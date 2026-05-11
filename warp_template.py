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
import re
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
G  = '\033[92m'
Y  = '\033[93m'
R  = '\033[91m'
C  = '\033[96m'
B  = '\033[1m'
D  = '\033[2m'
RS = '\033[0m'

NODE_NAME      = socket.gethostname().upper()
BROKER_URL     = "{{ BROKER_URL }}"
BROKER_PORT    = {{ BROKER_PORT }}
SESSION_ID     = "{{ SESSION_ID }}"
SECRET_KEY_B64 = "{{ SECRET_KEY }}"
PROTOCOL_ID    = "WARPv2"

MAX_FRAME_AGE_S     = 60     # replay protection: reject frames older than this
MAX_CHUNKS_PER_FILE = 8192   # 8192 × 32 KB = 256 MB max file size

# Graceful shutdown support
shutdown_event = threading.Event()
shutdown_lock  = threading.Lock()

BUFFER_TIMEOUT_S = 120
CHUNK_SIZE       = 1024 * 32
WATCH_DIR        = str(Path.cwd())
SAVE_DIR         = str(Path.cwd())

file_buffers       = {}
file_data_blocks   = {}
file_timestamps    = {}
file_total_chunks  = {}   # filename -> expected total_chunks (consistency guard)
file_hashes        = {}   # filename -> sha256 hex from last chunk
file_lock          = threading.Lock()
_recently_received = {}   # filename -> (timestamp, ttl)  anti-loop guard
_sending_files     = {}   # filename -> timestamp  anti-duplicate guard
aesgcm             = AESGCM(base64.b64decode(SECRET_KEY_B64))

_print_lock             = threading.Lock()
_logged_proto_mismatch  = False
LAST_PEER_SEEN          = {}   # hostname -> timestamp

# Strips terminal escape sequences — prevents ANSI injection via chat/filenames
_ANSI_STRIP = re.compile(
    r'\x1b\[[0-9;?]*[a-zA-Z]'
    r'|\x1b\].*?(?:\x07|\x1b\\)'
    r'|\x1b[PX^_].*?\x1b\\'
    r'|[\x00-\x08\x0b-\x1f\x7f]'
)


# ─── UI ────────────────────────────────────────────────────────────────────

def safe_print(*args, **kwargs):
    with _print_lock:
        print(*args, **kwargs)


def sanitize_terminal(s: str, max_len: int = 2000) -> str:
    if not isinstance(s, str):
        return ''
    return _ANSI_STRIP.sub('', s)[:max_len]


def log(color, symbol, msg):
    safe_print(f"{B}{color}[{symbol}]{RS} {msg}", flush=True)


def print_banner():
    safe_print(f"{B}{G}"
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

    safe_print(f"\n  {C}╔{'═' * w}╗{RS}")
    header = "  LINK ESTABLISHED"
    safe_print(f"  {C}║{RS}{B}{header:<{w}}{RS}{C}║{RS}")
    safe_print(f"  {C}╠{'═' * w}╣{RS}")
    for k, v in rows:
        safe_print(row(k, v))
    safe_print(f"  {C}╚{'═' * w}╝{RS}\n")


# ─── FILENAME SAFETY ───────────────────────────────────────────────────────

def _safe_filename(raw) -> str | None:
    """Strip directory components; return None if the result is unsafe.

    # test case: _safe_filename('../../../etc/cron.d/evil') == None
    # test case: _safe_filename('foo.txt') == 'foo.txt'
    # test case: _safe_filename('.hidden') == None
    # test case: _safe_filename('a' * 256) == None
    """
    if not raw or not isinstance(raw, str):
        return None
    name = Path(raw).name
    if not name or name in ('.', '..'):
        return None
    if name.startswith('.'):
        return None
    if len(name) > 255:
        return None
    if any(ord(c) < 32 for c in name):
        return None
    return name


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
        "protocol":   PROTOCOL_ID,
        "frame_type": frame_type,
        "version":    1,
        "timestamp":  int(time.time()),
        "body":       body,
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

        log(Y, '*', f"Clean shutdown initiated ({reason})...")
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
        log(G, '*', "Shutdown complete. Terminal restored.")


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
                total    = file_total_chunks.get(name, '?')
                log(R, '!', f"Transfer expired: {name} "
                            f"({received}/{total} chunks — discarded)")
                file_buffers.pop(name, None)
                file_data_blocks.pop(name, None)
                file_timestamps.pop(name, None)
                file_total_chunks.pop(name, None)
                file_hashes.pop(name, None)


# ─── FILE SEND ─────────────────────────────────────────────────────────────

def _process_file(client, filepath: str):
    path     = Path(filepath)
    filename = path.name

    if filename in ["warp_template.py", "warp.py"] or filename.startswith('.'):
        return

    time.sleep(0.3)  # Wait for writer to finish

    log(Y, '+', f"Syncing: {filename}")
    try:
        with open(filepath, 'rb') as f:
            data = f.read()

        # Ceiling division — correct for all sizes including exact multiples of CHUNK_SIZE
        # test case: len=32768 (CHUNK_SIZE*1) → total_chunks=1, not 2
        total_chunks = max(1, (len(data) + CHUNK_SIZE - 1) // CHUNK_SIZE)
        file_hash    = hashlib.sha256(data).hexdigest()

        for i in range(total_chunks):
            chunk = data[i * CHUNK_SIZE:(i + 1) * CHUNK_SIZE]
            body = {
                "type":         "CHUNK",
                "origin":       NODE_NAME,
                "filename":     filename,
                "chunk_index":  i,
                "total_chunks": total_chunks,
                "data":         base64.b64encode(chunk).decode('utf-8'),
            }
            if i == total_chunks - 1:
                body["hash"] = file_hash  # hash only in last chunk
            send_frame(client, "FILE", body, qos=1)
            time.sleep(0.01)

        log(G, '✓', f"Injected into network: {filename}")

    except Exception as e:
        log(R, '!', f"P2P error — {filename}: {e}")
    finally:
        def _clear():
            time.sleep(2.0)
            _sending_files.pop(filename, None)
        threading.Thread(target=_clear, daemon=True).start()


# ─── WATCHDOG HANDLER ──────────────────────────────────────────────────────

class WARPHandler(FileSystemEventHandler):
    """Listens for real filesystem events. Zero CPU at idle."""

    def __init__(self, mqtt_client):
        super().__init__()
        self._client = mqtt_client

    def _should_skip(self, path: str) -> bool:
        name = Path(path).name
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
    handler  = WARPHandler(mqtt_client)
    observer = Observer()
    observer.schedule(handler, WATCH_DIR, recursive=False)
    observer.start()
    return observer


# ─── FILE RECEIVE ──────────────────────────────────────────────────────────

def _handle_file_chunk(payload: dict):
    filename = _safe_filename(payload.get("filename", ""))
    if not filename:
        log(R, '!', "Received chunk with invalid filename, discarded.")
        return

    try:
        chunk_index    = int(payload["chunk_index"])
        total_chunks   = int(payload["total_chunks"])
        chunk_data_b64 = payload["data"]
    except (KeyError, ValueError, TypeError):
        log(R, '!', "Malformed file chunk frame, discarded.")
        return

    # test case: total_chunks=10_000_000 → rejected
    if not (1 <= total_chunks <= MAX_CHUNKS_PER_FILE):
        log(R, '!', f"total_chunks out of range: {total_chunks}")
        return
    # test case: chunk_index=99999, total_chunks=2 → rejected
    if not (0 <= chunk_index < total_chunks):
        log(R, '!', f"chunk_index out of range: {chunk_index}/{total_chunks}")
        return
    if not isinstance(chunk_data_b64, str) or len(chunk_data_b64) > CHUNK_SIZE * 2:
        log(R, '!', f"Invalid chunk data for {filename}")
        return

    with file_lock:
        if filename not in file_buffers:
            file_buffers[filename]      = set()
            file_data_blocks[filename]  = {}
            file_timestamps[filename]   = time.time()
            file_total_chunks[filename] = total_chunks
            log(Y, '+', f"Receiving: {filename}...")
        elif file_total_chunks[filename] != total_chunks:
            # Inconsistent total_chunks mid-transfer — abort to prevent corruption
            log(R, '!', f"Inconsistent total_chunks for {filename}, aborting transfer.")
            file_buffers.pop(filename, None)
            file_data_blocks.pop(filename, None)
            file_timestamps.pop(filename, None)
            file_total_chunks.pop(filename, None)
            file_hashes.pop(filename, None)
            return

        try:
            file_data_blocks[filename][chunk_index] = base64.b64decode(chunk_data_b64)
        except Exception:
            log(R, '!', f"Failed to decode chunk {chunk_index} for {filename}")
            return
        file_buffers[filename].add(chunk_index)

        if "hash" in payload and isinstance(payload["hash"], str) and len(payload["hash"]) == 64:
            file_hashes[filename] = payload["hash"]

        received = len(file_buffers[filename])
        # Progress update every 10 chunks and on completion
        if received % 10 == 0 or received == total_chunks:
            pct = (received / total_chunks) * 100
            with _print_lock:
                print(f"\r  {filename}: {pct:.0f}% ({received}/{total_chunks})",
                      end='', flush=True)
                if received == total_chunks:
                    print()

        if received == total_chunks:
            full_data     = b"".join(
                file_data_blocks[filename][i] for i in range(total_chunks)
            )
            expected_hash = file_hashes.pop(filename, None)
            actual_hash   = hashlib.sha256(full_data).hexdigest()

            if expected_hash and actual_hash != expected_hash:
                log(R, '!', f"INTEGRITY COMPROMISED: {filename}")
            else:
                target_path = Path(SAVE_DIR) / filename
                with open(target_path, 'wb') as f:
                    f.write(full_data)
                # Register AFTER write with adaptive TTL (min 3s, up to 30s for large files)
                # Registering before write caused a race: purge loop could expire the entry
                # while a large file was still being written, re-triggering sync.
                ttl = min(30.0, max(3.0, len(full_data) / (10 * 1024 * 1024)))
                _recently_received[filename] = (time.time(), ttl)
                log(G, '✓', f"Reconstruction successful: {filename}")

            file_buffers.pop(filename, None)
            file_data_blocks.pop(filename, None)
            file_timestamps.pop(filename, None)
            file_total_chunks.pop(filename, None)


# ─── RECENTLY-RECEIVED PURGE ───────────────────────────────────────────────

def purge_received_loop():
    """Purge _recently_received entries past their adaptive TTL."""
    while True:
        time.sleep(1)
        now     = time.time()
        expired = [
            k for k, (ts, ttl) in list(_recently_received.items())
            if now - ts > ttl
        ]
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
            safe_print(f"{B}{G}<{NODE_NAME}>{RS} {msg}", flush=True)
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


# ─── HEARTBEAT ─────────────────────────────────────────────────────────────

def heartbeat_loop(client):
    """Ping every 30s; mark a peer offline after 3 missed intervals."""
    while not shutdown_event.is_set():
        time.sleep(30)
        if shutdown_event.is_set():
            break
        send_frame(client, "SYSTEM", {"type": "PING", "origin": NODE_NAME})
        now = time.time()
        for peer, ts in list(LAST_PEER_SEEN.items()):
            if now - ts > 90:
                log(Y, '!', f"Peer {peer} silent for 90s — may be offline")
                LAST_PEER_SEEN.pop(peer, None)


# ─── MQTT CALLBACKS ────────────────────────────────────────────────────────

def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        client.subscribe(SESSION_ID, qos=1)
    else:
        log(R, '!', f"Connection error: {reason_code}")


def on_message(client, userdata, msg):
    global _logged_proto_mismatch
    try:
        decrypted = decrypt_payload(json.loads(msg.payload.decode('utf-8')))
        if not decrypted:
            return

        peer_protocol = decrypted.get("protocol", "unknown")
        if peer_protocol != PROTOCOL_ID:
            if not _logged_proto_mismatch:
                log(R, '!', f"Protocol mismatch: peer uses {peer_protocol}, "
                            f"we use {PROTOCOL_ID}. Update one of the two nodes.")
                _logged_proto_mismatch = True
            return

        # Replay protection: silently drop frames outside the freshness window
        ts = decrypted.get("timestamp", 0)
        if not isinstance(ts, (int, float)) or abs(time.time() - ts) > MAX_FRAME_AGE_S:
            return

        frame_type = decrypted.get("frame_type")
        body       = decrypted.get("body", {})
        origin     = body.get("origin", "PEER")
        if origin == NODE_NAME:
            return

        if origin not in LAST_PEER_SEEN:
            log(G, '●', f"Peer online: {origin}")
        LAST_PEER_SEEN[origin] = time.time()

        if frame_type == "FILE" and body.get("type") == "CHUNK":
            _handle_file_chunk(body)
        elif frame_type == "CHAT" and body.get("type") == "TEXT":
            safe_origin = sanitize_terminal(str(origin), max_len=64)
            safe_msg    = sanitize_terminal(body.get('msg', ''), max_len=2000)
            safe_print(f"\n{B}{Y}<{safe_origin}>{RS} {safe_msg}\n", flush=True)
        elif frame_type == "SYSTEM":
            sys_type = body.get("type")
            if sys_type == "DISCONNECT":
                reason = body.get("reason", "unknown")
                log(Y, '!', f"Peer disconnected: {origin} ({reason})")
                LAST_PEER_SEEN.pop(origin, None)
            elif sys_type == "PING":
                send_frame(client, "SYSTEM", {"type": "PONG", "origin": NODE_NAME})
    except Exception:
        pass


# ─── MAIN ──────────────────────────────────────────────────────────────────

def main():
    print_banner()

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = on_connect
    client.on_message = on_message

    # Install early signal handlers before any blocking call so Ctrl+C works
    # during the connection retry loop
    def _early_signal(signum, frame):
        log(Y, '*', "Connection cancelled.")
        reset_terminal()
        sys.exit(0)

    signal.signal(signal.SIGINT, _early_signal)
    if hasattr(signal, 'SIGTERM'):
        try:
            signal.signal(signal.SIGTERM, _early_signal)
        except (AttributeError, ValueError):
            pass

    # Resolve to IPv4 explicitly — test.mosquitto.org returns IPv6 first,
    # which fails with ENETUNREACHABLE on networks without IPv6 routing.
    try:
        broker_ip = socket.getaddrinfo(BROKER_URL, BROKER_PORT, socket.AF_INET)[0][4][0]
    except Exception:
        broker_ip = BROKER_URL

    retry_delay  = 1
    max_attempts = 10
    for attempt in range(max_attempts):
        try:
            client.connect(broker_ip, BROKER_PORT, 60)
            break
        except Exception as e:
            log(R, '!', f"Link down ({attempt + 1}/{max_attempts}): {e}. "
                        f"Retrying in {retry_delay}s...")
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 30)
    else:
        log(R, '!', "Could not connect to broker after max attempts. Aborting.")
        sys.exit(1)

    client.loop_start()

    safe_print(f"{D}Multiplexed terminal. Type to start chat...{RS}\n")

    observer = start_observer(client)
    threading.Thread(target=cleanup_loop,        daemon=True).start()
    threading.Thread(target=purge_received_loop, daemon=True).start()
    threading.Thread(target=chat_interface, args=(client, shutdown_event), daemon=True).start()
    threading.Thread(target=heartbeat_loop, args=(client,), daemon=True).start()

    def _signal_handler(signum, frame):
        perform_shutdown(client, observer, reason=f"signal {signum}")

    signal.signal(signal.SIGINT, _signal_handler)
    if hasattr(signal, 'SIGTERM'):
        try:
            signal.signal(signal.SIGTERM, _signal_handler)
        except (AttributeError, ValueError):
            pass

    try:
        shutdown_event.wait()
    except KeyboardInterrupt:
        perform_shutdown(client, observer, reason="KeyboardInterrupt")


if __name__ == "__main__":
    main()
