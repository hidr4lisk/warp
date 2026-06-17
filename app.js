// =============================================================================
//  Hidr4lisk_WARP v3 — Cliente web/móvil
//  app.js — puerto del motor WARPv2 (warp_template.py) al navegador
// =============================================================================
//  Mismo protocolo que el cliente Python: AES-256-GCM (WebCrypto), frames WARPv2
//  sobre MQTT (WSS), chunks de 32KB con SHA-256, replay-window de 60s. El broker
//  solo ve ciphertext. Todo efímero: la clave vive en memoria + el #fragmento del
//  link; cerrar la pestaña = la sesión desaparece. Web-a-web (v1).
// =============================================================================

'use strict';

// ─── Config (paridad con warp_template.py) ──────────────────────────────────
const PROTOCOL_ID         = 'WARPv2';            // NO tocar: interop futura con warp.py
const DEFAULT_BROKER      = 'wss://broker.hivemq.com:8884/mqtt';
const FALLBACK_BROKER     = 'wss://broker.emqx.io:8084/mqtt';
const CHUNK_SIZE          = 1024 * 32;           // 32 KB
const MAX_CHUNKS_PER_FILE = 8192;                // 8192 × 32KB = 256 MB
const MAX_FRAME_AGE_S     = 60;                  // replay protection
const BUFFER_TIMEOUT_S    = 120;                 // descartar transfers incompletas
const HEARTBEAT_MS        = 30000;
const PEER_TIMEOUT_S      = 90;

// ─── Estado (todo en memoria, nada persiste) ────────────────────────────────
let mqttClient = null;
let cryptoKey  = null;     // CryptoKey AES-GCM
let warpSessionId  = '';
let nodeName   = '';
let shareLink  = '';
let connected  = false;
let qr         = null;

const peers          = {};   // origin -> last seen (ms)
const fileBuffers    = {};   // filename -> { chunks:Map, total, hash, ts }
const sendingFiles   = new Set();

// ─── i18n (en/es, mismo patrón data-i18n que el resto del sitio) ─────────────
const APP_I18N = {
    en: {
        app_tagline: 'Ephemeral browser-to-browser sync',
        start_title: 'Start a secure session',
        start_desc: 'Generate a session and share the link or QR. Whoever opens it joins instantly — encrypted end-to-end, nothing stored.',
        btn_create: 'CREATE SESSION',
        invite_title: '// INVITE A PEER',
        invite_desc: 'Send this link (or let them scan the QR). The key travels inside the link — never to any server.',
        btn_share: '↗ SHARE LINK',
        btn_copy: '⧉ COPY',
        btn_qr: '⤓ SAVE QR',
        copied: 'Copied!',
        waiting: 'Waiting for peer to join…',
        peer_online: (n) => `● ${n} online`,
        peer_offline: (n) => `○ ${n} offline`,
        connecting: 'Connecting to relay…',
        connected_waiting: 'Connected — share the link to bring someone in.',
        chat_title: '// CHAT',
        chat_placeholder: 'Type a message…',
        portal_title: '// PORTAL',
        portal_hint: 'Drop files here or tap to choose',
        transfers_title: '// TRANSFERS',
        you: 'you',
        sending: 'sending',
        receiving: 'receiving',
        sent: 'sent',
        received: 'received',
        save: '↓ Save',
        integrity_fail: 'integrity check failed — discarded',
        leave: '↺ NEW SESSION',
        sys_joined: (n) => `${n} joined the session`,
        sys_left: (n) => `${n} left`,
        err_nokey: '[!] Invalid or missing session key. Ask for a fresh link.',
        err_broker: '[!] Could not reach the relay. Retrying…',
        nav_home: 'HOME',
        hero_kicker: 'Live in your browser · no install · ephemeral',
        web_how_title: '// HOW IT WORKS',
        web_s1_t: 'Generate', web_s1_d: 'A 256-bit key is born in your browser. No account, no server.',
        web_s2_t: 'Share', web_s2_d: 'Send the link or scan the QR. The key rides inside the link — never to a server.',
        web_s3_t: 'Connect', web_s3_d: 'Both browsers meet over an encrypted channel. Files & chat flow. Close it — gone.',
        legacy_eyebrow: '// ALSO ON DESKTOP',
        legacy_lead: 'Prefer the terminal, or a folder that auto-syncs in the background? The original clients live on.',
        legacy_v1: 'v1 · Python — Linux / macOS / terminal',
        legacy_v2: 'v2 · Windows — native GUI',
    },
    es: {
        app_tagline: 'Sincronización efímera navegador-a-navegador',
        start_title: 'Iniciá una sesión segura',
        start_desc: 'Generá una sesión y compartí el link o el QR. El que lo abre entra al instante — cifrado de extremo a extremo, nada se guarda.',
        btn_create: 'CREAR SESIÓN',
        invite_title: '// INVITAR A ALGUIEN',
        invite_desc: 'Mandá este link (o que escaneen el QR). La clave viaja dentro del link — nunca a un servidor.',
        btn_share: '↗ COMPARTIR LINK',
        btn_copy: '⧉ COPIAR',
        btn_qr: '⤓ GUARDAR QR',
        copied: '¡Copiado!',
        waiting: 'Esperando que se una alguien…',
        peer_online: (n) => `● ${n} en línea`,
        peer_offline: (n) => `○ ${n} desconectado`,
        connecting: 'Conectando al relay…',
        connected_waiting: 'Conectado — compartí el link para traer a alguien.',
        chat_title: '// CHAT',
        chat_placeholder: 'Escribí un mensaje…',
        portal_title: '// PORTAL',
        portal_hint: 'Soltá archivos acá o tocá para elegir',
        transfers_title: '// TRANSFERENCIAS',
        you: 'vos',
        sending: 'enviando',
        receiving: 'recibiendo',
        sent: 'enviado',
        received: 'recibido',
        save: '↓ Guardar',
        integrity_fail: 'falló la verificación de integridad — descartado',
        leave: '↺ NUEVA SESIÓN',
        sys_joined: (n) => `${n} se unió a la sesión`,
        sys_left: (n) => `${n} salió`,
        err_nokey: '[!] Clave de sesión inválida o faltante. Pedí un link nuevo.',
        err_broker: '[!] No se pudo alcanzar el relay. Reintentando…',
        nav_home: 'INICIO',
        hero_kicker: 'En vivo en tu navegador · sin instalar · efímero',
        web_how_title: '// CÓMO FUNCIONA',
        web_s1_t: 'Generá', web_s1_d: 'Una clave de 256 bits nace en tu navegador. Sin cuenta, sin servidor.',
        web_s2_t: 'Compartí', web_s2_d: 'Mandá el link o que escaneen el QR. La clave viaja dentro del link — nunca a un servidor.',
        web_s3_t: 'Conectá', web_s3_d: 'Los dos navegadores se encuentran por un canal cifrado. Archivos y chat. Cerrás — desaparece.',
        legacy_eyebrow: '// TAMBIÉN EN ESCRITORIO',
        legacy_lead: '¿Preferís la terminal, o una carpeta que se sincroniza sola en segundo plano? Los clientes originales siguen vivos.',
        legacy_v1: 'v1 · Python — Linux / macOS / terminal',
        legacy_v2: 'v2 · Windows — GUI nativa',
    },
};
// Enchufar al i18n GLOBAL del sitio: generator.js define translations/setLang/currentLang.
// app.js solo APORTA sus claves (mismo patrón que index.js) → un único setLang (el de la
// navbar) localiza todo. Las claves función-valuadas (peer_online…) se llaman desde JS.
if (typeof translations !== 'undefined') {
    Object.assign(translations.en, APP_I18N.en);
    Object.assign(translations.es, APP_I18N.es);
}
const curLang = () => (typeof currentLang !== 'undefined' ? currentLang : 'en');
const T = () => (typeof translations !== 'undefined' ? translations[curLang()] : APP_I18N[curLang()]);

// ─── base64 (estándar para el wire, b64url para el link) ────────────────────
function bytesToB64(bytes) {
    let bin = '';
    const b = new Uint8Array(bytes);
    for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
    return btoa(bin);
}
function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
const b64url = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function b64urlToBytes(s) {
    const std = s.replace(/-/g, '+').replace(/_/g, '/');
    return b64ToBytes(std + '='.repeat((4 - std.length % 4) % 4));
}

// ─── Crypto (WebCrypto — paridad con AESGCM de Python) ───────────────────────
async function importKeyRaw(rawBytes) {
    return crypto.subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
function generateSecretKeyBytes() {
    const key = new Uint8Array(32);                 // AES-256
    crypto.getRandomValues(key);
    return key;
}
async function encryptPayload(obj) {
    const pt = new TextEncoder().encode(JSON.stringify(obj));
    const iv = crypto.getRandomValues(new Uint8Array(12));   // nonce 12 bytes (== Python)
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, pt));
    return { n: bytesToB64(iv), d: bytesToB64(ct) };          // tag adjunto al ct (== Python)
}
async function decryptPayload(pkt) {
    try {
        const iv = b64ToBytes(pkt.n), ct = b64ToBytes(pkt.d);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ct);
        return JSON.parse(new TextDecoder().decode(pt));
    } catch { return null; }
}
async function sha256hex(bytes) {
    const h = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Frames WARPv2 ───────────────────────────────────────────────────────────
function buildFrame(type, body) {
    return { protocol: PROTOCOL_ID, frame_type: type, version: 1, timestamp: Math.floor(Date.now() / 1000), body };
}
async function sendFrame(type, body, qos = 1) {
    if (!mqttClient || !connected) return;
    const pkt = await encryptPayload(buildFrame(type, body));
    mqttClient.publish(warpSessionId, JSON.stringify(pkt), { qos });
}

// ─── Filename safety (== _safe_filename del Python) ─────────────────────────
function safeFilename(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let name = raw.split(/[\\/]/).pop();                 // basename
    if (!name || name === '.' || name === '..') return null;
    name = name.replace(/[\x00-\x1f\x7f]/g, '');         // strip control chars
    if (!name || name.length > 255) return null;
    return name;
}

// ─── MQTT ────────────────────────────────────────────────────────────────────
function connect(broker) {
    setStatus(T().connecting);
    mqttClient = mqtt.connect(broker, {
        clean: true, reconnectPeriod: 2500, connectTimeout: 8000, keepalive: 30,
        clientId: 'warp_' + Math.random().toString(16).slice(2, 10),
    });
    mqttClient.on('connect', () => {
        connected = true;
        mqttClient.subscribe(warpSessionId, { qos: 1 });
        onConnected();
    });
    mqttClient.on('reconnect', () => setStatus(T().err_broker));
    mqttClient.on('message', (_topic, payload) => { onMessage(payload); });
    mqttClient.on('error', () => setStatus(T().err_broker));
}

function onConnected() {
    setStatus(peerCount() ? '' : T().connected_waiting);
    sendFrame('SYSTEM', { type: 'PING', origin: nodeName });
    startHeartbeat();
}

async function onMessage(payloadBuf) {
    let pkt;
    try { pkt = JSON.parse(payloadBuf.toString()); } catch { return; }
    const f = await decryptPayload(pkt);
    if (!f || f.protocol !== PROTOCOL_ID) return;

    const ts = f.timestamp;
    if (typeof ts !== 'number' || Math.abs(Date.now() / 1000 - ts) > MAX_FRAME_AGE_S) return;  // replay window

    const body = f.body || {};
    const origin = body.origin || 'PEER';
    if (origin === nodeName) return;

    const isNew = !(origin in peers);
    peers[origin] = Date.now();          // registrar ANTES de refrescar el estado
    if (isNew) onPeerOnline(origin);

    if (f.frame_type === 'FILE' && body.type === 'CHUNK') {
        await handleChunk(body);
    } else if (f.frame_type === 'CHAT' && body.type === 'TEXT') {
        renderChat(sanitize(origin, 64), sanitize(body.msg, 2000), false);
    } else if (f.frame_type === 'SYSTEM') {
        if (body.type === 'DISCONNECT') onPeerOffline(origin);
        else if (body.type === 'PING') sendFrame('SYSTEM', { type: 'PONG', origin: nodeName });
    }
}

function sanitize(s, max) { return (typeof s === 'string' ? s : '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, max); }

// ─── Peers / estado ──────────────────────────────────────────────────────────
function peerCount() { return Object.keys(peers).length; }
function onPeerOnline(origin) {
    sysLine(T().sys_joined(origin));
    refreshPeerStatus();
}
function onPeerOffline(origin) {
    if (origin in peers) { delete peers[origin]; sysLine(T().sys_left(origin)); }
    refreshPeerStatus();
}
function refreshPeerStatus() {
    const el = document.getElementById('peer-status');
    if (!el) return;
    const names = Object.keys(peers);
    if (names.length) {
        el.className = 'peer-status online';
        el.textContent = names.map(n => T().peer_online(n)).join('   ');
    } else {
        el.className = 'peer-status';
        el.textContent = connected ? T().waiting : T().connecting;
    }
}
function startHeartbeat() {
    setInterval(() => {
        if (!connected) return;
        sendFrame('SYSTEM', { type: 'PING', origin: nodeName });
        const now = Date.now();
        for (const [p, ts] of Object.entries(peers)) {
            if (now - ts > PEER_TIMEOUT_S * 1000) onPeerOffline(p);
        }
    }, HEARTBEAT_MS);
}

// ─── Chat ──────────────────────────────────────────────────────────────────
function sendChat() {
    const input = document.getElementById('chat-input');
    const msg = (input.value || '').trim();
    if (!msg) return;
    input.value = '';
    renderChat(T().you, msg, true);
    sendFrame('CHAT', { type: 'TEXT', origin: nodeName, msg });
}
function renderChat(who, msg, mine) {
    const log = document.getElementById('chat-log');
    if (!log) return;
    const line = document.createElement('div');
    line.className = 'chat-line ' + (mine ? 'mine' : 'theirs');
    const w = document.createElement('span'); w.className = 'chat-who'; w.textContent = `<${who}>`;
    const m = document.createElement('span'); m.className = 'chat-msg'; m.textContent = ' ' + msg;
    line.append(w, m);
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}
function sysLine(text) {
    const log = document.getElementById('chat-log');
    if (!log) return;
    const line = document.createElement('div');
    line.className = 'chat-line sys';
    line.textContent = '— ' + text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}

// ─── Envío de archivos (chunked + SHA-256) ──────────────────────────────────
async function sendFile(file) {
    if (sendingFiles.has(file.name)) return;
    sendingFiles.add(file.name);
    const data = new Uint8Array(await file.arrayBuffer());
    const totalChunks = Math.max(1, Math.ceil(data.length / CHUNK_SIZE));
    if (totalChunks > MAX_CHUNKS_PER_FILE) {
        sysLine(`[!] ${file.name} too large (max 256 MB)`);
        sendingFiles.delete(file.name);
        return;
    }
    const hash = await sha256hex(data);
    const row = addTransferRow(file.name, data.length, T().sending);

    for (let i = 0; i < totalChunks; i++) {
        const chunk = data.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const body = {
            type: 'CHUNK', origin: nodeName, filename: file.name,
            chunk_index: i, total_chunks: totalChunks, data: bytesToB64(chunk),
        };
        if (i === totalChunks - 1) body.hash = hash;   // hash solo en el último chunk
        await sendFrame('FILE', body);
        updateTransfer(row, (i + 1) / totalChunks);
        await delay(8);   // no saturar el broker
    }
    setTransferDone(row, T().sent);
    setTimeout(() => sendingFiles.delete(file.name), 2000);
}

// ─── Recepción de archivos ──────────────────────────────────────────────────
async function handleChunk(body) {
    const filename = safeFilename(body.filename);
    if (!filename) return;
    let chunkIndex, totalChunks, dataB64;
    try {
        chunkIndex = parseInt(body.chunk_index);
        totalChunks = parseInt(body.total_chunks);
        dataB64 = body.data;
    } catch { return; }
    if (!(totalChunks >= 1 && totalChunks <= MAX_CHUNKS_PER_FILE)) return;
    if (!(chunkIndex >= 0 && chunkIndex < totalChunks)) return;
    if (typeof dataB64 !== 'string' || dataB64.length > CHUNK_SIZE * 2) return;

    let buf = fileBuffers[filename];
    if (!buf) {
        buf = fileBuffers[filename] = { chunks: new Map(), total: totalChunks, hash: null, ts: Date.now(), row: addTransferRow(filename, 0, T().receiving) };
    } else if (buf.total !== totalChunks) {
        delete fileBuffers[filename];   // total inconsistente → abortar (== Python)
        return;
    }
    try { buf.chunks.set(chunkIndex, b64ToBytes(dataB64)); } catch { return; }
    if (typeof body.hash === 'string' && body.hash.length === 64) buf.hash = body.hash;

    updateTransfer(buf.row, buf.chunks.size / totalChunks);

    if (buf.chunks.size === totalChunks) {
        const parts = [];
        let total = 0;
        for (let i = 0; i < totalChunks; i++) { const c = buf.chunks.get(i); parts.push(c); total += c.length; }
        const full = new Uint8Array(total);
        let off = 0;
        for (const p of parts) { full.set(p, off); off += p.length; }
        delete fileBuffers[filename];

        const actual = await sha256hex(full);
        if (buf.hash && actual !== buf.hash) {
            setTransferDone(buf.row, T().integrity_fail, true);
            return;
        }
        offerDownload(buf.row, filename, full);
    }
}

// ─── Limpieza de transfers incompletas ──────────────────────────────────────
setInterval(() => {
    const now = Date.now();
    for (const [name, buf] of Object.entries(fileBuffers)) {
        if (now - buf.ts > BUFFER_TIMEOUT_S * 1000) {
            setTransferDone(buf.row, '[!] expired', true);
            delete fileBuffers[name];
        }
    }
}, 30000);

// ─── UI de transferencias ────────────────────────────────────────────────────
function addTransferRow(name, size, label) {
    const list = document.getElementById('transfers');
    const row = document.createElement('div');
    row.className = 'xfer';
    row.innerHTML =
        `<div class="xfer-head"><span class="xfer-name"></span><span class="xfer-label">${label}</span></div>` +
        `<div class="xfer-bar"><div class="xfer-fill"></div></div>`;
    row.querySelector('.xfer-name').textContent = size ? `${name} · ${fmtSize(size)}` : name;
    list.prepend(row);
    return row;
}
function updateTransfer(row, frac) {
    const fill = row.querySelector('.xfer-fill');
    if (fill) fill.style.width = Math.round(frac * 100) + '%';
}
function setTransferDone(row, label, err) {
    row.querySelector('.xfer-label').textContent = label;
    if (err) row.classList.add('err');
    const fill = row.querySelector('.xfer-fill');
    if (fill && !err) fill.style.width = '100%';
}
function offerDownload(row, filename, bytes) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    row.querySelector('.xfer-label').textContent = T().received;
    const fill = row.querySelector('.xfer-fill'); if (fill) fill.style.width = '100%';
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.className = 'xfer-save'; a.textContent = T().save;
    // En móvil la descarga necesita gesto del usuario (no auto, por quirks iOS) → botón tocable.
    row.querySelector('.xfer-head').appendChild(a);
}

// ─── Sesión: crear / unirse (link + QR) ─────────────────────────────────────
function parseHash() {
    const h = (location.hash || '').replace(/^#/, '');
    const p = new URLSearchParams(h);
    return { s: p.get('s'), k: p.get('k') };
}
function randomNick() { return 'Device-' + crypto.randomUUID().slice(0, 4).toUpperCase(); }

async function createSession() {
    nodeName = randomNick();
    warpSessionId = 'WARP-' + crypto.randomUUID();
    const keyBytes = generateSecretKeyBytes();
    cryptoKey = await importKeyRaw(keyBytes);
    shareLink = `${location.origin}${location.pathname}#s=${encodeURIComponent(warpSessionId)}&k=${b64url(bytesToB64(keyBytes))}&l=${curLang()}`;
    enterRoom(true);
    connect(brokerFromQuery());
}

async function joinSession(s, k) {
    nodeName = randomNick();
    warpSessionId = s;
    try { cryptoKey = await importKeyRaw(b64urlToBytes(k)); }
    catch { showFatal(T().err_nokey); return; }
    shareLink = location.href;
    enterRoom(false);
    connect(brokerFromQuery());
}

function brokerFromQuery() {
    const b = new URLSearchParams(location.search).get('broker');
    if (b && b.startsWith('wss://')) return b;
    return DEFAULT_BROKER;
}

// ─── Pantallas ───────────────────────────────────────────────────────────────
function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('hidden', s.id !== id));
}
function enterRoom(isCreator) {
    show('screen-room');
    const invite = document.getElementById('invite');
    if (invite) invite.classList.toggle('hidden', !isCreator);
    document.getElementById('share-link').value = shareLink;
    if (isCreator) renderQR(shareLink);
    refreshPeerStatus();
}
function renderQR(text) {
    const box = document.getElementById('qr');
    if (!box || typeof QRCode === 'undefined') return;
    try {
        box.innerHTML = '';
        // correctLevel H (~30% recuperación) tolera el logo Hidr4lisk_ centrado sin perder escaneo.
        qr = new QRCode(box, { text, width: 200, height: 200, colorDark: '#0d0d0d', colorLight: '#cfe3d8', correctLevel: QRCode.CorrectLevel.H });
    } catch { /* el QR es opcional; el link sigue disponible */ }
}
// Exporta el QR + la marca Hidr4lisk_ central (que en pantalla es un overlay CSS, no
// parte del canvas) componiéndolos en un PNG. Replica el estilo de .qr-logo leyéndolo en vivo.
function downloadQR() {
    const src = document.querySelector('#qr canvas') || document.querySelector('#qr img');
    if (!src) return;
    const S = 560, pad = 36, qrS = S - pad * 2;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#cfe3d8'; ctx.fillRect(0, 0, S, S);   // mismo fondo claro que .qr
    ctx.imageSmoothingEnabled = false;                      // QR nítido (nearest-neighbor)
    ctx.drawImage(src, pad, pad, qrS, qrS);

    // Marca central — replica .qr-logo leyendo su estilo computado y escalándolo al export
    const logoEl = document.querySelector('.qr-logo');
    const cs = logoEl && getComputedStyle(logoEl);
    const dispW = src.getBoundingClientRect().width || 180;
    const k = qrS / dispW;                                  // factor pantalla → imagen
    const fs = (cs ? parseFloat(cs.fontSize) : 10) * k;
    const ls = (cs ? (parseFloat(cs.letterSpacing) || 0) : 0) * k;
    ctx.font = `${cs ? cs.fontWeight : '800'} ${fs}px ${cs ? cs.fontFamily : 'monospace'}`;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const txt = 'Hidr4lisk_';
    let tw = 0; for (const ch of txt) tw += ctx.measureText(ch).width + ls; tw -= ls;
    const padX = fs * 0.5, padY = fs * 0.28, bw = Math.max(2 * k, 2);
    const boxW = tw + padX * 2, boxH = fs + padY * 2;
    const bx = (S - boxW) / 2, by = (S - boxH) / 2, r = 5 * k;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, boxW, boxH, r);
    else ctx.rect(bx, by, boxW, boxH);
    ctx.fillStyle = cs ? cs.backgroundColor : '#0d0d0d'; ctx.fill();
    ctx.lineWidth = bw; ctx.strokeStyle = '#cfe3d8'; ctx.stroke();
    ctx.fillStyle = cs ? cs.color : '#39d353';
    let x = bx + padX; const cy = by + boxH / 2;
    for (const ch of txt) { ctx.fillText(ch, x, cy); x += ctx.measureText(ch).width + ls; }

    const a = document.createElement('a');
    a.href = c.toDataURL('image/png'); a.download = 'warp-qr.png';
    document.body.appendChild(a); a.click(); a.remove();
}
function setStatus(text) {
    const el = document.getElementById('peer-status');
    if (el && !peerCount()) el.textContent = text;
}
function showFatal(text) {
    show('screen-start');
    const e = document.getElementById('start-error');
    if (e) { e.textContent = text; e.classList.remove('hidden'); }
}

// ─── utils ───────────────────────────────────────────────────────────────────
const delay = (ms) => new Promise(r => setTimeout(r, ms));
function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─── Despedida limpia (== send_disconnect_signal del Python) ─────────────────
function disconnectClean() {
    try { if (connected) sendFrame('SYSTEM', { type: 'DISCONNECT', origin: nodeName, reason: 'closed' }); } catch {}
}
window.addEventListener('beforeunload', disconnectClean);
window.addEventListener('pagehide', disconnectClean);

// ─── Bootstrap ───────────────────────────────────────────────────────────────
function wireUI() {
    // Los botones de idioma usan onclick="setLang(...)" inline en la navbar (igual que el resto del sitio).
    document.getElementById('create-btn')?.addEventListener('click', createSession);

    document.getElementById('chat-send')?.addEventListener('click', sendChat);
    document.getElementById('chat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

    // Invitar: al Compartir o Copiar, la sección se minimiza (deja de molestar); reabrible.
    // El header también colapsa con un clic (útil al compartir pantalla en vivo: el QR
    // sigue visible si no copiás/compartís).
    const collapseInvite = () => document.getElementById('invite')?.classList.add('collapsed');
    document.getElementById('invite-reopen')?.addEventListener('click',
        () => document.getElementById('invite')?.classList.remove('collapsed'));
    document.getElementById('invite-collapse')?.addEventListener('click', collapseInvite);

    // COMPARTIR usa el menú nativo (navigator.share); en escritorio no existe → ocultamos el
    // botón (caería en copyLink y sería un duplicado de COPIAR). COPIAR pasa a ocupar la fila.
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn && !navigator.share) shareBtn.classList.add('hidden');
    shareBtn?.addEventListener('click', async () => {
        try { await navigator.share({ title: 'Hidr4lisk_WARP', text: 'Join my WARP session →', url: shareLink }); collapseInvite(); return; } catch {}
        copyLink();
        collapseInvite();
    });
    document.getElementById('copy-btn')?.addEventListener('click', () => { copyLink(); collapseInvite(); });
    document.getElementById('qr-save-btn')?.addEventListener('click', downloadQR);

    const portal = document.getElementById('portal');
    const fileInput = document.getElementById('file-input');
    portal?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => { for (const f of fileInput.files) sendFile(f); fileInput.value = ''; });
    ['dragover', 'dragenter'].forEach(ev => portal?.addEventListener(ev, e => { e.preventDefault(); portal.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => portal?.addEventListener(ev, e => { e.preventDefault(); portal.classList.remove('drag'); }));
    portal?.addEventListener('drop', e => { for (const f of e.dataTransfer.files) sendFile(f); });
}
function copyLink() {
    navigator.clipboard.writeText(shareLink).then(() => {
        const btn = document.getElementById('copy-btn');
        if (!btn) return;
        const old = btn.textContent; btn.textContent = T().copied;
        setTimeout(() => { btn.textContent = old; }, 1500);
    });
}

function boot() {
    if (!window.isSecureContext || !crypto.subtle) {
        showFatal('[!] WARP requires HTTPS (secure context).');
        return;
    }
    wireUI();
    const { s, k } = parseHash();
    const hl = new URLSearchParams((location.hash || '').replace(/^#/, '')).get('l');
    if ((hl === 'es' || hl === 'en') && typeof currentLang !== 'undefined') currentLang = hl;
    if (typeof setLang === 'function') setLang(curLang());   // localizar las claves de app
    // envolver el setLang global para refrescar también los strings dinámicos al cambiar idioma
    if (typeof window.setLang === 'function') {
        const _sl = window.setLang;
        window.setLang = function (l) { _sl(l); try { refreshPeerStatus(); } catch {} };
    }
    if (s && k) joinSession(s, k);
    else show('screen-start');
}

document.addEventListener('DOMContentLoaded', boot);
