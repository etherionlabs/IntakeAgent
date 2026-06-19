# Plan Fase 6 — Legal, cumplimiento y go-to-market — Implementación

> **Para workers agénticos:** SUB-SKILL REQUERIDA: usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan sintaxis de checkbox (`- [ ]`) para seguimiento.

**Objetivo:** Cerrar la brecha 9 del roadmap ("Sin capa legal"). Dotar al producto de cumplimiento de datos (retención, exportación y borrado por tenant), registro auditable de aceptación legal en el signup, publicación de ToS/Privacidad/DPA/política de WhatsApp, landing comercial en Netlify, documentación de cliente + FAQ, y email transaccional. El resultado deja los criterios de aceptación de la Fase 6 verdes, que son parte del Go/No-Go de la Fase 7.

**Arquitectura:** Todo el código nuevo vive en la **API central** (`api/`, Fastify + JWT, filtrado por `tenantId` del JWT — regla de aislamiento del spec maestro §3) y en la **SPA/landing** (`spa/`, desplegada en Netlify). Los documentos legales son `.md` versionados en el repo bajo `legal/` (se crean por separado como borradores de ingeniería); "publicar" = renderizarlos en rutas públicas y desplegar. La aceptación legal se engancha al `POST /auth/signup` de la Fase 4 (no se reimplementa). El job de retención es una tarea programada idempotente por `tenantId`. El email transaccional es un `EmailService` con contrato/implementación detrás de env (mismo patrón que `OutboundSender`).

**Tech Stack:** Node 20+, TypeScript via `tsx`, Prisma + PostgreSQL, Fastify 5 (`api/`), React + Vite (`spa/`), Netlify (deploy), vitest 4. Proveedor de email pendiente (Resend/Postmark/SES — Decisión abierta §9.4). ZIP de export con `archiver` o equivalente streaming.

**Dependencias de fase:**
- **Fase 4 (onboarding self-service):** este plan **extiende** `POST /auth/signup` y la transacción de creación de tenant; si la Fase 4 no está, el enganche de `LegalAcceptance` (Tarea 2) queda como adaptación pendiente.
- **Fase 2 (multi-tenancy):** el borrado total dispara `TenantManager.removeTenant(tenantId)` (Tarea 1.3) y la landing referencia el flujo de QR del onboarding.
- **Fase 3 (billing):** la baja del tenant (`canceled`) define el periodo de gracia previo al borrado; la landing muestra el precio del `Plan`.

**⚠️ Requiere asesoría legal externa y jurisdicción pendiente (Decisiones abiertas §9.1, §9.2 del spec):**
- La **jurisdicción / país objetivo** (GDPR / LFPDPPP / CCPA) condiciona los textos definitivos de ToS/Privacidad/DPA, los plazos de retención obligatorios y la ley aplicable. **Hay que fijarla ANTES de redactar los textos finales.** Este plan entrega **borradores de ingeniería** marcados como tales, no documentos firmados por abogado.
- Toda Tarea que produzca texto legal (Tareas 3, 6) queda marcada `[LEGAL-EXT]`: el borrador es de ingeniería y **debe validarse con un abogado de la jurisdicción elegida antes de cobrar**.
- La **ventana de retención por defecto** (12 meses `Message`, 30 días de gracia) está propuesta, no confirmada (§9.3).

---

### Tarea 1: Endpoints de export/borrado de datos por tenant + política de retención

**Objetivo:** Que el tenant (como responsable del tratamiento) pueda ejercer y trasladar a sus clientes finales los derechos de acceso y borrado, con una política de retención explícita en vez de "se guarda todo para siempre". Cubre §3 del spec.

**Archivos:**
- Crear: `api/src/routes/tenant-data.ts` (export + borrado)
- Crear: `api/src/services/dataExport.ts` (genera el ZIP por entidad)
- Crear: `api/src/services/dataDeletion.ts` (borrado fino + total, idempotente)
- Crear: `api/src/jobs/retention.ts` (purga programada de `Message`/media)
- Modificar: `api/src/app.ts` (registrar rutas) y el scheduler/cron del host o worker periódico
- Modificar: `prisma/schema.prisma` (campo de retención por tenant si no existe en `TenantSettings`)
- Crear tests: `api/tests/routes/tenant-data.test.ts`, `api/tests/services/dataDeletion.test.ts`, `api/tests/jobs/retention.test.ts`

- [ ] **Step 1: Política de retención en datos (schema)**

Confirmar/añadir a `TenantSettings` (tabla de Fase 2) un campo de ventana de retención de mensajes, p. ej. `messageRetentionMonths Int @default(12)`. Si `TenantSettings` aún no existe (Fase 2 no entregada), dejar el default a nivel de constante de servicio y registrar la dependencia. Documentar la tabla de retención del spec §3.1 como comentario de referencia.
*Cambios:* migración Prisma `add_message_retention`.
*Verificación:* `npx prisma migrate dev --name add_message_retention` aplica; `npm run typecheck` en `api/` sin errores.

- [ ] **Step 2: Test rojo de exportación**

Escribir `api/tests/routes/tenant-data.test.ts` que arranque la API con un tenant sembrado y `Contact`/`Job`/`Message` de ESE tenant + datos de OTRO tenant. Asertar:
  - `POST /tenant/data-export` con JWT admin → `202 { jobId }`.
  - `GET /tenant/data-export/:jobId` eventualmente → `status:'ready'` con `downloadUrl` y `expiresAt`.
  - el ZIP contiene `contacts.json`/`jobs.json`/`messages.json`/`agent_runs.json` **solo** del `tenantId` del JWT (cero filas del otro tenant).
  - rol no-admin o sin JWT → `403`/`401`.
*Verificación:* `npx vitest run api/tests/routes/tenant-data.test.ts` → FALLA (rutas no existen).

- [ ] **Step 3: Implementar exportación asíncrona (derecho de acceso)**

En `api/src/services/dataExport.ts` y `api/src/routes/tenant-data.ts`:
  - `POST /tenant/data-export` (JWT admin): encola un job de export, devuelve `202 { jobId }`.
  - El worker de export genera un **ZIP** con un JSON por entidad, **todas las queries filtradas por `tenantId` del JWT**, más la media referenciada. Estructura documentada (portabilidad).
  - `GET /tenant/data-export/:jobId`: devuelve `{ status, downloadUrl?, expiresAt? }`. La URL es **firmada y de expiración corta** (~24 h), nunca pública permanente.
  - Cada export deja rastro auditado (`tenantId`, `userId`, `at`).
*Verificación:* el test de Step 2 pasa.

- [ ] **Step 4: Test rojo de borrado (fino + total)**

En `api/tests/services/dataDeletion.test.ts` asertar:
  - `DELETE /tenant/contacts/:contactId/data` borra/anonimiza UN cliente final (`Contact` + sus `Message`/media + `Job`), solo dentro del `tenantId`; un contacto de otro tenant es intocable.
  - `POST /tenant/data-deletion` con `body.confirm == businessName` → `202 { jobId }`; con confirmación incorrecta → `400`.
  - el borrado es **idempotente** (re-ejecutar no falla).
  - `LegalAcceptance` **sobrevive** al borrado total (Tarea 2).
*Verificación:* `npx vitest run api/tests/services/dataDeletion.test.ts` → FALLA.

- [ ] **Step 5: Implementar borrado (derecho al olvido)**

En `api/src/services/dataDeletion.ts` y la ruta:
  - **Borrado de un cliente final:** elimina `Contact` + `Message`/media + `Job`; si hay que conservar el `Job` por contabilidad del negocio, **anonimiza** el contacto (desvincula teléfono/nombre) en vez de romper integridad.
  - **Borrado total del tenant:** borra todo lo del `tenantId` **excepto** `LegalAcceptance` y lo mínimo de `Subscription` que Stripe/contabilidad exija; dispara `TenantManager.removeTenant(tenantId)` (Fase 2) para cerrar la conexión Baileys y borrar su sesión.
  - Confirmación explícita, asíncrono si es masivo, auditado e idempotente.
*Verificación:* el test de Step 4 pasa.

- [ ] **Step 6: Job de retención programado**

En `api/src/jobs/retention.ts`: tarea idempotente, **por `tenantId`**, que borra `Message`/media más viejos que la ventana del tenant (Step 1), reutilizando el media store. Engancharla a un cron del host o worker periódico. La baja del tenant (`canceled`, Fase 3) aplica el periodo de gracia (propuesto 30 días) antes del borrado total automático.
*Verificación:* `api/tests/jobs/retention.test.ts` (siembra mensajes con fechas pasadas, corre el job, asegura que solo se borran los fuera de ventana y solo del tenant correcto) → PASA.

- [ ] **Step 7: Suite + typecheck + commit**

*Verificación:* `cd api && npm test && npm run typecheck` todo verde.
*Commit:* `feat(legal): export/borrado de datos por tenant + política de retención`.

> **Pendiente legal:** la **ventana de retención por defecto** (12 meses / 30 días de gracia) requiere confirmación de negocio y puede tener mínimos/máximos legales según jurisdicción (§9.3). El matiz de propagación a backups (7 días rolling) **debe** declararse en Privacidad (Tarea 3) para no prometer un borrado instantáneo irreal.

---

### Tarea 2: Registro de aceptación legal en signup (tabla `LegalAcceptance`)

**Objetivo:** Registrar de forma auditable y defendible qué documento legal se aceptó, en qué versión, cuándo y desde dónde, dentro de la misma transacción de creación del tenant. Cubre §2.4 del spec.

**Archivos:**
- Modificar: `prisma/schema.prisma` (añadir `model LegalAcceptance`)
- Modificar: `api/src/routes/auth.ts` (extender el contrato de `POST /auth/signup` de Fase 4)
- Modificar: la transacción de creación de tenant (Fase 4 §4.2)
- Crear: `api/src/middleware/reAcceptance.ts` (flag de re-aceptación)
- Crear tests: `api/tests/routes/signup-legal.test.ts`

- [ ] **Step 1: Modelo `LegalAcceptance` en el schema**

Añadir el modelo del spec §2.4 (`id`, `tenantId`, `userId`, `document`, `version`, `acceptedAt`, `ipAddress?`, `userAgent?`, relación a `Tenant`). `document` ∈ `'terms' | 'privacy' | 'dpa' | 'whatsapp_policy'`.
*Verificación:* `npx prisma migrate dev --name add_legal_acceptance` aplica; cliente regenerado.

- [ ] **Step 2: Test rojo del contrato de signup**

En `api/tests/routes/signup-legal.test.ts` asertar:
  - `POST /auth/signup` sin `acceptedTerms` → `400`.
  - sin `acceptedWhatsappRisk` (aceptación **separada** del riesgo Baileys, §4) → `400`.
  - con ambos `true` + versiones → crea tenant **y** una fila `LegalAcceptance` **por documento** aceptado, con `version`, `acceptedAt`, `ipAddress`, `userAgent`.
  - si la transacción de creación falla, **no** queda ninguna `LegalAcceptance` huérfana (todo-o-nada).
*Verificación:* `npx vitest run api/tests/routes/signup-legal.test.ts` → FALLA.

- [ ] **Step 3: Extender el contrato de signup**

En `api/src/routes/auth.ts`, añadir al body de `POST /auth/signup`: `acceptedTerms`, `acceptedWhatsappRisk` (ambos obligatorios → `400` si falta cualquiera), `termsVersion`, `whatsappPolicyVersion`. Capturar `ipAddress`/`userAgent` del request.

- [ ] **Step 4: Escribir el rastro dentro de la transacción**

En la transacción de creación de tenant (Fase 4 §4.2), dentro del mismo `$transaction`, insertar **una fila por documento aceptado** (`terms`, `privacy`, `dpa`, `whatsapp_policy`). O se crea el tenant **con** su rastro o no se crea.
*Verificación:* el test de Step 2 pasa.

- [ ] **Step 5: Middleware de re-aceptación**

En `api/src/middleware/reAcceptance.ts`: si la `version` vigente de un documento es mayor que la última aceptada por el tenant, marcar un flag que la SPA lea para pedir re-aceptación (banner bloqueante no destructivo, misma idea de "estado espejo" que el enforcement de Fase 3). Test: tenant con versión vieja recibe el flag; con versión al día, no.
*Verificación:* test de middleware verde.

- [ ] **Step 6: Suite + commit**

*Verificación:* `cd api && npm test && npm run typecheck` verde.
*Commit:* `feat(legal): registro de aceptación legal en signup (LegalAcceptance)`.

> **Pendiente legal:** las versiones (`termsVersion`, `whatsappPolicyVersion`) deben corresponder a documentos **validados por abogado** antes de cobrar; hasta entonces son versiones de borrador.

---

### Tarea 3: Publicación de ToS / Privacidad / DPA / deslinde Baileys  `[LEGAL-EXT]`

**Objetivo:** Que ToS + Privacidad + DPA + Política de uso de WhatsApp existan como `.md` versionados, se rendericen en rutas públicas y queden enlazados desde signup y landing. Cubre §2.3, §3.4 y §4 del spec.

**Archivos:**
- Enlazar (los borradores se crean por separado bajo `legal/`): `legal/terms.md`, `legal/privacy.md`, `legal/dpa.md`, `legal/whatsapp-policy.md`
- Crear: `spa/src/pages/legal/` (componente de render de Markdown + rutas públicas)
- Modificar: el router de la SPA (`/terms`, `/privacy`, `/dpa`, `/whatsapp-policy` como rutas públicas)
- Modificar: el formulario de signup (enlaces + checkbox separado de riesgo WhatsApp)

- [ ] **Step 1: Estructura y versionado de los documentos**

Cada `.md` lleva front-matter con `version` y `effectiveDate`. **Estos archivos son BORRADORES de ingeniería y se crean por separado** (fuera de este plan); aquí solo se enlazan y renderizan. Contenido mínimo por documento según el spec:
  - `terms.md`: cláusula de limitación sobre disponibilidad de WhatsApp "tal cual"; incorpora por referencia el DPA; deslinde de uso indebido del canal (§2.2, §4.3).
  - `privacy.md`: qué datos se tratan (WhatsApp de terceros, teléfono, intake), finalidad, **sub-encargados** (OpenRouter, Stripe, email, hosting/VPS, Netlify), retención (§3.1), cómo ejercer acceso/borrado **incluido el matiz de backups**, jurisdicción y contacto de privacidad (§3.4).
  - `dpa.md`: reparto **tenant = responsable / nosotros = encargado**, lista de sub-encargados, obligación del tenant de tener base legal frente a sus clientes finales.
  - `whatsapp-policy.md`: el modelo Baileys **no oficial**, riesgo de ban del número del negocio, deslinde y buenas prácticas anti-ban (§4).

- [ ] **Step 2: Render de Markdown en la SPA**

Componente que renderiza los `.md` en rutas **públicas** (no protegidas por JWT). "Publicar" = desplegar (Tarea 4).
*Verificación:* `/terms`, `/privacy`, `/dpa`, `/whatsapp-policy` cargan el contenido en local.

- [ ] **Step 3: Enganche en el signup**

En el formulario de signup: enlaces visibles a ToS/Privacidad/DPA + **checkbox separado y explícito** del riesgo WhatsApp (`acceptedWhatsappRisk`, no enterrado en el ToS). Esto conecta con el contrato de la Tarea 2.
*Verificación:* el signup no envía si falta cualquiera de las dos aceptaciones; las versiones enviadas coinciden con el front-matter de los `.md`.

- [ ] **Step 4: Deuda de negocio registrada**

Confirmar que la **migración a la API oficial de WhatsApp** queda como deuda explícita en el roadmap (§4.4) — no se construye aquí, solo se documenta y deslinda.
*Commit:* `feat(legal): publicación y render de ToS/Privacidad/DPA/política WhatsApp`.

> **⚠️ `[LEGAL-EXT]` y jurisdicción pendiente:** el contenido legal **debe validarse con un abogado de la jurisdicción elegida** (§9.1, §9.2) antes de cobrar. Los textos definitivos dependen de fijar el país objetivo (GDPR/LFPDPPP/CCPA). Esta tarea entrega la **maquinaria de publicación**; el texto firmado es bloqueante para el Go/No-Go pero externo a ingeniería.

---

### Tarea 4: Landing en Netlify

**Objetivo:** Superficie comercial pública con propuesta de valor, precios y CTA a signup, desplegada en Netlify. Cubre §5 del spec.

**Archivos:**
- Crear: `spa/src/pages/Landing.tsx` (Opción A — ruta dentro de la SPA, recomendada para MVP)
- Modificar: el router de la SPA (`/` landing pública + `/signup`, `/login`, legales)
- Modificar: `netlify.toml` (ya soporta SPA fallback `/* → /index.html`; verificar)

- [ ] **Step 1: Landing como ruta pública (Opción A)**

Implementar `/` como landing pública reutilizando el design system existente. El router distingue rutas públicas (landing, signup, login, legales) de las protegidas. La única var de entorno sigue siendo `VITE_API_URL`.
*Cambios:* contenido del spec §5.1 — propuesta de valor (recepcionista autónomo de WhatsApp por vertical: tapicería/paquetería/genérico), "cómo funciona" en 3 pasos, **precios** (plan mensual fijo de Fase 3 — monto pendiente Decisión #4 del roadmap), **CTA a `/signup`**, aviso de transparencia con enlace a `/whatsapp-policy`, pie con `/terms` y `/privacy` + contacto/soporte.

- [ ] **Step 2: Deploy en Netlify**

Verificar que el `netlify.toml` existente (build de `spa/`, fallback SPA) sirve la landing y las rutas públicas/legales. "Publicar legales" = este deploy.
*Verificación:* landing en vivo en Netlify con precios y CTA a signup funcionando (criterio del roadmap); `/whatsapp-policy`, `/terms`, `/privacy` accesibles públicamente.
*Commit:* `feat(gtm): landing en Netlify con precios y CTA a signup`.

> **Pendiente:** el **monto/intervalo del plan** (Decisión #4 del roadmap) y si la landing es ruta en la SPA (A) o sitio aparte (B, deuda SEO — §9.5) están abiertos. MVP asume Opción A.

---

### Tarea 5: Documentación de cliente + FAQ

**Objetivo:** Reducir soporte y fricción de onboarding (alimenta la beta de la Fase 7) con guía de inicio, FAQ y canal de soporte. Cubre §6 del spec.

**Archivos:**
- Crear: `docs/cliente/guia-inicio.md` (render en SPA/landing)
- Crear: `docs/cliente/faq.md`
- Modificar: la SPA (sección de ayuda) y el pie de la landing (datos de soporte)

- [ ] **Step 1: Guía de inicio**

`docs/cliente/guia-inicio.md`: cómo registrarse, **cómo vincular WhatsApp con el QR** paso a paso (matiz "usa el teléfono del negocio"), cómo configurar el bot (giro, bienvenida, schema de intake — wizard de Fase 4) y **buenas prácticas anti-ban** (§4.3: empezar despacio, responder solo a quien escribe primero, no comprar listas).
*Verificación:* se renderiza desde la SPA/landing.

- [ ] **Step 2: FAQ**

`docs/cliente/faq.md` cubriendo el spec §6: ¿pueden banear mi número? (sí — honesto, enlaza a la política); ¿qué pasa si el bot se desconecta?; ¿cómo cancelo?; ¿quién ve los mensajes de mis clientes? (encargado del tratamiento, §2); ¿cómo exporto/borro datos? (Tarea 1); ¿qué modelos de IA usan? (OpenRouter).

- [ ] **Step 3: Soporte**

Documentar canal **email** (`soporte@<dominio>`) y un **WhatsApp de soporte** del equipo, con horario y SLA orientativo, en la sección de ayuda de la SPA y el pie de la landing. (El runbook formal de soporte/incidentes vive en la Fase 7.)
*Verificación:* enlaces de soporte visibles en SPA y landing.
*Commit:* `docs(cliente): guía de inicio, FAQ y datos de soporte`.

> **Pendiente:** el **horario y SLA** prometidos (§9.7) son una decisión de negocio — sobreprometer es deuda operativa para la Fase 7.

---

### Tarea 6: Email transaccional  `[LEGAL-EXT parcial]`

**Objetivo:** Correo transaccional fiable para verificación de email, recuperación de contraseña y avisos de pago, reutilizable por las Fases 1, 3 y 4. Cubre §7 del spec.

**Archivos:**
- Crear: `api/src/email/EmailService.ts` (interfaz `send(template, to, vars)`)
- Crear: `api/src/email/providers/<proveedor>.ts` (una implementación por proveedor detrás de la interfaz)
- Crear: `api/src/email/templates/` (verificación, bienvenida, recuperación, pago fallido, suscripción cancelada/por vencer)
- Modificar: hooks de Fase 1/4 (`api/src/email/`) y de Fase 3 (dunning de `invoice.payment_failed`, `past_due`, cancelación)
- Crear tests: `api/tests/email/emailService.test.ts`

- [ ] **Step 1: Interfaz `EmailService`**

`send(template, to, vars)` con una sola implementación por proveedor detrás de la interfaz (mismo patrón contrato/implementación que `OutboundSender`). El proveedor se elige por env: `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`. **Nunca claves en código ni en logs** (regla de secretos Fase 1 §1.2).
*Verificación:* test con un proveedor fake en memoria que captura los envíos (`send` llama la API correcta con los vars correctos).

- [ ] **Step 2: Plantillas mínimas**

Verificación de email, bienvenida, recuperación de contraseña, **aviso de pago fallido**, **aviso de suscripción cancelada/por vencer**. Cada una con versión y enlace a soporte.

- [ ] **Step 3: Robustez / idempotencia**

El envío no debe tumbar el request principal (p. ej. el signup no falla si el correo tarda); apoyarse en reintentos del proveedor; bounces visibles para soporte.
*Verificación:* test que confirma que un fallo de envío no propaga excepción al flujo de signup.

- [ ] **Step 4: Entregabilidad**

Documentar **dominio verificado** (SPF + DKIM + DMARC); solo correo **transaccional** (no marketing) desde este remitente.
*Verificación:* `cd api && npm test && npm run typecheck` verde.
*Commit:* `feat(email): EmailService transaccional + plantillas (verificación/recuperación/pagos)`.

> **Pendiente:** el **proveedor** (Resend vs Postmark vs SES — §9.4) y el remitente/dominio están abiertos. La configuración SPF/DKIM/DMARC es operativa, no de código, y depende del dominio elegido.

---

## Resumen de criterios de aceptación cubiertos (spec §8)

- [ ] ToS + Privacidad publicados y aceptados en signup (Tareas 2, 3).
- [ ] ToS incorpora/referencia un DPA (responsable/encargado + sub-encargados) (Tarea 3).
- [ ] Aceptación registrada en `LegalAcceptance` dentro de la transacción de tenant (Tarea 2).
- [ ] Aceptación **separada** del riesgo WhatsApp/Baileys en el signup (Tareas 2, 3).
- [ ] Política de uso de WhatsApp publicada y enlazada (Tarea 3).
- [ ] Migración a API oficial registrada como deuda (Tarea 3, no se construye).
- [ ] Export de datos por tenant (ZIP por entidad, URL firmada y expirable) (Tarea 1).
- [ ] Borrado por tenant (cliente final + total, auditado e idempotente, dispara `removeTenant`) (Tarea 1).
- [ ] Política de retención implementada y documentada, incluido matiz de backups (Tareas 1, 3).
- [ ] Landing en vivo en Netlify con precios y CTA a signup (Tarea 4).
- [ ] Documentación de cliente publicada (guía, FAQ, soporte) (Tarea 5).
- [ ] Email transaccional integrado, dominio verificado, claves por env (Tarea 6).

## Decisiones abiertas que bloquean el cierre definitivo (spec §9)

1. **Jurisdicción / país objetivo** — condiciona todos los textos legales. **Fijar antes de redactar definitivos.** `[LEGAL-EXT]`
2. **Asesoría legal externa** — recomendada (sí) por tratar datos de terceros sobre canal no oficial. `[LEGAL-EXT]`
3. Ventana de retención por defecto (12 meses / 30 días de gracia) — confirmar.
4. Proveedor de email (Resend/Postmark/SES) + remitente/dominio.
5. Landing: ruta en SPA (A, recomendada) vs sitio aparte (B).
6. API oficial de WhatsApp: ¿deuda comprometida o solo evaluación?
7. Canal y SLA de soporte prometidos.
