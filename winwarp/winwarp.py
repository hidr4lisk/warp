#!/usr/bin/env python3
# =============================================================================
#  Hidr4lisk_WARP — Windows GUI
#  winwarp.py — Graphical P2P Node
# =============================================================================
#
#  Author  : Federico Furgiuele
#  GitHub  : https://github.com/hidr4lisk/warp
#
#  Place warp.py (from hidr4lisk.github.io/warp) next to this exe.
#  Dependencies: pip install paho-mqtt cryptography tkinterdnd2
# =============================================================================

import os, re, json, base64, time, hashlib, threading, socket, sys
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from paho.mqtt import client as mqtt
import tkinter as tk
from tkinter import scrolledtext, messagebox, filedialog

try:
    from tkinterdnd2 import TkinterDnD, DND_FILES
    DND_AVAILABLE = True
except ImportError:
    DND_AVAILABLE = False

# ─── THEME (Rick & Morty) ────────────────────────────────────────────────────
BG         = "#0a0a0a"
BG2        = "#0f0f0f"
BG3        = "#161616"
GREEN      = "#00ff88"
GREEN_DIM  = "#005533"
GREEN_GLOW = "#00ffaa"
PORTAL_BG  = "#030f07"
FG         = "#c8ffc8"
FG_DIM     = "#4a6b4a"
YELLOW     = "#ffe066"
RED_FG     = "#ff5555"

MONO   = ("Consolas", 10)
MONO_S = ("Consolas", 9)
MONO_L = ("Consolas", 13, "bold")
MONO_H = ("Consolas", 10, "bold")

# ─── PROTOCOL ────────────────────────────────────────────────────────────────
PROTOCOL_ID         = "WARPv2"
MAX_FRAME_AGE_S     = 60
MAX_CHUNKS_PER_FILE = 8192
CHUNK_SIZE          = 1024 * 32

_ANSI_STRIP = re.compile(
    r'\x1b\[[0-9;?]*[a-zA-Z]'
    r'|\x1b\].*?(?:\x07|\x1b\\)'
    r'|\x1b[PX^_].*?\x1b\\'
    r'|[\x00-\x08\x0b-\x1f\x7f]'
)

def sanitize(s, max_len=2000):
    if not isinstance(s, str):
        return ''
    return _ANSI_STRIP.sub('', s)[:max_len]

def _safe_filename(raw):
    if not raw or not isinstance(raw, str):
        return None
    name = Path(raw).name
    if not name or name in ('.', '..') or name.startswith('.'):
        return None
    if len(name) > 255 or any(ord(c) < 32 for c in name):
        return None
    return name

# ─── CREDENTIALS ─────────────────────────────────────────────────────────────
def load_credentials():
    base = Path(sys.executable).parent if getattr(sys, 'frozen', False) else Path(__file__).parent
    warp_path = base / "warp.py"

    if not warp_path.exists():
        messagebox.showerror(
            "Hidr4lisk_WARP",
            "warp.py not found in this folder.\n\n"
            "Generate one at  hidr4lisk.github.io/warp\n"
            "and place it here next to this exe."
        )
        sys.exit(1)

    content = warp_path.read_text(encoding="utf-8")

    def get(pattern, cast=str):
        m = re.search(pattern, content)
        if not m:
            raise ValueError(pattern)
        return cast(m.group(1))

    try:
        return {
            "SESSION_ID":     get(r'SESSION_ID\s*=\s*"([^"]+)"'),
            "SECRET_KEY_B64": get(r'SECRET_KEY_B64\s*=\s*"([^"]+)"'),
            "BROKER_URL":     get(r'BROKER_URL\s*=\s*"([^"]+)"'),
            "BROKER_PORT":    get(r'BROKER_PORT\s*=\s*(\d+)', int),
        }
    except ValueError as e:
        messagebox.showerror("Hidr4lisk_WARP", f"Could not parse warp.py.\nPattern missing: {e}")
        sys.exit(1)

# ─── APP ─────────────────────────────────────────────────────────────────────
class WarpApp:
    def __init__(self, root, creds):
        self.root   = root
        self.creds  = creds
        self.node   = socket.gethostname().upper()
        self.aesgcm = AESGCM(base64.b64decode(creds["SECRET_KEY_B64"]))

        self.shutdown_event = threading.Event()
        self.mqtt_client    = None

        self.peers              = {}
        self.file_buffers       = {}
        self.file_data_blocks   = {}
        self.file_timestamps    = {}
        self.file_total_chunks  = {}
        self.file_hashes        = {}
        self.file_lock          = threading.Lock()
        self._recently_received = {}
        self._sending_files     = {}
        self._proto_mismatch    = False

        base = Path(sys.executable).parent if getattr(sys, 'frozen', False) else Path(__file__).parent
        self.save_dir = base / "received"
        self.save_dir.mkdir(exist_ok=True)

        self._build_ui()
        self._connect_mqtt()
        self._start_threads()
        self._pulse_portal()

        root.protocol("WM_DELETE_WINDOW", self._on_close)

    # ── UI ────────────────────────────────────────────────────────────────────
    def _build_ui(self):
        self.root.title("Hidr4lisk_WARP")
        self.root.configure(bg=BG)
        self.root.minsize(820, 580)

        # Header
        hdr = tk.Frame(self.root, bg=BG, pady=7)
        hdr.pack(fill=tk.X, padx=12)
        tk.Label(hdr, text="Hidr4lisk_WARP", font=MONO_L, bg=BG, fg=GREEN).pack(side=tk.LEFT)
        self.peer_label = tk.Label(hdr, text="● waiting for peer...", font=MONO_S, bg=BG, fg=FG_DIM)
        self.peer_label.pack(side=tk.RIGHT, padx=4)

        tk.Frame(self.root, bg=GREEN_DIM, height=1).pack(fill=tk.X, padx=12)

        # Main pane
        main = tk.Frame(self.root, bg=BG)
        main.pack(fill=tk.BOTH, expand=True, padx=12, pady=(8, 0))
        main.columnconfigure(0, weight=3)
        main.columnconfigure(1, weight=2)
        main.rowconfigure(0, weight=1)

        # Chat
        chat_wrap = tk.Frame(main, bg=BG)
        chat_wrap.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        tk.Label(chat_wrap, text="CHAT", font=MONO_H, bg=BG, fg=GREEN_GLOW, anchor="w").pack(fill=tk.X)
        self.chat_box = scrolledtext.ScrolledText(
            chat_wrap, bg=BG3, fg=FG, font=MONO,
            insertbackground=GREEN, relief=tk.FLAT, bd=0,
            state=tk.DISABLED, wrap=tk.WORD,
            highlightthickness=1, highlightbackground=GREEN_DIM
        )
        self.chat_box.pack(fill=tk.BOTH, expand=True)
        self.chat_box.tag_config("me",   foreground=GREEN)
        self.chat_box.tag_config("peer", foreground=YELLOW)
        self.chat_box.tag_config("sys",  foreground=FG_DIM)

        # Portal
        portal_wrap = tk.Frame(main, bg=BG)
        portal_wrap.grid(row=0, column=1, sticky="nsew")
        tk.Label(portal_wrap, text="PORTAL", font=MONO_H, bg=BG, fg=GREEN_GLOW, anchor="w").pack(fill=tk.X)

        self.portal_frame = tk.Frame(
            portal_wrap, bg=PORTAL_BG,
            highlightthickness=2, highlightbackground=GREEN,
            relief=tk.FLAT
        )
        self.portal_frame.pack(fill=tk.BOTH, expand=True)

        inner = tk.Frame(self.portal_frame, bg=PORTAL_BG)
        inner.place(relx=0.5, rely=0.5, anchor=tk.CENTER)

        self.portal_icon = tk.Label(inner, text="◈", font=("Consolas", 38, "bold"), bg=PORTAL_BG, fg=GREEN)
        self.portal_icon.pack()
        tk.Label(inner, text="drop files here", font=MONO_S, bg=PORTAL_BG, fg=FG_DIM).pack()
        tk.Button(
            inner, text="[ BROWSE ]", font=MONO_S,
            bg=BG3, fg=GREEN, relief=tk.FLAT, bd=0,
            activebackground=GREEN_DIM, activeforeground=GREEN,
            cursor="hand2", command=self._browse_files
        ).pack(pady=(10, 0))

        if DND_AVAILABLE:
            self.portal_frame.drop_target_register(DND_FILES)
            self.portal_frame.dnd_bind('<<Drop>>', self._on_drop)

        # Input
        tk.Frame(self.root, bg=GREEN_DIM, height=1).pack(fill=tk.X, padx=12, pady=(8, 0))
        input_row = tk.Frame(self.root, bg=BG, pady=7)
        input_row.pack(fill=tk.X, padx=12)

        self.msg_var = tk.StringVar()
        self.msg_entry = tk.Entry(
            input_row, textvariable=self.msg_var,
            bg=BG3, fg=FG, font=MONO, insertbackground=GREEN,
            relief=tk.FLAT, bd=4,
            highlightthickness=1, highlightbackground=GREEN_DIM
        )
        self.msg_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 8))
        self.msg_entry.bind("<Return>", lambda _: self._send_chat())

        tk.Button(
            input_row, text="SEND", font=MONO_H,
            bg=GREEN_DIM, fg=GREEN, relief=tk.FLAT, bd=0,
            activebackground=GREEN, activeforeground=BG,
            cursor="hand2", padx=16, command=self._send_chat
        ).pack(side=tk.RIGHT)

        # File history
        tk.Frame(self.root, bg=GREEN_DIM, height=1).pack(fill=tk.X, padx=12)
        hist_wrap = tk.Frame(self.root, bg=BG, pady=5)
        hist_wrap.pack(fill=tk.X, padx=12, pady=(0, 8))
        tk.Label(hist_wrap, text="FILE HISTORY", font=MONO_S, bg=BG, fg=FG_DIM).pack(anchor="w")
        self.history_box = tk.Listbox(
            hist_wrap, bg=BG, fg=GREEN, font=MONO_S,
            relief=tk.FLAT, bd=0, height=4,
            selectbackground=GREEN_DIM, selectforeground=GREEN,
            highlightthickness=0
        )
        self.history_box.pack(fill=tk.X)

    # ── Portal pulse ──────────────────────────────────────────────────────────
    _pulse_idx    = 0
    _pulse_colors = ["#00ff88", "#00dd77", "#00bb66", "#00dd77", "#00ff88"]

    def _pulse_portal(self):
        c = self._pulse_colors[self._pulse_idx % len(self._pulse_colors)]
        self.portal_frame.config(highlightbackground=c)
        self.portal_icon.config(fg=c)
        self._pulse_idx += 1
        self.root.after(500, self._pulse_portal)

    # ── Chat helpers ──────────────────────────────────────────────────────────
    def _append_chat(self, text, tag="sys"):
        def _do():
            self.chat_box.config(state=tk.NORMAL)
            self.chat_box.insert(tk.END, text + "\n", tag)
            self.chat_box.see(tk.END)
            self.chat_box.config(state=tk.DISABLED)
        self.root.after(0, _do)

    def _send_chat(self):
        msg = self.msg_var.get().strip()
        if not msg or not self.mqtt_client:
            return
        self.msg_var.set("")
        self._append_chat(f"<{self.node}> {msg}", "me")
        self._send_frame("CHAT", {"type": "TEXT", "origin": self.node, "msg": msg})

    # ── File history helpers ──────────────────────────────────────────────────
    def _add_history(self, filename, direction, status="·"):
        arrow = "↑" if direction == "sent" else "↓"
        def _do():
            self.history_box.insert(0, f"  {status} {arrow}  {filename}")
        self.root.after(0, _do)

    def _update_history(self, filename, new_status):
        def _do():
            for i in range(self.history_box.size()):
                item = self.history_box.get(i)
                if filename in item:
                    updated = re.sub(r'^\s+\S', f"  {new_status}", item)
                    self.history_box.delete(i)
                    self.history_box.insert(i, updated)
                    break
        self.root.after(0, _do)

    # ── Peer label ────────────────────────────────────────────────────────────
    def _refresh_peers(self):
        def _do():
            if self.peers:
                self.peer_label.config(text="● " + ", ".join(self.peers), fg=GREEN)
            else:
                self.peer_label.config(text="● waiting for peer...", fg=FG_DIM)
        self.root.after(0, _do)

    # ── Crypto ───────────────────────────────────────────────────────────────
    def _encrypt(self, data_dict):
        plaintext  = json.dumps(data_dict).encode("utf-8")
        nonce      = os.urandom(12)
        ciphertext = self.aesgcm.encrypt(nonce, plaintext, None)
        return {
            "n": base64.b64encode(nonce).decode("utf-8"),
            "d": base64.b64encode(ciphertext).decode("utf-8"),
        }

    def _decrypt(self, payload):
        try:
            nonce      = base64.b64decode(payload["n"])
            ciphertext = base64.b64decode(payload["d"])
            plaintext  = self.aesgcm.decrypt(nonce, ciphertext, None)
            return json.loads(plaintext.decode("utf-8"))
        except Exception:
            return None

    def _build_frame(self, frame_type, body):
        return {
            "protocol":   PROTOCOL_ID,
            "frame_type": frame_type,
            "version":    1,
            "timestamp":  int(time.time()),
            "body":       body,
        }

    def _send_frame(self, frame_type, body, qos=1):
        if not self.mqtt_client:
            return
        try:
            packet = self._encrypt(self._build_frame(frame_type, body))
            self.mqtt_client.publish(self.creds["SESSION_ID"], json.dumps(packet), qos=qos)
        except Exception:
            pass

    # ── File send ─────────────────────────────────────────────────────────────
    def _browse_files(self):
        paths = filedialog.askopenfilenames(title="Select files to send via PORTAL")
        for p in paths:
            self._queue_send(p)

    def _on_drop(self, event):
        for p in self.root.tk.splitlist(event.data):
            if os.path.isfile(p):
                self._queue_send(p)

    def _queue_send(self, filepath):
        name = Path(filepath).name
        if name in self._sending_files:
            return
        self._sending_files[name] = time.time()
        self._add_history(name, "sent", "↑")
        threading.Thread(target=self._send_file, args=(filepath,), daemon=True).start()

    def _send_file(self, filepath):
        name = Path(filepath).name
        try:
            with open(filepath, "rb") as f:
                data = f.read()

            total_chunks = max(1, (len(data) + CHUNK_SIZE - 1) // CHUNK_SIZE)
            file_hash    = hashlib.sha256(data).hexdigest()

            for i in range(total_chunks):
                chunk = data[i * CHUNK_SIZE:(i + 1) * CHUNK_SIZE]
                body  = {
                    "type":         "CHUNK",
                    "origin":       self.node,
                    "filename":     name,
                    "chunk_index":  i,
                    "total_chunks": total_chunks,
                    "data":         base64.b64encode(chunk).decode("utf-8"),
                }
                if i == total_chunks - 1:
                    body["hash"] = file_hash
                self._send_frame("FILE", body, qos=1)
                time.sleep(0.01)

            self._update_history(name, "✓")
            self._append_chat(f"[sent] {name}", "sys")

        except Exception as e:
            self._update_history(name, "✗")
            self._append_chat(f"[error sending] {name}: {e}", "sys")
        finally:
            def _clear():
                time.sleep(2.0)
                self._sending_files.pop(name, None)
            threading.Thread(target=_clear, daemon=True).start()

    # ── File receive ──────────────────────────────────────────────────────────
    def _handle_chunk(self, body):
        name = _safe_filename(body.get("filename", ""))
        if not name:
            return

        try:
            idx    = int(body["chunk_index"])
            total  = int(body["total_chunks"])
            raw_b64 = body["data"]
        except (KeyError, ValueError, TypeError):
            return

        if not (1 <= total <= MAX_CHUNKS_PER_FILE):
            return
        if not (0 <= idx < total):
            return
        if not isinstance(raw_b64, str) or len(raw_b64) > CHUNK_SIZE * 2:
            return

        with self.file_lock:
            if name not in self.file_buffers:
                self.file_buffers[name]      = set()
                self.file_data_blocks[name]  = {}
                self.file_timestamps[name]   = time.time()
                self.file_total_chunks[name] = total
                self._add_history(name, "received", "↓")
            elif self.file_total_chunks[name] != total:
                for d in (self.file_buffers, self.file_data_blocks,
                          self.file_timestamps, self.file_total_chunks, self.file_hashes):
                    d.pop(name, None)
                return

            try:
                self.file_data_blocks[name][idx] = base64.b64decode(raw_b64)
            except Exception:
                return

            self.file_buffers[name].add(idx)

            if "hash" in body and isinstance(body["hash"], str) and len(body["hash"]) == 64:
                self.file_hashes[name] = body["hash"]

            if len(self.file_buffers[name]) == total:
                full_data     = b"".join(self.file_data_blocks[name][i] for i in range(total))
                expected_hash = self.file_hashes.pop(name, None)
                actual_hash   = hashlib.sha256(full_data).hexdigest()

                if expected_hash and actual_hash != expected_hash:
                    self._update_history(name, "✗")
                    self._append_chat(f"[integrity error] {name}", "sys")
                else:
                    target = self.save_dir / name
                    with open(target, "wb") as f:
                        f.write(full_data)
                    ttl = min(30.0, max(3.0, len(full_data) / (10 * 1024 * 1024)))
                    self._recently_received[name] = (time.time(), ttl)
                    self._update_history(name, "✓")
                    self._append_chat(f"[received] {name}  →  received/", "sys")

                for d in (self.file_buffers, self.file_data_blocks,
                          self.file_timestamps, self.file_total_chunks):
                    d.pop(name, None)

    # ── MQTT ─────────────────────────────────────────────────────────────────
    def _connect_mqtt(self):
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        c.on_connect = self._on_connect
        c.on_message = self._on_message
        self.mqtt_client = c
        self._append_chat(f"Connecting to {self.creds['BROKER_URL']}...", "sys")
        threading.Thread(target=self._mqtt_connect_loop, daemon=True).start()

    def _mqtt_connect_loop(self):
        try:
            ip = socket.getaddrinfo(
                self.creds["BROKER_URL"], self.creds["BROKER_PORT"], socket.AF_INET
            )[0][4][0]
        except Exception:
            ip = self.creds["BROKER_URL"]

        delay = 1
        for attempt in range(10):
            if self.shutdown_event.is_set():
                return
            try:
                self.mqtt_client.connect(ip, self.creds["BROKER_PORT"], 60)
                self.mqtt_client.loop_start()
                return
            except Exception as e:
                self._append_chat(f"Retry {attempt+1}/10: {e}", "sys")
                time.sleep(delay)
                delay = min(delay * 2, 30)

        self._append_chat("Could not reach broker. Check your connection.", "sys")

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code == 0:
            client.subscribe(self.creds["SESSION_ID"], qos=1)
            self._append_chat(
                f"Session  {self.creds['SESSION_ID'][:16]}…   Node: {self.node}", "sys"
            )
        else:
            self._append_chat(f"Connection error: {reason_code}", "sys")

    def _on_message(self, client, userdata, msg):
        try:
            decrypted = self._decrypt(json.loads(msg.payload.decode("utf-8")))
            if not decrypted:
                return

            if decrypted.get("protocol") != PROTOCOL_ID:
                if not self._proto_mismatch:
                    self._append_chat("Protocol mismatch — update one of the nodes.", "sys")
                    self._proto_mismatch = True
                return

            ts = decrypted.get("timestamp", 0)
            if not isinstance(ts, (int, float)) or abs(time.time() - ts) > MAX_FRAME_AGE_S:
                return

            frame_type = decrypted.get("frame_type")
            body       = decrypted.get("body", {})
            origin     = body.get("origin", "PEER")

            if origin == self.node:
                return

            if origin not in self.peers:
                self._append_chat(f"● Peer online: {origin}", "sys")
            self.peers[origin] = time.time()
            self._refresh_peers()

            if frame_type == "FILE" and body.get("type") == "CHUNK":
                self._handle_chunk(body)
            elif frame_type == "CHAT" and body.get("type") == "TEXT":
                self._append_chat(
                    f"<{sanitize(str(origin), 64)}> {sanitize(body.get('msg', ''), 2000)}",
                    "peer"
                )
            elif frame_type == "SYSTEM":
                st = body.get("type")
                if st == "DISCONNECT":
                    self._append_chat(f"● Peer disconnected: {origin}", "sys")
                    self.peers.pop(origin, None)
                    self._refresh_peers()
                elif st == "PING":
                    self._send_frame("SYSTEM", {"type": "PONG", "origin": self.node})
        except Exception:
            pass

    # ── Background threads ────────────────────────────────────────────────────
    def _start_threads(self):
        threading.Thread(target=self._heartbeat_loop, daemon=True).start()
        threading.Thread(target=self._cleanup_loop,   daemon=True).start()
        threading.Thread(target=self._purge_received, daemon=True).start()

    def _heartbeat_loop(self):
        while not self.shutdown_event.is_set():
            time.sleep(30)
            if self.shutdown_event.is_set():
                break
            self._send_frame("SYSTEM", {"type": "PING", "origin": self.node})
            now  = time.time()
            gone = [p for p, ts in list(self.peers.items()) if now - ts > 90]
            for p in gone:
                self.peers.pop(p, None)
                self._append_chat(f"● Peer timed out: {p}", "sys")
            if gone:
                self._refresh_peers()

    def _cleanup_loop(self):
        while not self.shutdown_event.is_set():
            time.sleep(30)
            now = time.time()
            with self.file_lock:
                expired = [n for n, ts in self.file_timestamps.items() if now - ts > 120]
                for n in expired:
                    for d in (self.file_buffers, self.file_data_blocks,
                              self.file_timestamps, self.file_total_chunks, self.file_hashes):
                        d.pop(n, None)
                    self._update_history(n, "✗")

    def _purge_received(self):
        while not self.shutdown_event.is_set():
            time.sleep(1)
            now     = time.time()
            expired = [k for k, (ts, ttl) in list(self._recently_received.items()) if now - ts > ttl]
            for k in expired:
                self._recently_received.pop(k, None)

    # ── Shutdown ──────────────────────────────────────────────────────────────
    def _on_close(self):
        self.shutdown_event.set()
        if self.mqtt_client:
            try:
                self._send_frame("SYSTEM", {
                    "type": "DISCONNECT", "origin": self.node, "reason": "shutdown"
                })
            except Exception:
                pass
            try:
                self.mqtt_client.disconnect()
                self.mqtt_client.loop_stop()
            except Exception:
                pass
        self.root.destroy()


# ─── ENTRY POINT ─────────────────────────────────────────────────────────────
def main():
    creds = load_credentials()
    root  = TkinterDnD.Tk() if DND_AVAILABLE else tk.Tk()
    WarpApp(root, creds)
    root.mainloop()

if __name__ == "__main__":
    main()
