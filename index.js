// ── Visit counter via CountAPI ───────────────────────────────────────
(function () {
    const el = document.getElementById('visit-count');
    if (!el) return;
    fetch('https://api.counterapi.dev/v1/hidr4lisk-warp/visits/up')
        .then(r => r.json())
        .then(d => {
            if (typeof d.count === 'number') {
                el.textContent = String(d.count).padStart(4, '0');
            }
        })
        .catch(() => { el.textContent = '????'; });
})();

// ── Extra i18n keys not present in generator.js translations ────────
const extraTranslations = {
    en: {
        hero_eyebrow:  '// EPHEMERAL · P2P · ZERO_KNOWLEDGE',
        hero_subtitle: 'Zero-config encrypted sync between trusted nodes. No servers. No accounts. No traces.',
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
        hero_eyebrow:  '// EFÍMERO · P2P · CONOCIMIENTO_CERO',
        hero_subtitle: 'Sincronización cifrada sin configuración entre nodos confiables. Sin servidores. Sin cuentas. Sin rastros.',
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
