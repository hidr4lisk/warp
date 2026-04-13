# =============================================================================
#  Hidr4lisk_WARP — Ephemeral P2P File Sync & Terminal Chat
#  warp.py — P2P Node
# =============================================================================
#
#  Author      : Federico Furgiuele
#  GitHub      : https://github.com/hidr4lisk/warp
#  LinkedIn    : https://linkedin.com/in/federico-furgiuele
#  Instagram   : https://instagram.com/hidr4lisk
#
#  Description : Zero-config ephemeral P2P node. Generates a session ID and
#                AES-256-GCM key pair on the fly, syncs files via MQTT relay,
#                and exposes a multiplexed terminal chat channel. No accounts,
#                no servers, no persistence — shut it down and the session
#                is gone.
#
#  Protocol    : WARPv2 — explicit frame types (FILE / CHAT / SYSTEM) over
#                MQTT with end-to-end encryption. The broker sees only
#                opaque ciphertext.
#
#  License     : MIT
#
#  Dependencies (install once):
#    pip install paho-mqtt cryptography watchdog
#
# =============================================================================
import os
import json
import base64
import time
import hashlib
import threading
import sys
import signal
import select
import socket
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from paho.mqtt import client as mqtt
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# ─── ANSI ──────────────────────────────────────────────────────────────────
G  = '\033[92m'   # Green
Y  = '\033[93m'   # Yellow
R  = '\033[91m'   # Red
C  = '\033[96m'   # Cyan
B  = '\033[1m'
D  = '\033[2m'
RS = '\033[0m'

NODE_NAME      = socket.gethostname().upper()
BROKER_URL     = "WARP-BROKER-PLACEHOLDER-URL"
BROKER_PORT    = 10000
SESSION_ID     = "WARP-0000-0000-0000"
SECRET_KEY_B64 = "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA="
PROTOCOL_ID    = "WARPv2"

# Graceful shutdown support
shutdown_event = threading.Event()
shutdown_lock  = threading.Lock()

# Buffer expiration: incomplete transfers are discarded after this many seconds.
BUFFER_TIMEOUT_S = 120
CHUNK_SIZE       = 1024 * 32
WATCH_DIR        = str(Path.cwd())
SAVE_DIR         = str(Path.cwd())

file_buffers       = {}
file_data_blocks   = {}
file_timestamps    = {}   # filename -> time first chunk arrived
file_lock          = threading.Lock()
_recently_received = {}   # filename -> timestamp written locally (anti-loop)
_sending_files     = {}   # filename -> timestamp being sent (anti-duplicate)
aesgcm             = AESGCM(base64.b64decode(SECRET_KEY_B64))


# ─── UI ────────────────────────────────────────────────────────────────────

def log(color, symbol, msg):
    print(f"{B}{color}[{symbol}]{RS} {msg}", flush=True)


def print_banner():
    print(f"{B}{G}"
          "\n"
          "██╗    ██╗ █████╗ ██████╗ ██████╗ \n"
          "██║    ██║██╔══██╗██╔══██╗██╔══██╗\n"
          "██║ █╗ ██║███████║██████╔╝██████╔╝\n"
          "██║███╗██║██╔══██║██╔══██╗██╔═══╝ \n"
          "╚███╔███╔╝██║  ██║██║  ██║██║     \n"
          " ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     \n"
          f"   BY FEDERICO FURGIUELE   {RS}")
    _print_panel()


def _print_panel():
    rows = [
        ("SECURE CHANNEL", SESSION_ID),
        ("ROUTING",        f"{BROKER_URL}:{BROKER_PORT}"),
        ("NODE",           NODE_NAME),
    ]
    col1 = max(len(k) for k, _ in rows)
    col2 = max(len(v) for _, v in rows)
    w    = col1 + col2 + 5

    def row(key, val):
        content = f"  {key:<{col1}}  {val}"
        return f"  {C}║{RS}{content:<{w}}{C}║{RS}"

    print(f"\n  {C}╔{'═' * w}╗{RS}")
    header = f"  LINK ESTABLISHED"
    print(f"  {C}║{RS}{B}{header:<{w}}{RS}{C}║{RS}")
    print(f"  {C}╠{'═' * w}╣{RS}")
    for k, v in rows:
        print(row(k, v))
    print(f"  {C}╚{'═' * w}╝{RS}\n")


# ─── CRYPTO ────────────────────────────────────────────────────────────────

def encrypt_payload(data_dict: dict) -> dict:
    plaintext  = json.dumps(data_dict).encode('utf-8')
    nonce      = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)
    return {
        "n": base64.b64encode(nonce).decode('utf-8'),
        "d": base64.b64encode(ciphertext).decode('utf-8')
    }


def decrypt_payload(payload: dict) -> dict:
    try:
        nonce      = base64.b64decode(payload["n"])
        ciphertext = base64.b64decode(payload["d"])
        plaintext  = aesgcm.decrypt(nonce, ciphertext, None)
        return json.loads(plaintext.decode('utf-8'))
    except Exception:
        return None


def build_frame(frame_type: str, body: dict) -> dict:
    return {
        "protocol":    PROTOCOL_ID,
        "frame_type":  frame_type,
        "version":     1,
        "timestamp":   int(time.time()),
        "body":        body,
    }


def send_frame(client, frame_type: str, body: dict, qos: int = 1):
    packet = encrypt_payload(build_frame(frame_type, body))
    client.publish(SESSION_ID, json.dumps(packet), qos=qos)


def send_disconnect_signal(client, reason: str = "shutdown"):
    try:
        send_frame(client, "SYSTEM", {
            "type":   "DISCONNECT",
            "origin": NODE_NAME,
            "reason": reason,
        }, qos=1)
    except Exception:
        pass


def reset_terminal():
    try:
        sys.stdout.write(f"{RS}\033c")
        sys.stdout.flush()
        os.system("stty sane")
    except Exception:
        pass


def perform_shutdown(client, observer, reason: str = "shutdown"):
    with shutdown_lock:
        if shutdown_event.is_set():
            return
        shutdown_event.set()

        log(Y, '*', f"Cierre limpio iniciado ({reason})...")
        send_disconnect_signal(client, reason)

        try:
            observer.stop()
            observer.join(timeout=5)
        except Exception:
            pass

        try:
            client.disconnect()
        except Exception:
            pass

        try:
            client.loop_stop()
        except Exception:
            pass

        reset_terminal()
        log(G, '*', "Cierre completo. Terminal restaurada.")


# ─── BUFFER CLEANUP ────────────────────────────────────────────────────────

def cleanup_loop():
    """Discard incomplete file transfers older than BUFFER_TIMEOUT_S seconds."""
    while True:
        time.sleep(30)
        now = time.time()
        with file_lock:
            expired = [
                name for name, ts in file_timestamps.items()
                if now - ts > BUFFER_TIMEOUT_S
            ]
            for name in expired:
                received = len(file_buffers.get(name, set()))
                total    = max(file_data_blocks.get(name, {}).keys(), default=-1) + 1
                log(R, '!', f"Transferencia expirada: {name} "
                            f"({received}/{total} chunks — descartado)")
                file_buffers.pop(name, None)
                file_data_blocks.pop(name, None)
                file_timestamps.pop(name, None)


# ─── FILE SEND ─────────────────────────────────────────────────────────────

def _process_file(client, filepath: str):
    path     = Path(filepath)
    filename = path.name

    if filename in ["warp_template.py", "warp.py"] or filename.startswith('.'):
        return

    time.sleep(0.3)  # Wait for writer to finish

    log(Y, '+', f"Sincronizando: {filename}")
    try:
        with open(filepath, 'rb') as f:
            data = f.read()

        total_chunks = (len(data) // CHUNK_SIZE) + 1
        file_hash    = hashlib.sha256(data).hexdigest()

        for i in range(total_chunks):
            chunk = data[i * CHUNK_SIZE:(i + 1) * CHUNK_SIZE]
            if not chunk:
                break
            send_frame(client, "FILE", {
                "type":         "CHUNK",
                "origin":       NODE_NAME,
                "filename":     filename,
                "chunk_index":  i,
                "total_chunks": total_chunks,
                "data":         base64.b64encode(chunk).decode('utf-8'),
                "hash":         file_hash
            }, qos=1)
            time.sleep(0.01)

        log(G, '✓', f"Inyectado en la red: {filename}")

    except Exception as e:
        log(R, '!', f"Error P2P - {filename}: {e}")
    finally:
        # Keep in _sending_files for a short grace period (2s) to ignore chatter
        def _clear():
            time.sleep(2.0)
            _sending_files.pop(filename, None)
        threading.Thread(target=_clear, daemon=True).start()


# ─── WATCHDOG HANDLER ──────────────────────────────────────────────────────

class WARPHandler(FileSystemEventHandler):
    """
    Listens for real filesystem events (Watchdog).
    Fires only when the OS reports a change — zero CPU at idle.
    """

    def __init__(self, mqtt_client):
        super().__init__()
        self._client = mqtt_client

    def _should_skip(self, path: str) -> bool:
        name = Path(path).name
        # Skip hidden files, the script itself, and files we just received
        if name.startswith('.') or name in ("warp.py", "warp_template.py"):
            return True
        if name in _recently_received or name in _sending_files:
            return True
        return False

    def _trigger_sync(self, path: str):
        name = Path(path).name
        with file_lock:
            if name in _sending_files:
                return
            _sending_files[name] = time.time()
        
        threading.Thread(
            target=_process_file,
            args=(self._client, path),
            daemon=True
        ).start()

    def on_created(self, event):
        if not event.is_directory and not self._should_skip(event.src_path):
            self._trigger_sync(event.src_path)

    def on_modified(self, event):
        if not event.is_directory and not self._should_skip(event.src_path):
            self._trigger_sync(event.src_path)


def start_observer(mqtt_client):
    """Start the watchdog Observer and return it (non-blocking)."""
    handler  = WARPHandler(mqtt_client)
    observer = Observer()
    observer.schedule(handler, WATCH_DIR, recursive=False)
    observer.start()
    return observer


# ─── FILE RECEIVE ──────────────────────────────────────────────────────────

def _handle_file_chunk(payload: dict):
    filename     = payload["filename"]
    chunk_index  = payload["chunk_index"]
    total_chunks = payload["total_chunks"]

    with file_lock:
        if filename not in file_buffers:
            file_buffers[filename]     = set()
            file_data_blocks[filename] = {}
            file_timestamps[filename]  = time.time()
            log(Y, '+', f"Recibiendo: {filename}...")

        file_data_blocks[filename][chunk_index] = base64.b64decode(payload["data"])
        file_buffers[filename].add(chunk_index)

        if len(file_buffers[filename]) == total_chunks:
            full_data = b"".join(
                file_data_blocks[filename][i] for i in range(total_chunks)
            )
            if hashlib.sha256(full_data).hexdigest() != payload.get("hash"):
                log(R, '!', f"INTEGRIDAD COMPROMETIDA: {filename}")
            else:
                # Register before writing so watchdog ignores this file event
                _recently_received[filename] = time.time()
                with open(Path(SAVE_DIR) / filename, 'wb') as f:
                    f.write(full_data)
                log(G, '✓', f"Reconstrucción exitosa: {filename}")

            del file_buffers[filename]
            del file_data_blocks[filename]
            del file_timestamps[filename]


# ─── RECENTLY-RECEIVED PURGE ───────────────────────────────────────────────

def purge_received_loop():
    """Purge _recently_received entries older than 3 seconds."""
    while True:
        time.sleep(1)
        now     = time.time()
        expired = [k for k, ts in list(_recently_received.items()) if now - ts > 3.0]
        for k in expired:
            _recently_received.pop(k, None)


# ─── CHAT ──────────────────────────────────────────────────────────────────

def chat_interface(client, shutdown_event):
    while not shutdown_event.is_set():
        try:
            ready, _, _ = select.select([sys.stdin], [], [], 0.5)
            if not ready:
                continue

            msg = sys.stdin.readline()
            if not msg:
                break
            msg = msg.strip()
            if msg == "":
                continue

            sys.stdout.write("\033[F\033[K")
            print(f"{B}{G}<{NODE_NAME}>{RS} {msg}", flush=True)
            send_frame(client, "CHAT", {
                "type":   "TEXT",
                "origin": NODE_NAME,
                "msg":    msg
            }, qos=1)
        except KeyboardInterrupt:
            break
        except EOFError:
            break
        except Exception as e:
            log(R, '!', f"Chat error: {e}")
            break


# ─── MQTT CALLBACKS ────────────────────────────────────────────────────────

def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        client.subscribe(SESSION_ID, qos=1)
    else:
        log(R, '!', f"Error de conexión: {reason_code}")


def on_message(client, userdata, msg):
    try:
        decrypted = decrypt_payload(json.loads(msg.payload.decode('utf-8')))
        if not decrypted:
            return

        if decrypted.get("protocol") != PROTOCOL_ID:
            return

        frame_type = decrypted.get("frame_type")
        body       = decrypted.get("body", {})
        origin     = body.get("origin", "PEER")
        if origin == NODE_NAME:
            return

        if frame_type == "FILE" and body.get("type") == "CHUNK":
            _handle_file_chunk(body)
        elif frame_type == "CHAT" and body.get("type") == "TEXT":
            print(f"\n{B}{Y}<{origin}>{RS} {body.get('msg', '')}\n", flush=True)
        elif frame_type == "SYSTEM" and body.get("type") == "DISCONNECT":
            reason = body.get("reason", "desconocido")
            log(Y, '!', f"Peer desconectado: {origin} ({reason})")
    except Exception:
        pass


# ─── MAIN ──────────────────────────────────────────────────────────────────

def main():
    print_banner()

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = on_connect
    client.on_message = on_message

    retry_delay = 1
    while True:
        try:
            client.connect(BROKER_URL, BROKER_PORT, 60)
            break
        except Exception as e:
            log(R, '!', f"Enlace caído: {e}. Reintentando en {retry_delay}s...")
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 30)

    client.loop_start()

    print(f"{D}Terminal multiplexada. Escribe para iniciar el chat...{RS}\n")

    # ── Background threads ─────────────────────────────────────────────────
    observer = start_observer(client)   # watchdog: filesystem events
    threading.Thread(target=cleanup_loop,       daemon=True).start()  # buffer GC
    threading.Thread(target=purge_received_loop, daemon=True).start() # anti-loop GC
    threading.Thread(target=chat_interface, args=(client, shutdown_event), daemon=True).start()

    def _signal_handler(signum, frame):
        perform_shutdown(client, observer, reason=f"signal {signum}")

    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    try:
        shutdown_event.wait()
    except KeyboardInterrupt:
        perform_shutdown(client, observer, reason="KeyboardInterrupt")


if __name__ == "__main__":
    main()
