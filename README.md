# Hidr4lisk_WARP
**Ephemeral P2P File Sync & Terminal Chat**

*Created by [Federico Furgiuele](https://linkedin.com/in/federico-furgiuele)*
[![GitHub](https://img.shields.io/badge/GitHub-hidr4lisk%2Fwarp-0fa?style=flat&logo=github)](https://github.com/hidr4lisk/warp)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-federico--furgiuele-0fa?style=flat&logo=linkedin)](https://linkedin.com/in/federico-furgiuele)
[![Instagram](https://img.shields.io/badge/Instagram-hidr4lisk-0fa?style=flat&logo=instagram)](https://instagram.com/hidr4lisk)

[English](#english) | [Español](#español)

---

## English

Hidr4lisk_WARP is a zero-config, zero-knowledge ephemeral P2P tool. It uses a public MQTT broker as a blind relay while handling AES-256-GCM encryption and SHA-256 integrity checks entirely on the client side. No accounts, no servers, no port forwarding.

### How it works

1. **Generate a session** on the [web generator](https://hidr4lisk.github.io/warp/) — it creates a unique `SESSION_ID` and a 256-bit `SECRET_KEY` and bakes them into `warp.py`.
2. **Copy `warp.py`** into the folder you want to sync on each machine.
3. **Run it** — the folder becomes a live encrypted sync zone. Any file dropped there is detected via OS-native events (Watchdog), encrypted, and pushed instantly. Chat works in the same terminal.
4. **Safe protocol framing** — Uses explicit WARPv2 framing to separate SYSTEM control frames from CHAT payloads, avoiding message collisions and parse errors.
5. **Graceful shutdown** — Ctrl+C / SIGTERM closes sockets cleanly, notifies the peer with a disconnect frame, and restores the terminal state.

Nodes identify each other automatically by hostname. The broker sees only encrypted binary blobs.

### Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install paho-mqtt cryptography watchdog
python3 warp.py
```

> Run these commands inside the folder you want to sync on **each machine**.

### Limitations / Known issues
- Uses test.mosquitto.org as public broker — not for sensitive data in production
- Single-folder sync only (no recursion)
- No resume on interrupted transfer (WIP)

### Roadmap
- [ ] Recursive folder sync
- [ ] File resume

### Dependencies

| Package | Purpose |
|---|---|
| `paho-mqtt` | MQTT transport layer |
| `cryptography` | AES-256-GCM encryption |
| `watchdog` | OS-native filesystem events |

---

## Español

Hidr4lisk_WARP es una herramienta P2P efímera, sin configuración y sin conocimiento. Usa un broker MQTT público como relay ciego mientras maneja el cifrado AES-256-GCM y la verificación de integridad SHA-256 completamente del lado del cliente. Sin cuentas, sin servidores, sin abrir puertos.

### Cómo funciona

1. **Generá una sesión** en el [generador web](https://hidr4lisk.github.io/warp/) — crea un `SESSION_ID` único y una `SECRET_KEY` de 256 bits que se inyectan en `warp.py`.
2. **Copiá `warp.py`** en la carpeta que querés sincronizar en cada máquina.
3. **Ejecutalo** — la carpeta se convierte en una zona de sincronización cifrada. Cualquier cambio es detectado por eventos nativos del OS (Watchdog), cifrado y enviado al instante. El chat funciona en la misma terminal.
4. **Framing seguro** — Usa un protocolo WARPv2 con frames explícitos para separar mensajes de SISTEMA de los datos de CHAT, evitando colisiones y errores de parseo.
5. **Cierre ordenado** — Ctrl+C / SIGTERM cierra sockets limpiamente, notifica al peer con un frame de desconexión y restaura el estado de la terminal.

Los nodos se identifican automáticamente por hostname. El broker solo ve blobs binarios cifrados.

### Instalación

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install paho-mqtt cryptography watchdog
python3 warp.py
```

> Ejecutá estos comandos dentro de la carpeta que querés sincronizar en **cada máquina**.

### Dependencias

| Paquete | Función |
|---|---|
| `paho-mqtt` | Capa de transporte MQTT |
| `cryptography` | Cifrado AES-256-GCM |
| `watchdog` | Eventos nativos del sistema de archivos |

### Limitaciones / Problemas conocidos
- Usa test.mosquitto.org como broker público — no apto para datos sensibles en producción
- Sincronización de una sola carpeta (sin recursión)
- Sin reanudación en transferencias interrumpidas (WIP)

### Roadmap
- [ ] Sincronización recursiva de carpetas
- [ ] Reanudación de archivos
