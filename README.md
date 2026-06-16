# Intake

Recepcionista autónomo de WhatsApp para talleres de tapicería. Atiende los
mensajes de los clientes, levanta el "intake" (datos del trabajo) de forma
conversacional y avisa al dueño cuando un trabajo está listo para revisar. Trae
un panel web para ver conversaciones, gestionar el pipeline de trabajos y la
configuración.

- **Stack:** Node.js 20+, TypeScript (ejecutado con `tsx`, sin paso de build),
  Fastify + Handlebars + HTMX (panel), Prisma 7 + SQLite, Baileys (WhatsApp),
  OpenRouter (LLM + transcripción de audios).

---

## Requisitos

- **Node.js 20 o superior** — https://nodejs.org
- Una **API key de OpenRouter** — https://openrouter.ai/keys
- Un **teléfono con WhatsApp** para vincular la cuenta del negocio.

---

## Instalación rápida (recomendada)

Desde la carpeta del proyecto:

**Windows (PowerShell):**

```powershell
.\install.ps1
```

Si PowerShell bloquea el script:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

**macOS / Linux:**

```bash
bash install.sh
```

El instalador:

1. Verifica que tengas Node.js 20+.
2. Instala las dependencias (`npm install`).
3. Lanza el setup interactivo, que te pide la API key de OpenRouter y una
   contraseña para el panel, genera los secretos y crea la base de datos.

Al terminar, arranca con:

```bash
npm start
```

---

## Instalación manual (paso a paso)

Si prefieres no usar el script:

```bash
# 1. Dependencias
npm install

# 2. Configuración interactiva (.env + base de datos)
npm run setup
```

`npm run setup` es **reentrante**: puedes correrlo otra vez sin perder lo ya
configurado. Hace lo siguiente:

- Crea `.env` a partir de `.env.example` si no existe.
- Pide `OPENROUTER_API_KEY` si falta.
- Pide una contraseña para el panel y guarda su hash (`PANEL_PASSWORD_HASH`).
- Genera un `PANEL_SESSION_SECRET` estable.
- Crea la base de datos aplicando las migraciones (`prisma migrate deploy`).

Si prefieres configurar el `.env` a mano, copia `.env.example` a `.env` y
rellena los valores. Para generar el hash de la contraseña del panel sin el
asistente:

```bash
npm run panel:hash -- mi-password-segura
# pega el resultado en PANEL_PASSWORD_HASH del .env

npm run db:deploy   # crea la base de datos
```

---

## Primer arranque

```bash
npm start
```

1. La primera vez se imprime un **código QR** en la terminal. Escánealo desde
   WhatsApp en el teléfono del negocio:
   **WhatsApp → Dispositivos vinculados → Vincular un dispositivo.**
2. La sesión queda guardada en `data/baileys-session/`; los siguientes arranques
   reconectan solos, sin QR.
3. Abre el panel en **http://localhost:3000**
   - Usuario: **admin**
   - Contraseña: la que definiste en el setup.

Para detener el proceso: `Ctrl + C`.

---

## Configuración del negocio

- **`config.json`** — comportamiento del asistente: modelo, teléfono del dueño
  (`owner.phoneE164`, en formato E.164, ej. `+5215555555555`), horarios, límites
  de costo, etc. La sección `media` controla cómo se procesan los adjuntos:
  `transcribeAudio` (notas de voz → texto) y `describeImages` (fotos del cliente
  → descripción con `visionModel`). Cuando están activos, el asistente "razona"
  sobre audios y fotos como si fueran texto.
- **`profiles/tapiceria/`** — el "perfil" del negocio:
  - `intake-schema.json` — qué datos se recogen de cada trabajo.
  - `prompt-vars.json` — variables del prompt (nombre del negocio, tono…).
  - `business-facts.json` — datos del negocio que el asistente puede usar.
  - `welcome.txt` — mensaje de bienvenida.

Edita estos archivos antes de la primera prueba con el cliente para adaptarlo al
negocio. Tras cambiar `config.json` o el perfil, reinicia con `Ctrl + C` y
`npm start`.

### Editar desde el panel

La sección **Configuración** del panel (visible solo para usuarios con rol
`admin`) permite editar sin tocar archivos:

- **Negocio** (perfil del tenant): nombre y giro, mensaje de bienvenida,
  variables del asistente (tono, instrucciones), y los datos del negocio.
- **Sistema** (`config.json`): modelo, temperatura, horarios, teléfono del
  dueño y notificaciones, límites de costo, y medios (describir imágenes,
  transcribir audios, modelo de visión).

Los cambios se validan y se escriben a los archivos correspondientes. Como el
worker carga la configuración al arrancar, **reinícialo para aplicar los
cambios**.

---

## Variables de entorno (`.env`)

| Variable | Descripción |
| --- | --- |
| `OPENROUTER_API_KEY` | API key de OpenRouter (LLM + transcripción). |
| `PANEL_PASSWORD_HASH` | Hash bcrypt de la contraseña del panel (usuario `admin`). |
| `PANEL_SESSION_SECRET` | Secreto para firmar sesiones del panel. **Debe ser estable** entre reinicios. |
| `PANEL_PORT` | Puerto del panel (por defecto `3000`). |
| `DATABASE_URL` | Ruta de la base de datos SQLite (por defecto `file:./data/intake.db`). |

---

## Comandos útiles

| Comando | Para qué |
| --- | --- |
| `npm start` | Arranca el asistente + panel web. |
| `npm run setup` | Configuración inicial / reconfiguración. |
| `npm run db:deploy` | Aplica migraciones (crea/actualiza la base de datos). |
| `npm run panel:hash -- <password>` | Genera el hash de una contraseña del panel. |
| `npm test` | Corre la batería de pruebas. |
| `npm run typecheck` | Verifica tipos de TypeScript. |
| `npm run prisma:studio` | Explorador visual de la base de datos. |

---

## Datos y copias de seguridad

Todo el estado vive en la carpeta `data/`:

- `data/intake.db` — base de datos (contactos, trabajos, mensajes, costos).
- `data/baileys-session/` — sesión de WhatsApp (no compartir ni versionar).

Para respaldar, copia la carpeta `data/` completa con el proceso detenido.

---

## Solución de problemas

- **El QR no aparece / se desconecta:** borra `data/baileys-session/` y vuelve a
  arrancar para vincular de nuevo.
- **El asistente no responde:** revisa que `OPENROUTER_API_KEY` sea válida y que
  tengas saldo en OpenRouter.
- **No entras al panel:** confirma `PANEL_PASSWORD_HASH` en `.env` (regenera con
  `npm run panel:hash`) y que entras con el usuario `admin`.
- **Te desloguea al reiniciar:** falta un `PANEL_SESSION_SECRET` fijo en `.env`
  (vuelve a correr `npm run setup`).
