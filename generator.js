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
        protocol_text: 'Files are chunked, encrypted (AES-256-GCM), and pushed over MQTT. Nodes identify by hostname. Keys never leave your machine. Shut it down — session is gone.',
        footer_author: 'Created by',
        disclaimer1: 'Secure sync between trusted nodes.',
        disclaimer2: 'Work in progress. Use at your own risk.',
        status_generating: '>> Generating session...',
        status_routing: 'ROUTING: broker.hivemq.com',
        status_encryption: 'ENCRYPTION: AES-256-GCM',
        broker_placeholder: 'Custom Broker (optional, e.g.: my-server.com:1883)',
        copied: 'Copied!',
        t_fetching: '> Generating high-entropy vectors...',
        t_fetch_def: 'Loading WARP definitions...',
        t_fetch_err: '[!] Error loading template. Make sure it is in the same directory.',
        t_session: (id) => `[OK] SESSION_ID: ${id}`,
        t_key: '[OK] AES-256 cryptographic key generated.',
        t_inject: '> Injecting keys...',
        t_mae: '[OK] Mutually Assured Encryption embedded.',
        t_done: '> Node ready for deployment.',
        panel_about_label: '// ABOUT WARP',
        panel_about_text: 'Zero-config, zero-knowledge ephemeral P2P sync.<br>Generate a session, copy the script on two machines — they connect instantly. The broker sees nothing.<br>Close it — it\'s gone.',
        contact_text: 'Help us improve — send us your feedback: hidralisk.online@gmail.com',
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
        protocol_text: 'Los archivos se fragmentan, cifran (AES-256-GCM) y envían por MQTT. Los nodos se identifican por hostname. Las claves nunca salen de tu máquina. Al cerrar — la sesión desaparece.',
        footer_author: 'Creado por',
        disclaimer1: 'Sincronización segura entre nodos de confianza.',
        disclaimer2: 'En desarrollo. Usalo bajo tu propio riesgo.',
        status_generating: '>> Generando sesión...',
        status_routing: 'ENRUTAMIENTO: broker.hivemq.com',
        status_encryption: 'CIFRADO: AES-256-GCM',
        broker_placeholder: 'Broker personalizado (opcional, ej: mi-servidor.com:1883)',
        copied: '¡Copiado!',
        t_fetching: '> Generando vectores de alta entropía...',
        t_fetch_def: 'Cargando definiciones WARP...',
        t_fetch_err: '[!] Error al cargar el template. Verificá que esté en el mismo directorio.',
        t_session: (id) => `[OK] SESSION_ID: ${id}`,
        t_key: '[OK] Clave criptográfica AES-256 generada.',
        t_inject: '> Inyectando claves...',
        t_mae: '[OK] Cifrado de Seguridad Mutua embebido.',
        t_done: '> Nodo listo para desplegar.',
        panel_about_label: '// ACERCA DE WARP',
        panel_about_text: 'P2P efímero, zero-config y zero-knowledge.<br>Generá una sesión, copiá el script en dos máquinas — conectan al instante. El broker no ve nada.<br>Cerralo — desaparece.',
        contact_text: 'Ayudame a mejorar — enviame tu opinión: hidralisk.online@gmail.com',
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
const generateBtn    = document.getElementById('generate-btn');
const downloadWarpBtn   = document.getElementById('download-warp');
const resetBtn          = document.getElementById('reset-btn');
const brokerInput       = document.getElementById('broker-url');
const statusText        = document.getElementById('status-text');
const statusRouting     = document.querySelector('[data-i18n="status_routing"]');
const carousel          = document.querySelector('.carousel');
const deploySidebar     = document.querySelector('.deploy-sidebar');
const panelAbout        = document.querySelector('.panel-about');
const actionContainer   = document.querySelector('.action-container');

let warpTemplateStr = '';
let sessionId = '';
let secretKeyB64 = '';
let carouselInterval = null;

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

function parseBrokerInput(raw) {
    if (!raw) return { url: 'broker.hivemq.com', port: 1883 };
    if (raw.includes(':')) {
        const [url, rawPort] = raw.split(':');
        return { url, port: parseInt(rawPort) || 1883 };
    }
    return { url: raw, port: 1883 };
}

function injectKeysIntoTemplate(template, sid, key, brokerUrl, brokerPort) {
    return template
        .replace('{{ SESSION_ID }}', sid)
        .replace('{{ SECRET_KEY }}', key)
        .replace('{{ BROKER_URL }}', brokerUrl)
        .replace('{{ BROKER_PORT }}', String(brokerPort));
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
    brokerInput.classList.add('hidden');
    if (statusText) statusText.textContent = t.status_generating;

    await typeLine(t.t_fetching, 'user-input');
    await sleep(300);

    try {
        await typeLine(t.t_fetch_def, 'user-input');
        const r1 = await fetch('warp_template.py');
        warpTemplateStr = await r1.text();
    } catch (e) {
        await typeLine(t.t_fetch_err, 'user-input');
        if (statusText) statusText.innerHTML = t.tagline;
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

    const { url: brokerUrl, port: brokerPort } = parseBrokerInput(brokerInput.value.trim());
    warpTemplateStr = injectKeysIntoTemplate(warpTemplateStr, sessionId, secretKeyB64, brokerUrl, brokerPort);

    await sleep(400);
    await typeLine(t.t_mae);
    await sleep(200);
    await typeLine(t.t_done, 'user-input');

    if (statusText) statusText.innerHTML = t.tagline;
    if (statusRouting) statusRouting.textContent = `ROUTING: ${brokerUrl}`;

    await sleep(2000);

    terminalOutput.innerHTML = '';

    const template = document.getElementById('deploy-content');
    if (template) {
        const clone = template.content.cloneNode(true);
        terminalOutput.appendChild(clone);
    }

    setLang(currentLang);

    if (actionContainer) actionContainer.classList.add('hidden');
    if (deploySidebar) deploySidebar.classList.remove('hidden');
    if (carousel) carousel.classList.add('hidden');
    if (panelAbout) panelAbout.classList.add('hidden');
}

function resetSession() {
    terminalOutput.innerHTML = '';
    const initLine = document.createElement('p');
    initLine.className = 'user-input';
    initLine.id = 'terminal-init-line';
    initLine.dataset.i18n = 'terminal_init';
    terminalOutput.appendChild(initLine);

    warpTemplateStr = '';
    sessionId = '';
    secretKeyB64 = '';
    brokerInput.value = '';

    if (actionContainer) actionContainer.classList.remove('hidden');
    generateBtn.classList.remove('hidden');
    brokerInput.classList.remove('hidden');

    if (deploySidebar) deploySidebar.classList.add('hidden');
    if (carousel) carousel.classList.remove('hidden');
    if (panelAbout) panelAbout.classList.remove('hidden');
    setLang(currentLang);
}

function copyToClipboard(id, btn) {
    const el = document.getElementById(id);
    navigator.clipboard.writeText(el.innerText).then(() => {
        const t = translations[currentLang];
        const oldText = btn.innerText;
        btn.innerText = t.copied;
        btn.classList.add('copied');
        setTimeout(() => {
            btn.innerText = oldText;
            btn.classList.remove('copied');
        }, 2000);
    });
}

function isMobile() {
    return window.innerWidth < 768;
}

function goToSlide(index) {
    const track = document.querySelector('.carousel-track');
    const dots = document.querySelectorAll('.carousel-dot');
    if (!track || isMobile()) return;

    const totalSlides = track.children.length;
    const idx = Math.max(0, Math.min(index, totalSlides - 1));

    track.style.transform = `translateX(-${idx * 100}%)`;

    dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === idx);
    });
}

function nextSlide() {
    const dots = document.querySelectorAll('.carousel-dot');
    const activeDot = document.querySelector('.carousel-dot.active');
    if (!activeDot) return;
    const current = parseInt(activeDot.dataset.slide);
    const next = (current + 1) % dots.length;
    goToSlide(next);
}

function initCarousel() {
    const track = document.querySelector('.carousel-track');

    if (isMobile()) {
        if (carousel) carousel.classList.add('hidden');
        return;
    }

    const dots = document.querySelectorAll('.carousel-dot');
    if (!track || !dots.length) return;

    dots.forEach(dot => {
        dot.addEventListener('click', () => {
            goToSlide(parseInt(dot.dataset.slide));
            resetCarouselInterval();
        });
    });

    const carousel = document.querySelector('.carousel');
    if (carousel) {
        carousel.addEventListener('mouseenter', () => {
            if (carouselInterval) {
                clearInterval(carouselInterval);
                carouselInterval = null;
            }
        });
        carousel.addEventListener('mouseleave', () => {
            startCarouselInterval();
        });
    }

    startCarouselInterval();

    window.addEventListener('resize', () => {
        if (isMobile()) {
            if (carouselInterval) {
                clearInterval(carouselInterval);
                carouselInterval = null;
            }
            if (track) track.style.transform = 'none';
        } else {
            const activeDot = document.querySelector('.carousel-dot.active');
            if (activeDot) {
                goToSlide(parseInt(activeDot.dataset.slide));
            }
            if (!carouselInterval) startCarouselInterval();
        }
    });
}

function startCarouselInterval() {
    if (carouselInterval) clearInterval(carouselInterval);
    if (isMobile()) return;
    carouselInterval = setInterval(nextSlide, 4000);
}

function resetCarouselInterval() {
    startCarouselInterval();
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
initCarousel();
