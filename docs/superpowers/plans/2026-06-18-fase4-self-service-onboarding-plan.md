# Plan Fase 4 — Onboarding self-service — Plan de implementación

> **Para workers agénticos:** SUB-SKILL REQUERIDA: usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan sintaxis de checkbox (`- [ ]`) para seguimiento.

**Objetivo:** Reemplazar el alta manual por terminal (`api/src/cli/create-user.ts`) por un flujo público end-to-end en el que un negocio se registra, verifica su email, paga (Stripe), su tenant se aprovisiona solo (`TenantManager`, Fase 2), su plantilla de industria se copia a `TenantSettings`, y un wizard reanudable en la SPA lo lleva de "signup" a "bot vinculado y respondiendo" sin que el operador toque nada. Cierra la brecha 6 del roadmap ("Sin signup").

**Arquitectura:** El backend añade rutas hermanas de `/auth/login` en `api/src/routes/auth.ts` (signup, verify-email, resend, onboarding) más un `EmailService` (`api/src/email/`), un `TemplateLoader` (`api/src/onboarding/templates.ts`) y un orquestador de provisioning (`api/src/onboarding/provision.ts`). El estado del onboarding **vive en el servidor** (`Tenant.status`, `Tenant.onboarding`, `Subscription.status`, `wa-status`) para que el wizard sea reanudable: la SPA deriva el paso pendiente, nunca lo guarda solo en el cliente. La SPA añade `/signup` y `/verify-email` (públicos, paralelos a `/login`) y `/onboarding` (protegido). El disco (`profiles/<industria>/`) pasa a ser **plantilla semilla read-only**; la instancia editable vive en `TenantSettings`.

**Tech Stack:** API Fastify 5 + `@fastify/jwt` + `@fastify/rate-limit` (Fase 1) + zod + bcryptjs; Prisma 7.8 + `@prisma/adapter-pg` + PostgreSQL 16; Stripe SDK + webhooks (Fase 3); proveedor de email transaccional (Resend/Postmark/SES); SPA React + react-router-dom; vitest.

**Bandera de lanzamiento:** Todo el flujo soporta `TRIAL_REQUIRES_CARD` (decisión §8 del diseño). La única diferencia es **qué evento dispara `addTenant`**: webhook `checkout.session.completed` (tarjeta requerida, default recomendado) vs. verificación de email (trial sin tarjeta). El código no debe ramificar más allá de ese punto.

---

## Dependencias de fases previas (NO empezar sin ellas verdes)

Esta fase es **pegamento**: integra lo que las Fases 1–3 dejan listo. Si una no está completa, esta fase queda a medias por diseño (spec §2).

| Depende de | Qué debe estar listo (verificado contra el código actual) | Bloquea a las tareas |
|------------|-----------------------------------------------------------|----------------------|
| **Fase 1 — Hardening** | Identidad por **email global único** en `PanelUser` (hoy `prisma/schema.prisma:28` usa `username` con `@@unique([tenantId, username])`, y `auth.ts:15` hace `findFirst({ where: { username } })` — inseguro y colisiona en multi-tenant). JWT en cookie `HttpOnly`. `@fastify/rate-limit` registrado. Recuperación de contraseña por email (reutiliza el `EmailService`). Política mínima de password. | Tareas 1, 2, 3 |
| **Fase 2 — Multi-tenancy real** | `TenantManager.addTenant(tenantId)` / `removeTenant` / `getStatus` en caliente (sin tocar `docker-compose.yml`). Tabla **`TenantSettings`** editable por UI (hoy la config vive en disco vía `profileDir`: `tenant-profile.ts`, `settings.ts`, que aún leen/escriben `profiles/<x>/*.json`). `GET /wa-status` ruteado por `tenantId` (hoy `wa-status.ts` apunta a un único `WORKER_INTERNAL_URL`). | Tareas 4, 5, 6, 9 |
| **Fase 3 — Billing** | Stripe Checkout + Customer Portal; webhooks idempotentes (`checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed`); tablas `Plan`/`Subscription`; middleware de enforcement por estado de suscripción. | Tareas 3, 4, 8 |

> **Nota de reconciliación (diseño vs. schema real):** el `prisma/schema.prisma` actual NO tiene `Tenant.status`, `Tenant.onboarding`, `EmailVerification`, ni `email`/`Subscription`. La Tarea 1 los añade de forma **aditiva**. `Tenant.profileDir` (`schema.prisma:14`) sigue existiendo pero deja de ser config viva (se pone `''` en signup) — su retiro definitivo es deuda de Fase 2.

---

## Orden de tareas y agrupación

```
Grupo A · Modelo de datos          → Tarea 1
Grupo B · POST /auth/signup        → Tareas 2, 3        (signup transaccional + anti-abuso)
Grupo C · Verificación de email    → Tareas 4, 5        (EmailService + token + envío)
Grupo D · Stripe + provisioning    → Tareas 6, 7        (Checkout/webhook + TenantManager idempotente)
Grupo E · Plantillas por industria → Tareas 8, 9        (profiles/ → TenantSettings)
Grupo F · Wizard SPA reanudable    → Tareas 10, 11, 12  (estado server + wizard + QR/prueba/checklist)
Grupo G · E2E + cierre             → Tarea 13
```

Las tareas están **ordenadas**: cada una deja el árbol compilando y los tests verdes antes de la siguiente. Backend (1–9) antes que SPA (10–12); E2E (13) al final.

---

### Tarea 1: Migración de datos — `Tenant.status`, `Tenant.onboarding`, `EmailVerification`

**Grupo A. Objetivo:** dejar el modelo listo para todo el flujo, de forma aditiva, sin romper tests existentes.

**Dependencias:** Fase 1 (campo `email` en `PanelUser`), Fase 3 (`Subscription` ya creada). Si `Subscription` no existe aún, esta tarea no la crea — la asume de Fase 3.

**Archivos:**
- Modificar: `prisma/schema.prisma`
- Crear: `prisma/migrations/<timestamp>_fase4_onboarding/migration.sql` (generada)
- Modificar: `tests/helpers/db.ts` (limpieza de las tablas nuevas)
- Crear: `tests/services/onboarding-model.test.ts`

**Cambios (descritos):**
- En `model Tenant` (tras `createdAt`, `schema.prisma:15`): añadir
  - `status String @default("pending_verification")` — valores: `pending_verification | verified | provisioning | active | suspended`.
  - `onboarding Json?` — `{ step, businessDone, welcomeDone, schemaDone, whatsappLinked, testDone, completed }`.
  - relación `emailVerifications EmailVerification[]`.
- Nuevo modelo `EmailVerification` (id uuid, `tenantId`, `email`, `token @unique`, `verifiedAt DateTime?`, `expiresAt`, `createdAt`, relación a `Tenant`).
- `PanelUser`: confirmar que Fase 1 ya añadió `email String @unique`. Si la Fase 1 migró `username`→`email`, esta tarea **no** lo vuelve a hacer; solo lo asume.
- En `tests/helpers/db.ts` `cleanupDb()`: añadir `await testPrisma.emailVerification.deleteMany();` antes de borrar `tenant`.

**Verificación (tests):**
- `tests/services/onboarding-model.test.ts`: crear un `Tenant` con `status` default `pending_verification`; crear un `EmailVerification` con token único y `expiresAt` futuro; verificar el `@unique` del token (segundo insert con el mismo token → error).
- `npx prisma migrate dev --name fase4_onboarding` aplica limpio.
- `npm test && npm run typecheck` verde (las tablas nuevas son aditivas; nada existente cambia).

---

### Tarea 2: `POST /auth/signup` transaccional (Tenant + PanelUser + EmailVerification)

**Grupo B. Objetivo:** alta atómica pública que reemplaza `create-user.ts`. O se crean los tres registros, o ninguno.

**Dependencias:** Tarea 1 (modelo). Fase 1 (email como identidad, política de password). El `create-user.ts` se **conserva** como herramienta de operador (no se borra).

**Archivos:**
- Modificar: `api/src/routes/auth.ts` (añadir ruta hermana de `/auth/login`)
- Crear: `api/src/lib/slug.ts` (slug único)
- Crear: `api/src/lib/tokens.ts` (`randomToken()`, `in24h()`)
- Crear: `tests/api/signup.test.ts`

**Cambios (descritos):**
- `SignupZ = z.object({ email: z.string().email(), password: <política Fase 1>, businessName: z.string().min(1).max(120), industry: z.enum(['tapiceria','paqueteria','generico']) })` (mismo estilo que `LoginZ`, `auth.ts:6`).
- Handler `POST /auth/signup`:
  1. `safeParse` → 400 con error zod.
  2. `uniqueSlug(businessName)` (slugify + sufijo si colisiona contra `Tenant.slug @unique`).
  3. `passwordHash = await bcrypt.hash(password, 10)` (consistente con `create-user.ts:15`).
  4. `prisma.$transaction`: crear `Tenant` (`slug`, `name: businessName`, `industry`, `profileDir: ''`, `status: 'pending_verification'`), luego `PanelUser` (`tenantId`, `email`, `passwordHash`, `role: 'admin'`), luego `EmailVerification` (`token: randomToken()`, `expiresAt: in24h()`).
  5. Capturar violación de único de email → `409 { error: 'email ya registrado' }` (sin filtrar de más).
  6. Respuesta `201 { tenantId, status: 'pending_verification' }`.
- El **envío** del correo se hace en la Tarea 4 (aquí solo se crea el registro `EmailVerification`); por ahora, dejar un punto de extensión (`await emailService.sendVerification(...)` se inyecta en Tarea 4).

**Verificación (tests):**
- `tests/api/signup.test.ts` (vía `app.inject`): 201 crea Tenant+PanelUser+EmailVerification (assertar los tres en DB); email duplicado → 409 y **sin** tenant huérfano (probar atomicidad: forzar fallo del segundo insert y verificar rollback del Tenant); body inválido → 400; industry fuera del enum → 400.
- `npm test && npm run typecheck` verde.

---

### Tarea 3: Anti-abuso en signup — rate-limit + email único + password

**Grupo B. Objetivo:** defensa contra registro masivo automatizado y enumeración de emails.

**Dependencias:** Tarea 2. Fase 1 (`@fastify/rate-limit` ya registrado en `server.ts`).

**Archivos:**
- Modificar: `api/src/routes/auth.ts` (config de rate-limit por ruta)
- Modificar: `api/src/server.ts` (registrar `@fastify/rate-limit` si Fase 1 no lo dejó global)
- Modificar: `tests/api/signup.test.ts` (casos de límite)

**Cambios (descritos):**
- Rate-limit dedicado en `/auth/signup` por IP (p. ej. `max: 5, timeWindow: '1 hour'`) usando la config por-ruta de `@fastify/rate-limit`. Mismo tratamiento se reutilizará en `/auth/resend-verification` (Tarea 4).
- Email único global: ya garantizado por `@unique` (Fase 1) + manejo 409 (Tarea 2). Confirmar que el 409 no revela información más allá de "email ya registrado".
- Password: validar política mínima de Fase 1 dentro de `SignupZ`.
- **CAPTCHA**: decisión abierta (§10.2 del diseño) — dejar un hook opcional (`if (process.env.SIGNUP_CAPTCHA) ...`) sin implementar el proveedor; no bloquea.

**Verificación (tests):**
- 6.º signup desde la misma IP en la ventana → `429`.
- El rate-limit no afecta a `/auth/login` (límites independientes).
- `npm test` verde.

---

### Tarea 4: `EmailService` + envío de verificación y bienvenida

**Grupo C. Objetivo:** introducir el proveedor de email transaccional con plantillas, reutilizable por la recuperación de contraseña de Fase 1.

**Dependencias:** Tarea 2 (registro `EmailVerification` ya creado en signup).

**Archivos:**
- Crear: `api/src/email/service.ts` (interfaz `EmailService` + impl. del proveedor)
- Crear: `api/src/email/templates.ts` (verificación, bienvenida, reenvío)
- Modificar: `api/src/env.ts` (`EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `PUBLIC_APP_URL`)
- Modificar: `api/src/routes/auth.ts` (inyectar `emailService.sendVerification` en el signup de la Tarea 2)
- Crear: `tests/api/email-service.test.ts`

**Cambios (descritos):**
- Interfaz `EmailService { sendVerification(email, token), sendWelcome(email, businessName) }`. Impl. concreta (Resend/Postmark/SES) detrás de la interfaz; en tests se inyecta un **fake** que captura los envíos (sin red).
- Plantilla de verificación: enlace `${PUBLIC_APP_URL}/verify-email?token=<token>`.
- Inyección: `buildServer` pasa el `emailService` a `authRoutes` (igual que `fetcher` se pasa a `waStatusRoutes` en `server.ts:51`); en tests se inyecta el fake.

**Verificación (tests):**
- Signup dispara exactamente un `sendVerification` con el token persistido (assertar contra el fake).
- El `EmailService` real no se invoca en tests (inyección del fake).
- `npm test && npm run typecheck` verde.

---

### Tarea 5: Verificación de email — `GET /auth/verify-email` + `POST /auth/resend-verification`

**Grupo C. Objetivo:** token de un solo uso con expiración; verificar es **obligatorio** antes de aprovisionar/operar (criterio del roadmap).

**Dependencias:** Tareas 2 y 4.

**Archivos:**
- Modificar: `api/src/routes/auth.ts`
- Modificar: `tests/api/signup.test.ts` o crear `tests/api/verify-email.test.ts`

**Cambios (descritos):**
- `GET /auth/verify-email?token=<token>`:
  - Buscar `EmailVerification` por `token`; si no existe / `verifiedAt != null` / `expiresAt < now` → 400.
  - Marcar `verifiedAt = now`; `Tenant.status: 'pending_verification' → 'verified'`.
  - Disparar el siguiente paso según `TRIAL_REQUIRES_CARD`: si **sin tarjeta**, encolar provisioning (Tarea 7); si **con tarjeta**, no hace nada aquí (lo dispara el webhook de Checkout).
- `POST /auth/resend-verification { email }`: rate-limited (reutiliza la config de la Tarea 3); invalida tokens previos y crea uno nuevo; responde 200 genérico (no revela si el email existe).

**Verificación (tests):**
- Token válido → 200 y `Tenant.status === 'verified'`.
- Token expirado / ya usado / inexistente → 400.
- Reenvío crea token nuevo y respeta el rate-limit.
- En modo `TRIAL_REQUIRES_CARD=false`, verificar dispara el provisioning (assertar el spy de `addTenant` de la Tarea 7).
- `npm test` verde.

---

### Tarea 6: Integración con Stripe — orden de trial (con/sin tarjeta)

**Grupo D. Objetivo:** enganchar el paso de pago del onboarding a Stripe Checkout y dejar el provisioning disparado por el evento correcto según `TRIAL_REQUIRES_CARD`.

**Dependencias:** Fase 3 (Checkout, webhooks idempotentes, `Subscription`). Tarea 5.

**Archivos:**
- Modificar: `api/src/routes/` (la ruta de Checkout y el handler de webhooks de Fase 3; aquí solo se engancha el provisioning)
- Crear: `api/src/onboarding/provision.ts` (orquestador; impl. real en Tarea 7)
- Crear: `tests/api/onboarding-stripe.test.ts`

**Cambios (descritos):**
- `TRIAL_REQUIRES_CARD=true` (default recomendado): el wizard redirige a Stripe Checkout **antes** del provisioning. El webhook `checkout.session.completed` (verificado por firma, idempotente — Fase 3) llama `provisionTenant(tenantId)` (Tarea 7). `Subscription.status` inicial: `trialing` con método de pago en archivo.
- `TRIAL_REQUIRES_CARD=false`: el Checkout se difiere; el provisioning lo dispara la verificación de email (Tarea 5). `Subscription.status: trialing` sin método de pago.
- **Idempotencia (crítico):** el webhook puede llegar dos veces; `provisionTenant` debe ser idempotente (Tarea 7). No duplicar provisioning si `Tenant.status` ya es `provisioning`/`active`.

**Verificación (tests):**
- Con `TRIAL_REQUIRES_CARD=true`: simular `checkout.session.completed` → llama `provisionTenant` una vez; segundo evento idéntico → no re-aprovisiona (assertar 1 sola llamada).
- Con `TRIAL_REQUIRES_CARD=false`: el webhook no es la vía; la verificación de email sí.
- `npm test` verde.

---

### Tarea 7: Aprovisionamiento automático vía `TenantManager` (idempotente)

**Grupo D. Objetivo:** `provisionTenant(tenantId)` crea la conexión Baileys en caliente vía `TenantManager.addTenant` (Fase 2), sin editar `docker-compose.yml` ni reiniciar.

**Dependencias:** Fase 2 (`TenantManager.addTenant/getStatus`). Tarea 6.

**Archivos:**
- Modificar/crear: `api/src/onboarding/provision.ts`
- Crear: `tests/api/provision.test.ts`

**Cambios (descritos):**
- `provisionTenant(tenantId)`:
  1. Guard: si `Tenant.status` ∈ {`provisioning`,`active`} → no-op (idempotencia ante webhooks duplicados).
  2. Precondición: `Tenant.status === 'verified'` (email verificado obligatorio); si no, abortar.
  3. Copiar plantilla de industria a `TenantSettings` (Tarea 8 — llamar `TemplateLoader`).
  4. `Tenant.status → 'provisioning'`; `TenantManager.addTenant(tenantId)` (en caliente).
  5. Al confirmar la conexión: `Tenant.status → 'active'`.
- `addTenant` debe ser idempotente en sí (Fase 2): si la conexión ya existe, no duplica.

**Verificación (tests):**
- `provisionTenant` sobre tenant `verified` → llama `addTenant` una vez y `status === 'active'` (con fake de `TenantManager`).
- Segunda llamada (webhook duplicado) → no llama `addTenant` de nuevo.
- Tenant no verificado → no aprovisiona.
- `npm test && npm run typecheck` verde.

---

### Tarea 8: `TemplateLoader` — copiar plantilla de industria a `TenantSettings`

**Grupo E. Objetivo:** la `industry` del signup selecciona una plantilla semilla read-only de `profiles/<industria>/` y se **escribe una copia** en `TenantSettings`, con `{{businessName}}`/`{{businessDomain}}` sustituidos. El disco es la plantilla; la DB es la instancia.

**Dependencias:** Fase 2 (`TenantSettings` editable por UI). Tarea 7 (la llama durante el provisioning).

**Archivos:**
- Crear: `api/src/onboarding/templates.ts` (`TemplateLoader`)
- Crear: `profiles/paqueteria/` y `profiles/generico/` (hoy solo existe `profiles/tapiceria/` con `intake-schema.json`, `welcome.txt`, `business-facts.json`, `prompt-vars.json`) — decisión abierta §10.3; crear al menos `generico` para no bloquear.
- Crear: `tests/api/templates.test.ts`

**Cambios (descritos):**
- `TemplateLoader.seedTenantSettings(tenantId, industry, { businessName, businessDomain })`:
  1. Leer los cuatro archivos de `profiles/<industry>/`.
  2. Sustituir `{{businessName}}` (en `welcome.txt`) y `{{businessDomain}}` por los datos del signup.
  3. Escribir la copia en `TenantSettings` (NO en disco) vía la API de `TenantSettings` de Fase 2.
- A partir de aquí el wizard (Tarea 11, pasos 4–6) y la pantalla `Settings` existente editan la copia en DB, nunca el archivo de disco. **Nota:** `settings.ts` y `tenant-profile.ts` hoy leen/escriben disco vía `profileDir`; su migración a `TenantSettings` es de Fase 2 — esta tarea **asume** esa API disponible.

**Verificación (tests):**
- Para `industry: 'tapiceria'`, `seedTenantSettings` carga las secciones de `intake-schema.json` (cliente/trabajo/especificaciones/logística) en `TenantSettings`.
- `{{businessName}}` queda sustituido en el welcome.
- Industria inexistente → error claro.
- `npm test` verde.

---

### Tarea 9: Endpoints de onboarding — estado reanudable en el servidor

**Grupo E/F (puente). Objetivo:** exponer el estado server-side del que la SPA deriva el paso pendiente, y los PATCH que persisten la config del wizard en `TenantSettings`.

**Dependencias:** Tareas 1, 7, 8. Fase 2 (`TenantSettings`, `wa-status` por tenant). Fase 3 (`Subscription.status`).

**Archivos:**
- Crear: `api/src/routes/onboarding.ts`
- Modificar: `api/src/server.ts` (registrar `onboardingRoutes`)
- Crear: `tests/api/onboarding-state.test.ts`

**Cambios (descritos):**
- `GET /onboarding/state` (protegido): devuelve `{ step, tenantStatus, subStatus, flags }` derivando el primer paso incompleto de `Tenant.status` + `Subscription.status` + `Tenant.onboarding` + `wa-status` (la SPA salta a `step`).
- `PATCH /onboarding/business` → guarda facts en `TenantSettings`; marca `onboarding.businessDone`.
- `PATCH /onboarding/welcome` → guarda welcome; `onboarding.welcomeDone`.
- `PATCH /onboarding/schema` → guarda intake-schema; `onboarding.schemaDone`.
- `POST /onboarding/complete` → `onboarding.completed = true`.
- Todos protegidos por `app.authenticate` (`server.ts:34`) y `tenantId` del JWT.

**Verificación (tests):**
- Tenant `pending_verification` → `state.step` = verificar email.
- Tenant `active` con `whatsappLinked` pero sin `testDone` → `state.step` = mensaje de prueba (reanudabilidad: salta al primer incompleto).
- Cada PATCH persiste en `TenantSettings` y actualiza el flag de `onboarding`.
- `npm test && npm run typecheck` verde.

---

### Tarea 10: SPA — pantallas públicas `/signup` y `/verify-email`

**Grupo F. Objetivo:** signup público (paralelo a `/login`) y landing del enlace de verificación.

**Dependencias:** Tareas 2, 5. SPA: `Login.tsx`, `App.tsx`, `AuthContext.tsx`, `api/client.ts`.

**Archivos:**
- Crear: `spa/src/pages/Signup.tsx` (gemela de `Login.tsx`, con email + password + nombre del negocio + selector de industria)
- Crear: `spa/src/pages/VerifyEmail.tsx`
- Modificar: `spa/src/App.tsx` (rutas públicas fuera de `ProtectedRoute`, junto a `/login` — `App.tsx:17`)
- Modificar: `spa/src/api/client.ts` (`signup`, `verifyEmail`, `resendVerification`)
- Crear: `spa/src/pages/Signup.test.tsx`, `spa/src/pages/VerifyEmail.test.tsx`

**Cambios (descritos):**
- `Signup.tsx`: 4 campos; tras `201`, estado "revisa tu correo". Reutiliza `ApiError` (`api/client.ts:3`) y el estilo de `Login.tsx`.
- `VerifyEmail.tsx`: lee `?token` de la URL, llama `api.verifyEmail(token)`, muestra éxito/error, CTA a continuar (login → `/onboarding`).
- `App.tsx`: añadir `<Route path="/signup" .../>` y `<Route path="/verify-email" .../>` **fuera** del `ProtectedRoute` (igual que `/login`).
- `api/client.ts`: añadir `signup`, `verifyEmail`, `resendVerification` (mismo patrón que `login`, `api/client.ts:28`).

**Verificación (tests):**
- `Signup.test.tsx`: submit válido → muestra "revisa tu correo"; 409 → muestra "email ya registrado".
- `VerifyEmail.test.tsx`: token válido → mensaje de éxito; token inválido → error.
- `npm test` (vitest SPA) verde.

---

### Tarea 11: SPA — wizard multi-paso reanudable (`/onboarding`)

**Grupo F. Objetivo:** host del wizard protegido que, al cargar, pide `GET /onboarding/state` y **salta al primer paso incompleto**.

**Dependencias:** Tarea 9 (endpoints de estado), Tarea 10 (signup). SPA: `App.tsx`, `ProtectedRoute.tsx`.

**Archivos:**
- Crear: `spa/src/pages/Onboarding.tsx` (host + router de pasos)
- Crear: `spa/src/components/onboarding/` (un componente por paso 1–9)
- Modificar: `spa/src/App.tsx` (`<Route path="/onboarding" .../>` dentro de `ProtectedRoute`)
- Modificar: `spa/src/api/client.ts` (`getOnboardingState`, `patchBusiness`, `patchWelcome`, `patchSchema`, `completeOnboarding`)
- Crear: `spa/src/pages/Onboarding.test.tsx`

**Cambios (descritos):**
- Pasos (según diseño §5.2): 1 verificar email · 2 suscripción (redirige a Checkout o se salta sin tarjeta) · 3 aprovisionar ("preparando tu bot…", poll hasta `active`) · 4 negocio (facts) · 5 bienvenida · 6 schema de intake (plantilla precargada, editable) · 7 vincular WhatsApp (QR) · 8 mensaje de prueba · 9 checklist.
- Reanudabilidad: el paso pendiente se **deriva del servidor** (`GET /onboarding/state`), nunca solo del cliente. Al volver, entra directo al primer incompleto.
- Pasos 4–6 hacen los PATCH de la Tarea 9 (escriben en `TenantSettings`).

**Verificación (tests):**
- `Onboarding.test.tsx`: con `state.step = 4`, renderiza el paso "negocio" directamente (reanuda); guardar negocio llama `patchBusiness`.
- Con `state.step = 1`, renderiza "verificar email".
- `npm test` (SPA) verde.

---

### Tarea 12: SPA — pasos QR + mensaje de prueba + checklist "listo para operar"

**Grupo F. Objetivo:** cerrar el wizard con el QR del tenant correcto, la confirmación de un mensaje de prueba ida/vuelta, y el checklist final.

**Dependencias:** Tarea 11. Fase 2 (`GET /wa-status` ruteado por `tenantId`). SPA: `WhatsApp.tsx` (ya consume `getWaStatus`, `api/client.ts:52`).

**Archivos:**
- Crear/modificar: `spa/src/components/onboarding/StepWhatsApp.tsx`, `StepTestMessage.tsx`, `StepChecklist.tsx`
- Modificar: `spa/src/api/client.ts` (reutiliza `getWaStatus`; poll hasta `connected: true`)
- Crear: tests de los tres pasos

**Cambios (descritos):**
- **Paso 7 (QR):** reutiliza el patrón de `WhatsApp.tsx` (`api.getWaStatus()` → muestra `qr` hasta `connected: true`). El QR es del tenant del JWT (Fase 2 lo rutea por `tenantId`). Marca `onboarding.whatsappLinked`.
- **Paso 8 (mensaje de prueba):** guía al usuario a mandar un WhatsApp a su bot (o botón "enviar prueba"); confirma ida y vuelta. Marca `onboarding.testDone`.
- **Paso 9 (checklist):** resumen visual de hitos — email verificado, suscripción activa/trial, bot vinculado, configuración guardada, prueba exitosa. `POST /onboarding/complete` → CTA al dashboard.

**Verificación (tests):**
- Paso QR: `connected: false` muestra QR; `connected: true` avanza.
- Paso prueba: confirmación marca `testDone`.
- Checklist refleja los 5 hitos; complete redirige al dashboard.
- `npm test` (SPA) verde.

---

### Tarea 13: E2E del flujo completo + cierre

**Grupo G. Objetivo:** probar end-to-end que un usuario nuevo llega de signup a "bot vinculado y respondiendo" sin intervención del operador (criterio del roadmap).

**Dependencias:** Todas las anteriores.

**Archivos:**
- Crear: `tests/api/onboarding-e2e.test.ts` (o test de integración existente)
- Modificar: `docs/ROADMAP-PRODUCCION.md` (marcar criterios de Fase 4) — solo si se pide explícitamente

**Cambios (descritos):**
- Test que encadena (con fakes de email, Stripe y `TenantManager`): signup → verify-email → (Checkout webhook | provisioning directo según bandera) → `provisionTenant` → `TenantSettings` sembrado → `GET /onboarding/state` recorre los pasos hasta `completed`.
- Ejecutar con `TRIAL_REQUIRES_CARD` en ambos valores.

**Verificación (tests):**
- Flujo completo verde en ambos modos de bandera.
- `npm test && npm run typecheck` (API y SPA) verde.

---

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| **Fases 1–3 incompletas.** El signup asume `email @unique` (F1), `TenantManager.addTenant`/`TenantSettings` (F2) y `Subscription`/webhooks (F3). Sin ellas la fase queda a medias por diseño. | No empezar Tareas 2+/4+/6+ hasta que la fase correspondiente esté verde. La Tarea 1 (aditiva) sí puede ir antes. |
| **Webhook de Stripe duplicado** aprovisiona dos veces (doble conexión Baileys). | `provisionTenant` idempotente (guard por `Tenant.status`); `addTenant` idempotente (Fase 2). Tarea 7 lo testea explícitamente. |
| **Registros basura** en trial sin tarjeta consumen conexiones Baileys. | Rate-limit (Tarea 3) + verificación de email obligatoria + (a futuro) límite de tenants en trial. Default recomendado: `TRIAL_REQUIRES_CARD=true`. |
| **Config en dos sitios** (disco `profileDir` vs. `TenantSettings`). Hoy `settings.ts`/`tenant-profile.ts` aún escriben disco. | El `TemplateLoader` escribe solo `TenantSettings`; el wizard edita solo la copia DB. El retiro de `profileDir` es deuda de Fase 2; documentarlo, no bloquear. |
| **Enumeración de emails** en 409/resend. | 409 genérico; resend responde 200 sin revelar existencia. |
| **Provisioning huérfano si el pago falla justo después** (`invoice.payment_failed`). | Coordinar con enforcement de Fase 3: `removeTenant` tras periodo de gracia (decisión abierta §10.6). No resolver aquí; dejar el hook. |
| **Plantillas faltantes** (`paqueteria`/`generico` no existen). | Tarea 8 crea al menos `generico`. Decisión abierta §10.3: lanzar solo con industrias con demanda real. |
| **Wizard no reanudable** si se guarda estado solo en cliente. | Estado derivado del servidor (`GET /onboarding/state`); el cliente nunca es la fuente de verdad. |

---

## Checklist final (criterios de aceptación, diseño §9 + roadmap)

- [ ] Un usuario nuevo, sin que el operador toque nada, llega de signup a "bot vinculado y respondiendo" en staging.
- [ ] `POST /auth/signup` crea `Tenant` + `PanelUser` admin **transaccionalmente** (o ambos, o ninguno) con validación zod.
- [ ] Email verificado **obligatorio** antes de aprovisionar/operar; token de un solo uso con expiración (24 h).
- [ ] Rate-limit activo en `/auth/signup` y `/auth/resend-verification`.
- [ ] El aprovisionamiento llama `TenantManager.addTenant(tenantId)` sin editar `docker-compose.yml` ni reiniciar; **idempotente** ante webhooks duplicados.
- [ ] La plantilla de la industria elegida se **precarga en `TenantSettings`** (schema, bienvenida, facts) con `{{businessName}}` sustituido; el wizard edita la copia, no el disco.
- [ ] El wizard es **reanudable**: al volver, salta al primer paso incompleto según `Tenant.status` + `Subscription.status` + `Tenant.onboarding` + `wa-status`.
- [ ] La SPA muestra el QR del tenant correcto (`GET /wa-status` ruteado por `tenantId`) y confirma un **mensaje de prueba** ida y vuelta.
- [ ] El checklist "listo para operar" refleja: email verificado, suscripción activa/trial, bot vinculado, configuración guardada, prueba exitosa.
- [ ] Proveedor de email transaccional integrado (verificación + bienvenida), reutilizable por la recuperación de contraseña de Fase 1.
- [ ] Bandera `TRIAL_REQUIRES_CARD` soporta ambos órdenes (tarjeta requerida vs. trial sin tarjeta) con el default de lanzamiento elegido.
- [ ] `npm test && npm run typecheck` verde en API y SPA.
```
