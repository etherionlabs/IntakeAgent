# Fase 3 — Billing: Stripe, suscripción mensual fija — Diseño

**Fecha:** 2026-06-18
**Estado:** Propuesta para aprobación
**Enfoque elegido:** Suscripción mensual **fija** (sin cobro por uso) vía Stripe
Checkout + Customer Portal + webhooks de estado. Cierra la brecha 5 del roadmap.

> Spec maestro relacionado: `docs/superpowers/specs/2026-06-13-saas-deployment-design.md`.
> Roadmap: `docs/ROADMAP-PRODUCCION.md` (Fase 3). Depende de la Fase 2
> (`TenantManager`) para suspender el bot en caliente.

---

## 1. Objetivo

Cobrar de forma **recurrente y automática**, y que el **acceso al panel y la
operación del bot dependan del estado de la suscripción** del tenant.

La pregunta que guía cada decisión: *"¿cómo cobramos de forma confiable y
cortamos acceso a quien no paga, sin construir un sistema de facturación
propio?"*. Respuesta: delegar el ciclo de vida del pago a Stripe (Checkout,
Portal, reintentos, dunning) y mantener en nuestra base solo el **estado
espejo** de la suscripción, sincronizado por webhooks firmados e idempotentes.

**Decisión de negocio (fija):** un único plan mensual de monto fijo. El
`CostEntry` / `AgentRun.costUsd` queda como **control interno de margen**, nunca
como base de factura. No hay metered billing en esta fase.

**Alcance de esta fase:**
- Modelos `Plan` y `Subscription` + migración Prisma.
- Alta de suscripción (Checkout) y autogestión (Customer Portal).
- Webhooks de Stripe que sincronizan `Subscription.status`.
- Enforcement: middleware que bloquea panel/bot según el estado.
- Pantalla de facturación en la SPA.
- Variables de entorno nuevas.

**Fuera de alcance (deuda explícita):** metered/usage billing, múltiples planes
o tiers, cupones/descuentos en UI propia (se delegan al Portal), proration
manual, facturación B2B con datos fiscales propios (se delega a Stripe), e-mail
transaccional de avisos de pago (vive en Fase 6; aquí solo se deja el hook).

---

## 2. Modelo de datos (PostgreSQL / Prisma)

Se añaden dos modelos a `prisma/schema.prisma` y una relación 1-a-1 (opcional)
con `Tenant`. **El estado de Stripe es la fuente de verdad; nuestra tabla es un
espejo** poblado exclusivamente por webhooks (ver §4).

### 2.1 Modelo `Plan`

Catálogo interno de planes. En esta fase habrá **un solo registro activo**, pero
se modela como tabla para no cablear precio/límites en código y permitir cambiar
de `stripePriceId` sin migración.

```prisma
model Plan {
  id            String   @id @default(uuid())
  name          String                       // "Plan Mensual" (display)
  stripePriceId String   @unique             // price_xxx de Stripe (fuente del monto real)
  amountCents   Int                          // espejo informativo del precio (display); Stripe manda
  currency      String   @default("usd")     // espejo informativo; PENDIENTE definir (ver §10)
  interval      String   @default("month")   // 'month' | 'year' — fijo en 'month' esta fase
  trialDays     Int      @default(0)         // 0 = sin trial; ver decisión abierta §10
  // Límites del plan (informativos/operativos; no se cobran por uso):
  maxContacts   Int?                         // null = sin límite
  maxJobsMonth  Int?                         // null = sin límite
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())

  subscriptions Subscription[]
}
```

Notas:
- `amountCents`/`currency`/`interval` son **espejo de display**. El cargo real lo
  determina el `Price` en Stripe (`stripePriceId`). Nunca calculamos importes.
- `maxContacts` / `maxJobsMonth` son límites **operativos** (soft caps de
  producto), no base de cobro. Su enforcement es opcional en esta fase.

### 2.2 Modelo `Subscription`

Espejo del objeto `Subscription` de Stripe, **uno por tenant** (1-a-1).

```prisma
model Subscription {
  id                   String    @id @default(uuid())
  tenantId             String    @unique          // 1-a-1 con Tenant
  planId               String
  stripeCustomerId     String    @unique          // cus_xxx
  stripeSubscriptionId String?   @unique          // sub_xxx (null entre customer creado y checkout completado)
  status               String                     // ver máquina de estados §4.3
  currentPeriodEnd     DateTime?                  // fin del periodo pagado; corte de acceso al cancelar
  cancelAtPeriodEnd    Boolean   @default(false)  // canceló pero sigue activo hasta currentPeriodEnd
  gracePeriodEndsAt    DateTime?                  // fin del periodo de gracia en past_due (ver §4.4)
  lastEventId          String?                    // idempotencia: último evt_xxx aplicado
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id])
  plan   Plan   @relation(fields: [planId], references: [id])

  @@index([status])
}
```

### 2.3 Relación con `Tenant`

Se añade el lado inverso en el modelo `Tenant` existente
(`prisma/schema.prisma:9`):

```prisma
model Tenant {
  // ... campos existentes (id, slug, name, industry, profileDir, createdAt) ...
  subscription Subscription?   // 1-a-1, opcional (un tenant puede existir sin suscripción aún)
}
```

`Subscription?` es **opcional** a propósito: en el flujo self-service (Fase 4) el
`Tenant` puede crearse antes de completar el Checkout. Un tenant sin
`Subscription` o con `status` no operativo queda bloqueado por el enforcement (§5).

### 2.4 Tabla de idempotencia de webhooks

Para garantizar idempotencia incluso ante reintentos de Stripe y entregas
fuera de orden, se persiste cada evento procesado:

```prisma
model StripeEvent {
  id          String   @id           // evt_xxx (PK = id del evento de Stripe)
  type        String                 // 'checkout.session.completed', etc.
  processedAt DateTime @default(now())
}
```

El handler hace `INSERT` con la PK del evento dentro de la transacción; si la PK
ya existe (constraint violation), el evento es un duplicado y se ignora (200 OK).

### 2.5 Migración

```
prisma migrate dev --name add_billing_plan_subscription   # en desarrollo
prisma migrate deploy                                       # en deploy (ver §8 del spec maestro)
```

La migración crea `Plan`, `Subscription`, `StripeEvent` y la FK
`Subscription.tenantId → Tenant.id`. **No** toca tablas existentes salvo el lado
inverso de la relación (que no genera columna). Compatible con datos existentes:
los tenants ya creados quedan sin `Subscription` (bloqueados hasta suscribirse, o
exentos por allowlist — ver §5.4). Seeding inicial: insertar el registro `Plan`
con el `stripePriceId` real una vez creado el producto en Stripe.

---

## 3. Stripe Checkout + Customer Portal

Toda la captura de tarjeta y gestión de pago ocurre en **páginas alojadas por
Stripe** (Checkout y Portal). **Nunca tocamos datos de tarjeta** → reduce el
alcance PCI a SAQ-A. La SPA solo recibe URLs de redirección.

### 3.1 Alta de suscripción — Checkout

Nuevo router `api/src/routes/billing.ts`, registrado en
`api/src/server.ts` junto al resto (`await app.register(billingRoutes)`).

```
POST /billing/checkout           (auth requerido)
  → crea (o reutiliza) el Customer de Stripe del tenant
  → crea una Checkout Session mode='subscription' con el Price del plan activo
  → devuelve { url } para redirigir
```

Lógica:
1. Resolver `tenantId` del JWT (`request.tenantId`, ya expuesto por el decorator
   `authenticate` en `api/src/server.ts:34`).
2. Buscar `Subscription` del tenant. Si no existe `stripeCustomerId`, crear un
   `Customer` en Stripe (`metadata: { tenantId }`) y persistir un registro
   `Subscription` parcial (`status='incomplete'`, sin `stripeSubscriptionId`).
3. Crear `checkout.sessions.create`:
   ```ts
   {
     mode: 'subscription',
     customer: sub.stripeCustomerId,
     line_items: [{ price: plan.stripePriceId, quantity: 1 }],
     subscription_data: { trial_period_days: plan.trialDays || undefined },
     // payment_method_collection: 'always'  → exige tarjeta aunque haya trial (recomendado, §10)
     success_url: `${SPA_URL}/billing?status=success`,
     cancel_url:  `${SPA_URL}/billing?status=cancel`,
     client_reference_id: tenantId,            // re-vincula en el webhook
     metadata: { tenantId },
   }
   ```
4. Responder `{ url: session.url }`. La SPA hace `window.location = url`.

> **Importante:** el alta de `Subscription.status='active'` **no** se confía a la
> redirección de `success_url` (manipulable). Se confirma **solo** vía webhook
> `checkout.session.completed` / `customer.subscription.created` (§4).

### 3.2 Gestión — Customer Portal

```
POST /billing/portal            (auth requerido)
  → crea una Billing Portal Session para el Customer del tenant
  → devuelve { url }
```

El **Customer Portal** de Stripe cubre, sin UI propia: cambiar método de pago,
ver facturas/recibos, **cancelar** la suscripción, y (si se configura) reanudar.
Se configura una sola vez en el dashboard de Stripe (qué acciones se permiten).
`return_url` apunta de vuelta a `${SPA_URL}/billing`.

### 3.3 ¿Por qué Checkout + Portal y no UI propia?

- Cero manejo de PAN/tarjetas → PCI SAQ-A.
- Stripe gestiona reintentos de pago, dunning, SCA/3DS, recibos e impuestos.
- Menos superficie de error y de mantenimiento. Nuestra responsabilidad se
  reduce a: crear sesiones, escuchar webhooks y reflejar estado.

---

## 4. Webhooks de Stripe

Endpoint **único, público, sin JWT**, verificado por **firma** e **idempotente**.
Es la única vía por la que `Subscription.status` cambia.

### 4.1 Endpoint y verificación de firma

```
POST /billing/webhook            (SIN auth JWT; verificado por firma Stripe)
```

Requisitos de implementación en Fastify:
- **Raw body obligatorio:** la verificación de firma usa el cuerpo *crudo*. Hay
  que registrar un `contentTypeParser` para `application/json` que conserve el
  `Buffer` original **solo en esta ruta** (el resto de la API sigue parseando
  JSON normal). Alternativa: un parser global que adjunte `request.rawBody`.
- Verificar con `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)`
  donde `sig = request.headers['stripe-signature']`. Si falla → `400` y no se
  procesa nada.

```ts
let event: Stripe.Event;
try {
  event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
} catch {
  return reply.code(400).send({ error: 'firma inválida' });
}
```

### 4.2 Idempotencia

1. Intentar `INSERT` en `StripeEvent` con `id = event.id` (PK).
2. Si viola la constraint de PK → ya procesado → responder `200` sin reprocesar.
3. Si inserta → procesar el evento y, en la **misma transacción**, actualizar
   `Subscription`. Guardar `Subscription.lastEventId = event.id`.

Esto cubre los reintentos de Stripe (que reenvía hasta recibir `2xx`) y entregas
duplicadas. Para entregas **fuera de orden**, se ignoran eventos cuyo objeto sea
más viejo que el estado ya aplicado (comparar `currentPeriodEnd` / timestamps).

### 4.3 Eventos manejados y máquina de estados

Eventos suscritos (mínimo):

| Evento de Stripe | Acción sobre `Subscription` |
|---|---|
| `checkout.session.completed` | Vincular `stripeSubscriptionId` (de la session), `status = 'active'` o `'trialing'`, set `currentPeriodEnd`. Re-vincula por `client_reference_id`/`metadata.tenantId`. |
| `customer.subscription.updated` | Sincronizar `status`, `currentPeriodEnd`, `cancelAtPeriodEnd` desde el objeto. Cubre transiciones trial→active, active→past_due, reactivaciones. |
| `customer.subscription.deleted` | `status = 'canceled'`. El acceso ya se cortó al fin del periodo (ver §5.2). |
| `invoice.payment_failed` | `status = 'past_due'`; set `gracePeriodEndsAt = now + GRACE_DAYS`. Disparar aviso al dueño (hook a e-mail de Fase 6). |
| `invoice.payment_succeeded` *(opcional)* | Confirmar `status = 'active'`, limpiar `gracePeriodEndsAt`, refrescar `currentPeriodEnd`. |

**Máquina de estados** (`Subscription.status` refleja los estados de Stripe):

```
                  checkout completado
   (incomplete) ───────────────────────► trialing ──(trial termina, pago ok)──► active
        │                                    │                                     │
        │ (sin trial: pago inmediato)        │                                     │
        └────────────────────────────────────┴───────────────────────────────────►│
                                                                                    │
                              invoice.payment_failed                                │
   active ──────────────────────────────────────────────────────────────────────► past_due
        ▲                                                                           │
        │ invoice.payment_succeeded (reintento ok)                                  │
        └───────────────────────────────────────────────────────────────────────┐ │
                                                                                  │ │
   past_due ──(reintentos de Stripe agotados / cancelación)──► canceled ◄─────────┘ (gracia vencida)
        │                                                          ▲
        └──────────────────────────────────────────────────────────┘
   active/trialing ──(usuario cancela en Portal)──► cancelAtPeriodEnd=true
                              └─(llega currentPeriodEnd)─► canceled
```

Estados **operativos** (bot/panel funcionan): `trialing`, `active`, y
`past_due` **mientras** `now < gracePeriodEndsAt`.
Estados **bloqueados**: `incomplete`, `canceled`, `unpaid`, y `past_due`
**vencida la gracia**.

### 4.4 Periodo de gracia

Cuando un pago falla (`invoice.payment_failed`), el tenant pasa a `past_due`
pero **el bot sigue operando** durante `GRACE_DAYS` (config, recomendado 3 días).
Durante ese tiempo:
- La SPA muestra un **banner de aviso** ("tu pago falló, actualiza tu tarjeta").
- Stripe reintenta el cobro automáticamente (Smart Retries).
- Si un reintento tiene éxito → `invoice.payment_succeeded` → vuelve a `active`.
- Si vence `gracePeriodEndsAt` sin pago → el enforcement bloquea (§5) y se
  suspende el bot vía `TenantManager`.

---

## 5. Enforcement (bloqueo de panel/bot)

### 5.1 Helper de estado

Un único helper resuelve si un tenant está operativo:

```ts
// api/src/billing/access.ts
export function isTenantActive(sub: Subscription | null): boolean {
  if (!sub) return false;
  if (sub.status === 'active' || sub.status === 'trialing') return true;
  if (sub.status === 'past_due' && sub.gracePeriodEndsAt && new Date() < sub.gracePeriodEndsAt)
    return true;
  return false;
}
```

### 5.2 Middleware en la API (panel)

Un `preHandler` global (o un decorator `requireActiveSubscription`) se aplica a
**todas las rutas protegidas de negocio** (`jobs`, `contacts`, `usage`,
`settings`, `wa-status`), pero **NO** a:
- `/auth/*`, `/health`
- `/billing/*` (para que un tenant bloqueado pueda ir al Portal y pagar)

Comportamiento: tras `authenticate`, consulta la `Subscription` del
`request.tenantId`. Si `!isTenantActive(sub)` → responde
`402 Payment Required` con `{ error: 'subscription_inactive', portalHint: true }`.
La SPA intercepta el `402` y redirige a la pantalla de facturación.

> Rendimiento: cachear el estado de suscripción por `tenantId` en memoria con TTL
> corto (p.ej. 60 s) e invalidar al recibir webhooks, para no pegarle a la DB en
> cada request. Opcional en esta fase; aceptable empezar sin caché.

Para la **cancelación**: al cancelar en el Portal, Stripe deja la suscripción
activa hasta `currentPeriodEnd` (`cancelAtPeriodEnd=true`), y emite
`customer.subscription.deleted` al final. Así el acceso **se corta al fin del
periodo pagado**, no inmediatamente — cumpliendo el criterio de aceptación.

### 5.3 Suspensión del bot — conexión con el `TenantManager` (Fase 2)

El enforcement no solo bloquea el panel: **debe detener la operación del bot**.
La Fase 2 introduce el `TenantManager` con API en memoria
(`addTenant` / `removeTenant` / `getStatus(tenantId)`). Se extiende con:

```
suspendTenant(tenantId)   → cierra/pausa la conexión Baileys del tenant (no borra sesión)
resumeTenant(tenantId)    → re-vincula/reactiva la conexión
```

Disparadores:
- En el **webhook handler**, cuando una transición deja al tenant no-operativo
  (gracia vencida, `canceled`, `unpaid`), la API llama al endpoint interno del
  worker (`POST /internal/tenant/suspend`, protegido con `INTERNAL_API_TOKEN`,
  mismo patrón que `wa-status` en `api/src/routes/wa-status.ts`) para que el
  `TenantManager` ejecute `suspendTenant(tenantId)`.
- Cuando vuelve a `active`/`trialing` (`invoice.payment_succeeded` /
  `subscription.updated`), la API llama `POST /internal/tenant/resume`.

Mientras esté suspendido, el `TenantManager` **no procesa mensajes entrantes**
del tenant (no responde, no consume OpenRouter). La sesión Baileys **no se
borra** para permitir reactivación sin re-escanear QR. Como red de seguridad, el
`TenantManager` también puede consultar el estado de suscripción al arrancar cada
tenant y negarse a operar si está bloqueado (defensa en profundidad).

### 5.4 Allowlist / exención (tenants existentes y de soporte)

Para no romper a los 2 tenants iniciales del piloto (que existen sin
`Subscription`), un flag de tenant `billingExempt` (o un set por env
`BILLING_EXEMPT_TENANT_IDS`) hace que `isTenantActive` devuelva `true` sin
suscripción. Útil para cuentas internas/demos. Documentado como mecanismo
temporal de transición.

---

## 6. Pantalla de facturación en la SPA

Nueva vista `spa/src/pages/Billing.tsx` (ruta `/billing`), enlazada en la
navegación del panel.

**Contenido:**
- **Estado del plan:** badge con `status` legible (Activa / En prueba / Pago
  pendiente / Cancelada), nombre del plan, precio (display, desde `Plan`), y
  fecha de **próxima renovación / fin de periodo** (`currentPeriodEnd`).
- **Sin suscripción / bloqueado:** CTA **"Suscribirme"** → `POST /billing/checkout`
  → redirige a Stripe Checkout.
- **Con suscripción:** botón **"Gestionar facturación"** → `POST /billing/portal`
  → redirige al Customer Portal (cambiar tarjeta / cancelar / ver facturas).
- **Banner de aviso global** (en el layout, no solo en `/billing`): si
  `status === 'past_due'`, mostrar aviso de pago fallido + enlace al Portal,
  visible durante la gracia.
- **Interceptor `402`** en `spa/src/api/client.ts`: cualquier respuesta `402`
  redirige a `/billing` con un mensaje de "tu suscripción no está activa".

**Endpoint de lectura para la SPA:**
```
GET /billing/status              (auth requerido)
  → { status, planName, amountCents, currency, currentPeriodEnd,
      cancelAtPeriodEnd, gracePeriodEndsAt }
```
Lee del espejo local (`Subscription` + `Plan`), sin pegarle a Stripe en cada
carga. Patrón idéntico a `usageRoutes` (`api/src/routes/usage.ts`): handler con
`preHandler: app.authenticate`, filtrado por `request.tenantId`.

Estilos: reutilizar el design system existente de la SPA (igual que el resto de
vistas del MVP).

---

## 7. Variables de entorno nuevas

Se añaden a `api/src/env.ts` (siguiendo el patrón `requireEnv`) y al
`docker-compose.yml` del servicio `api`. **Solo el backend** ve las claves
secretas; la SPA nunca recibe claves de Stripe.

| Variable | Dónde | Descripción |
|---|---|---|
| `STRIPE_SECRET_KEY` | api | `sk_test_…` / `sk_live_…`. Clave secreta del SDK. **Nunca** en la SPA ni en logs. |
| `STRIPE_WEBHOOK_SECRET` | api | `whsec_…`. Para verificar la firma del webhook. Distinto por endpoint/entorno. |
| `STRIPE_PRICE_ID` | api | `price_…` del plan mensual. Espejo del seed de `Plan.stripePriceId` (o se lee de `Plan`). |
| `SPA_URL` | api | Base de la SPA para `success_url` / `cancel_url` / `return_url` (p.ej. `https://app.etherionlabs.com`). |
| `BILLING_GRACE_DAYS` | api | Días de gracia en `past_due` (default 3). |
| `BILLING_EXEMPT_TENANT_IDS` | api | Lista separada por comas de tenants exentos (piloto/soporte). Opcional. |

Notas:
- `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` son **secretos**: tratarlos como
  `JWT_SECRET` / `INTERNAL_API_TOKEN` (solo por env, fuera de logs y del repo).
- En la SPA **no** se necesita `STRIPE_PUBLISHABLE_KEY` porque Checkout/Portal son
  redirecciones server-side (no se monta Stripe.js en el cliente).
- `requireEnv('STRIPE_SECRET_KEY')` y `requireEnv('STRIPE_WEBHOOK_SECRET')` hacen
  que la API falle al arrancar si faltan (fail-fast, como el resto de `env.ts`).

---

## 8. Resumen de cambios por archivo

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | + `Plan`, `Subscription`, `StripeEvent`; + relación inversa en `Tenant`. Migración. |
| `api/src/env.ts` | + lectura de las vars de §7 (`requireEnv` para las secretas). |
| `api/src/server.ts` | + `app.register(billingRoutes)`; + decorator/preHandler `requireActiveSubscription`; raw-body parser solo para `/billing/webhook`. |
| `api/src/routes/billing.ts` | **nuevo**: `POST /billing/checkout`, `POST /billing/portal`, `GET /billing/status`, `POST /billing/webhook`. |
| `api/src/billing/access.ts` | **nuevo**: helper `isTenantActive`. |
| `api/src/billing/stripe.ts` | **nuevo**: cliente Stripe singleton. |
| Worker / `TenantManager` (Fase 2) | + `suspendTenant`/`resumeTenant` y endpoints internos `/internal/tenant/suspend|resume`. |
| `spa/src/pages/Billing.tsx` | **nuevo**: estado del plan + enlaces a Checkout/Portal. |
| `spa/src/api/client.ts` | + interceptor `402` → redirige a `/billing`. |
| `docker-compose.yml` | + vars de Stripe en el servicio `api`. |

---

## 9. Pruebas

- **Webhook firmado e idempotente:** test que envía un evento con firma válida
  (usando `stripe.webhooks.generateTestHeaderString`) y verifica el cambio de
  estado; reenviar el **mismo `event.id`** y verificar que **no** se reprocesa.
  Firma inválida → `400`.
- **Máquina de estados:** simular `checkout.session.completed` → `active`;
  `invoice.payment_failed` → `past_due` + `gracePeriodEndsAt`;
  `customer.subscription.deleted` → `canceled`.
- **Enforcement:** request a `/jobs` con `Subscription` `canceled` → `402`;
  con `trialing`/`active` → `200`; `past_due` dentro de gracia → `200`, fuera de
  gracia → `402`. `/billing/*` accesibles aun bloqueado.
- **Suspensión del bot:** verificar que la transición a bloqueado llama al
  endpoint interno de suspensión (mock del worker, patrón `fetcher` inyectable
  igual que `waStatusRoutes`).
- **E2E manual (modo test):** suscribirse con la tarjeta de prueba `4242…`,
  confirmar `active`; forzar fallo con tarjeta de fallo de pago, confirmar
  `past_due` → corte tras gracia; cancelar en el Portal, confirmar corte al fin
  de periodo. Stripe CLI (`stripe listen --forward-to`) para webhooks locales.

---

## Criterios de aceptación

- [ ] Existen los modelos `Plan` y `Subscription` (+ `StripeEvent`) con migración
      Prisma aplicada y relación 1-a-1 con `Tenant`.
- [ ] Un cliente puede suscribirse con tarjeta real (modo test) vía Checkout y la
      `Subscription` queda `active` (o `trialing` si hay trial).
- [ ] El cliente puede abrir el Customer Portal desde la SPA y cambiar tarjeta /
      cancelar.
- [ ] El endpoint de webhook **verifica la firma** (rechaza firmas inválidas con
      `400`) y es **idempotente** (reenvío del mismo `event.id` no reprocesa) —
      cubierto por test.
- [ ] Falla de pago → `past_due`; tras el periodo de gracia, el bot deja de
      operar (vía `TenantManager`) y se avisa al cliente.
- [ ] Cancelación desde el Portal refleja `canceled` y corta el acceso **al fin
      del periodo pagado**, no antes.
- [ ] El middleware bloquea panel/bot cuando la suscripción no está
      `active`/`trialing` (ni en gracia), devolviendo `402`, salvo `/billing/*`,
      `/auth/*` y `/health`.
- [ ] La SPA muestra el estado del plan, banner de aviso en `past_due`, y enlaces
      a Checkout/Portal; intercepta `402` y redirige a facturación.
- [ ] Las claves de Stripe viven solo en el backend, fuera de logs y del repo; la
      API falla al arrancar si faltan las secretas.

---

## Decisiones abiertas

> **Bloqueadas a definición del dueño.** Ninguna impide diseñar/implementar la
> mecánica; solo configuran valores concretos.

1. **Monto e intervalo del plan** — precio exacto y confirmación de intervalo
   mensual (vs. opción anual). Necesario para crear el `Product`/`Price` en
   Stripe y poblar `Plan`. *(Roadmap, decisión abierta #4.)*
2. **Mercado / moneda / impuestos** — país objetivo inicial → define `currency`,
   si se activa **Stripe Tax** (IVA/sales tax) y los requisitos fiscales/legales
   asociados. *(Roadmap, decisión abierta #5.)*
3. **Trial: ¿con o sin tarjeta?** — recomendación: **trial corto (p.ej. 7 días)
   con tarjeta requerida** (`payment_method_collection: 'always'` + `trialDays`),
   por menor fraude y mejor conversión. Pendiente confirmar duración y si se
   exige tarjeta. *(Roadmap, decisión abierta #3.)*
4. **Días de periodo de gracia** en `past_due` (default propuesto: 3). Trade-off
   entre tolerancia al cliente y costo de operar impago.
5. **Aviso de pago por e-mail** — el disparo en `invoice.payment_failed` deja un
   hook; el proveedor de e-mail transaccional (Postmark/Resend/SES) y el copy se
   definen en la Fase 6. ¿Se quiere un MVP de aviso ya en esta fase?
6. **Límites del plan (`maxContacts` / `maxJobsMonth`)** — ¿se enforced en esta
   fase o se dejan como informativos? Recomendación: informativos ahora, enforce
   más adelante.
