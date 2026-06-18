# Fase 4 — Onboarding self-service — Diseño

**Fecha:** 2026-06-18
**Estado:** Propuesta para implementación
**Roadmap:** Fase 4 de `docs/ROADMAP-PRODUCCION.md` (cierra la brecha 6: "Sin signup")

---

## 1. Objetivo

Que un negocio se registre, pague y tenga su bot de WhatsApp **funcionando sin
intervención manual del operador**. Hoy el alta es un comando de terminal
(`api:create-user`, `api/src/cli/create-user.ts`) que asume que el `Tenant` ya
existe; esta fase reemplaza ese proceso por un flujo público end-to-end:

```
signup → verificación de email → suscripción (Stripe) → aprovisionamiento
automático (TenantManager) → wizard de configuración → QR de WhatsApp →
mensaje de prueba → "listo para operar"
```

La pregunta que guía cada decisión es: **"¿esto permite que un dueño llegue solo
de la landing al bot vinculado, sin que toquemos nada?"**.

---

## 2. Dependencias (no se construye nada aquí que estas fases no dejen listo)

Esta fase es la última de la ruta crítica (`1 → 2 → 3 → 4`) y **integra** lo que
las anteriores entregan. No la empieces hasta tenerlas verdes.

| Depende de | Qué necesita exactamente | Por qué bloquea |
|------------|--------------------------|-----------------|
| **Fase 1 — Hardening** | Identidad de login por **email global único** (no `findFirst({ where: { username } })` como en `api/src/routes/auth.ts:15`); JWT en cookie `HttpOnly`; rate-limit y recuperación de contraseña por email. | El signup self-service crea N usuarios; el `username` global de hoy colisiona y es inseguro. El email es la identidad natural del signup y de la verificación. |
| **Fase 2 — Multi-tenancy real** | `TenantManager` con `addTenant(tenantId)` / `removeTenant` / `getStatus(tenantId)` en caliente; ruteo de `wa-status` por `tenantId`; tabla **`TenantSettings`** editable por UI (la config deja de vivir en `profileDir` JSON); carga de plantillas de perfil por industria. | El aprovisionamiento automático = `TenantManager.addTenant(...)` en memoria. Sin él, dar de alta un tenant todavía exige editar `docker-compose.yml`. El wizard escribe en `TenantSettings`, no en disco. |
| **Fase 3 — Billing** | Stripe Checkout + Customer Portal; webhooks (`checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed`); tablas `Plan`/`Subscription`; middleware de enforcement por estado de suscripción. | El paso de pago del onboarding es Checkout; el provisioning se dispara desde el webhook `checkout.session.completed` o, en trial sin tarjeta, desde la verificación de email. |

> Si una de estas tres no está completa, esta fase queda a medias por diseño.
> Lo que aquí se añade es **el pegamento** signup ↔ email ↔ Stripe ↔ TenantManager,
> más el wizard de la SPA.

---

## 3. Flujo objetivo end-to-end

```
┌────────────┐   ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐
│ 1. Signup  │──▶│ 2. Verificar │──▶│ 3. Suscripción│──▶│ 4. Aprovisionamiento│
│  (público) │   │    email     │   │   (Stripe)   │   │  (TenantManager)    │
└────────────┘   └──────────────┘   └──────────────┘   └─────────┬───────────┘
                                                                  ▼
                              ┌──────────────────────────────────────────────┐
                              │ 5. Wizard de configuración guiada            │
                              │  giro · bienvenida · datos · schema (plantilla)│
                              └─────────────────────┬────────────────────────┘
                                                    ▼
                              ┌──────────────┐  ┌──────────────┐  ┌──────────┐
                              │ 6. QR de WA  │─▶│ 7. Mensaje de │─▶│ 8. "Listo │
                              │  (vincular)  │  │    prueba     │  │ p/operar"│
                              └──────────────┘  └──────────────┘  └──────────┘
```

### Paso a paso

1. **Signup público** — email + contraseña + nombre del negocio + industria.
   Crea `Tenant` + `PanelUser` (rol `admin`) en **una transacción**. Estado del
   tenant: `pending_verification`.
2. **Verificación de email** — se envía un token de un solo uso. El usuario no
   puede operar el bot hasta verificar (criterio de aceptación del roadmap:
   "Email verificado obligatorio antes de operar"). Estado → `verified`.
3. **Suscripción (Stripe, Fase 3)** — Stripe Checkout. Según la decisión de trial
   (§8), este paso puede ir **antes** del wizard (tarjeta requerida) o quedar
   diferido (trial sin tarjeta). Resultado: `Subscription.status` = `trialing` o
   `active`.
4. **Aprovisionamiento automático** — disparado por webhook de Stripe
   (`checkout.session.completed`) o por verificación de email en trial sin
   tarjeta. La API llama `TenantManager.addTenant(tenantId)` (Fase 2): se crea la
   conexión Baileys del tenant en caliente, sin tocar `docker-compose.yml` ni
   reiniciar. Estado del tenant → `provisioning` → `active`.
5. **Wizard de configuración guiada** (SPA, §5) — nombre/giro, mensaje de
   bienvenida, datos del negocio (facts), y **schema de intake de su industria
   precargado como plantilla** (§6). Todo se persiste en `TenantSettings`.
6. **QR de WhatsApp** — la SPA pide `GET /wa-status` (que la Fase 2 rutea al
   `TenantManager` por `tenantId`) y muestra el QR para vincular el teléfono.
7. **Mensaje de prueba** — el usuario manda un WhatsApp a su propio bot (o usa un
   botón "enviar prueba") y la SPA confirma ida y vuelta.
8. **Checklist "listo para operar"** — verificación visual de los hitos:
   email verificado, suscripción activa, bot vinculado, configuración guardada,
   mensaje de prueba exitoso.

---

## 4. Backend — `POST /auth/signup`

Nueva ruta en `api/src/routes/auth.ts`, hermana de `/auth/login`. Reemplaza el
flujo manual de `api/src/cli/create-user.ts` (que se conserva solo como
herramienta de operador/soporte).

### 4.1 Contrato

```
POST /auth/signup
  body: {
    email:        string (email válido, único global)
    password:     string (política mínima de Fase 1)
    businessName: string (1..120)
    industry:     'tapiceria' | 'paqueteria' | 'generico'
  }
  → 201 { tenantId, status: 'pending_verification' }
  → 409 { error: 'email ya registrado' }
  → 400 { error: validación zod }
  → 429 { error: 'demasiados intentos' }
```

Validación con **zod** (mismo estilo que `LoginZ` en `api/src/routes/auth.ts:6`).

### 4.2 Creación transaccional Tenant + PanelUser

El alta debe ser atómica: o se crean ambos registros, o ninguno. Hoy
`create-user.ts` los crea por separado (primero busca el tenant, luego crea el
usuario); el signup los crea juntos:

```ts
const slug = await uniqueSlug(businessName); // slugify + sufijo si colisiona
const passwordHash = await bcrypt.hash(password, 10); // como create-user.ts:15
const tenant = await prisma.$transaction(async (tx) => {
  const t = await tx.tenant.create({
    data: {
      slug,
      name: businessName,
      industry,
      profileDir: '',                 // ya no se usa disco; config en TenantSettings (Fase 2)
      status: 'pending_verification', // campo nuevo, ver §4.5
    },
  });
  await tx.panelUser.create({
    data: { tenantId: t.id, email, passwordHash, role: 'admin' },
  });
  await tx.emailVerification.create({
    data: { tenantId: t.id, email, token: randomToken(), expiresAt: in24h() },
  });
  return t;
});
```

> Nota: `PanelUser` hoy tiene `username` (`prisma/schema.prisma:25-36`). La Fase 1
> introduce el email como identidad. El signup escribe `email`; si la Fase 1 lo
> hizo migrando `username`→`email` o añadiendo `email` único, el signup usa ese
> campo. Esta fase **asume** esa decisión tomada en Fase 1.

### 4.3 Validación y anti-abuso

- **Rate-limit** dedicado en `/auth/signup` por IP (`@fastify/rate-limit`, ya
  introducido en Fase 1): p. ej. 5 signups/hora/IP. Defensa contra registro
  masivo automatizado.
- **Email único global**: índice único; si colisiona, `409` sin filtrar si el
  email existe o no más allá de lo necesario.
- **Verificación de email obligatoria** antes de aprovisionar (no se crea
  conexión Baileys para un email no verificado).
- **CAPTCHA opcional** (decisión abierta) si el rate-limit no basta.
- Password: política mínima de Fase 1 (longitud, etc.), hash bcrypt (cost 10,
  consistente con el resto del código).

### 4.4 Verificación de email (token)

```
GET  /auth/verify-email?token=<token>     → marca verificado, status → 'verified'
POST /auth/resend-verification { email }   → reenvía (rate-limited)
```

- Token de un solo uso, con expiración (24 h), en tabla `EmailVerification`
  (nueva). Al verificar: se marca `verifiedAt`, el tenant pasa a `verified` y se
  dispara el siguiente paso (Checkout, o provisioning si es trial sin tarjeta).
- **Proveedor de email transaccional**: Resend / Postmark / SES (el mismo que la
  Fase 6 prevé para verificación, recuperación y avisos de pago). Se introduce un
  pequeño `EmailService` (`api/src/email/`) con plantillas: verificación,
  bienvenida, y reenvío. Reutilizable por la recuperación de contraseña de Fase 1.

### 4.5 Cambios de modelo de datos (Prisma)

Migración aditiva sobre `prisma/schema.prisma`:

```prisma
model Tenant {
  // ...campos existentes...
  status     String   @default("pending_verification")
  // 'pending_verification' | 'verified' | 'provisioning' | 'active' | 'suspended'
  onboarding Json?    // estado del wizard (paso actual + flags), ver §5.3
}

model EmailVerification {
  id         String   @id @default(uuid())
  tenantId   String
  email      String
  token      String   @unique
  verifiedAt DateTime?
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  tenant     Tenant   @relation(fields: [tenantId], references: [id])
}
```

`PanelUser` recibe `email` (de Fase 1) y mantiene `role` (`admin`/`viewer`).
`TenantSettings` (de Fase 2) es donde el wizard escribe la configuración del bot.

---

## 5. SPA — Wizard de onboarding multi-paso y reanudable

Nuevas vistas bajo `/onboarding`, añadidas a `spa/src/App.tsx` (junto a las rutas
actuales `Dashboard`, `WhatsApp`, `Settings`). El signup vive fuera del
`ProtectedRoute` (es público, como `/login`); el wizard vive **dentro** del
`ProtectedRoute` porque exige sesión.

```
/signup            público   (paralelo a /login en App.tsx)
/verify-email      público   (landing del enlace del correo)
/onboarding        protegido (host del wizard; redirige al paso pendiente)
```

### 5.1 Pantalla de signup

`spa/src/pages/Signup.tsx`, gemela de `Login.tsx` pero con cuatro campos
(email, password, nombre del negocio, selector de industria). Reutiliza
`AuthContext`/`ApiError` (`spa/src/auth/AuthContext.tsx`) y, tras `201`, deja al
usuario en estado "revisa tu correo".

### 5.2 Pasos del wizard

| # | Paso | Qué hace | Persiste en |
|---|------|----------|-------------|
| 1 | **Verificar email** | Espera/confirma verificación; reenvío disponible. | `EmailVerification` |
| 2 | **Suscripción** | Redirige a Stripe Checkout (o se salta en trial sin tarjeta). | `Subscription` (Fase 3) |
| 3 | **Aprovisionar** | Pantalla de "preparando tu bot…"; consulta hasta que el tenant esté `active`. | `Tenant.status` |
| 4 | **Negocio** | Nombre/giro, datos del negocio (facts: ubicación, horarios, pago). | `TenantSettings` |
| 5 | **Bienvenida** | Mensaje de bienvenida (precargado desde plantilla, editable). | `TenantSettings` |
| 6 | **Schema de intake** | Plantilla de la industria precargada; el usuario revisa/ajusta secciones y campos. | `TenantSettings` |
| 7 | **Vincular WhatsApp** | Muestra el **QR** (`GET /wa-status`), espera `connected: true`. | conexión Baileys (TenantManager) |
| 8 | **Mensaje de prueba** | Guía al usuario a mandar un WhatsApp; confirma ida/vuelta. | — (verificación en vivo) |
| 9 | **Checklist "listo"** | Resumen de hitos; CTA al dashboard. | `Tenant.onboarding.completed` |

### 5.3 Reanudable — estado persistido

El roadmap exige: "El flujo es reanudable si el usuario abandona a medias". El
wizard **no** guarda su progreso solo en el cliente. El paso pendiente se deriva
del estado del servidor:

- `Tenant.status` (`pending_verification` → `verified` → `provisioning` →
  `active`) ⇒ determina si el usuario está antes/después del provisioning.
- `Subscription.status` (Fase 3) ⇒ si ya pagó / está en trial.
- `Tenant.onboarding` (JSON: `{ step, businessDone, welcomeDone, schemaDone,
  whatsappLinked, testDone, completed }`) ⇒ progreso de los pasos de
  configuración (4–9).
- Estado de la conexión Baileys vía `GET /wa-status` ⇒ si el QR ya se vinculó.

Al cargar `/onboarding`, la SPA pide `GET /onboarding/state` y **salta al primer
paso incompleto**. Así, si el usuario cierra el navegador tras vincular WhatsApp,
al volver entra directo al mensaje de prueba. Endpoints:

```
GET  /onboarding/state                  → { step, tenantStatus, subStatus, flags }
PATCH /onboarding/business              → guarda facts en TenantSettings
PATCH /onboarding/welcome               → guarda welcome en TenantSettings
PATCH /onboarding/schema                → guarda intake-schema en TenantSettings
POST /onboarding/complete               → marca onboarding.completed = true
```

---

## 6. Plantillas de perfil por industria

Hoy un perfil vive en disco bajo `profiles/<industria>/` con cuatro archivos
(verificado en `profiles/tapiceria/`):

- `intake-schema.json` — secciones y campos del intake (cliente, trabajo,
  especificaciones, logística).
- `welcome.txt` — mensaje de bienvenida con `{{businessName}}`.
- `business-facts.json` — `facts` (ubicación, horarios, pago) + `freeContext`.
- `prompt-vars.json` — `promptTemplate` + `vars` (tono, instrucciones, reglas).

### 6.1 Cómo se precargan a `TenantSettings`

En el signup, la `industry` elegida selecciona un **template seed**. La Fase 2 ya
prevé "carga de perfiles de intake por industria seleccionable (tapicería,
paquetería, genérico) como plantillas al alta". Esta fase la engancha al
provisioning:

1. Los `profiles/<industria>/` dejan de ser config viva del tenant y pasan a ser
   **plantillas semilla** versionadas (read-only) en el repo. Se añaden
   `profiles/paqueteria/` y `profiles/generico/` (hoy solo existe `tapiceria/`).
2. Un `TemplateLoader` (`api/src/onboarding/templates.ts`) lee los cuatro
   archivos de la industria y, sustituyendo `{{businessName}}`/`{{businessDomain}}`
   por los datos del signup, **escribe una copia en `TenantSettings`** del tenant
   recién creado.
3. A partir de ahí, el wizard (pasos 4–6) y la pantalla de `Settings` existente
   editan la copia del tenant en `TenantSettings`, **nunca** el archivo de disco.
   El disco es la plantilla; la DB es la instancia.

```
profiles/tapiceria/*.json   ──TemplateLoader──▶  TenantSettings(tenantId)
   (semilla, read-only)        + sustitución        (instancia editable por UI)
                                de variables
```

Así un negocio de tapicería arranca con el schema de tapicería ya cargado (las
secciones cliente/trabajo/especificaciones/logística y sus campos) y solo lo
ajusta, en vez de partir de cero.

---

## 7. Integración signup ↔ Stripe ↔ TenantManager (provisioning end-to-end)

```
SPA /signup ──▶ POST /auth/signup ──▶ Tenant(pending_verification) + correo
                                          │
       correo: enlace de verificación  ◀──┘
                │
                ▼
   GET /auth/verify-email?token ──▶ Tenant(verified)
                │
                ▼
   [trial CON tarjeta]                    [trial SIN tarjeta]
   Stripe Checkout                        provisioning directo
        │                                       │
   webhook checkout.session.completed           │
        │  (Fase 3, verificado por firma)        │
        └───────────────┬───────────────────────┘
                        ▼
        TenantManager.addTenant(tenantId)   ◀── aprovisionamiento (Fase 2)
                        │
                        ▼
        Tenant(active) + conexión Baileys lista
                        │
                        ▼
        SPA muestra QR (GET /wa-status, ruteado por tenantId)
```

El punto de integración crítico es **idempotencia**: el webhook de Stripe puede
llegar dos veces; `addTenant` debe ser idempotente (si la conexión ya existe, no
duplica). Esto encaja con el requisito de Fase 3 "webhooks idempotentes".

---

## 8. Decisión de trial y orden de pasos

El roadmap deja abierta la pregunta y recomienda **trial corto con tarjeta
requerida** (menos fraude, mejor conversión). El orden de los pasos depende de
esta decisión:

| | **Trial CON tarjeta** (recomendado) | **Trial SIN tarjeta** |
|---|---|---|
| Orden | signup → verificar → **Checkout** → provisioning → wizard | signup → verificar → provisioning → wizard → (Checkout antes de que expire el trial) |
| Provisioning lo dispara | webhook `checkout.session.completed` | verificación de email |
| Estado inicial de `Subscription` | `trialing` (con método de pago en archivo) | `trialing` (sin método de pago) |
| Riesgo | fricción de poner tarjeta antes de ver valor | registros basura que consumen una conexión Baileys |
| Mitigación | trial corto y gratis hasta el primer cobro | rate-limit + verificación de email + límite de tenants en trial |

El diseño soporta **ambos** detrás de una bandera de configuración
(`TRIAL_REQUIRES_CARD`), porque la única diferencia es **qué evento dispara
`addTenant`** (webhook de Checkout vs. verificación de email) y si el paso 2 del
wizard precede o sigue al provisioning. Recomendación de implementación: arrancar
con **tarjeta requerida** y medir conversión.

---

## 9. Criterios de aceptación

- [ ] Un usuario nuevo, sin que el operador toque nada, llega de signup a "bot
      vinculado y respondiendo" en staging (criterio del roadmap).
- [ ] `POST /auth/signup` crea `Tenant` + `PanelUser` admin de forma
      **transaccional** (o ambos, o ninguno) con validación zod.
- [ ] Email verificado **obligatorio** antes de aprovisionar/operar (criterio del
      roadmap); token de un solo uso con expiración.
- [ ] Rate-limit activo en `/auth/signup` y `/auth/resend-verification`
      (anti-abuso).
- [ ] El aprovisionamiento llama `TenantManager.addTenant(tenantId)` (Fase 2) sin
      editar `docker-compose.yml` ni reiniciar; es **idempotente** ante webhooks
      duplicados.
- [ ] La plantilla de la industria elegida se **precarga en `TenantSettings`**
      (schema, bienvenida, facts) con `{{businessName}}` sustituido; el wizard
      edita la copia, no el archivo de disco.
- [ ] El wizard es **reanudable**: al volver, salta al primer paso incompleto a
      partir del estado del servidor (`Tenant.status`, `Subscription.status`,
      `Tenant.onboarding`, `wa-status`).
- [ ] La SPA muestra el QR del tenant correcto (vía `GET /wa-status` ruteado por
      `tenantId`) y confirma un **mensaje de prueba** ida y vuelta.
- [ ] El checklist "listo para operar" refleja: email verificado, suscripción
      activa/trial, bot vinculado, configuración guardada, prueba exitosa.
- [ ] Proveedor de email transaccional integrado (verificación + bienvenida),
      reutilizable por la recuperación de contraseña de Fase 1.

---

## 10. Decisiones abiertas

1. **¿Trial con o sin tarjeta?** — Recomendación del roadmap: trial corto **con
   tarjeta requerida** (menos fraude, mejor conversión). Afecta el orden de los
   pasos y qué evento dispara el provisioning (§8). El diseño soporta ambos tras
   `TRIAL_REQUIRES_CARD`; hay que **elegir el default de lanzamiento**.
2. **¿CAPTCHA en el signup?** — ¿basta el rate-limit por IP + verificación de
   email, o se añade CAPTCHA contra registro automatizado?
3. **Industrias disponibles al lanzar** — hoy solo existe `profiles/tapiceria/`.
   ¿Se crean `paqueteria` y `generico` como plantillas para el lanzamiento, o se
   arranca solo con las que ya tienen demanda real?
4. **Reclamo del número de WhatsApp** — si el usuario abandona tras vincular,
   ¿cuánto tiempo se mantiene viva su conexión Baileys antes de liberarla
   (consume recursos del `TenantManager`)?
5. **¿Slug autogenerado o elegible?** — el signup deriva `slug` del nombre del
   negocio; ¿se deja editar al usuario (riesgo de colisión/UX) o se mantiene
   interno y opaco?
6. **Reverso del provisioning** — si el pago falla justo después del provisioning
   (Fase 3, `invoice.payment_failed`), ¿se llama `removeTenant` de inmediato o
   tras el periodo de gracia? (Coordinar con el enforcement de Fase 3.)
```
