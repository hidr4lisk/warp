const translations = {
    en: {
        tagline: 'Ephemeral P2P File Sync &amp; Terminal Chat',
        f1_title: 'Zero-Config',
        f1_desc: 'No servers, no ports, no accounts. Generate keys and run.',
        f2_title: 'End-to-End Encrypted',
        f2_desc: 'AES-256-GCM with per-session ephemeral keys. The broker sees nothing.',
        f3_title: 'One Script, Two Machines',
        f3_desc: 'Same file, both ends. Drop it in the folder you want to sync and run.',
        terminal_init: '&gt; Initialize secure session?',
        btn_generate: 'GENERATE SESSION',
        btn_reset: '↺ NEW SESSION',
        success_msg: '// Session keys injected. Node ready for deployment.',
        btn_download: '↓ DOWNLOAD warp.py',
        deploy_title: '// DEPLOY ON EACH MACHINE',
        step1_desc: 'Copy <code class="inline">warp.py</code> into the folder you want to sync on <strong>each machine</strong>.',
        step2_desc: 'Create a virtual environment and install the 3 dependencies:',
        step3_desc: "Run the node. That's it.",
        protocol_label: '// HOW IT WORKS',
        protocol_text: 'Any file dropped in the folder is chunked, encrypted, and pushed over the MQTT relay. Messages run over explicit WARPv2 frames so SYSTEM control traffic and CHAT data never collide. Nodes identify each other by hostname. Keys never leave your machine. Shut it down — session is gone.',
        footer_tagline: 'Zero-Config. Zero-Knowledge. Zero-Persistence.',
        footer_author: 'Created by',
        disclaimer1: 'Secure sync between trusted nodes.',
        disclaimer2: 'Work in progress. Use at your own risk.',
        status_system: 'SYSTEM: ONLINE',
        status_routing: ' | ROUTING: test.mosquitto.org',
        status_encryption: ' | ENCRYPTION: AES-256-GCM',
        broker_placeholder: 'Custom Broker (optional, e.g.: my-server.com:1883)',
        t_fetching: '> Generating high-entropy vectors...',
        t_fetch_def: 'Loading WARP definitions...',
        t_fetch_err: '[!] Error loading template. Make sure it is in the same directory.',
        t_session: (id) => `[OK] SESSION_ID: ${id}`,
        t_key: '[OK] AES-256 cryptographic key generated.',
        t_inject: '> Injecting keys...',
        t_done: '> Node ready for deployment.',
    },
    es: {
        tagline: 'Sincronización P2P Efímera y Chat de Terminal',
        f1_title: 'Zero-Config',
        f1_desc: 'Sin servidores, sin puertos, sin cuentas. Generá las claves y ejecutá.',
        f2_title: 'Cifrado Extremo-a-Extremo',
        f2_desc: 'AES-256-GCM con claves efímeras por sesión. El broker no ve nada.',
        f3_title: 'Un Script, Dos Máquinas',
        f3_desc: 'El mismo archivo en ambos extremos. Tiralo en la carpeta y ejecutá.',
        terminal_init: '&gt; ¿Iniciar sesión segura?',
        btn_generate: 'GENERAR SESIÓN',
        btn_reset: '↺ NUEVA SESIÓN',
        success_msg: '// Claves inyectadas. Nodo listo para desplegar.',
        btn_download: '↓ DESCARGAR warp.py',
        deploy_title: '// DESPLEGAR EN CADA MÁQUINA',
        step1_desc: 'Copiá <code class="inline">warp.py</code> en la carpeta que querés sincronizar en <strong>cada máquina</strong>.',
        step2_desc: 'Creá un entorno virtual e instalá las 3 dependencias:',
        step3_desc: 'Ejecutá el nodo. Eso es todo.',
        protocol_label: '// CÓMO FUNCIONA',
        protocol_text: 'Cualquier archivo en la carpeta es fragmentado, cifrado y enviado por el relay MQTT. El flujo usa frames WARPv2 explícitos para separar mensajes de SISTEMA y datos de CHAT. Los nodos se identifican por hostname. Las claves nunca salen de tu máquina. Al cerrar — la sesión desaparece.',
        footer_tagline: 'Zero-Config. Zero-Knowledge. Zero-Persistence.',
        footer_author: 'Creado por',
        disclaimer1: 'Sincronización segura entre nodos de confianza.',
        disclaimer2: 'En desarrollo. Usalo bajo tu propio riesgo.',
        status_system: 'SISTEMA: EN LÍNEA',
        status_routing: ' | ENRUTAMIENTO: test.mosquitto.org',
        status_encryption: ' | CIFRADO: AES-256-GCM',
        broker_placeholder: 'Broker personalizado (opcional, ej: mi-servidor.com:1883)',
        t_fetching: '> Generando vectores de alta entropía...',
        t_fetch_def: 'Cargando definiciones WARP...',
        t_fetch_err: '[!] Error al cargar el template. Verificá que esté en el mismo directorio.',
        t_session: (id) => `[OK] SESSION_ID: ${id}`,
        t_key: '[OK] Clave criptográfica AES-256 generada.',
        t_inject: '> Inyectando claves...',
        t_done: '> Nodo listo para desplegar.',
    }
};

let currentLang = (navigator.language || 'en').startsWith('es') ? 'es' : 'en';

function setLang(lang) {
    currentLang = lang;
    const t = translations[lang];

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (t[key] !== undefined) el.innerHTML = t[key];
    });

    document.querySelectorAll('[data-i18n-html]').forEach(el => {
        const key = el.dataset.i18nHtml;
        if (t[key] !== undefined) el.innerHTML = t[key];
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        if (t[key] !== undefined) el.placeholder = t[key];
    });

    document.getElementById('lang-en').classList.toggle('active', lang === 'en');
    document.getElementById('lang-es').classList.toggle('active', lang === 'es');

    document.documentElement.lang = lang;
}

const terminalOutput = document.getElementById('terminal-output');
const generateBtn = document.getElementById('generate-btn');
const downloadContainer = document.getElementById('download-container');
const downloadWarpBtn = document.getElementById('download-warp');
const resetBtn = document.getElementById('reset-btn');

let warpTemplateStr = '';
let sessionId = '';
let secretKeyB64 = '';

function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
}

function generateUUID() { return 'WARP-' + crypto.randomUUID(); }
function generateSecretKey() {
    const key = new Uint8Array(32);
    window.crypto.getRandomValues(key);
    return bufferToBase64(key.buffer);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function typeLine(text, cssClass = '') {
    const p = document.createElement('p');
    if (cssClass) p.className = cssClass;
    terminalOutput.appendChild(p);
    let current = '';
    for (let i = 0; i < text.length; i++) {
        current += text[i];
        p.innerText = current;
        await sleep(10);
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }
}

async function startGenerationSequence() {
    const t = translations[currentLang];
    generateBtn.classList.add('hidden');
    document.getElementById('broker-url').classList.add('hidden');
    document.querySelector('.features').classList.add('hidden');
    document.querySelector('.status-bar').classList.add('hidden');

    await typeLine(t.t_fetching, 'user-input');
    await sleep(300);

    try {
        await typeLine(t.t_fetch_def, 'user-input');
        const r1 = await fetch('warp_template.py');
        warpTemplateStr = await r1.text();
    } catch (e) {
        await typeLine(t.t_fetch_err, 'user-input');
        return;
    }

    await sleep(400);
    sessionId = generateUUID();
    await typeLine(t.t_session(sessionId));

    await sleep(400);
    secretKeyB64 = generateSecretKey();
    await typeLine(t.t_key);
    await sleep(200);
    await typeLine(t.t_inject);

    let brokerInput = document.getElementById('broker-url').value.trim();
    let brokerUrl = 'test.mosquitto.org';
    let brokerPort = 1883;

    if (brokerInput) {
        if (brokerInput.includes(':')) {
            let parts = brokerInput.split(':');
            brokerUrl = parts[0];
            brokerPort = parseInt(parts[1]) || 1883;
        } else {
            brokerUrl = brokerInput;
        }
    }

    warpTemplateStr = warpTemplateStr.replace('WARP-0000-0000-0000', sessionId);
    warpTemplateStr = warpTemplateStr.replace('MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=', secretKeyB64);
    warpTemplateStr = warpTemplateStr.replace('WARP-BROKER-PLACEHOLDER-URL', brokerUrl);
    warpTemplateStr = warpTemplateStr.replace('BROKER_PORT    = 10000', `BROKER_PORT    = ${brokerPort}`);

    await sleep(400);
    await typeLine('[OK] Mutually Assured Encryption embedded.');
    await sleep(200);
    await typeLine(t.t_done, 'user-input');

    downloadContainer.classList.remove('hidden');
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function resetSession() {
    const t = translations[currentLang];

    terminalOutput.innerHTML = '';
    const initLine = document.createElement('p');
    initLine.className = 'user-input';
    initLine.id = 'terminal-init-line';
    initLine.dataset.i18n = 'terminal_init';
    initLine.innerHTML = t.terminal_init;
    terminalOutput.appendChild(initLine);

    warpTemplateStr = '';
    sessionId = '';
    secretKeyB64 = '';
    document.getElementById('broker-url').value = '';

    downloadContainer.classList.add('hidden');
    generateBtn.classList.remove('hidden');
    document.getElementById('broker-url').classList.remove('hidden');
    document.querySelector('.features').classList.remove('hidden');
    document.querySelector('.status-bar').classList.remove('hidden');
}

function copyToClipboard(id, btn) {
    const el = document.getElementById(id);
    const text = el.innerText;
    navigator.clipboard.writeText(text).then(() => {
        const oldText = btn.innerText;
        btn.innerText = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerText = oldText;
            btn.classList.remove('copied');
        }, 2000);
    });
}

generateBtn.addEventListener('click', startGenerationSequence);
downloadWarpBtn.addEventListener('click', () => downloadScript('warp.py', warpTemplateStr));
resetBtn.addEventListener('click', resetSession);

function downloadScript(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

setLang(currentLang);
