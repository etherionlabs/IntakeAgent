# Intake — Agente recepcionista de WhatsApp (diseño)

**Fecha:** 2026-05-25
**Estado:** Diseño aprobado, pendiente de plan de implementación.
**Stack:** Node.js + TypeScript · `@openrouter/sdk` · Baileys · Prisma · Fastify · HTMX

## 1. Objetivo

Construir un agente autónomo que actúe como recepcionista de WhatsApp para negocios pequeños (caso piloto: una tapicería). El agente conversa con el cliente, recopila la información necesaria sobre el trabajo solicitado en un **intake estructurado**, y notifica al dueño cuando el caso está listo para revisión.

El sistema está diseñado **multi-negocio desde el inicio**: el dominio (tapicería, peluquería, taller mecánico, etc.) se configura mediante archivos declarativos por "perfil de negocio", sin tocar el código del agente.

### Criterios de éxito (MVP)

- Un cliente puede iniciar conversación por WhatsApp, mantener un intercambio natural, y al final tener un caso registrado en el panel del dueño con todos los datos requeridos.
- El dueño revisa los casos pendientes en un panel web, edita lo que necesite, y toma el control del cliente cuando quiera (pausando al bot).
- Cambiar el agente para otro tipo de negocio toma editar 4 archivos JSON/TXT — sin tocar código.

### Fuera de alcance (MVP)

- Llamadas de voz (fase posterior).
- Comandos del dueño al agente vía WhatsApp para iniciar mensajes outbound (fase 2).
- Análisis de imágenes con visión.
- Cotizaciones automáticas / agenda automática.
- Multi-tenant simultáneo (un proceso = un negocio).
- UI para editar perfiles (se editan los JSON a mano con hot-reload).

## 2. Arquitectura

Monolito modular en un solo proceso Node.js, con módulos comunicados por interfaces para poder dividirse en servicios separados en el futuro sin reescribir.

```
┌──────────────────────────────────────────────────────────────┐
│                    Proceso principal (Node)                  │
│                                                              │
│  ┌────────────────┐    ┌──────────────────┐                  │
│  │ whatsapp-      │───▶│ inbound-pipeline │                  │
│  │ adapter        │    │  (debounce,      │                  │
│  │ (Baileys+QR)   │    │   identify,      │                  │
│  └────────────────┘    │   route to job)  │                  │
│         ▲              └────────┬─────────┘                  │
│         │                       ▼                            │
│         │              ┌──────────────────┐                  │
│         │              │   agent-core     │                  │
│         │              │  (OpenRouter +   │                  │
│         │              │   tools + state  │                  │
│         │              │   injection)     │                  │
│         │              └────────┬─────────┘                  │
│         │                       ▼                            │
│         │              ┌──────────────────┐                  │
│         └──────────────│ outbound-sender  │                  │
│                        └──────────────────┘                  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  storage layer (Prisma → SQLite local / PG en VPS)   │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────┐   ┌─────────────────────────────────┐   │
│  │ media-store     │   │ panel-web                       │   │
│  │ (fotos/audios)  │   │ (Fastify + HTMX + Tailwind CDN) │   │
│  └─────────────────┘   └─────────────────────────────────┘   │
│                                                              │
│  config.json + profiles/<negocio>/*  (hot-reload)            │
└──────────────────────────────────────────────────────────────┘
```

### Módulos

| Módulo | Responsabilidad |
|--------|----------------|
| **whatsapp-adapter** | Conexión Baileys, eventos in/out, QR, reconexión, persistencia de sesión. |
| **inbound-pipeline** | Filtra (grupos, propios), garantiza idempotencia, normaliza (texto/imagen/audio), persiste mensaje, identifica contacto, asigna a job. |
| **agent-core** | Construye prompt con estado inyectado, llama a OpenRouter vía SDK, ejecuta tools, devuelve respuesta. |
| **outbound-sender** | Envía respuestas del agente al cliente. Notifica al dueño cuando hay eventos clave. |
| **storage** | Prisma + SQLite (local) o Postgres (VPS), mismo schema. |
| **media-store** | Filesystem `./media/<contact_id>/<job_id>/...` con paths registrados en DB. |
| **panel-web** | Fastify routes `/panel/*` y `/api/*` con auth básica. |
| **config / profiles** | `config.json` + `profiles/<negocio>/{intake-schema,prompt-vars,business-facts,welcome}` con hot-reload. |

### Por qué Node + TypeScript

- Baileys (WhatsApp Web con QR) es nativo Node y muy mantenido.
- `@openrouter/sdk` es Node-first; Zod para schemas de tools.
- Tipado fuerte ayuda con el dominio de muchos estados.

## 3. Modelo de datos

Postgres-compatible; SQLite en local con el mismo schema vía Prisma.

```
contacts
  id              uuid PK
  phone_e164      text UNIQUE
  display_name    text NULL
  bot_active      bool DEFAULT true
  flagged_non_intake bool DEFAULT false
  created_at, updated_at

jobs
  id              uuid PK
  contact_id      uuid FK contacts(id)
  status          enum('OPEN_INTAKE','READY_FOR_REVIEW','IN_PROGRESS','CLOSED')
  intake          jsonb
  intake_complete bool DEFAULT false
  summary         text NULL
  opened_at, ready_at NULL, closed_at NULL
  INDEX (contact_id, status)

messages
  id              uuid PK
  job_id          uuid FK jobs(id) NULL
  contact_id      uuid FK contacts(id)
  direction       enum('inbound','outbound')
  kind            enum('text','image','audio','sticker','location','other')
  body            text NULL
  media_path      text NULL
  whatsapp_msg_id text NULL
  raw             jsonb
  created_at
  UNIQUE (whatsapp_msg_id)
  INDEX (contact_id, created_at)

agent_runs
  id              uuid PK
  job_id          uuid FK jobs(id)
  trigger_message_ids uuid[]
  model           text
  input_tokens, output_tokens int
  cost_usd        numeric(10,6) NULL
  tool_calls      jsonb
  response_text   text
  config_hash     text          -- hash del config.json al momento
  error           text NULL
  created_at

notifications
  id              uuid PK
  job_id          uuid FK jobs(id)
  kind            enum('owner_ready','disconnect_alert','cost_alert')
  sent_via        enum('whatsapp','panel_only')
  sent_at

settings
  key             text PK
  value           jsonb
  -- ej: 'whatsapp_session', otros singletons
```

### Decisiones clave

- **`intake` como JSONB**: la estructura la define el perfil del negocio (no requiere migraciones para cambios de schema).
- **`whatsapp_msg_id` UNIQUE**: idempotencia ante reenvíos.
- **`messages.job_id` nullable**: el mensaje se persiste antes de decidir el job.
- **`agent_runs` separado**: cada llamada al modelo es auditable (prompts, tokens, costo, tool calls).
- **`config_hash` en agent_runs**: trazabilidad de qué versión del prompt produjo cada respuesta.

## 4. Estructura del intake

El intake vive en `jobs.intake` como JSONB. Su **schema lo define el perfil del negocio** en `profiles/<negocio>/intake-schema.json` — declarativo, autocontenido, sin código.

### Formato del schema

```json
{
  "$businessName": "Tapicería [Nombre]",
  "$businessDomain": "tapicería de muebles",
  "$language": "es-MX",
  "sections": [
    {
      "key": "client",
      "label": "Cliente",
      "fields": [
        { "key": "name", "label": "Nombre", "type": "string", "required": true },
        { "key": "city_or_zone", "label": "Ciudad / Zona", "type": "string", "required": true },
        { "key": "phone_alt", "label": "Teléfono alterno", "type": "phone", "required": false }
      ]
    },
    {
      "key": "work",
      "label": "Trabajo",
      "fields": [
        { "key": "item_type", "label": "Mueble", "type": "string", "required": true, "hint": "sillón 3 plazas, silla de comedor, etc." },
        { "key": "service_type", "label": "Tipo de trabajo", "type": "enum",
          "options": ["retapizar", "reparar", "fabricar", "otro"], "required": true },
        { "key": "quantity", "label": "Cantidad", "type": "integer", "min": 1, "required": true }
      ]
    }
    // ... más secciones (specs, logistics, etc.)
  ]
}
```

### Tipos soportados

`string`, `text` (multilínea), `integer`, `number`, `boolean`, `enum`, `multi_enum`, `phone`, `date`, `currency`.

### Estado runtime del intake (en `jobs.intake`)

Cada campo definido en el schema se representa así:

```json
{
  "client": {
    "name":         { "value": "María González", "asked": true, "updated_at": "...", "source_message_id": "..." },
    "city_or_zone": { "value": null,             "asked": true, "declined": true, "declined_reason": "prefiere no decirlo aún", "updated_at": "...", "source_message_id": "..." },
    "phone_alt":    { "value": null,             "asked": false }
  },
  "work": { "item_type": { "value": "sillón 3 plazas", "asked": true, "updated_at": "...", "source_message_id": "..." }, ... },
  "media": { "photo_count": 2, "audio_count": 0 },
  "free_notes": [
    { "text": "lo necesita antes del 15 de junio para un evento", "added_at": "...", "source_message_id": "..." }
  ]
}
```

- `asked` evita repreguntar lo mismo.
- `declined` indica que el cliente explícitamente dijo que no tiene, no sabe, no aplica o no quiere dar el dato. El campo deja de bloquear el cierre del intake. `declined_reason` guarda el motivo en palabras del cliente.
- `updated_at` + `source_message_id` permiten trazabilidad: si el cliente cambia un dato (ej. "son 4 sillas… bueno, en realidad 6"), el panel puede mostrar cuándo y de qué mensaje vino el valor actual. La historia completa de valores se reconstruye desde `messages` + `agent_runs` cuando se necesite.
- `free_notes` captura información relevante que no encaja en campos definidos, con la misma trazabilidad.

### Criterio de "intake completo"

Un campo `required` se considera satisfecho si **`value !== null`** o **`declined === true`**. Cuando todos los campos `required` están satisfechos, el agente puede llamar a `mark_ready_for_review`.

### Render del estado al modelo (iconografía)

- ✓ lleno
- ✗ vacío y requerido
- ⊘ declinado (vacío pero el cliente lo descartó)
- ○ opcional vacío

## 5. Inbound pipeline

Desde un evento de Baileys hasta el agent run.

1. **Pre-filter**: ignorar grupos (`@g.us`), mensajes propios, status/broadcast.
2. **Idempotencia**: drop si `whatsapp_msg_id` ya está en DB.
3. **Normalizar**:
   - texto → `kind=text, body=texto`
   - imagen → descargar a media-store, `kind=image, media_path=...`
   - audio → descargar + transcribir con Whisper (vía OpenRouter), `kind=audio, body=transcripción, media_path=...`
   - otros → `kind=other`, body con descripción
4. **Persistir** `messages` (con `job_id` aún null).
5. **Resolver contacto**: upsert por `phone_e164`. Si `bot_active=false` o `flagged_non_intake=true` → STOP.
6. **Resolver job**:
   - jobs abiertos = status ∈ {OPEN_INTAKE, READY_FOR_REVIEW}
   - 0 jobs → crear OPEN_INTAKE, marcar `is_first_msg=true`
   - 1 job → asignar
   - >1 jobs → diferir (lo decide el agente con tool `select_or_open_job`)
7. **Encolar** en buffer del debouncer por `contact_id`.

### Debouncer

Estructura en memoria:

```ts
Map<contact_id, {
  messages: Message[];
  timer: NodeJS.Timeout;
  processing: boolean;
}>
```

- Timer de 5 s (configurable). Cada mensaje nuevo lo resetea (a menos que ya esté en `processing=true`, en cuyo caso solo se acumula).
- Cuando el timer dispara, se hace lock (`processing=true`), se toma snapshot, se llama al agent-core.
- Al terminar, si hubo mensajes acumulados durante el proceso, se reinicia el timer.

Garantiza orden serializado por contacto y paralelismo entre contactos.

### Primer contacto

Si el job se creó con `is_first_msg=true`, antes de invocar al agente se envía el `welcome.txt` del perfil. Sin tokens.

## 6. Agent-core y tools

Una instancia fresca del SDK por agent run — la fuente de verdad de la conversación es nuestra DB, no el SDK.

```ts
const agent = createAgent({
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: cfg.model,                          // ej. "anthropic/claude-sonnet-4-6"
  instructions: buildSystemPrompt(cfg, profile, ctx),
  tools: buildTools(ctx),
  maxSteps: cfg.maxSteps ?? 6,
});
const response = await agent.sendSync(renderBatch(ctx.batchMessages));
```

`sendSync` porque WhatsApp no necesita streaming.

### Construcción del system prompt

Composición en orden:
1. Plantilla del prompt (`prompt-vars.json` aplicada al template base, con `{{businessName}}` y `{{businessDomain}}` sustituidos desde el schema).
2. Bloque `=== INFORMACIÓN DEL NEGOCIO ===` con los `business-facts.json`.
3. Bloque `=== ESTADO DEL INTAKE ===` generado del `jobs.intake` actual y el schema (Sección 4).
4. Bloque `=== JOBS ABIERTOS MÚLTIPLES ===` si aplica.
5. Bloque de horario actual si `hours.enabled=true`.

### Construcción del user message

Los mensajes del batch concatenados con anotaciones de tipo:

```
[mensaje 1 — texto]
Hola, te escribo porque tengo un sillón

[mensaje 2 — foto recibida]
(imagen guardada, id=img_abc123)

[mensaje 3 — audio transcrito]
Lo necesito antes del 15 de junio
```

### Tools (6 en total)

Todas con Zod, closures sobre `ctx`.

| Tool | Propósito |
|------|----------|
| `update_intake` | **Batch**: array de `{path, value}` + opcional `notes_to_add[]`. Marca campos como `asked=true`. Una sola tool call por turno típico. |
| `mark_ready_for_review` | Requiere campos mínimos completos. Cambia status del job, dispara notificación al dueño. Toma `summary` 2-3 frases. |
| `close_job` | Cierra el job. Solo cuando el cliente confirma que terminó. |
| `select_or_open_job` | Solo expuesta cuando hay >1 job abierto. Decide entre usar uno existente o abrir nuevo. |
| `flag_non_intake` | Marca contacto como no-cliente. El bot deja de responder. |
| `request_photo` | Registra que el agente pidió fotos (para tracking). No envía nada por sí solo. |

`update_intake` es batch deliberadamente para minimizar steps del modelo, y soporta tanto guardar valores como marcar campos como **declinados** por el cliente:

```ts
tool({
  name: 'update_intake',
  description: 'Guarda valores y/o marca campos como declinados por el cliente. Agrupa todos los cambios del turno en una sola llamada.',
  inputSchema: z.object({
    fields: z.array(z.object({
      path: z.string(),
      value: z.union([z.string(), z.number(), z.boolean()]).optional(),
      declined: z.boolean().optional(),
      declined_reason: z.string().optional(),
    }).refine(
      d => d.value !== undefined || d.declined === true,
      { message: 'Cada campo debe tener value o declined=true' }
    )).min(1),
    notes_to_add: z.array(z.string().min(3).max(500)).optional(),
  }),
  execute: async ({ fields, notes_to_add }) =>
    intakeService.bulkUpdate(ctx.job.id, fields, notes_to_add ?? []),
}),
```

Instrucción dura para el agente (en `prompt-vars.json`): si el cliente dice explícitamente que no tiene, no sabe, no aplica o no quiere dar un dato, usar `declined=true` con `declined_reason`. Nunca insistir en un dato ya declinado. Nunca marcar declined a la primera ambigüedad — debe ser una negación clara del cliente.

### Validación de tool calls en el runtime

El runtime **no confía** en que el modelo respete las reglas — las valida en el `execute()` de cada tool y devuelve error al modelo cuando se sale del carril. Esto traslada la autoridad operacional del prompt al código y elimina toda una clase de bugs causados por alucinaciones.

| Tool | Validaciones del runtime |
|------|--------------------------|
| `update_intake` | (1) Cada `path` debe existir en el `intake-schema.json` del perfil. (2) Cada `value` debe cumplir el `type` del campo (string/integer/enum/etc.). Si es enum, debe estar en `options`. Si es integer, debe respetar `min`/`max`. (3) `value` y `declined` no pueden ir juntos para el mismo path. (4) `declined=true` requiere `declined_reason` con longitud razonable. |
| `mark_ready_for_review` | (1) El job debe estar en `OPEN_INTAKE`. (2) Todos los campos `required` del schema deben estar satisfechos (`value !== null` o `declined === true`). (3) `summary` con longitud mínima. |
| `close_job` | (1) El job debe estar en `OPEN_INTAKE` o `READY_FOR_REVIEW`. (2) No se cierra desde `IN_PROGRESS` (ese estado lo decide el dueño desde el panel). |
| `select_or_open_job` | (1) Si `action='use_existing'`, `existing_job_id` debe ser uno de los jobs abiertos pasados en el contexto del turno. |
| `flag_non_intake` | Sin precondiciones, pero registra `reason` para auditoría. |
| `request_photo` | Sin precondiciones. |

Cuando una validación falla, el `execute()` devuelve un objeto `{ error: "razón concreta para el modelo" }` que el SDK pasa como tool result. El modelo lo recibe en el siguiente step y puede corregir (ej. preguntar el dato faltante en vez de marcar ready). Si el modelo insiste, `maxSteps` lo corta.

Cada validación fallida también se loguea en `agent_runs.tool_calls` para visibilidad.

### Manejo de errores

- Excepciones del SDK / red: capturadas, guardadas en `agent_runs.error`. Respuesta de fallback configurable (`fallbackOnError`) al cliente.
- 3 errores consecutivos en el mismo contacto → notificación al dueño.

### Costos

Cada agent run guarda tokens y costo. Cuando se supera `limits.alertOnCostUsd` mensual → notificación. Si se supera `limits.monthlyCostUsd` → **pausa global del bot** hasta intervención.

## 7. Configuración multi-negocio

### Layout de archivos

```
./config.json                                ← config global (modelo, owner, panel, profile path)
./profiles/
  ├── tapiceria/
  │   ├── intake-schema.json
  │   ├── prompt-vars.json
  │   ├── business-facts.json
  │   └── welcome.txt
  ├── peluqueria/
  │   └── ...
  └── ...
```

`config.json` apunta al perfil activo:

```json
{
  "profile": "./profiles/tapiceria",
  "model": "anthropic/claude-sonnet-4-6",
  "maxSteps": 6,
  "temperature": 0.4,
  "debounceMs": 5000,
  "fallbackOnError": "Disculpa, tuve un problema. ¿Me lo repites?",
  "outOfScopeNudge": "Esto es solo para temas de {{businessDomain}}. ¿Cómo puedo ayudarte?",
  "hours": { "enabled": false, "timezone": "America/Mexico_City", "schedule": {...} },
  "owner": {
    "phone_e164": "+521XXXXXXXXXX",
    "notifyOnReady": true,
    "notifyOnDisconnect": true,
    "panelUrl": "http://localhost:3000"
  },
  "panel": {
    "users": [{ "username": "duenio", "passwordHashEnv": "PANEL_PASSWORD_HASH" }]
  },
  "media": { "storeDir": "./media", "transcribeAudio": true, "whisperModel": "openai/whisper-1" },
  "limits": { "monthlyCostUsd": 50, "alertOnCostUsd": 40, "maxConsecutiveErrors": 3 }
}
```

### `profiles/<negocio>/prompt-vars.json`

```json
{
  "promptTemplate": "Eres el asistente virtual de **{{businessName}}**, un negocio de {{businessDomain}}. Tu trabajo es atender por WhatsApp...\n\n## Tono\n{{tone}}\n\n## Cómo trabajas\n{{coreInstructions}}\n\n## Reglas duras\n{{hardRules}}",
  "vars": {
    "tone": "Español neutro y cercano. Usa 'tú'. Mensajes cortos.",
    "coreInstructions": "...",
    "hardRules": "..."
  }
}
```

### `profiles/<negocio>/business-facts.json`

```json
{
  "facts": [
    { "topic": "ubicación", "aliases": ["dirección", "donde están"], "answer": "Av. Reforma 123..." },
    { "topic": "horarios", "aliases": ["a qué hora abren"], "answer": "L-V 9-19h, S 10-14h." },
    { "topic": "métodos de pago", "aliases": ["pago", "tarjeta"], "answer": "Efectivo, transferencia y tarjeta." }
  ],
  "freeContext": "Trabajamos sobre todo con muebles de sala y comedor. No hacemos colchones."
}
```

Se inyecta en el system prompt. Instrucción dura: **nunca inventar datos del negocio**; si la pregunta no está cubierta, decir que el dueño la confirmará.

### Hot-reload y validación

- En cada agent run, se relee `config.json` y los archivos del perfil.
- Validación con Zod meta-schema. Si algo falla, se mantiene la última versión válida y se loguea.
- Si los `facts[]` + `freeContext` superan ~3000 tokens, se considera retrieval (fase posterior).

### Escalar a otro negocio

Copiar `profiles/tapiceria/` → `profiles/peluqueria/`, editar los 4 archivos, cambiar `profile` en `config.json`, reiniciar. Cero código.

## 8. Panel web

Stack: Fastify + HTMX + plantillas server-side + Tailwind por CDN. Cero build step.

Auth: HTTP Basic + cookie firmada. Una cuenta en MVP (`config.panel.users`).

### Vistas

| Ruta | Función |
|------|---------|
| `/panel/dashboard` | Listas por estado: READY_FOR_REVIEW, OPEN_INTAKE, IN_PROGRESS, CLOSED, non-intake. Estado de WhatsApp y bot. Cada conversación activa muestra un chip de "modo de atención": 🟢 IA activa · 👤 Humano atendiendo (job en IN_PROGRESS) · ⏸️ IA pausada (bot_active=false). Es la información que más tranquiliza al dueño y por eso va visible en primer plano. |
| `/panel/jobs/:id` | Conversación completa (con fotos y audios reproducibles) + formulario del intake renderizado del schema + botones (pausar bot, marcar IN_PROGRESS, cerrar, reabrir). Campos declinados se muestran como "No proporcionado: \<reason\>" en gris y son editables si el dueño obtiene el dato después. |
| `/panel/contacts` | Tabla de contactos con toggle de `bot_active`. |
| `/panel/whatsapp` | Estado de conexión, QR cuando aplica, botones de logout/reconectar. |
| `/panel/usage` | Costos, agent runs, tokens del mes. |
| `/panel/config` | Visor del config/perfil (solo lectura en MVP). |

### API interna

| Endpoint | Función |
|----------|---------|
| `POST /api/contacts/:id/bot-toggle` | Cambia `bot_active`. |
| `PATCH /api/jobs/:id/intake` | Edita campos del intake. |
| `POST /api/jobs/:id/status` | Cambia status manualmente. |
| `GET /api/whatsapp/status` | Estado + QR. |

Cambios desde el panel **no** disparan respuesta del agente.

### Notificación al dueño (READY)

WhatsApp al `owner.phone_e164` con:
```
🪡 Nuevo intake listo

Cliente: María González
Trabajo: Retapizar sillón 3 plazas
Zona: Polanco
Fotos: 2 recibidas

Ver: http://localhost:3000/panel/jobs/abc123
```

## 9. Testing y observabilidad

### Testing (Vitest)

**Unit**:
- `intakeService`: bulkUpdate, addFreeNote, marcado de `asked`.
- `jobService`: máquina de estados.
- `prompt builder`: render con todas las combinaciones de estado.
- `debouncer`: agrupación, lock, mensajes durante `processing`.
- `config loader`: validación Zod, fallback a última versión válida.
- `schema validator`: rechaza schemas malformados, tipos no soportados, enums vacíos.

**Integration** (DB SQLite efímera + stubs de adapter y OpenRouter):
- Primer contacto → bienvenida → agent run → respuesta + tools.
- 4 mensajes rápidos → un solo agent run.
- Intake completo → `mark_ready_for_review` → notificación.
- Reapertura con 1 job READY pendiente.
- 2 jobs abiertos → `select_or_open_job`.
- Mensaje duplicado → ignorado.
- `bot_active=false` → mensaje guardado sin respuesta.
- Foto → archivo persistido.
- Audio → transcripción usada como texto.

**No testeamos**: el SDK de OpenRouter ni Baileys (asumimos que sus libs funcionan), ni la calidad subjetiva del prompt (eso se evalúa con corridas manuales).

### Manual / piloto

- Carpeta `./fixtures/conversations/` con transcripciones marcadas "buena/mala" para iterar el prompt.

### Observabilidad

- **Logs estructurados con pino**: cada log incluye `contact_id`, `job_id`, `agent_run_id` cuando aplica.
- Eventos clave: `wa.connected/disconnected/qr_required`, `inbound.message`, `debounce.flush`, `agent.run.start/end`, `agent.tool.called`, `agent.error`, `job.status_changed`, `notification.sent`.
- **Métricas en `/panel/usage`**: runs/día, tokens/día, costo/mes, duración media, tasa de errores.
- **Healthcheck** `/healthz`: 200 si DB y WhatsApp OK, 503 si falla algo.

### Alertas al dueño (vía WhatsApp)

- Desconexión de WhatsApp > 2 min.
- 3+ errores consecutivos para un mismo contacto.
- Costo mensual > `limits.alertOnCostUsd`.
- Costo mensual > `limits.monthlyCostUsd` → además pausa el bot globalmente.

## 10. Roadmap post-MVP

- **Fase 2**: comandos del dueño al agente por WhatsApp ("escríbele a María pidiéndole la medida del respaldo"). Requiere identificar al dueño por número, parsear intención, abrir conversación outbound.
- **Fase 3**: llamadas de voz.
- Edición de perfiles desde el panel.
- Retrieval para business-facts grandes (embeddings).
- Multi-tenant simultáneo (prefijar tablas con `tenant_id`).
- Análisis de fotos con visión multimodal.
- Integración con calendario para agendar visitas.

### Direcciones de evolución arquitectónica (no son features, son rumbos)

- **Separación más fuerte entre extracción semántica y decisión operacional**: hoy las tools tipadas + validación en runtime ya separan ambas, pero el modelo aún decide *cuándo* llamar cada tool. Si en producción aparecen patrones donde el modelo se sale del carril con frecuencia, evolucionar hacia un modo donde el modelo solo emita extracción de entidades + intención, y un controlador determinístico decida los siguientes pasos. Migrable sin tocar el storage ni el panel.
- **Historia completa de valores por campo**: hoy se reconstruye con join `messages × agent_runs`. Si el caso "el cliente se contradice" pasa seguido y el dueño necesita verlo de un vistazo, materializar `previous_values[]` por campo con `value/source/timestamp/confidence`.
- **El producto es el runtime de intake, no el bot de WhatsApp**: el verdadero moat está en el motor (conversación caótica → estructura → workflow → handoff). WhatsApp es un adaptador. Conviene tratar `whatsapp-adapter` como una integración intercambiable desde el inicio (ya lo es por interfaces), y nombrar el core como `intake-runtime` cuando llegue el momento de empaquetarlo como producto.

## 11. Estructura de directorios (referencia)

```
intake/
├── src/
│   ├── adapters/whatsapp/        # Baileys, QR, sesión
│   ├── pipeline/                 # filter, normalize, debouncer
│   ├── agent/                    # createAgent, prompt, tools
│   ├── services/                 # intake, job, contact, notification
│   ├── storage/                  # Prisma client, repositories
│   ├── media/                    # filesystem store
│   ├── panel/                    # Fastify routes, vistas, API
│   ├── config/                   # loader, validator, hot-reload
│   └── index.ts                  # bootstrap
├── prisma/schema.prisma
├── profiles/
│   └── tapiceria/
│       ├── intake-schema.json
│       ├── prompt-vars.json
│       ├── business-facts.json
│       └── welcome.txt
├── config.json
├── .env                          # OPENROUTER_API_KEY, PANEL_PASSWORD_HASH
├── media/                        # archivos descargados (gitignored)
├── data/                         # SQLite en local (gitignored)
├── tests/
└── docs/superpowers/specs/
```

## 12. Dependencias

```json
{
  "@openrouter/sdk": "latest",
  "zod": "^3",
  "@whiskeysockets/baileys": "latest",
  "@prisma/client": "^5",
  "fastify": "^4",
  "pino": "^9",
  "handlebars": "^4"
}
```

Dev: `typescript`, `tsx`, `vitest`, `prisma`, `@types/node`.

## 13. Variables de entorno

```
OPENROUTER_API_KEY=sk-or-...
PANEL_PASSWORD_HASH=<bcrypt hash>
DATABASE_URL=file:./data/intake.db          # local
# DATABASE_URL=postgres://...               # VPS
```
