# Roadmap a producción — Intake SaaS

**Fecha:** 2026-06-18
**Estado:** Propuesta para aprobación
**Objetivo:** Llevar Intake de "MVP desplegable" a **producto vendible** (SaaS
multi-tenant, self-service, con cobro recurrente) sin romper lo que ya funciona.

## Decisiones de negocio que guían este roadmap

| Decisión | Elección | Consecuencia en el plan |
| --- | --- | --- |
| **Monetización** | Suscripción mensual fija (Stripe) | Stripe Checkout + webhooks de estado de suscripción. Sin medición de uso para cobrar (el `CostEntry` queda como control interno, no como base de factura). |
| **Onboarding** | **Self-service completo** | Signup público → pago → aprovisionamiento automático del bot. Esto **obliga** a resolver el aprovisionamiento dinámico de workers (hoy manual en `docker-compose.yml`). Es el mayor esfuerzo de ingeniería del roadmap. |
| **Prioridad #1** | **Seguridad y confiabilidad** | El hardening (Fase 1) va **antes** que billing y signup. Vendemos con confianza primero. |
| **Canales** | WhatsApp en el lanzamiento; **SMS + voz en vivo como v2** | Se hace un refactor ligero de "capa de canal" antes del lanzamiento (Fase 2) para no cerrar la puerta, pero los canales SMS y **voz conversacional en vivo** (Twilio) se construyen post-lanzamiento (Fase 8). El núcleo del pipeline ya es agnóstico al canal. |

---

## 0. Línea base — qué ya está hecho

Esto **no** hay que rehacerlo; es el punto de partida real (verificado en el código):

- ✅ Schema PostgreSQL multi-tenant con `tenantId` en todas las tablas (`prisma/schema.prisma`).
- ✅ Worker dockerizado que lee `TENANT_ID` por env y escribe a Postgres aislado por tenant.
- ✅ Endpoint interno protegido con `INTERNAL_API_TOKEN` (`src/internal/server.ts`).
- ✅ API central Fastify + JWT con rutas `jobs`, `contacts`, `usage`, `settings`,
  `profile`, `wa-status` y batería de tests (`api/tests/`).
- ✅ SPA React + Vite con login, dashboard, detalle de job, contactos, uso,
  configuración y página de WhatsApp, con tests (`spa/src/`).
- ✅ Configuración del negocio editable desde el panel (`api/src/routes/settings.ts`).
- ✅ Docker Compose (postgres + api + 1 worker) y runbooks de despliegue
  (`docs/runbooks/`).

### Brechas conocidas que bloquean la venta (verificadas en código)

1. **Auth en `localStorage`** — el token viaja en el body de `/auth/login`
   (`api/src/routes/auth.ts:20`) y la SPA lo guarda en `localStorage`. Riesgo XSS.
2. **Login sin tenant** — `prisma.panelUser.findFirst({ where: { username } })`
   (`api/src/routes/auth.ts:15`): el `username` es global. Con self-service esto
   produce colisiones de usuario y es inseguro.
3. **La API cablea UN solo worker** — `WORKER_INTERNAL_URL: http://worker-tapiceria:3002`
   (`docker-compose.yml:44`, `api/src/routes/wa-status.ts:8`). No hay ruteo por
   tenant: con N tenants, `wa-status` apunta siempre al mismo worker.
4. **Un worker por tenant editado a mano** — agregar un tenant hoy = editar
   `docker-compose.yml` + `.env` + reiniciar. Incompatible con self-service.
5. **Sin billing** — no hay tablas `Subscription`/`Plan` ni integración de pagos.
6. **Sin signup** — el alta de tenant/usuario es manual (`api:create-user`).
7. **Sin CI/CD** — no hay workflows en `.github/` (build/test/deploy son manuales).
8. **Sin observabilidad** — no hay métricas, alertas, ni rastreo de errores.
9. **Sin capa legal** — falta ToS, política de privacidad y manejo de datos
   (obligatorio para cobrar y para datos de WhatsApp de terceros).

---

## 1. Estrategia de fases

Siete fases. Cada una deja el producto en un estado **más vendible** que la
anterior y es desplegable de forma independiente. El orden respeta la prioridad
elegida (seguridad primero) y las dependencias técnicas (multi-tenancy real
antes de self-service).

```
Fase 1  Hardening de seguridad y confiabilidad   ◄── PRIORIDAD #1
Fase 2  Multi-tenancy real (ruteo + provisioning) ◄── habilitador del self-service
Fase 3  Billing (Stripe, suscripción fija)
Fase 4  Onboarding self-service
Fase 5  Observabilidad y operaciones
Fase 6  Legal, cumplimiento y go-to-market
Fase 7  Beta cerrada → Lanzamiento
```

> Estimaciones en "semanas-persona" (1 dev full-time). Ajustar a tu capacidad
> real. Las fases 1, 5 y 6 pueden solaparse parcialmente con 2–4.

### Documentos de diseño por fase (base teórica)

Cada fase tiene su **spec de diseño** aterrizado al código (decisiones,
arquitectura, modelo de datos, criterios de aceptación). Este roadmap es el
documento maestro; los specs son el detalle previo a implementar. Convención:
`spec (diseño)` → `plan (implementación)` → código.

| Fase | Spec de diseño | Plan de implementación |
| --- | --- | --- |
| 1 — Seguridad y confiabilidad | [spec](superpowers/specs/2026-06-18-fase1-security-hardening-design.md) | [plan](superpowers/plans/2026-06-18-fase1-security-hardening-plan.md) |
| 2 — Multi-tenancy + capa de canal | [spec](superpowers/specs/2026-06-18-fase2-multitenancy-channel-layer-design.md) | [plan](superpowers/plans/2026-06-18-fase2-multitenancy-channel-layer-plan.md) |
| 3 — Billing (Stripe) | [spec](superpowers/specs/2026-06-18-fase3-billing-stripe-design.md) | [plan](superpowers/plans/2026-06-18-fase3-billing-stripe-plan.md) |
| 4 — Onboarding self-service | [spec](superpowers/specs/2026-06-18-fase4-self-service-onboarding-design.md) | [plan](superpowers/plans/2026-06-18-fase4-self-service-onboarding-plan.md) |
| 5 — Observabilidad y operaciones | [spec](superpowers/specs/2026-06-18-fase5-observability-ops-design.md) | [plan](superpowers/plans/2026-06-18-fase5-observability-ops-plan.md) |
| 6 — Legal, cumplimiento y GTM | [spec](superpowers/specs/2026-06-18-fase6-legal-gtm-design.md) | [plan](superpowers/plans/2026-06-18-fase6-legal-gtm-plan.md) |
| 7 — Beta → Lanzamiento | (operacional) | [runbook go-live](runbooks/2026-06-18-go-live-runbook.md) |
| 8 — Multicanal v2 (SMS + voz) | [spec](superpowers/specs/2026-06-18-fase8-multichannel-sms-voice-design.md) | [plan](superpowers/plans/2026-06-18-fase8-multichannel-sms-voice-plan.md) |

### Documentos operativos, legales y de GTM (base no-código lista)

| Área | Documentos |
| --- | --- |
| **Legal** (borradores, requieren revisión profesional) | [ToS](legal/terms-of-service.md) · [Privacidad](legal/privacy-policy.md) · [DPA](legal/dpa.md) · [Aviso WhatsApp/Baileys](legal/whatsapp-baileys-disclaimer.md) |
| **Runbooks** | [Backup/restore drill](runbooks/2026-06-18-backup-restore-drill.md) · [Respuesta a incidentes](runbooks/2026-06-18-incident-response.md) · [Go-live](runbooks/2026-06-18-go-live-runbook.md) |
| **GTM / cliente** | [Landing copy](gtm/landing-copy.md) · [Precios](gtm/pricing.md) · [Guía de inicio](gtm/getting-started.md) · [FAQ](gtm/faq.md) |
| **Decisiones** | [Registro de decisiones abiertas](DECISIONES-PENDIENTES.md) |

---

## Fase 1 — Hardening de seguridad y confiabilidad  *(prioridad #1)*

**Objetivo:** que un cliente pueda confiar sus datos y los de sus clientes
finales al producto. Cierra las brechas 1, 2 y endurece la operación.

**Esfuerzo estimado:** 2–3 semanas.

### 1.1 Autenticación robusta
- Migrar JWT de `localStorage` a **cookie `HttpOnly` + `Secure` + `SameSite`** y
  agregar protección **CSRF** (token por sesión). Tocar `api/src/routes/auth.ts`,
  middleware `authenticate`, y `spa/src/auth/AuthContext.tsx` + `api/client.ts`.
- **Login con `tenantSlug`** (o email único global): cambiar el `findFirst` por
  una búsqueda determinista por `(tenantSlug, username)` o por email único.
  Decisión recomendada: **email como identidad global única** (encaja mejor con
  signup self-service y recuperación de contraseña).
- **Recuperación de contraseña** (email con token de un solo uso) y cambio de
  contraseña desde el panel.
- Política de contraseñas mínima y rate-limit en `/auth/login` (anti fuerza bruta).

### 1.2 Endurecimiento de la API
- **Rate limiting** global y por IP (`@fastify/rate-limit`).
- **Helmet / headers de seguridad** (`@fastify/helmet`).
- Validar y limitar tamaño de payloads; revisar CORS (ya existe `cors.test.ts`).
- Auditar que **todas** las queries filtran por `tenantId` del JWT (test de
  aislamiento que intente leer datos de otro tenant y espere 403/empty).
- Revisar manejo de secretos: nada de claves en logs; `OPENROUTER_API_KEY` y
  `INTERNAL_API_TOKEN` solo por env.

### 1.3 Confiabilidad de WhatsApp (Baileys)
- **Resiliencia de sesión**: reconexión automática con backoff, detección de
  `loggedOut` vs caída temporal, y alerta al dueño (y al operador) cuando un bot
  queda desconectado > N minutos.
- Persistencia de sesión Baileys ya está en volumen; **respaldar también** ese
  estado o documentar el flujo de re-vinculación.
- Manejo de límites de OpenRouter (saldo agotado / 429): degradar con mensaje
  claro al cliente final y notificar al dueño, sin perder mensajes.

### 1.4 Backups probados (no solo configurados)
- Script `pg_dump` diario con retención (ya esbozado en runbooks) **+ un
  restore drill documentado** en staging (la diferencia entre "tengo backups" y
  "puedo recuperarme").
- Backup del estado de sesiones de WhatsApp / media, o política explícita de
  re-vinculación.

### Criterios de aceptación
- [ ] Token nunca accesible desde JS (cookie `HttpOnly`); CSRF cubierto por test.
- [ ] Identidad de login única y a prueba de colisiones entre tenants.
- [ ] Rate-limit activo en login y API; headers de seguridad presentes.
- [ ] Test automatizado que prueba el aislamiento entre tenants.
- [ ] Un bot desconectado genera alerta; reconecta solo cuando es posible.
- [ ] Restore de Postgres ejecutado con éxito en staging y documentado.

---

## Fase 2 — Multi-tenancy real: ruteo + aprovisionamiento  *(habilitador)*

**Objetivo:** que agregar un tenant **no requiera tocar `docker-compose.yml`,
`.env` ni reiniciar**. Es el prerequisito técnico del self-service. Cierra las
brechas 3 y 4.

**Esfuerzo estimado:** 3–5 semanas (la pieza más pesada del roadmap).

### Decisión de arquitectura (requiere tu aprobación)
Hay dos caminos para soportar N tenants dinámicos:

- **Enfoque A — Worker multi-tenant (`TenantManager`)** *(recomendado)*: un
  solo proceso worker mantiene N conexiones Baileys, una por tenant, creadas/
  destruidas en caliente al alta/baja. La API rutea `wa-status` por `tenantId`
  hacia el `TenantManager` (un solo endpoint interno, no uno por worker).
  - ✔ Self-service trivial: alta de tenant = crear conexión en memoria, no un
    contenedor. ✔ Menos infra. ✔ Ya previsto como destino en el spec maestro.
  - ✗ Aislamiento de fallos más débil (un crash afecta a varios). Mitigable con
    supervisión por-tenant y reinicio aislado de la conexión.
- **Enfoque B — Un contenedor worker por tenant, orquestado por código**: la API
  lanza/para contenedores vía Docker API o un orquestador. Mejor aislamiento,
  mucha más complejidad operativa (no recomendado para este tamaño).

> **Recomendación:** Enfoque A. El resto de esta fase lo asume.

### Tareas (Enfoque A)
- Implementar `TenantManager`: registro de conexiones Baileys por `tenantId`,
  arranque al boot (todos los tenants activos), y API en memoria para
  `addTenant` / `removeTenant` / `getStatus(tenantId)`.
- Refactor de `src/index.ts` para no asumir un único `TENANT_ID`; cargar la
  lista de tenants activos desde Postgres.
- **Ruteo dinámico en la API**: `wa-status` (y logout/reconnect) reciben el
  `tenantId` del JWT y se lo pasan al endpoint interno, que despacha a la
  conexión correcta. Eliminar la suposición de `WORKER_INTERNAL_URL` único.
- Config por tenant fuera de `profileDir` JSON estático → **tabla
  `TenantSettings`** editable por UI (cierra deuda técnica #3/#4 del spec). El
  `TenantManager` carga la config del tenant desde la tabla.
- Carga de perfiles de intake por industria seleccionable (tapicería,
  paquetería, genérico) como plantillas al alta.

### 2.x Capa de canal (refactor ligero, habilitador de SMS/voz)
El núcleo del pipeline (debounce, agente, intake, media) **ya es agnóstico al
canal**: `OutboundSender` es una interfaz (`sendText`) y el agente no sabe de
WhatsApp. Lo acoplado es solo el borde. Hacer ahora un refactor mínimo evita una
migración dolorosa después, sin retrasar el lanzamiento WhatsApp-only:

- Renombrar `RawInboundMessage.whatsappMsgId` → `externalMsgId` y añadir un
  campo `channel: 'whatsapp' | 'sms' | 'voice'` (`src/pipeline/types.ts`).
- Añadir columna `channel` a `Message` y `Contact` (un contacto puede existir en
  varios canales; clave de identidad sigue siendo el teléfono E.164). Migración
  Prisma con default `'whatsapp'` para datos existentes.
- Definir interfaces `InboundSource` y mantener `OutboundSender`/`Notifier` como
  contratos por canal; WhatsApp (Baileys) pasa a ser **una** implementación.
- **No** se construye SMS ni voz aquí — solo se deja la abstracción lista.

> Este refactor es barato (días, no semanas) y se hace junto con la Fase 2 porque
> ambos tocan la frontera del worker. SMS y voz reales viven en la Fase 8.

### Criterios de aceptación
- [ ] Alta de un tenant nuevo desde código/API crea su conexión sin reiniciar
      el proceso ni tocar archivos.
- [ ] `wa-status` devuelve el estado **del tenant del usuario**, no de uno fijo.
- [ ] Dos tenants con bots simultáneos, mensajes aislados, verificado en staging.
- [ ] Config del bot editable por tenant desde el panel (sin tocar JSON en disco).
- [ ] `Message`/`Contact` tienen `channel`; WhatsApp es una implementación de
      `InboundSource`/`OutboundSender` (abstracción lista, sin nuevos canales).

---

## Fase 3 — Billing: Stripe, suscripción mensual fija

**Objetivo:** cobrar de forma recurrente y que el acceso dependa del estado de
la suscripción. Cierra la brecha 5.

**Esfuerzo estimado:** 1.5–2.5 semanas.

### Tareas
- Modelo de datos: `Plan` (precio, intervalo, límites) y `Subscription`
  (`tenantId`, `stripeCustomerId`, `stripeSubscriptionId`, `status`,
  `currentPeriodEnd`). Migración Prisma.
- **Stripe Checkout** para alta de suscripción y **Customer Portal** para que el
  cliente gestione método de pago / cancele.
- **Webhooks de Stripe** (`checkout.session.completed`,
  `customer.subscription.updated/deleted`, `invoice.payment_failed`) que
  actualizan `Subscription.status`. Endpoint verificado por firma.
- **Enforcement**: middleware que bloquea el panel/bot cuando la suscripción no
  está `active`/`trialing` (con periodo de gracia y aviso). Estados: trial →
  active → past_due → canceled.
- Pantalla de facturación en la SPA (estado del plan, enlace al portal).
- Manejo de impuestos/moneda según mercado objetivo (Stripe Tax si aplica).

### Criterios de aceptación
- [ ] Un cliente puede suscribirse con tarjeta real (modo test) y queda `active`.
- [ ] Falla de pago → `past_due` → tras gracia, el bot deja de operar y se avisa.
- [ ] Cancelación desde el portal refleja `canceled` y corta acceso al fin del
      periodo.
- [ ] Webhooks idempotentes y verificados por firma (test de webhook).

---

## Fase 4 — Onboarding self-service

**Objetivo:** un negocio se registra, paga y tiene su bot funcionando **sin
intervención manual**. Cierra la brecha 6. Depende de Fases 1–3.

**Esfuerzo estimado:** 2–3 semanas.

### Flujo objetivo
1. **Signup** (email + contraseña + nombre del negocio + industria) → crea
   `Tenant` + `PanelUser` (admin) en una transacción, con validación.
2. **Suscripción** (Fase 3): Checkout antes de activar el bot (o trial sin
   tarjeta, decisión de negocio — ver abajo).
3. **Aprovisionamiento automático**: al activarse, el `TenantManager` (Fase 2)
   crea la conexión del tenant y la SPA muestra el **QR de WhatsApp** para
   vincular.
4. **Asistente de configuración** guiado: nombre/giro, mensaje de bienvenida,
   datos del negocio, schema de intake de su industria (plantilla precargada).
5. **Primer mensaje de prueba** y checklist de "listo para operar".

### Decisión de negocio pendiente
- ¿**Trial gratuito** (X días sin tarjeta) o **tarjeta requerida** desde el
  signup? Afecta el orden de los pasos 1–2. Recomendación: trial corto con
  tarjeta requerida (menos fraude, mejor conversión a pago).

### Tareas
- `POST /auth/signup` con validación, anti-abuso (rate-limit, verificación de
  email) y creación transaccional de tenant+admin.
- Verificación de email (token).
- Wizard de onboarding en la SPA (multi-paso, reanudable).
- Integración signup ↔ Stripe ↔ `TenantManager` (provisioning end-to-end).

### Criterios de aceptación
- [ ] Un usuario nuevo, sin que el operador toque nada, llega de signup a "bot
      vinculado y respondiendo" en staging.
- [ ] Email verificado obligatorio antes de operar.
- [ ] El flujo es reanudable si el usuario abandona a medias.

---

## Fase 5 — Observabilidad y operaciones

**Objetivo:** poder operar el SaaS con varios clientes sin volar a ciegas.
Cierra las brechas 7 y 8. Puede correr en paralelo desde la Fase 1.

**Esfuerzo estimado:** 1.5–2 semanas.

### Tareas
- **CI/CD** (`.github/workflows/`): en cada PR, `npm test` (raíz + `api/` + `spa/`)
  + `npm run typecheck` + build de imágenes. Deploy a staging en merge a main;
  deploy a prod manual/aprobado.
- **Rastreo de errores** (Sentry o equivalente) en API, worker y SPA.
- **Métricas y health**: `/health` ya existe; agregar métricas básicas (mensajes/
  min, errores LLM, bots conectados) y un **uptime monitor** externo con alerta.
- **Alertas operativas**: bot caído, pago fallido, error rate alto, saldo
  OpenRouter bajo, disco/DB.
- **Logs estructurados** (pino ya está) centralizados y con `tenantId`.
- **Panel de operador/admin** interno: ver tenants, estado de bots y
  suscripciones, suspender/reactivar (soporte).

### Criterios de aceptación
- [ ] PR no mergeable si fallan tests o typecheck.
- [ ] Un error en producción aparece en el rastreador con `tenantId`.
- [ ] Una caída de bot dispara alerta al operador en < 5 min.

---

## Fase 6 — Legal, cumplimiento y go-to-market

**Objetivo:** poder cobrar legalmente y vender. Cierra la brecha 9.

**Esfuerzo estimado:** 1–2 semanas (parte legal puede requerir asesoría externa).

### Tareas
- **Términos de Servicio** y **Política de Privacidad** (manejo de datos de
  WhatsApp de terceros — los clientes finales del negocio). Aceptación
  registrada en el signup.
- **Cumplimiento de datos**: política de retención, exportación y borrado de
  datos por tenant (derecho de acceso/borrado). Endpoint de export/delete.
- **Política de uso de WhatsApp**: dejar claro el modelo Baileys (no API oficial)
  y sus riesgos/términos al cliente, para gestionar expectativas y
  responsabilidad.
- **Landing page** con propuesta de valor, precios y CTA a signup.
- **Documentación de cliente**: guía de inicio, FAQ, soporte (email/WhatsApp).
- Email transaccional (verificación, recuperación, avisos de pago) con un
  proveedor (Postmark/Resend/SES).

### Criterios de aceptación
- [ ] ToS + Privacidad publicados y aceptados en signup.
- [ ] Un tenant puede exportar y solicitar borrado de sus datos.
- [ ] Landing con precios y signup en vivo.

---

## Fase 7 — Beta cerrada → Lanzamiento

**Objetivo:** validar con clientes reales antes de abrir el grifo.

**Esfuerzo estimado:** 2–4 semanas de operación (no de código).

### Tareas
- **Beta cerrada** con los 2 tenants iniciales del spec (tapicería + paquetería)
  ya bajo el flujo self-service real (no manual).
- Recoger fricción de onboarding, fallos de bot, dudas de cobro; iterar.
- **Runbook de soporte e incidentes** (qué hacer si un bot cae, si un pago
  falla, si OpenRouter se queda sin saldo).
- Revisión de costos unitarios (OpenRouter por tenant) vs precio del plan →
  confirmar márgenes.
- **Go/No-Go** contra el checklist de lanzamiento.

### Checklist de lanzamiento (Go/No-Go)
- [ ] Fases 1–6 con criterios de aceptación cumplidos.
- [ ] Backups con restore probado.
- [ ] Monitoreo y alertas activos.
- [ ] Cobro real funcionando (un pago de verdad cobrado y conciliado).
- [ ] Self-service end-to-end probado por alguien externo al equipo.
- [ ] ToS/Privacidad publicados; soporte definido.
- [ ] Márgenes por tenant validados.

---

## Fase 8 — Multicanal v2: SMS + Voz conversacional en vivo  *(post-lanzamiento)*

**Objetivo:** atender clientes que prefieren **SMS** o **llamada de voz**, no solo
WhatsApp. Se construye **después** del lanzamiento (decisión: WhatsApp primero),
apoyándose en la capa de canal de la Fase 2. Proveedor: **Twilio** (SMS + voz +
números en un solo lugar).

> Dos sub-tracks de esfuerzo muy distinto. SMS es barato y reutiliza casi todo el
> pipeline; la voz en vivo es la pieza más compleja de todo el roadmap.

### 8A — SMS (Twilio)  ·  esfuerzo: 1.5–2.5 semanas
- Webhook de Twilio para SMS entrante → adaptarlo a `InboundSource` (un mensaje
  de texto entra al mismo pipeline; sin media salvo MMS opcional).
- `OutboundSender` para SMS vía Twilio API.
- **Aprovisionamiento de número por tenant** (comprar/asignar un número Twilio en
  el onboarding; guardarlo en `TenantSettings`).
- Diferencias de canal a manejar: SMS no tiene "typing"/recibos como WhatsApp,
  límite de 160 chars/segmentación, sin QR ni sesión Baileys (mucho más estable).
- UI: el panel muestra el canal de cada conversación; estado del número SMS.
- **Costos:** SMS se cobra por segmento — vigilar el margen contra el plan fijo.

**Criterios de aceptación 8A**
- [ ] Un SMS entrante crea/continúa un intake y el bot responde por SMS.
- [ ] El número SMS se asigna en el onboarding sin intervención manual.
- [ ] Conversaciones SMS y WhatsApp del mismo teléfono se ven coherentes.

### 8B — Agente de voz conversacional en vivo (Twilio)  ·  esfuerzo: 6–10+ semanas
La pieza más ambiciosa: el cliente **llama y conversa con la IA en tiempo real**.
Arquitectura nueva y sensible a latencia, separada del worker de chat.

**Arquitectura propuesta**
- **Twilio Voice + Media Streams**: audio bidireccional por WebSocket hacia un
  nuevo servicio de voz (`voice-gateway`).
- Bucle en tiempo real: **STT (streaming) → razonamiento (LLM) → TTS (streaming)**
  con **barge-in** (el cliente puede interrumpir) y presupuesto de latencia
  objetivo < ~800 ms por turno. Evaluar un modelo *speech-to-speech* realtime vs.
  pipeline STT+LLM+TTS por separado (trade-off latencia/control/costo).
- **Reutiliza la lógica de intake/agente** existente, pero adaptada a turnos de
  voz (respuestas cortas, confirmaciones habladas, manejo de silencios).
- **Grabación + consentimiento**: aviso de grabación al inicio de la llamada
  (requisito legal en muchos países), transcripción guardada como `Message` con
  `channel='voice'`, audio en el media store.
- **Fallbacks**: si la IA no entiende o falla, derivar a buzón → transcripción
  (el modo simple) o a un humano; nunca dejar la llamada colgada.
- Nuevo contenedor `voice-gateway` (escala distinta al worker de chat; la voz es
  intensiva en CPU/red y stateful por llamada).

**Riesgos / decisiones de la voz en vivo**
- Latencia y calidad de la conversación son el make-or-break del producto.
- Costo por minuto (Twilio + STT + LLM + TTS) puede ser alto → revisar margen
  contra el plan fijo; quizá la voz sea un add-on de precio.
- Cumplimiento de grabación de llamadas varía por jurisdicción.

**Criterios de aceptación 8B**
- [ ] Un cliente llama, conversa con la IA y completa un intake por voz, con
      interrupciones manejadas y latencia aceptable.
- [ ] La llamada queda transcrita y vinculada al job correcto del tenant.
- [ ] Aviso de grabación reproducido; fallback a buzón/humano si la IA falla.
- [ ] Margen por minuto validado contra el precio del plan (o add-on definido).

---

## Resumen de secuencia y dependencias

```
Fase 1 (seguridad) ──┐
                     ├─► Fase 4 (self-service) ──► Fase 7 (beta → LANZAMIENTO)
Fase 2 (multi-tenant)┤        ▲                          │
  + capa de canal    │        │                          ▼
Fase 3 (billing) ────┘────────┘            Fase 8 (multicanal v2: SMS + voz)
Fase 5 (observabilidad)  ── en paralelo desde Fase 1 ──► requisito de launch
Fase 6 (legal/GTM)       ── en paralelo, cierra antes de Fase 7
```

**Ruta crítica al lanzamiento:** 1 → 2 → 3 → 4 → 7 (WhatsApp-only). Las fases 5 y
6 corren en paralelo y son requisitos del Go/No-Go. La **Fase 8 (SMS + voz) es
post-lanzamiento** y no bloquea el launch; la capa de canal que la habilita se
deja lista barato dentro de la Fase 2.

**Estimación total al lanzamiento (1 dev full-time, secuencial):** ~13–21 semanas
de ingeniería + 2–4 de beta. Con paralelización (5 y 6 solapadas) y foco, una
ventana realista es **~3–4 meses** hasta lanzamiento WhatsApp-only.

**Post-lanzamiento (Fase 8):** SMS ~2 semanas; **voz en vivo 6–10+ semanas** como
línea de producto v2 (la inversión más grande, pero también el mayor
diferenciador).

---

## Decisiones abiertas que necesito de ti antes de ejecutar

1. **Enfoque 2** — ¿apruebas el `TenantManager` multi-tenant (Enfoque A) sobre
   un contenedor por tenant? (recomendado: sí).
2. **Identidad de login** — ¿email global único (recomendado) o
   `tenantSlug + username`?
3. **Trial** — ¿trial gratuito con/sin tarjeta, o tarjeta requerida desde el
   signup?
4. **Precio del plan** — define el monto y el intervalo para configurar el `Plan`
   en Stripe.
5. **Mercado/moneda/impuestos** — ¿país objetivo inicial? (afecta Stripe Tax y
   requisitos legales).
6. **Voz (Fase 8)** — ¿la voz en vivo será parte del plan base o un **add-on de
   precio**? (su costo por minuto puede no caber en el plan fijo). Definir también
   el país inicial para cumplimiento de grabación de llamadas.

> Cuando confirmes 1–5, el siguiente paso es convertir **Fase 1** en un plan de
> implementación detallado (spec → plan → ejecución) y arrancar, ya que no
> depende de las decisiones de billing/onboarding. La decisión 6 puede esperar
> hasta acercarse a la Fase 8.
