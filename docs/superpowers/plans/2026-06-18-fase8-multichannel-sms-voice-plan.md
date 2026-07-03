# Plan Fase 8 — Multicanal v2: SMS + Voz conversacional en vivo (Twilio) — Implementación

> **Para workers agénticos:** SUB-SKILL REQUERIDA: usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan sintaxis de checkbox (`- [ ]`) para seguimiento.

**Objetivo:** Ampliar los canales del producto más allá de WhatsApp **sin reescribir el núcleo**: añadir **SMS** (8A, barato, reutiliza casi todo el pipeline) y un **agente de voz conversacional en vivo** (8B, servicio nuevo sensible a latencia). Proveedor único: **Twilio** (SMS + Voz + Media Streams + números). Esta fase es **post-lanzamiento**: el producto ya vende y opera WhatsApp-only; SMS y voz son una línea v2.

**Arquitectura:** El núcleo del worker **ya es agnóstico al canal** (verificado en código): `OutboundSender` es una interfaz de un método (`sendText(toPhoneE164, text)` — `src/services/outbound.ts:6`); el coordinador llama `this.deps.sender.sendText(...)` sin saber el canal (`src/pipeline/coordinator.ts:100,249`); el agente es texto-in/texto-out (`runAgentTurn(ctx, deps)` — `src/agent/runner.ts:6`); el pipeline opera sobre `RawInboundMessage`, no sobre tipos de Baileys (`InboundCoordinator.handleInbound` — `src/pipeline/coordinator.ts:28`); el STT está abstraído como `Transcriber` (`src/media/transcriber.ts`). **Lo único acoplado a un canal es el borde de entrada/salida.** El trabajo de la Fase 8 es escribir **nuevos adaptadores de borde** (8A en la `api`, 8B en un contenedor `voice-gateway` nuevo), no tocar el núcleo.

**Tech Stack:** Node 20+, TypeScript, Prisma + PostgreSQL, Fastify 5 (`api/`), SDK de Twilio (SMS + Voz + Media Streams), WebSocket (`ws`) para Media Streams, STT/TTS streaming (proveedor pendiente — §9.3 del spec), OpenRouter para el LLM (reuso de `runAgentTurn`), vitest 4. Contenedor nuevo `voice-gateway` con `Dockerfile.voice`.

**⚠️ DEPENDENCIA CRÍTICA — Capa de canal de la Fase 2 (§2.x del roadmap):** esta fase **asume** que la Fase 2 ya hizo el refactor barato que es habilitador:
- `RawInboundMessage.whatsappMsgId` renombrado a **`externalMsgId`** + campo **`channel: 'whatsapp' | 'sms' | 'voice'`** (`src/pipeline/types.ts`).
- Columna **`channel`** en `Message` y `Contact` (Prisma, default `'whatsapp'`); identidad del contacto sigue siendo el teléfono E.164.
- Interfaz **`InboundSource`** definida; WhatsApp/Baileys pasa a ser **una** implementación.

> **Nota de reconciliación (código real vs Fase 2):** en el código actual el coordinador (`src/pipeline/coordinator.ts:31,49,61`) y la idempotencia todavía usan `whatsappMsgId`, **no** `externalMsgId`/`channel`. Si al ejecutar este plan la Fase 2 **no** completó ese renombrado, hacerlo es **prerequisito de la Tarea 1 (8A)** — es el único cambio que toca el núcleo. La Tarea 0 lo verifica y, si falta, lo hace primero.

**POST-LANZAMIENTO:** no bloquea el launch (ruta crítica = WhatsApp-only). 8A va primero por bajo riesgo y reutilización casi total; 8B es la inversión grande (6–10+ semanas) y se aborda con un prototipo de latencia/calidad **antes** de comprometer las semanas completas. Ambos sub-tracks dependen además del **onboarding self-service de la Fase 4** (para aprovisionar números). Secretos Twilio solo por env, nunca en logs (regla de Fase 1); validación de `X-Twilio-Signature` obligatoria en todos los webhooks.

---

## Tarea 0: Verificar la capa de canal de la Fase 2 (prerequisito)

**Objetivo:** Confirmar que el renombrado `externalMsgId`/`channel` y la interfaz `InboundSource` existen; si no, completarlos (es el único cambio que toca el núcleo).

**Archivos:**
- Verificar/Modificar: `src/pipeline/types.ts`, `src/pipeline/coordinator.ts`, `src/pipeline/idempotency.ts`
- Verificar: `prisma/schema.prisma` (columna `channel` en `Message`/`Contact`)

- [ ] **Step 1:** Inspeccionar `src/pipeline/types.ts` y `coordinator.ts`. Si siguen usando `whatsappMsgId` (como en el código actual), renombrar a `externalMsgId`, añadir `channel` a `RawInboundMessage`, y migrar la columna `channel` (default `'whatsapp'`) en `Message`/`Contact`. Definir/confirmar la interfaz `InboundSource`; WhatsApp como una implementación.
*Verificación:* `npm test && npm run typecheck` verde; los tests del coordinador siguen pasando con `channel='whatsapp'` por defecto.

---

## 8A — SMS (Twilio) · esfuerzo ~2 semanas

### Tarea 1: `TwilioSmsInboundSource` + webhook de SMS entrante

**Objetivo:** Que un SMS entrante de Twilio entre al mismo `InboundCoordinator.handleInbound` que WhatsApp, con cero cambios en el núcleo. Cubre §4.1 del spec.

**Archivos:**
- Crear: `api/src/routes/webhooks-twilio-sms.ts` (`POST /webhooks/twilio/sms`)
- Crear: `api/src/channels/sms/TwilioSmsInboundSource.ts` (mapea payload Twilio → `RawInboundMessage`)
- Crear: `api/src/channels/twilioSignature.ts` (validación `X-Twilio-Signature`)
- Modificar: `api/src/app.ts` (registrar la ruta)
- Crear tests: `api/tests/channels/twilioSmsInbound.test.ts`, `api/tests/routes/webhooks-twilio-sms.test.ts`

- [ ] **Step 1: Test rojo del webhook**

Asertar: payload de Twilio (`From`, `To`, `Body`, `MessageSid`, `NumMedia`) con firma válida → `200` (TwiML vacío) y `coordinator.handleInbound` llamado con un `RawInboundMessage { channel:'sms', externalMsgId: MessageSid, fromPhoneE164: From, kind:'text', text: Body }`. Firma **inválida o ausente** → rechazado (`403`). Tenant resuelto por el número destino `To` (`TenantSettings.smsNumber`).
*Verificación:* `npx vitest run api/tests/routes/webhooks-twilio-sms.test.ts` → FALLA.

- [ ] **Step 2: Validación de firma**

`twilioSignature.ts`: HMAC con el Auth Token sobre la URL + params. Rechazar webhooks no firmados.
*Cambios:* `TWILIO_AUTH_TOKEN` por env.

- [ ] **Step 3: `TwilioSmsInboundSource`**

Mapear el payload de Twilio a `RawInboundMessage` según la tabla del spec §4.1: `externalMsgId ← MessageSid` (idempotencia ya soportada por `alreadySeen`), `fromPhoneE164 ← From` (Twilio ya entrega E.164), `channel:'sms'`, `chatKind:'individual'`, `fromMe:false`, `kind:'text'`, `text ← Body`, `media:null`, `receivedAt: ahora`. MMS queda fuera del MVP (§4.5).

- [ ] **Step 4: Ruta + ruteo por tenant**

`POST /webhooks/twilio/sms`: validar firma → resolver tenant por `To` → construir `RawInboundMessage` → `coordinator.handleInbound(raw)` → responder `200` con TwiML vacío (la respuesta del bot sale por API saliente, no inline). A partir de `handleInbound` el flujo es **idéntico** al de WhatsApp.
*Verificación:* tests de Step 1 pasan; `MessageSid` da idempotencia (un SMS reentregado no se procesa dos veces).
*Commit:* `feat(sms): TwilioSmsInboundSource + webhook de SMS entrante con firma`.

### Tarea 2: `TwilioSmsSender implements OutboundSender`

**Objetivo:** Enviar las respuestas del bot por SMS inyectando un sender, sin tocar el coordinador. Cubre §4.2 del spec.

**Archivos:**
- Crear: `api/src/channels/sms/TwilioSmsSender.ts`
- Crear tests: `api/tests/channels/twilioSmsSender.test.ts`

- [ ] **Step 1: Implementar `OutboundSender`**

`sendText(toPhoneE164, text)` → `client.messages.create({ from: fromNumber, to, body: text })`. Twilio segmenta automáticamente (ver Tarea 4 sobre longitud). El coordinador inyecta este `sender` para contactos de canal SMS igual que hoy inyecta el de Baileys; `welcome` y respuesta del agente salen por SMS sin tocar `coordinator.ts:100,249`.
*Verificación:* test con un cliente Twilio fake confirma que `sendText` llama `messages.create` con `from/to/body` correctos; `TwilioSmsSender` satisface el tipo `OutboundSender`.
*Commit:* `feat(sms): TwilioSmsSender (OutboundSender) inyectable sin tocar el coordinador`.

### Tarea 3: Aprovisionamiento de número por tenant (`TenantSettings`)

**Objetivo:** Comprar/asignar un número Twilio al tenant en el onboarding y guardarlo, sin intervención manual. Cubre §4.3 del spec. **Depende de Fase 4 (onboarding).**

**Archivos:**
- Modificar: `prisma/schema.prisma` (`TenantSettings`: `smsEnabled`, `smsNumber`, `twilioNumberSid`)
- Crear: `api/src/channels/sms/provisioning.ts`
- Modificar: el flujo de onboarding (Fase 4) para invocar el provisioning si el tenant activa SMS
- Crear tests: `api/tests/channels/smsProvisioning.test.ts`

- [ ] **Step 1: Columnas de canal SMS en `TenantSettings`** (`smsEnabled bool`, `smsNumber String?`, `twilioNumberSid String?`). Migración Prisma.

- [ ] **Step 2: Provisioning** — `api` llama Twilio **AvailablePhoneNumbers** + **IncomingPhoneNumbers.create** (comprar/asignar número en el país del tenant); configurar el webhook SMS del número apuntando a `/webhooks/twilio/sms`; guardar `smsEnabled/smsNumber/twilioNumberSid` en `TenantSettings`. El ruteo inbound resuelve el tenant por `To → TenantSettings.smsNumber`.
*Verificación:* test con cliente Twilio fake (siembra número → guarda settings → el webhook resuelve el tenant correcto por `To`).
*Commit:* `feat(sms): aprovisionamiento de número Twilio por tenant en onboarding`.

> **Nota:** subaccount Twilio por tenant es deuda futura (§9.4); MVP = cuenta de plataforma con números etiquetados por tenant.

### Tarea 4: Segmentación / control de longitud + UI de canal

**Objetivo:** Proteger el margen (SMS se cobra por segmento) y mostrar el canal en el panel. Cubre §4.4 y §4.6 del spec.

**Archivos:**
- Modificar: el system prompt / construcción de prompt para una **variante de canal** (`src/agent/prompt.ts` o equivalente)
- Modificar: la SPA (detalle de conversación + página de configuración)

- [ ] **Step 1: Control de longitud (margen)** — instruir al agente con respuestas más cortas para SMS (variante de prompt por canal o post-recorte), para limitar segmentos (160 chars GSM-7 / 70 UCS-2). El núcleo ya soporta respuestas cortas; basta un parámetro de canal en el system prompt. No bloquea 8A pero protege el margen.
*Verificación:* test de que el prompt de canal `'sms'` produce instrucción de brevedad; el de `'whatsapp'` no cambia.

- [ ] **Step 2: UI de canal** — detalle de conversación muestra un **badge SMS/WhatsApp** por mensaje (lee `Message.channel`); la página de configuración muestra el **estado del número SMS** (asignado, activo/inactivo) en lugar de un QR; conversaciones SMS y WhatsApp del **mismo teléfono E.164** se ven coherentes (mismo `Contact`, mensajes etiquetados por canal).
*Verificación:* tests de SPA; `npm test && npm run typecheck` (raíz + `api/` + `spa/`) verde.
*Commit:* `feat(sms): control de longitud por canal + UI de canal en el panel`.

---

## 8B — Voz conversacional en vivo (Twilio) · esfuerzo 6–10+ semanas

> **Antes de comprometer las semanas completas:** construir un **prototipo de latencia/calidad** (Step de prototipo en Tarea 6) y validarlo. Latencia y calidad son el make-or-break (§5.8). **Decisión arquitectónica clave (§5.3):** arrancar con **pipeline separado STT→LLM→TTS** (máxima reutilización de `runAgentTurn`, tools e intake; auditable vía `AgentRun`), no con un modelo speech-to-speech cerrado.

### Tarea 5: Servicio `voice-gateway` (contenedor nuevo) + Media Streams WS

**Objetivo:** Levantar el contenedor stateful por llamada y abrir el WebSocket de Twilio Media Streams (audio bidireccional). Cubre §5.1 y §5.7 del spec.

**Archivos:**
- Crear: `voice-gateway/` (servicio Node nuevo), `Dockerfile.voice`
- Crear: `voice-gateway/src/server.ts` (WSS para Media Streams), `voice-gateway/src/twiml.ts` (`<Connect><Stream>`)
- Modificar: `docker-compose.yml` (servicio `voice-gateway`, un endpoint WSS vía nginx/TLS), `api/src/routes/webhooks-twilio-voice.ts` (responde TwiML al llamar)
- Crear tests: `voice-gateway/tests/mediaStream.test.ts`

- [ ] **Step 1: TwiML de conexión** — la llamada entrante (webhook de voz en la `api`, firma validada) responde TwiML `<Connect><Stream url="wss://voice.../media"/>` que abre el WS hacia el `voice-gateway`.
- [ ] **Step 2: WS Media Streams** — `voice-gateway` recibe frames de audio del usuario (μ-law 8 kHz, base64 en JSON) y acepta audio de vuelta por el mismo WS. Estado **por llamada** en memoria; escala por **llamadas concurrentes**.
- [ ] **Step 3: Contenedor + red** — `Dockerfile.voice`; en Compose expone **un** endpoint WSS vía nginx/TLS; **sin** acceso a postgres/worker desde fuera del host (regla de red del spec maestro).
*Verificación:* test que simula frames de Media Streams sobre el WS (eco/echo de audio) y confirma el handshake; el contenedor levanta en Compose sin exponer postgres.
*Commit:* `feat(voice): voice-gateway con Twilio Media Streams (WebSocket)`.

### Tarea 6: Bucle STT→LLM→TTS streaming con barge-in + reutilización de `runAgentTurn`

**Objetivo:** El bucle conversacional en tiempo real con presupuesto de latencia <~800 ms/turno, interrupciones, y reutilizando el agente de texto intacto. Cubre §5.2, §5.3, §5.4 del spec.

**Archivos:**
- Crear: `voice-gateway/src/loop/turnManager.ts` (VAD, silencios, barge-in)
- Crear: `voice-gateway/src/stt/streamingTranscriber.ts` (variante streaming de `Transcriber`)
- Crear: `voice-gateway/src/tts/streamingTts.ts`
- Reutilizar: `src/agent/runner.ts` (`runAgentTurn`), tools, `recordAgentRun`
- Crear tests: `voice-gateway/tests/turnManager.test.ts`, `voice-gateway/tests/bargeIn.test.ts`

- [ ] **Step 0 (gate): prototipo de latencia/calidad** — antes de invertir el resto, medir latencia p50 por turno y calidad conversacional en un prototipo mínimo. Si no se acerca a <~800 ms, replantear (§5.8) antes de seguir.
- [ ] **Step 1: STT streaming** — introducir una variante **streaming** del contrato `Transcriber` (el STT ya está abstraído en `src/media/transcriber.ts`); produce texto parcial/final. VAD para detectar fin de turno.
- [ ] **Step 2: Reutilizar el agente** — el `turnManager` llama `runAgentTurn(ctx, deps)` con el texto transcrito como `batchMessages`, **igual que el coordinador de chat** (`src/pipeline/coordinator.ts:221`). `IntakeState` y la resolución de job/contacto son **los mismos**; el `Contact` se resuelve por el teléfono E.164 de la llamada (mismo contacto que su WhatsApp/SMS). Una **variante de canal del system prompt** (§5.4) impone respuestas cortas y habladas, confirmaciones explícitas, una pregunta a la vez, manejo de números/direcciones deletreadas.
- [ ] **Step 3: TTS streaming** — primer chunk de TTS cuanto antes; streaming en cada etapa (STT parcial → primer token LLM → primer chunk TTS) para cumplir el presupuesto de latencia.
- [ ] **Step 4: Barge-in** — si el usuario habla mientras la IA habla, **cortar el TTS** (Twilio `clear` del buffer) y reiniciar la escucha. Requisito, no opcional. Manejo de silencios con timeouts ("¿sigues ahí?") y cierre cortés tras silencio prolongado.
*Verificación:* `turnManager.test.ts` (turno completo simulado texto-a-texto reutilizando `runAgentTurn`); `bargeIn.test.ts` (audio entrante durante TTS dispara `clear` y reinicio de escucha).
*Commit:* `feat(voice): bucle STT→LLM→TTS streaming con barge-in reutilizando runAgentTurn`.

### Tarea 7: Grabación + consentimiento, transcripción como `Message channel='voice'`, fallbacks

**Objetivo:** Aviso de grabación, persistencia de audio y transcripción coherente con el resto del historial, y nunca dejar la llamada colgada. Cubre §5.5 y §5.6 del spec.

**Archivos:**
- Crear: `voice-gateway/src/recording.ts`, `voice-gateway/src/fallbacks.ts`
- Reutilizar: media store existente, `recordAgentRun`
- Modificar: `prisma/schema.prisma` (`TenantSettings`: `voiceEnabled`, `voiceNumber`, `recordingNotice`, `recordingJurisdiction`; opcional tabla `Call`)
- Crear tests: `voice-gateway/tests/fallbacks.test.ts`, `voice-gateway/tests/recordingNotice.test.ts`

- [ ] **Step 1: Aviso de grabación** — el primer mensaje hablado de la llamada incluye el aviso ("Esta llamada puede ser grabada…"), configurable por tenant/país (`recordingNotice`, `recordingJurisdiction`). Requisito legal en muchas jurisdicciones.
- [ ] **Step 2: Persistencia** — grabación de audio en el **media store existente** (el mismo de imágenes/audio de WhatsApp), referenciada por path; **transcripción guardada como `Message` con `channel='voice'`**, vinculada al `Job` y `Contact` del tenant; el historial del job mezcla turnos de voz/SMS/WhatsApp coherentemente. `AgentRun` por turno (`recordAgentRun`) para auditoría y costo por llamada. (Para 8B, columnas de canal de voz en `TenantSettings`; tabla `Call` opcional para métricas — recomendada, no bloqueante, §6.)
- [ ] **Step 3: Fallbacks (nunca colgar)** — STT/LLM/TTS falla o no se entiende → **buzón con transcripción** o **transferir a humano** (Twilio `<Dial>`), según config del tenant; caída de OpenRouter/saldo (mismo riesgo del chat, Fase 1) → mensaje hablado + buzón; latencia degradada → "dame un momento" en vez de silencio muerto. La regla dura: nunca silencio ni cuelgue.
*Verificación:* `recordingNotice.test.ts` (el primer turno emite el aviso configurado); `fallbacks.test.ts` (fallo de STT/LLM degrada a buzón→transcripción sin cortar la llamada); la transcripción se persiste como `Message channel='voice'` ligada al job correcto.
*Commit:* `feat(voice): grabación+consentimiento, transcripción channel='voice' y fallbacks`.

> **Despliegue/escala:** métricas nuevas — llamadas activas, latencia p50/p95 por turno, tasa de fallback (§5.7).

---

## Resumen de criterios de aceptación (spec §8)

### 8A — SMS
- [ ] SMS entrante crea/continúa intake y el bot responde por SMS (mismo pipeline) (Tareas 1, 2).
- [ ] `X-Twilio-Signature` validada; webhook no firmado rechazado (Tarea 1).
- [ ] Número SMS asignado en onboarding sin intervención manual, guardado en `TenantSettings` (Tarea 3).
- [ ] Inbound rutea al tenant correcto por `To` (Tarea 1).
- [ ] `MessageSid` da idempotencia (Tarea 1).
- [ ] SMS y WhatsApp del mismo E.164 coherentes en el panel, canal etiquetado (Tarea 4).
- [ ] Panel muestra estado del número SMS (sin QR) y canal por conversación (Tarea 4).
- [ ] `TwilioSmsSender` implementa `OutboundSender` e inyectado sin tocar el coordinador (Tarea 2).

### 8B — Voz
- [ ] Cliente llama, conversa en tiempo real y completa intake por voz (Tareas 5, 6).
- [ ] Barge-in funciona (la IA se calla al interrumpir) (Tarea 6).
- [ ] Latencia por turno <~800 ms p50 en pruebas (Tarea 6, gate de prototipo).
- [ ] Llamada transcrita y vinculada al `Job`/`Contact` correctos, `channel='voice'` (Tarea 7).
- [ ] Aviso de grabación reproducido; audio en el media store (Tarea 7).
- [ ] Fallback a buzón→transcripción o humano; la llamada nunca se cuelga (Tarea 7).
- [ ] `voice-gateway` como contenedor aparte, sin exponer postgres/worker (Tarea 5).
- [ ] Margen por minuto validado contra el plan (o add-on definido) — decisión de negocio (§9.1).

## Dependencias y decisiones abiertas (spec §9)

- **Dependencia de la capa de canal (Fase 2):** prerequisito duro (Tarea 0). Si falta el renombrado `externalMsgId`/`channel`, hacerlo primero.
- **Dependencia de Fase 4 (onboarding):** aprovisionamiento de números self-service (Tarea 3).
- **Post-lanzamiento:** no bloquea el launch; 8A primero (bajo riesgo), 8B con prototipo de latencia antes de comprometer 6–10+ semanas.
1. ¿Voz en plan base o **add-on de precio**? (costo/min probablemente no cabe en el plan fijo; SMS sí, con tope de segmentos).
2. **País inicial para grabación de voz** (régimen de consentimiento una/dos partes + texto del aviso).
3. **Modelo de voz realtime a evaluar** — arrancar con pipeline STT+LLM+TTS separado; evaluar speech-to-speech como mejora de latencia tras validar calidad.
4. Subaccounts de Twilio por tenant vs cuenta de plataforma (MVP: plataforma).
