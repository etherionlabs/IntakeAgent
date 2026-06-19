# Plan Fase 3 — Billing con Stripe (suscripción mensual fija)

> **Para ejecutores agénticos:** SUB-SKILL REQUERIDA: usa
> superpowers:subagent-driven-development (recomendada) o
> superpowers:executing-plans para implementar este plan tarea por tarea. Los
> pasos usan sintaxis de checkbox (`- [ ]`) para seguimiento.

**Objetivo:** Cobrar de forma recurrente y automática delegando todo el ciclo de
vida del pago a Stripe (Checkout + Customer Portal + reintentos/dunning),
manteniendo en nuestra base únicamente el **estado espejo** de la suscripción,
sincronizado por **webhooks firmados e idempotentes**, y haciendo que el acceso
al panel y la operación del bot **dependan del estado de la suscripción** del
tenant.

**Arquitectura:** Se añaden tres modelos Prisma (`Plan`, `Subscription`,
`StripeEvent`) y una relación 1‑a‑1 opcional con `Tenant`. **Stripe es la fuente
de verdad**; nuestra tabla es un espejo poblado exclusivamente por webhooks. Un
router nuevo `api/src/routes/billing.ts` expone `POST /billing/checkout`,
`POST /billing/portal`, `GET /billing/status` (con `app.authenticate`) y
`POST /billing/webhook` (sin JWT, verificado por firma). Un helper
`isTenantActive` + un `preHandler` `requireActiveSubscription` bloquean las rutas
de negocio con `402` cuando la suscripción no está operativa, exceptuando
`/auth/*`, `/health` y `/billing/*`. El enforcement del **bot** se conecta al
`TenantManager` (Fase 2) mediante endpoints internos del worker
(`/internal/tenant/suspend|resume`), llamados con `INTERNAL_API_TOKEN` con el
mismo patrón que `wa-status`. La SPA gana una vista `/billing` y un interceptor
`402`. Todo queda **parametrizado por env** (monto/intervalo/moneda/mercado son
decisión pendiente del dueño y nunca se cablean en código).

**Stack técnico:** Node 20+, TypeScript, Prisma 7.8 + `@prisma/adapter-pg` +
PostgreSQL 16, Fastify 5, `@fastify/jwt`, SDK oficial `stripe` (Node), vitest 4
(`fileParallelism: false`), Docker Compose. SPA en React/TypeScript.

**Decisión de negocio (fija):** un único plan mensual de **monto fijo**, sin
metered billing. El `AgentRun.costUsd` queda como control interno de margen,
nunca como base de factura.

> **PENDIENTE DEL DUEÑO (no bloquea la implementación; solo configura valores):**
> monto exacto, intervalo (mensual vs anual), moneda y mercado/impuestos
> (Stripe Tax), duración del trial y si exige tarjeta, y días de gracia. Todo se
> alimenta por env (`STRIPE_PRICE_ID`, `BILLING_GRACE_DAYS`, `Plan.trialDays`)
> y por el `Product`/`Price` creado en el dashboard de Stripe. El código **no**
> calcula importes ni asume moneda: lee el `Price` de Stripe y muestra el espejo.

---

## Dependencias y orden

- **DEPENDE DE FASE 2 (`TenantManager`):** el enforcement del bot
  (`suspendTenant`/`resumeTenant` + endpoints internos `/internal/tenant/*`)
  requiere que el `TenantManager` de la Fase 2 exista. La Tarea 4 marca esa
  dependencia explícitamente. Si la Fase 2 aún no aterrizó, las Tareas 1–3, 5 y
  6 pueden completarse y el enforcement de **panel** (`402`) funciona solo; el
  enforcement del **bot** queda con la llamada al worker apuntando a un endpoint
  que la Fase 2 debe proveer (degradación segura: si el worker no responde, se
  registra y reintenta, pero el panel ya bloquea).
- **Orden recomendado:** 1 (modelos/migración) → 2 (Stripe Checkout/Portal) →
  3 (webhook firmado + idempotente + máquina de estados) → 4 (enforcement +
  TenantManager) → 5 (SPA) → 6 (env vars / compose). La Tarea 6 (env) puede
  adelantarse parcialmente para desbloquear el arranque local; se deja al final
  por claridad de checklist.
- **Prerrequisito local:** PostgreSQL de desarrollo (mismo patrón del Plan 1) y
  la **Stripe CLI** (`stripe login`, `stripe listen --forward-to
  localhost:3001/billing/webhook`) para firmar/forwardear webhooks en local.
  Crear en el dashboard de Stripe (modo test) un `Product` + `Price` recurrente
  y copiar el `price_…` a `STRIPE_PRICE_ID`.

---

## Tarea 1: Modelos Prisma `Plan` / `Subscription` / `StripeEvent` + migración

**Objetivo:** Añadir el modelo de datos del billing y la relación 1‑a‑1 con
`Tenant`, dejando la tabla como espejo de Stripe.

**Archivos:**
- Modificar: `prisma/schema.prisma`
- Modificar: `tests/helpers/db.ts` (limpieza de las nuevas tablas + seed de `Plan`)
- Crear: `tests/services/subscription.test.ts`
- Migración: generada

**Dependencias:** ninguna (base de todo el plan).

- [ ] **Paso 1: Escribir test que falla para el modelo y la relación**

  Crear `tests/services/subscription.test.ts` que: siembre un `Tenant` y un
  `Plan` (`seedTestPlan`), cree una `Subscription` 1‑a‑1 con ese tenant, y
  verifique que `prisma.tenant.findUnique({ include: { subscription: true } })`
  devuelve la suscripción; que `tenantId` y `stripeCustomerId` son únicos
  (segundo `create` con el mismo `tenantId` lanza); y que un `StripeEvent` con
  PK duplicada lanza error de constraint.

- [ ] **Paso 2: Ejecutar el test para confirmar que falla**

  Run: `npx vitest run tests/services/subscription.test.ts`
  Esperado: FALLA — `prisma.plan` / `prisma.subscription` / `prisma.stripeEvent`
  no existen.

- [ ] **Paso 3: Añadir los modelos al schema**

  En `prisma/schema.prisma`, añadir `Plan`, `Subscription`, `StripeEvent` según
  el spec §2 (campos exactos: `Plan` con `stripePriceId @unique`, `amountCents`,
  `currency @default("usd")`, `interval @default("month")`, `trialDays`,
  `maxContacts?`, `maxJobsMonth?`, `active`; `Subscription` con `tenantId @unique`
  1‑a‑1, `planId`, `stripeCustomerId @unique`, `stripeSubscriptionId? @unique`,
  `status`, `currentPeriodEnd?`, `cancelAtPeriodEnd @default(false)`,
  `gracePeriodEndsAt?`, `lastEventId?`, `@@index([status])`; `StripeEvent` con
  `id @id` = `evt_…` como PK, `type`, `processedAt`). Añadir el lado inverso
  **opcional** en `Tenant`: `subscription Subscription?`. No tocar tablas
  existentes salvo esa relación inversa (no genera columna).

  > **Nota tenancy:** `Subscription?` es opcional a propósito — un `Tenant` puede
  > existir sin suscripción (flujo self-service de Fase 4). Un tenant sin
  > `Subscription` o con `status` no operativo queda bloqueado por la Tarea 4,
  > salvo allowlist.

- [ ] **Paso 4: Generar la migración**

  Run: `npx prisma migrate dev --name add_billing_plan_subscription`
  Esperado: migración creada y aplicada; cliente regenerado; existen
  `prisma.plan`, `prisma.subscription`, `prisma.stripeEvent`. La migración crea
  las tres tablas y la FK `Subscription.tenantId → Tenant.id`; **compatible con
  datos existentes** (los tenants previos quedan sin `Subscription`).

- [ ] **Paso 5: Extender el helper de tests**

  En `tests/helpers/db.ts`: añadir en `cleanupDb` el borrado de
  `subscription`, `stripeEvent` y `plan` (en orden de FK: subscription antes que
  plan/tenant). Añadir `TEST_PLAN_ID` + `seedTestPlan()` (inserta un `Plan`
  activo con un `stripePriceId` ficticio `price_test`, `amountCents`/`currency`
  de display). Documentar que el monto real lo manda Stripe.

- [ ] **Paso 6: Pasar el test + suite + typecheck**

  Run: `npx vitest run tests/services/subscription.test.ts && npm test && npm run typecheck`
  Esperado: todo PASA.

- [ ] **Paso 7: Documentar el seed de producción (no ejecutar)**

  En el runbook (o comentario en la migración): tras crear el `Product`/`Price`
  en Stripe, insertar **un** registro `Plan` con el `stripePriceId` real. Anotar
  que `migrate deploy` en prod aplica limpio (no toca datos existentes).

**Verificación:** test verde de modelo + relación 1‑a‑1 + unicidad + PK de
`StripeEvent`; suite completa verde; migración aplicada.

---

## Tarea 2: Integración Stripe Checkout + Customer Portal

**Objetivo:** Alta de suscripción (Checkout) y autogestión (Portal) vía páginas
alojadas por Stripe — **nunca tocamos datos de tarjeta** (PCI SAQ‑A). La SPA solo
recibe URLs de redirección.

**Archivos:**
- Crear: `api/src/billing/stripe.ts` (cliente Stripe singleton)
- Crear: `api/src/routes/billing.ts` (por ahora: `checkout`, `portal`, `status`)
- Modificar: `api/src/server.ts` (registrar `billingRoutes`)
- Modificar: `api/src/env.ts` (leer `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `SPA_URL`)
- Crear: `api/tests/routes/billing.checkout.test.ts`
- Instalar: dependencia `stripe`

**Dependencias:** Tarea 1 (modelos). Env vars de la Tarea 6 (se pueden añadir
aquí incrementalmente).

- [ ] **Paso 1: Instalar el SDK + crear el cliente singleton**

  `npm install stripe` (en `api/`). Crear `api/src/billing/stripe.ts`: exporta un
  cliente `Stripe` perezoso construido con `requireEnv('STRIPE_SECRET_KEY')`,
  fijando `apiVersion`. Inyectable en tests (aceptar un cliente fake por
  parámetro o factory) para no pegarle a Stripe real.

- [ ] **Paso 2: Test que falla para `POST /billing/checkout`**

  Crear `api/tests/routes/billing.checkout.test.ts`: con un cliente Stripe
  **mock** (que registra las llamadas y devuelve `{ url: 'https://checkout...' }`),
  inyectado en `buildServer`, verificar que `POST /billing/checkout`
  autenticado: (a) crea/reutiliza el `Customer` con `metadata.tenantId`,
  (b) persiste una `Subscription` parcial `status='incomplete'` sin
  `stripeSubscriptionId` si no existía, (c) crea la Checkout Session con
  `mode='subscription'`, `line_items` con el `price` del plan activo,
  `client_reference_id = tenantId`, `metadata.tenantId`,
  `success_url`/`cancel_url` derivados de `SPA_URL`, y `subscription_data`
  con `trial_period_days` solo si `plan.trialDays > 0`, y (d) responde
  `{ url }`. Sin token → `401`.

- [ ] **Paso 3: Ejecutar para confirmar fallo**

  Run: `npx vitest run api/tests/routes/billing.checkout.test.ts`
  Esperado: FALLA — la ruta no existe.

- [ ] **Paso 4: Implementar `checkout`, `portal` y `status`**

  En `api/src/routes/billing.ts` registrar tres rutas con
  `preHandler: app.authenticate` (patrón de `usageRoutes`/`waStatusRoutes`,
  `request.tenantId` ya disponible):
  - `POST /billing/checkout`: resuelve el `Plan` activo, crea/reutiliza
    `Customer` (persiste `Subscription` parcial), crea la Checkout Session y
    devuelve `{ url }`. **No** marca `active` aquí (eso lo hace el webhook).
  - `POST /billing/portal`: crea una Billing Portal Session para el
    `stripeCustomerId` del tenant con `return_url = ${SPA_URL}/billing`,
    devuelve `{ url }`. Si el tenant no tiene `Customer` aún → `409`/`400` con
    hint de ir a checkout.
  - `GET /billing/status`: lee del espejo local (`Subscription` + `Plan`),
    devuelve `{ status, planName, amountCents, currency, currentPeriodEnd,
    cancelAtPeriodEnd, gracePeriodEndsAt }` filtrado por `request.tenantId`. Sin
    pegarle a Stripe.
  Aceptar un cliente Stripe inyectable vía las opciones del router (igual que
  `fetcher` en `waStatusRoutes`) para tests.

- [ ] **Paso 5: Registrar el router + env**

  En `api/src/server.ts` añadir `await app.register(billingRoutes, { stripe:
  opts.stripe })` y extender `BuildOptions` con `stripe?`. En `api/src/env.ts`
  añadir `requireEnv('STRIPE_SECRET_KEY')`, `requireEnv('STRIPE_PRICE_ID')` y
  `SPA_URL` (con default razonable o `requireEnv`). Fail-fast al arrancar si
  faltan las secretas (igual que `JWT_SECRET`).

- [ ] **Paso 6: Pasar el test + suite + typecheck**

  Run: `npx vitest run api/tests/routes/billing.checkout.test.ts && npm test && npm run typecheck`
  Esperado: PASA. Cubrir también: `success_url`/`cancel_url` correctos;
  `trial_period_days` omitido cuando `trialDays=0`; reutilización del `Customer`
  existente (no se crea dos veces).

**Verificación:** tests de Checkout/Portal/status con cliente Stripe mock; sin
token → `401`; el alta `active` **no** depende de la redirección (se confía solo
al webhook de la Tarea 3).

---

## Tarea 3: Webhook firmado e idempotente + máquina de estados

**Objetivo:** Endpoint único, público, **sin JWT**, verificado por **firma** e
**idempotente**, única vía por la que cambia `Subscription.status`.

**Archivos:**
- Modificar: `api/src/routes/billing.ts` (+ `POST /billing/webhook`)
- Modificar: `api/src/server.ts` (raw-body parser **solo** para `/billing/webhook`)
- Crear: `api/src/billing/state-machine.ts` (mapeo evento → transición)
- Modificar: `api/src/env.ts` (`STRIPE_WEBHOOK_SECRET`, `BILLING_GRACE_DAYS`)
- Crear: `api/tests/routes/billing.webhook.test.ts`

**Dependencias:** Tareas 1 y 2.

- [ ] **Paso 1: Raw body solo en la ruta del webhook**

  En `api/src/server.ts`, registrar un `contentTypeParser` para
  `application/json` que conserve el `Buffer` crudo (`request.rawBody`) **sin
  romper** el parseo JSON normal del resto de la API. La verificación de firma de
  Stripe exige el cuerpo crudo exacto. Opciones: parser global que adjunta
  `rawBody` además de parsear, o `addContentTypeParser` acotado a la ruta del
  webhook. Documentar la decisión en comentario.

- [ ] **Paso 2: Test que falla para firma + idempotencia + estados**

  Crear `api/tests/routes/billing.webhook.test.ts`. Usar
  `stripe.webhooks.generateTestHeaderString` con `STRIPE_WEBHOOK_SECRET` de test
  para firmar payloads reales. Casos:
  1. **Firma inválida** (header manipulado / secreto distinto) → `400`, sin
     cambios en DB.
  2. **`checkout.session.completed`** firmado → vincula `stripeSubscriptionId`,
     `status='active'` (o `'trialing'`), set `currentPeriodEnd`; re-vincula por
     `client_reference_id`/`metadata.tenantId`.
  3. **Idempotencia:** reenviar el **mismo `event.id`** → `200` sin reprocesar
     (verificar que el estado no cambia dos veces y que existe **una** fila en
     `StripeEvent`).
  4. **`invoice.payment_failed`** → `status='past_due'` +
     `gracePeriodEndsAt = now + BILLING_GRACE_DAYS`.
  5. **`customer.subscription.deleted`** → `status='canceled'`.
  6. **`invoice.payment_succeeded`** → `active`, limpia `gracePeriodEndsAt`,
     refresca `currentPeriodEnd`.
  7. **Fuera de orden:** un `subscription.updated` con `currentPeriodEnd` más
     viejo que el aplicado se ignora (no retrocede el estado).

- [ ] **Paso 3: Ejecutar para confirmar fallo**

  Run: `npx vitest run api/tests/routes/billing.webhook.test.ts`
  Esperado: FALLA — la ruta no existe.

- [ ] **Paso 4: Implementar el handler**

  En `api/src/routes/billing.ts`, `POST /billing/webhook` (sin
  `authenticate`):
  1. `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)`;
     si lanza → `400` y no procesa nada.
  2. **Idempotencia:** `INSERT` en `StripeEvent` con `id = event.id` dentro de
     una transacción; si viola la PK → duplicado → `200` sin reprocesar.
  3. Si inserta → en la **misma transacción**, aplicar la transición
     (Paso 5) y `Subscription.lastEventId = event.id`. Responder `2xx`.
  4. **Fuera de orden:** ignorar eventos cuyo objeto sea más viejo que el estado
     aplicado (comparar `currentPeriodEnd`/timestamps).
  Disparar el hook de aviso (no-op por ahora; e-mail vive en Fase 6) en
  `invoice.payment_failed`.

- [ ] **Paso 5: Máquina de estados en módulo aparte**

  Crear `api/src/billing/state-machine.ts` con una función pura
  `applyStripeEvent(currentSub, event) → patch` que mapee cada evento a su
  transición según el spec §4.3 (tabla de eventos + diagrama):
  `incomplete → trialing/active → past_due → canceled`, con
  `cancelAtPeriodEnd`. Mantenerla pura facilita testearla sin DB ni HTTP.

- [ ] **Paso 6: Env del webhook**

  En `api/src/env.ts`: `requireEnv('STRIPE_WEBHOOK_SECRET')` (secreto,
  fail-fast) y `BILLING_GRACE_DAYS` (`Number(... ?? 3)`).

- [ ] **Paso 7: Pasar el test + suite + typecheck**

  Run: `npx vitest run api/tests/routes/billing.webhook.test.ts && npm test && npm run typecheck`
  Esperado: PASA. Los 7 casos verdes.

- [ ] **Paso 8: E2E manual con Stripe CLI (no automatizado)**

  `stripe listen --forward-to localhost:3001/billing/webhook` y
  `stripe trigger checkout.session.completed` / `invoice.payment_failed` para
  confirmar el flujo real de firma. Documentar en el runbook.

**Verificación:** firma inválida → `400`; reenvío de `event.id` no reprocesa
(test); transiciones de la máquina de estados cubiertas; entregas fuera de orden
ignoradas.

---

## Tarea 4: Enforcement (panel + bot) conectado al `TenantManager`

**Objetivo:** Bloquear panel/bot cuando la suscripción no está operativa
(`402`), y **suspender/reactivar el bot** vía el `TenantManager` de la Fase 2.

> **DEPENDE DE FASE 2 (`TenantManager`).** Esta tarea extiende el
> `TenantManager` con `suspendTenant`/`resumeTenant` y los endpoints internos
> `/internal/tenant/suspend|resume`. Si la Fase 2 no aterrizó, el enforcement de
> **panel** (`402`) se entrega igual; la llamada al worker degrada con seguridad
> (registra y reintenta) hasta que existan los endpoints.

**Archivos:**
- Crear: `api/src/billing/access.ts` (`isTenantActive`)
- Modificar: `api/src/server.ts` (`preHandler`/decorator `requireActiveSubscription`,
  aplicado a rutas de negocio; exenciones)
- Modificar: rutas de negocio (`jobs`, `contacts`, `usage`, `settings`,
  `wa-status`) para colgar el `preHandler` (o aplicarlo global con exenciones)
- Modificar (Fase 2): `TenantManager` + worker — `suspendTenant`/`resumeTenant`
  y endpoints `/internal/tenant/suspend|resume` (protegidos por `INTERNAL_API_TOKEN`)
- Modificar: `api/src/routes/billing.ts` (webhook llama a suspend/resume del worker)
- Modificar: `api/src/env.ts` (`BILLING_EXEMPT_TENANT_IDS`, `WORKER_INTERNAL_URL` ya existe)
- Crear: `api/tests/billing/access.test.ts`, `api/tests/routes/enforcement.test.ts`

**Dependencias:** Tareas 1–3; Fase 2 para la parte del bot.

- [ ] **Paso 1: Test del helper `isTenantActive`**

  Crear `api/tests/billing/access.test.ts`: tabla de verdad —
  `null → false`; `active`/`trialing → true`; `past_due` con
  `now < gracePeriodEndsAt → true`, fuera de gracia `→ false`;
  `incomplete`/`canceled`/`unpaid → false`; tenant en
  `BILLING_EXEMPT_TENANT_IDS → true` sin suscripción.

- [ ] **Paso 2: Implementar `isTenantActive` + allowlist**

  Crear `api/src/billing/access.ts` con la lógica del spec §5.1, más la
  exención por `BILLING_EXEMPT_TENANT_IDS` (set parseado de env, separado por
  comas). Documentar la allowlist como mecanismo **temporal** de transición para
  los tenants del piloto que existen sin `Subscription`.

- [ ] **Paso 3: Test del middleware (`402`)**

  Crear `api/tests/routes/enforcement.test.ts`: con `requireActiveSubscription`
  activo, request a `/jobs` con `Subscription` `canceled` → `402`
  `{ error: 'subscription_inactive', portalHint: true }`; con `trialing`/`active`
  → `200`; `past_due` dentro de gracia → `200`, fuera → `402`; `/billing/*`,
  `/auth/*`, `/health` accesibles **aun bloqueado**.

- [ ] **Paso 4: Implementar el `preHandler` y aplicarlo**

  En `api/src/server.ts`, decorar `requireActiveSubscription`: tras
  `authenticate`, lee la `Subscription` de `request.tenantId` y, si
  `!isTenantActive(sub)`, responde `402`. Aplicarlo a las rutas de negocio
  (`jobs`, `contacts`, `usage`, `settings`, `wa-status`) y **NO** a `/auth/*`,
  `/health`, `/billing/*` (para que un tenant bloqueado pueda ir al Portal a
  pagar). Opcional (no en esta fase): caché en memoria por `tenantId` con TTL
  corto invalidado por webhooks.

- [ ] **Paso 5: Extender el `TenantManager` (Fase 2) y endpoints internos**

  En el worker/`TenantManager`: añadir `suspendTenant(tenantId)` (pausa/cierra
  la conexión Baileys sin borrar la sesión, deja de procesar entrantes y de
  consumir OpenRouter) y `resumeTenant(tenantId)` (reactiva). Exponer
  `POST /internal/tenant/suspend` y `POST /internal/tenant/resume` protegidos
  por `INTERNAL_API_TOKEN` (mismo patrón que `wa-status`). Defensa en
  profundidad: al arrancar cada tenant, el `TenantManager` puede consultar el
  estado y negarse a operar si está bloqueado.

- [ ] **Paso 6: Disparar suspend/resume desde el webhook**

  En el handler del webhook (Tarea 3): cuando una transición deja al tenant
  no-operativo (gracia vencida / `canceled` / `unpaid`), llamar
  `POST {WORKER_INTERNAL_URL}/internal/tenant/suspend` con
  `Authorization: Bearer ${INTERNAL_API_TOKEN}` (patrón `proxyAction` de
  `wa-status.ts`, con `fetcher` inyectable). Cuando vuelve a `active`/`trialing`,
  llamar `/internal/tenant/resume`. Mockear el `fetcher` en tests.

- [ ] **Paso 7: Test de la suspensión del bot**

  En `enforcement.test.ts` (o nuevo): con `fetcher` mock, verificar que la
  transición a bloqueado llama a `/internal/tenant/suspend` y la transición a
  operativo llama a `/internal/tenant/resume`. Verificar que la **cancelación**
  desde el Portal corta el acceso al **fin del periodo pagado**
  (`cancelAtPeriodEnd=true` mantiene operativo hasta `currentPeriodEnd`; el
  `customer.subscription.deleted` final marca `canceled`).

- [ ] **Paso 8: Pasar tests + suite + typecheck**

  Run: `npm test && npm run typecheck`
  Esperado: todo PASA.

**Verificación:** `402` en rutas de negocio según estado; exenciones correctas;
suspend/resume del worker disparados por las transiciones (mock); cancelación
corta al fin de periodo, no antes.

---

## Tarea 5: Pantalla de facturación en la SPA

**Objetivo:** Vista `/billing` con estado del plan, CTA Suscribirme / Gestionar
facturación, banner de aviso en `past_due`, e interceptor `402`.

**Archivos:**
- Crear: `spa/src/pages/Billing.tsx`
- Modificar: `spa/src/api/client.ts` (interceptor `402` → redirige a `/billing`)
- Modificar: el router/navegación de la SPA (enlace a `/billing`)
- Modificar: el layout (banner global de `past_due`)
- Crear: test de la vista (si la SPA tiene setup de tests de componentes)

**Dependencias:** Tarea 2 (`GET /billing/status`, `POST /billing/checkout`,
`POST /billing/portal`).

- [ ] **Paso 1: Vista `Billing.tsx`**

  Consume `GET /billing/status`. Renderiza: badge de `status` legible
  (Activa / En prueba / Pago pendiente / Cancelada), nombre del plan, precio de
  display (desde el espejo `Plan`), y fecha de próxima renovación / fin de
  periodo (`currentPeriodEnd`). **Sin suscripción / bloqueado:** botón
  "Suscribirme" → `POST /billing/checkout` → `window.location = url`. **Con
  suscripción:** botón "Gestionar facturación" → `POST /billing/portal` →
  redirige al Portal. Reusar el design system existente de la SPA.

- [ ] **Paso 2: Banner global en `past_due`**

  En el layout (no solo en `/billing`): si `status === 'past_due'`, mostrar
  aviso de pago fallido + enlace al Portal, visible durante la gracia.

- [ ] **Paso 3: Interceptor `402`**

  En `spa/src/api/client.ts`: cualquier respuesta `402` redirige a `/billing`
  con mensaje "tu suscripción no está activa". No interceptar las propias rutas
  `/billing/*`.

- [ ] **Paso 4: Navegación + verificación manual**

  Añadir el enlace a `/billing` en la navegación del panel. Verificar a mano:
  estado se renderiza desde `status`; botones redirigen; banner aparece en
  `past_due`; un `402` de cualquier endpoint manda a `/billing`.

**Verificación:** la SPA muestra estado/banner/enlaces y el interceptor `402`
redirige; build de la SPA verde.

---

## Tarea 6: Variables de entorno + docker-compose

**Objetivo:** Declarar las env vars nuevas (solo backend) y propagarlas en
Compose y `.env.example`. **Secretas solo en el backend, fuera de logs y del
repo.**

**Archivos:**
- Modificar: `api/src/env.ts` (ya tocado en Tareas 2–4; consolidar)
- Modificar: `docker-compose.yml` (servicio `api`)
- Modificar: `.env.example`

**Dependencias:** ninguna estricta; cierra el plan.

- [ ] **Paso 1: Consolidar lectura en `env.ts`**

  Confirmar que `api/src/env.ts` lee (patrón `requireEnv` para secretas):
  - `STRIPE_SECRET_KEY` — secreto, `requireEnv`, nunca en logs/SPA.
  - `STRIPE_WEBHOOK_SECRET` — secreto, `requireEnv`.
  - `STRIPE_PRICE_ID` — `price_…` del plan (espejo del seed de `Plan`).
  - `SPA_URL` — base de la SPA para `success_url`/`cancel_url`/`return_url`.
  - `BILLING_GRACE_DAYS` — días de gracia (default 3).
  - `BILLING_EXEMPT_TENANT_IDS` — opcional, lista CSV de tenants exentos.
  `WORKER_INTERNAL_URL` e `INTERNAL_API_TOKEN` ya existen (reutilizados para
  suspend/resume). La SPA **no** necesita `STRIPE_PUBLISHABLE_KEY` (Checkout/
  Portal son redirecciones server-side).

- [ ] **Paso 2: Compose + `.env.example`**

  Añadir las seis vars al servicio `api` en `docker-compose.yml` y placeholders
  (sin valores reales) en `.env.example`. No commitear secretos.

- [ ] **Paso 3: Verificar fail-fast**

  Arrancar la API sin `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` y confirmar
  que falla al arrancar (como `JWT_SECRET`). Con todas presentes, arranca.

**Verificación:** API falla sin secretas; arranca con ellas; Compose y
`.env.example` actualizados; ninguna clave en el repo ni en logs.

---

## Riesgos

- **Raw body del webhook (Fastify):** el mayor riesgo técnico. Si el
  `contentTypeParser` no preserva el `Buffer` exacto, `constructEvent` rechaza
  toda firma. Acotar el raw body a la ruta del webhook para no romper el parseo
  JSON del resto de la API. Cubierto por el test de firma de la Tarea 3.
- **Confiar en `success_url`:** nunca marcar `active` por la redirección
  (manipulable). Solo el webhook cambia estado. Reforzado en Tareas 2 y 3.
- **Entregas fuera de orden / duplicadas de Stripe:** mitigadas por `StripeEvent`
  (idempotencia por PK) + comparación de timestamps (no retroceder estado).
- **Dependencia de Fase 2:** si el `TenantManager` no existe, el bot no se
  suspende automáticamente aunque el panel sí bloquee. Degradación segura
  (registrar + reintentar) y defensa en profundidad (el worker consulta estado
  al arrancar).
- **Acoplamiento espejo ↔ Stripe:** nuestra tabla puede desincronizarse si se
  pierden webhooks. Mitigación: Stripe reintenta hasta `2xx`; opción futura de
  un job de reconciliación (`subscription.list`) — deuda explícita, no en esta
  fase.
- **Decisiones del dueño pendientes:** monto/moneda/mercado/trial/gracia. El
  plan funciona parametrizado por env y por el `Price` de Stripe; no se cablea
  ningún importe. Riesgo solo de **configuración**, no de código.
- **Allowlist de exención:** `BILLING_EXEMPT_TENANT_IDS` evita romper a los
  tenants del piloto, pero es un bypass del cobro — mantenerla mínima y
  temporal, documentada.
- **PCI:** mantener todo en Checkout/Portal (SAQ‑A). No montar Stripe.js ni
  capturar PAN en la SPA.

---

## Checklist final (criterios de aceptación del spec)

- [ ] Existen `Plan`, `Subscription`, `StripeEvent` con migración aplicada y
      relación 1‑a‑1 con `Tenant`. (Tarea 1)
- [ ] Un cliente puede suscribirse con tarjeta real (modo test) vía Checkout y la
      `Subscription` queda `active` (o `trialing`). (Tareas 2–3)
- [ ] El cliente abre el Customer Portal desde la SPA y cambia tarjeta / cancela.
      (Tareas 2, 5)
- [ ] El webhook **verifica la firma** (firma inválida → `400`) y es
      **idempotente** (reenvío del mismo `event.id` no reprocesa) — con test.
      (Tarea 3)
- [ ] Falla de pago → `past_due`; tras la gracia, el bot deja de operar (vía
      `TenantManager`) y se deja el hook de aviso. (Tareas 3–4)
- [ ] Cancelación desde el Portal refleja `canceled` y corta acceso **al fin del
      periodo pagado**, no antes. (Tareas 3–4)
- [ ] El middleware bloquea panel/bot cuando la suscripción no está
      `active`/`trialing` (ni en gracia) con `402`, salvo `/billing/*`,
      `/auth/*`, `/health`. (Tarea 4)
- [ ] La SPA muestra estado del plan, banner en `past_due`, enlaces a
      Checkout/Portal, e intercepta `402`. (Tarea 5)
- [ ] Las claves de Stripe viven solo en el backend, fuera de logs y del repo; la
      API falla al arrancar si faltan las secretas. (Tarea 6)
- [ ] Suite completa y typecheck verdes tras cada tarea. (Todas)

---

## Decisiones abiertas (del dueño — no bloquean la implementación)

1. **Monto e intervalo** del plan (mensual vs anual) → `Product`/`Price` en
   Stripe + `STRIPE_PRICE_ID` + display en `Plan`.
2. **Mercado / moneda / impuestos** → `currency`, Stripe Tax (IVA/sales tax),
   requisitos fiscales.
3. **Trial: ¿con o sin tarjeta?** → `Plan.trialDays` +
   `payment_method_collection: 'always'`. Recomendación: trial corto con tarjeta.
4. **Días de gracia** en `past_due` → `BILLING_GRACE_DAYS` (default 3).
5. **Aviso de pago por e-mail** → hook dejado en `invoice.payment_failed`;
   proveedor y copy en Fase 6.
6. **Límites del plan** (`maxContacts`/`maxJobsMonth`) → informativos ahora,
   enforce más adelante.
