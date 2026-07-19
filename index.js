// ── Extra i18n keys not present in generator.js translations ────────
const extraTranslations = {
    en: {
        nav_motto:        '2026 - Knowledge is free',
        win_bar_msg:      'Windows GUI now available',
        win_bar_cta:      '↓ download',
        win_new_badge:    '// NEW RELEASE',
        win_title:        'Now on Windows.',
        win_sub:          'Same session. Same encryption. Same <code class="inline">warp.py</code>.<br>Now with a native GUI — chat, drag-and-drop, and a PORTAL.',
        win_download_btn: '↓ DOWNLOAD FOR WINDOWS',
        win_note:         'v1.0 · place warp.py next to the exe · AES-256-GCM',
        hero_eyebrow:  '// EPHEMERAL · P2P · ZERO_KNOWLEDGE',
        hero_subtitle: 'Zero-config encrypted sync between trusted nodes. No servers. No accounts. No traces.',
        cta_open_app:  'Open WARP in your browser',
        cta_app_note:  'No install — works on your phone. Share a link, send files & chat. Or generate the Python script ↓',
        cta_secondary: 'READ THE DOCS →',
        f1_meta:       'requires: python3',
        f2_meta:       'cipher: AES-256-GCM',
        f3_meta:       'transport: MQTT',
        about_heading: '// ABOUT',
        howto_heading: '// HOW IT WORKS',
        how_bullet_1:  'files chunked → encrypted → relayed',
        how_bullet_2:  'nodes identify by hostname',
        how_bullet_3:  'keys never leave your machine',
        how_bullet_4:  'shutdown → session vanishes',
        setup_heading: '// SETUP',
        about_p1: 'Zero-config, <span class="accent-word">zero-knowledge</span> ephemeral P2P sync.',
        about_p2: 'Generate a session. Copy the script on two machines.<br>They connect <span class="accent-word">instantly</span>. The broker sees nothing.',
        about_p3: 'Close it — it\'s <span class="accent-word">gone</span>.',
    },
    es: {
        nav_motto:        '2026 - El conocimiento es libre',
        win_bar_msg:      'GUI para Windows disponible',
        win_bar_cta:      '↓ descargar',
        win_new_badge:    '// NUEVO',
        win_title:        'Ahora en Windows.',
        win_sub:          'Misma sesión. Mismo cifrado. Mismo <code class="inline">warp.py</code>.<br>Ahora con interfaz gráfica — chat, drag-and-drop y un PORTAL.',
        win_download_btn: '↓ DESCARGAR PARA WINDOWS',
        win_note:         'v1.0 · colocá warp.py al lado del exe · AES-256-GCM',
        hero_eyebrow:  '// EFÍMERO · P2P · CONOCIMIENTO_CERO',
        hero_subtitle: 'Sincronización cifrada sin configuración entre nodos confiables. Sin servidores. Sin cuentas. Sin rastros.',
        cta_open_app:  'Abrí WARP en el navegador',
        cta_app_note:  'Sin instalar — funciona en tu celu. Compartí un link, mandá archivos y chateá. O generá el script de Python ↓',
        cta_secondary: 'LEER LOS DOCS →',
        f1_meta:       'requiere: python3',
        f2_meta:       'cifrado: AES-256-GCM',
        f3_meta:       'transporte: MQTT',
        about_heading: '// SOBRE',
        howto_heading: '// CÓMO FUNCIONA',
        how_bullet_1:  'archivos fragmentados → cifrados → enviados',
        how_bullet_2:  'nodos se identifican por hostname',
        how_bullet_3:  'las claves nunca salen de tu máquina',
        how_bullet_4:  'al cerrar → la sesión desaparece',
        setup_heading: '// INSTALACIÓN',
        about_p1: 'P2P efímero, zero-config y <span class="accent-word">zero-knowledge</span>.',
        about_p2: 'Generá una sesión. Copiá el script en dos máquinas.<br>Conectan <span class="accent-word">al instante</span>. El broker no ve nada.',
        about_p3: 'Cerralo — desaparece.',
    }
};

if (typeof translations !== 'undefined') {
    for (const lang of ['en', 'es']) {
        Object.assign(translations[lang], extraTranslations[lang]);
    }
    if (typeof setLang === 'function' && typeof currentLang !== 'undefined') {
        setLang(currentLang);
    }
}

// ── Scroll-reveal via IntersectionObserver ───────────────────────────
const revealObs = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (entry.isIntersecting) {
            const el = entry.target;
            if (el.classList.contains('feature-card-new')) {
                const siblings = [...el.parentElement.querySelectorAll('.feature-card-new')];
                el.style.animationDelay = `${siblings.indexOf(el) * 80}ms`;
            }
            el.classList.add('in-view');
            revealObs.unobserve(el);
        }
    }
}, { threshold: 0.12 });

document.querySelectorAll('[data-animatable]').forEach(el => revealObs.observe(el));

(function(){
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = document.querySelector('.hero3__title-text');
    if (!el) return;
    const orig = el.textContent;
    const chars = '!@#$%^&*<>[]{}01';
    let frame = 0;
    const total = 40;
    const id = setInterval(() => {
        el.textContent = [...orig].map((ch, i) => {
            const lockAt = Math.floor((i / orig.length) * total * 0.75);
            return frame > lockAt ? ch : chars[Math.floor(Math.random() * chars.length)];
        }).join('');
        if (++frame >= total) { clearInterval(id); el.textContent = orig; }
    }, 50);
    setTimeout(() => { const ov = document.getElementById('glitch-overlay'); if (ov) ov.remove(); }, 2100);
})();

// ── Copy command from setup terminal ────────────────────────────────
function copyCmd(btn) {
    const cmd = btn.closest('.setup-cmd').dataset.cmd;
    if (!cmd) return;
    const t = (typeof translations !== 'undefined' && typeof currentLang !== 'undefined')
        ? translations[currentLang]
        : null;
    const label = t && t.copied ? t.copied : 'Copied!';
    navigator.clipboard.writeText(cmd).then(() => {
        const orig = btn.textContent;
        btn.textContent = label;
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = orig;
            btn.classList.remove('copied');
        }, 1500);
    }).catch(() => {});
}
