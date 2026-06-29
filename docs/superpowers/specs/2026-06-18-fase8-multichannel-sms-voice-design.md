# Fase 8 — Multicanal v2: SMS + Voz conversacional en vivo (Twilio) — Diseño

**Fecha:** 2026-06-18
**Estado:** Propuesta para implementación (post-lanzamiento)
**Proveedor elegido:** Twilio (SMS + Voz + Media Streams + números, todo en un solo lugar)
**Depende de:** Fase 2 (capa de canal, §2.x del roadmap) y Fase 4 (onboarding self-service)

---

## 1. Objetivo

Atender a clientes finales que prefieren **SMS** o una **llamada de voz** en lugar de
WhatsApp, sin reescribir el núcleo del producto. Esta fase es **post-lanzamiento**: el
producto ya vende y opera WhatsApp-only; SMS y voz son una línea v2 que **amplía el
alcance de canales** apoyándose en la abstracción que la Fase 2 dejó lista.

La pregunta que guía cada decisión no es "qué stack de voz es más impresionante", sino
**"qué reutiliza el pipeline existente y qué margen deja contra el plan fijo"**.

Dos sub-tracks de esfuerzo y riesgo radicalmente distintos:

- **8A — SMS:** barato (~2 semanas), reutiliza casi todo el pipeline, más estable que
  Baileys (sin QR ni sesión). Es texto entrando al mismo bucle de hoy.
- **8B — Voz conversacional en vivo:** la pieza más compleja del roadmap (6–10+ semanas),
  servicio nuevo, sensible a latencia, stateful por llamada. Es donde está el riesgo y
  el diferenciador.

---

## 2. Punto de partida: el núcleo YA es agnóstico al canal

Esto **no** hay que rehacerlo. Verificado en el código actual del worker:

- **`OutboundSender` es una interfaz de un solo método** — `sendText(toPhoneE164, text)`
  (`src/services/outbound.ts:6`). El coordinador llama `this.deps.sender.sendText(...)`
  (`src/pipeline/coordinator.ts:100,249`) sin saber qué canal hay detrás. WhatsApp/Baileys
  es **una** implementación; `MemorySender` es otra (tests).
- **El agente es texto puro in / texto puro out.** `runAgentTurn(ctx, deps)`
  (`src/agent/runner.ts:6`) recibe `batchMessages` y `recentHistory` y devuelve
  `responseText` (`src/agent/types.ts:106`). No menciona WhatsApp en ningún punto.
- **El pipeline (debounce, idempotencia, resolución de contacto/job, intake) es genérico.**
  `InboundCoordinator.handleInbound(raw)` (`src/pipeline/coordinator.ts:28`) opera sobre
  `RawInboundMessage`, no sobre tipos de Baileys.
- **El STT ya está abstraído como interfaz.** `Transcriber.transcribe(buffer, mimetype)`
  (`src/media/transcriber.ts:1`) con implementaciones `Noop`, `Scripted` y
  `WhisperTranscriber` (OpenRouter). La voz reutiliza este contrato.
- **`Notifier` es una interfaz** (`src/services/notification.ts:13`) para avisos al dueño.

Lo único acoplado a un canal es **el borde de entrada/salida** (el adaptador Baileys). El
trabajo de la Fase 8 es **escribir nuevos adaptadores de borde**, no tocar el núcleo.

### 2.1 Lo que la Fase 2 (§2.x Capa de canal) dejó listo y esta fase asume

La Fase 2 hizo un refactor barato (días) que es el habilitador de toda esta fase:

- `RawInboundMessage.whatsappMsgId` → **`externalMsgId`** y campo
  **`channel: 'whatsapp' | 'sms' | 'voice'`** (`src/pipeline/types.ts:10-20`). El
  coordinador y la idempotencia ya usan `externalMsgId` en lugar de un id de WhatsApp.
- Columna **`channel`** en `Message` y `Contact` (Prisma, default `'whatsapp'`). La
  identidad del contacto sigue siendo el **teléfono E.164**; un mismo teléfono puede
  existir en varios canales.
- Interfaz **`InboundSource`** definida; `OutboundSender`/`Notifier` son contratos por
  canal. WhatsApp (Baileys) es **una** implementación de `InboundSource`/`OutboundSender`.

> Si por cualquier motivo la Fase 2 no completó el renombrado/`channel`, es **prerequisito
> de la Fase 8A** hacerlo primero — es el único cambio que toca el núcleo.

---

## 3. Arquitectura de la fase

```
                        ┌──────────────────────────────────────────────┐
                        │  VPS — red Docker interna                    │
   Twilio (SMS)         │                                              │
   webhook HTTPS  ─────►│  api (Fastify)                               │
                        │   └─ POST /webhooks/twilio/sms  (8A)         │
                        │        └─► TwilioSmsInboundSource             │
                        │             └─► InboundCoordinator (núcleo)  │
                        │                   ▲ sender:                   │
                        │                   └─ TwilioSmsSender ─► Twilio│
                        │  postgres (Message.channel='sms')            │
                        └──────────────────────────────────────────────┘

   Twilio (Voz)         ┌──────────────────────────────────────────────┐
   PSTN call            │  voice-gateway  (CONTENEDOR NUEVO, 8B)       │
        │               │   stateful por llamada · escala distinta     │
        ▼               │                                              │
   Twilio Voice ◄──WS──►│  WebSocket Media Streams (audio bidireccional)│
   + Media Streams      │   bucle: STT-stream → agente → TTS-stream    │
                        │   barge-in · <~800ms/turno · grabación       │
                        │      └─► reutiliza runAgentTurn (texto)       │
                        │      └─► escribe Message.channel='voice'      │
                        └──────────────────────────────────────────────┘
```

**Regla de red (heredada del spec maestro):** la `api` es la única superficie pública
del backend. El `voice-gateway` expone **un** endpoint WSS para Media Streams de Twilio
(vía nginx/TLS en el host); postgres y el worker de chat siguen sin puerto público.

---

## 4. 8A — SMS (Twilio) · esfuerzo: ~2 semanas

### 4.1 Inbound: webhook de Twilio → `InboundSource`

Twilio entrega cada SMS entrante como un **POST HTTPS** (form-urlencoded) a una URL
configurada en el número. Se implementa una ruta en la `api` (no en el worker: el SMS no
necesita sesión persistente, y la `api` ya es la superficie pública):

```
POST /webhooks/twilio/sms
  body: From, To, Body, MessageSid, NumMedia, MediaUrl0...  (Twilio)
  → validar firma X-Twilio-Signature (HMAC con el Auth Token)
  → resolver tenant por el número destino `To`  (TenantSettings.smsNumber)
  → construir RawInboundMessage { channel:'sms', externalMsgId: MessageSid, ... }
  → coordinator.handleInbound(raw)
  → responder 200 (TwiML vacío; la respuesta del bot va por API saliente, no inline)
```

**`TwilioSmsInboundSource`** mapea el payload de Twilio a `RawInboundMessage`:

| Campo `RawInboundMessage` | Origen Twilio SMS |
| --- | --- |
| `externalMsgId` | `MessageSid` (idempotencia: ya soportada por `alreadySeen`) |
| `fromPhoneE164` | `From` (Twilio ya entrega E.164) |
| `channel` | `'sms'` |
| `chatKind` | siempre `'individual'` |
| `fromMe` | `false` |
| `kind` | `'text'` (o `'image'` si `NumMedia>0` y es MMS — opcional, ver §4.5) |
| `text` | `Body` |
| `media` | `null` (texto) / descarga de `MediaUrl0` si MMS |
| `receivedAt` | ahora |

A partir de `handleInbound`, **el flujo es idéntico al de WhatsApp**: prefilter →
idempotencia → contacto → job → debounce → `runAgentTurn` → `sender.sendText`. Cero
cambios en el núcleo.

### 4.2 Outbound: `TwilioSmsSender implements OutboundSender`

```ts
class TwilioSmsSender implements OutboundSender {
  constructor(private client: TwilioClient, private fromNumber: string) {}
  async sendText(toPhoneE164: string, text: string): Promise<void> {
    // Twilio segmenta automáticamente; ver §4.4 sobre control de longitud.
    await this.client.messages.create({ from: this.fromNumber, to: toPhoneE164, body: text });
  }
}
```

El coordinador inyecta este `sender` para los contactos de canal SMS exactamente como hoy
inyecta el sender de Baileys. El `welcome` y la respuesta del agente
(`coordinator.ts:100,249`) salen por SMS sin tocar el coordinador.

### 4.3 Aprovisionamiento de número por tenant

En el **onboarding self-service** (Fase 4), si el tenant activa SMS:

1. La `api` llama a Twilio **AvailablePhoneNumbers** + **IncomingPhoneNumbers.create**
   (comprar/asignar un número en el país del tenant).
2. Se configura el **webhook SMS** del número apuntando a `/webhooks/twilio/sms`.
3. Se guarda en **`TenantSettings`** (la tabla introducida en Fase 2):
   `smsEnabled: bool`, `smsNumber: E.164`, `twilioNumberSid`.
4. El ruteo inbound resuelve el tenant por `To` → `TenantSettings.smsNumber`.

> El **subaccount de Twilio** puede ser único de la plataforma (números bajo nuestra
> cuenta) o un subaccount por tenant. Recomendación MVP: **una cuenta de plataforma con
> números etiquetados por tenant** (más simple); subaccounts por tenant es deuda futura
> para aislamiento de facturación/cumplimiento.

### 4.4 Diferencias de canal a manejar (SMS vs WhatsApp)

| Aspecto | WhatsApp (hoy) | SMS (8A) |
| --- | --- | --- |
| Typing / recibos de lectura | sí | **no existen** — el bot no muestra "escribiendo…" |
| Longitud | larga, sin segmentar | **160 chars GSM-7 / 70 UCS-2**; se segmenta y se cobra por segmento |
| Sesión | QR + sesión Baileys (frágil) | **sin sesión, sin QR** — número Twilio, mucho más estable |
| Media | imágenes/audio nativos | MMS (opcional, no en todos los países; coste extra) |
| Costo | plan fijo (OpenRouter por mensaje) | **por segmento enviado/recibido** — vigilar margen |
| Identidad | teléfono E.164 | teléfono E.164 (misma clave de contacto) |

**Control de longitud (recomendado):** instruir al agente para SMS con respuestas más
cortas (variante de prompt o post-recorte) para limitar segmentos. El núcleo ya soporta
respuestas cortas; basta un parámetro de canal en el system prompt. No bloquea 8A pero
protege el margen.

### 4.5 MMS (opcional, fuera del alcance mínimo)

Si llega MMS (`NumMedia>0`), `TwilioSmsInboundSource` puede descargar `MediaUrl0` y
construir `media: { buffer, mimetype }`, reutilizando el `Transcriber` (audio) y el
`Describer` (imagen) que el pipeline ya usa. Se deja como extensión; el MVP de 8A es
**texto puro**.

### 4.6 UI / panel

- El detalle de conversación muestra el **canal** de cada mensaje (badge SMS/WhatsApp),
  leyendo `Message.channel`.
- La página de configuración muestra el **estado del número SMS** (número asignado,
  activo/inactivo) en lugar de un QR.
- Conversaciones SMS y WhatsApp del **mismo teléfono E.164** se ven coherentes (mismo
  `Contact`, mensajes etiquetados por canal).

---

## 5. 8B — Agente de voz conversacional en vivo (Twilio) · esfuerzo: 6–10+ semanas

La pieza más ambiciosa: el cliente **llama y conversa con la IA en tiempo real**. Es un
servicio nuevo, sensible a latencia, **stateful por llamada** y de escala distinta al
worker de chat. Vive en un contenedor aparte.

### 5.1 Arquitectura: `voice-gateway` (contenedor nuevo)

```
Llamada PSTN ─► Twilio Voice
                 │  TwiML <Connect><Stream url="wss://voice.../media"/>
                 ▼
   ┌──────────────────────────────────────────────────────────┐
   │ voice-gateway  (Node, 1 instancia ↔ N llamadas)          │
   │   por llamada (stateful):                                 │
   │     ┌─ WS Twilio Media Streams (audio μ-law 8kHz, bidi)  │
   │     │     ▲ frames de audio del usuario                   │
   │     │     ▼ frames de audio de la IA (TTS)                │
   │     ├─ VAD + STT streaming  → texto parcial/final         │
   │     ├─ turn manager (silencios, barge-in)                 │
   │     ├─ runAgentTurn(...)  ← REUTILIZA el núcleo de chat   │
   │     ├─ TTS streaming → audio → de vuelta al WS            │
   │     └─ grabación + transcripción → Postgres + media store │
   └──────────────────────────────────────────────────────────┘
```

- **Twilio Voice + Media Streams**: la llamada entrante responde con TwiML
  `<Connect><Stream>` que abre un **WebSocket** hacia el `voice-gateway`. Twilio envía
  audio del usuario (μ-law 8 kHz, base64 en frames JSON) y acepta audio de vuelta por el
  mismo WS — **audio bidireccional**.
- **Stateful por llamada**: a diferencia del worker de chat (sin estado entre mensajes
  más allá de la DB), cada llamada mantiene un bucle de audio vivo en memoria. Escala por
  **llamadas concurrentes**, no por mensajes/min.
- **Contenedor aparte** (`Dockerfile.voice`), porque la voz es intensiva en CPU/red y su
  escalado, despliegue y perfil de fallo son distintos al worker de chat. No se mezcla
  con el worker de Baileys.

### 5.2 Bucle en tiempo real y presupuesto de latencia (<~800 ms/turno)

```
usuario habla ─► VAD detecta fin de turno ─► STT(streaming) ─► texto
            ─► runAgentTurn(texto) ─► responseText
            ─► TTS(streaming) ─► audio ─► Twilio WS ─► usuario oye
```

- **Barge-in (interrupción):** si el usuario empieza a hablar mientras la IA habla, se
  **corta el TTS** inmediatamente (Twilio `clear` del buffer de audio) y se reinicia la
  escucha. Sin barge-in la conversación se siente robótica; es requisito, no opcional.
- **Presupuesto de latencia objetivo: < ~800 ms** desde que el usuario termina de hablar
  hasta que oye la primera sílaba de la IA. Esto obliga a **streaming en cada etapa**
  (STT parcial, primer token del LLM, primer chunk de TTS) — nada de esperar respuestas
  completas.
- **Manejo de silencios:** detección de turno por VAD + timeouts ("¿sigues ahí?"), y
  cierre cortés tras silencio prolongado.

### 5.3 Trade-off central: speech-to-speech realtime vs pipeline STT+LLM+TTS

Esta es la **decisión arquitectónica clave** de 8B.

| | **Pipeline separado (STT → LLM → TTS)** | **Modelo speech-to-speech realtime** |
| --- | --- | --- |
| Latencia | suma de 3 etapas; alcanzable <800ms con streaming, pero más ajustado | menor (un solo modelo de audio nativo) |
| Control | **alto**: el LLM es el `runAgentTurn` actual, con **las mismas tools y el mismo intake**; auditable (`AgentRun`) | **bajo**: la lógica de tools/intake es más difícil de inyectar en un modelo de voz cerrado |
| Reutilización | **máxima**: reusa el agente de texto tal cual | requiere readaptar la lógica de intake al paradigma de audio |
| Transcripción | nativa (el STT ya produce texto para guardar como `Message`) | hay que pedir transcript aparte |
| Costo | STT + LLM + TTS por separado | a menudo más caro por minuto, pero menos piezas |
| Madurez/proveedor | piezas intercambiables (Twilio + STT + cualquier LLM) | atado a un proveedor de voz realtime concreto |

**Recomendación:** empezar con el **pipeline separado** porque **reutiliza el núcleo de
intake/agente intacto** (`runAgentTurn`, tools, `AgentRun` para auditoría y costos) y
mantiene el control del comportamiento de negocio, que es el activo del producto. El STT
ya está abstraído como `Transcriber` (`src/media/transcriber.ts`); aquí se introduce una
variante **streaming**. Evaluar el modelo speech-to-speech realtime como mejora de
latencia una vez validada la calidad conversacional (ver Decisiones abiertas).

### 5.4 Reutilización de la lógica de intake/agente, adaptada a voz

El `voice-gateway` **no reimplementa** el agente: llama a `runAgentTurn(ctx, deps)` con
el texto transcrito como `batchMessages`, exactamente como el coordinador de chat. Lo que
cambia es la **forma de las respuestas**, vía una **variante de canal del system prompt**:

- **Respuestas cortas y habladas** (una idea por turno; no listas largas ni texto que
  "se lee" mal en voz).
- **Confirmaciones explícitas habladas** ("Entonces, un sillón de 3 plazas, ¿correcto?")
  porque en voz no hay scroll para revisar.
- **Una pregunta a la vez** (el intake ya es incremental campo a campo).
- **Manejo de números/direcciones deletreadas** (más errores de STT que en texto).

El `IntakeState` y la resolución de job/contacto son **los mismos**; solo se persisten con
`channel='voice'`. El `Contact` se resuelve por el teléfono E.164 de la llamada (mismo
contacto que su WhatsApp/SMS).

### 5.5 Grabación, consentimiento y persistencia

- **Aviso de grabación al inicio** (requisito legal en muchas jurisdicciones): el primer
  mensaje hablado de la llamada incluye el aviso ("Esta llamada puede ser grabada…").
  Configurable por tenant/país.
- **Grabación de audio** guardada en el **media store** existente (el mismo que ya usan
  imágenes/audio de WhatsApp), referenciada por path.
- **Transcripción guardada como `Message` con `channel='voice'`**, vinculada al `Job` y
  `Contact` del tenant, igual que cualquier otro mensaje. El historial del job mezcla
  turnos de voz, SMS y WhatsApp de forma coherente.
- **`AgentRun`** se registra por turno como hoy (`recordAgentRun`), dando auditoría y
  costo por llamada.

### 5.6 Fallbacks (nunca colgar)

La regla dura: **nunca dejar la llamada colgada ni en silencio**.

- **STT/LLM/TTS falla o el cliente no se entiende** → degradar a **buzón con
  transcripción** (el cliente deja un mensaje, se transcribe y se guarda como intake para
  revisión humana) o **transferir a un humano** (Twilio `<Dial>` a un número del negocio),
  según configuración del tenant.
- **Caída de OpenRouter / saldo agotado** (mismo riesgo que el chat, ya contemplado en
  Fase 1) → mensaje hablado claro + buzón, sin perder la llamada.
- **Latencia degradada** → mensaje de "dame un momento" en lugar de silencio muerto.

### 5.7 Despliegue y escala

- Nuevo servicio `voice-gateway` en Compose con `Dockerfile.voice`, **un endpoint WSS**
  expuesto vía nginx/TLS para Media Streams; sin acceso a postgres desde fuera del host.
- Escala por **llamadas concurrentes** (cada llamada = un bucle de audio en memoria).
  Métricas nuevas: llamadas activas, latencia p50/p95 por turno, tasa de fallback.

### 5.8 Riesgos / decisiones de la voz en vivo

- **Latencia y calidad son el make-or-break.** Una conversación con cortes o robótica
  hunde el producto. Es la primera métrica a validar en un prototipo antes de invertir las
  10 semanas completas.
- **Costo por minuto** = Twilio Voice + STT + LLM + TTS. Puede **no caber en el plan
  fijo** → ver Decisiones abiertas (add-on de precio probable). Hay que validar el margen
  por minuto antes del go-live, como se hizo con OpenRouter por tenant en Fase 7.
- **Cumplimiento de grabación varía por jurisdicción** (consentimiento de una o dos
  partes). Limitar el lanzamiento a un país inicial con reglas claras y aviso integrado.

---

## 6. Modelo de datos (incremental)

Sobre lo que la Fase 2 ya dejó (`channel` en `Message`/`Contact`):

- **`TenantSettings`** (tabla de Fase 2) gana columnas de canal:
  `smsEnabled`, `smsNumber`, `twilioNumberSid`, `voiceEnabled`, `voiceNumber`,
  `recordingNotice` (texto del aviso), `recordingJurisdiction`.
- **`Message`**: ya tiene `channel`; para voz se reusa `mediaPath` para el audio de la
  grabación y `body` para la transcripción del turno.
- Sin tablas nuevas obligatorias para 8A. Para 8B, opcionalmente una tabla `Call`
  (`callSid`, `tenantId`, `jobId`, `startedAt`, `endedAt`, `outcome`,
  `recordingPath`) para métricas/operación — recomendada pero no bloqueante.

---

## 7. Secretos y configuración

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (solo por env, nunca en logs — regla de
  Fase 1). Validación de **firma `X-Twilio-Signature`** obligatoria en todos los webhooks.
- 8B añade credenciales del proveedor de STT/TTS (o del modelo speech-to-speech) por env.
- El reuso de `OPENROUTER_API_KEY` para el LLM se mantiene; el STT puede seguir en
  OpenRouter (`WhisperTranscriber`) o moverse a un STT streaming dedicado.

---

## 8. Criterios de aceptación

### 8A — SMS

- [ ] Un SMS entrante crea o continúa un intake y el bot responde por SMS (mismo pipeline).
- [ ] La firma `X-Twilio-Signature` se valida y un webhook no firmado es rechazado.
- [ ] El número SMS se asigna en el onboarding sin intervención manual y se guarda en
      `TenantSettings`.
- [ ] El inbound rutea al tenant correcto por el número destino (`To`).
- [ ] `MessageSid` da idempotencia (un SMS reentregado por Twilio no se procesa dos veces).
- [ ] Conversaciones SMS y WhatsApp del **mismo teléfono E.164** se ven coherentes en el
      panel, con el canal etiquetado por mensaje.
- [ ] El panel muestra el estado del número SMS (sin QR) y el canal de cada conversación.
- [ ] `TwilioSmsSender` implementa `OutboundSender` y se inyecta sin tocar el coordinador.

### 8B — Voz conversacional en vivo

- [ ] Un cliente llama, conversa con la IA en tiempo real y completa un intake por voz.
- [ ] **Barge-in** funciona: el cliente puede interrumpir a la IA y esta se calla.
- [ ] Latencia por turno dentro del presupuesto objetivo (<~800 ms p50) en pruebas.
- [ ] La llamada queda **transcrita** y vinculada al `Job` y `Contact` correctos del
      tenant, con `channel='voice'`.
- [ ] **Aviso de grabación** reproducido al inicio; audio guardado en el media store.
- [ ] **Fallback** a buzón→transcripción o humano si la IA falla; la llamada **nunca** se
      cuelga ni queda en silencio.
- [ ] El `voice-gateway` corre como contenedor aparte, sin exponer postgres/worker.
- [ ] Margen por minuto validado contra el precio del plan (o add-on definido).

---

## 9. Decisiones abiertas

1. **¿Voz incluida en el plan base o add-on de precio?** El costo por minuto
   (Twilio + STT + LLM + TTS) probablemente **no cabe en el plan fijo**. Recomendación:
   **add-on** (precio por minuto o paquete de minutos), para no erosionar el margen del
   plan base. SMS sí puede ir en el plan base con un tope de segmentos.
2. **País inicial para grabación de voz.** Define el régimen de consentimiento (una vs dos
   partes) y el texto del aviso. Limitar el lanzamiento de 8B a una jurisdicción clara
   antes de generalizar.
3. **Modelo de voz realtime a evaluar.** Arrancar con **pipeline STT+LLM+TTS separado**
   (máxima reutilización del agente actual). Evaluar después un **modelo speech-to-speech
   realtime** como mejora de latencia: decidir cuál (proveedor, costo/min, capacidad de
   inyectar tools/intake) tras validar la calidad conversacional del prototipo.
4. **(Secundaria) Subaccounts de Twilio por tenant** vs una cuenta de plataforma con
   números etiquetados. Recomendación MVP: cuenta de plataforma; subaccounts como deuda
   futura para aislamiento de facturación/cumplimiento.

---

## 10. Resumen de esfuerzo y secuencia

```
8A (SMS)  ~2 semanas   ── barato, reutiliza el pipeline; primero
8B (Voz)  6–10+ semanas ── servicio nuevo, latencia = make-or-break; después
```

Ambos sub-tracks dependen de la **capa de canal de la Fase 2** y del **onboarding de la
Fase 4** (para aprovisionar números self-service). 8A se hace primero por su bajo riesgo
y reutilización casi total; 8B es la inversión grande y el diferenciador, y se aborda con
un prototipo de latencia/calidad **antes** de comprometer las semanas completas.
