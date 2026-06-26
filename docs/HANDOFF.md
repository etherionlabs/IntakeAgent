# Handoff — Continuar Intake hacia producción desde un entorno local

**Rama:** `claude/production-roadmap-plan-s0kic2`
**Estado:** Fases 1–6 del roadmap implementadas con tests (sandbox). Fases 7 (go-live)
y 8 (SMS/voz) pendientes; varias tareas requieren infraestructura/decisiones reales.

Este documento reúne **todo lo que NO se pudo cerrar en el entorno efímero** (sin
Docker, sin Stripe/WhatsApp/dominios reales, sin secretos) para que se complete
desde una sesión con un entorno local completo. Cada ítem dice **qué falta, dónde
está el código, y cómo verificarlo**.

> Mapa del trabajo: `docs/ROADMAP-PRODUCCION.md` (maestro), `docs/DECISIONES-PENDIENTES.md`,
> y los specs/planes por fase en `docs/superpowers/`.

---

## 0. Cómo levantar el proyecto localmente (lo que yo usé)

```bash
# Postgres local (Docker recomendado; en el sandbox usé binarios de postgres a mano)
docker run -d --name intake-pg -e POSTGRES_DB=intake -e POSTGRES_USER=intake \
  -e POSTGRES_PASSWORD=intake -p 5432:5432 postgres:16
export DATABASE_URL="postgres://intake:intake@localhost:5432/intake"

npm ci
npx prisma generate
npx prisma migrate deploy          # aplica TODAS las migraciones (incluidas las nuevas)
export NODE_ENV=test JWT_SECRET=test-jwt-secret
npm test                           # raíz + api/ (un solo vitest) — ~364 tests
npm run typecheck

cd spa && npm ci && npm test && npm run typecheck   # ~46 tests
```

Migraciones nuevas creadas en esta rama (aplicar con `migrate deploy`):
`20260620000000_auth_email_reset`, `20260620010000_tenant_settings_channel`,
`20260620020000_add_billing`, `20260620030000_fase4_onboarding`,
`20260620040000_operator_audit`, `20260620050000_legal_retention`.

---

## 1. Decisiones de negocio que desbloquean cierres (del dueño)

Ver `docs/DECISIONES-PENDIENTES.md`. Las que aún faltan:

| # | Decisión | Bloquea |
|---|----------|---------|
| 4 | **Precio e intervalo** del plan (monto + mensual/anual) | Configurar `Plan` + `Price` en Stripe |
| 5 | **Mercado / moneda / impuestos** (Stripe Tax) | Stripe + marco legal |
| 6 | **Jurisdicción legal** (GDPR/LFPDPPP/CCPA) | Validar textos legales con abogado |
| — | Ventana de **retención** (propuesta 12 meses / 30 días gracia) | Política de privacidad final |
| — | **Voz** (Fase 8): ¿plan base o add-on? + país de grabación | Diseño de pricing de voz |

Ya tomadas (en `DECISIONES-PENDIENTES.md`): TenantManager shardeable, login por email,
trial con tarjeta, Resend, Sentry, dirección API oficial de WhatsApp.

---

## 2. Pendientes que requieren entorno local con Docker / infra real

### 2.1 Infra base y migraciones (todas las fases)
- [ ] Levantar el stack con `docker compose` (postgres + worker + api) y aplicar
      `prisma migrate deploy` en staging y prod. Ver `docs/runbooks/production-checklist.md`.
- [ ] `docker compose config` / `up -d` para validar `docker-compose.yml`
      (servicio único `worker` con `SHARD_ID/SHARD_COUNT`, api con env de Stripe/email).

### 2.2 Fase 1 — Seguridad/confiabilidad
- [ ] **Restore drill real en staging Docker** (yo lo validé como round-trip local con
      `pg_dump`/`psql`). Procedimiento: `docs/runbooks/2026-06-18-backup-restore-drill.md`.
      Cerrar 3.5 del plan: **redacción de logs del worker ya hecha**; confirmar en logs reales.

### 2.3 Fase 2 — Multi-tenancy + canal
- [ ] **Verificar 2 bots simultáneos** (tapicería + paquetería) en staging real con
      Baileys + números reales, sesiones aisladas (`./data/baileys-session/<tenantId>`).
- [ ] **Follow-up de código**: la edición de `TenantSettings` desde el panel
      (`api/src/routes/settings.ts` aún escribe a `config.json`/`profileDir`); migrarla
      a `TenantSettings` (tabla ya existe y el worker ya la consume). `business-facts`/
      `promptVars` no están modelados en `TenantSettings` aún (otra columna/JSON).

### 2.4 Fase 3 — Billing (Stripe real)
- [ ] Cuenta Stripe (modo test) → crear `Product` + `Price` recurrente → setear
      `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, y **sembrar un
      registro `Plan`** con ese `price_…`.
- [ ] E2E de webhooks: `stripe listen --forward-to localhost:3001/billing/webhook` +
      `stripe trigger checkout.session.completed | invoice.payment_failed`.
- [ ] Pago real con tarjeta de prueba → `active`; Customer Portal → cambiar/cancelar;
      confirmar corte **al fin del periodo** (no antes).
- (Código y máquina de estados verificados offline con firma real; ver
  `docs/superpowers/plans/2026-06-18-fase3-billing-stripe-plan.md`.)

### 2.5 Fase 4 — Onboarding self-service
- [ ] Flujo end-to-end con **bot real respondiendo por WhatsApp** tras el onboarding
      (Docker + Baileys + número). El E2E `api/tests/onboarding-e2e.test.ts` cubre la
      cadena lógica con fakes en ambos modos de `TRIAL_REQUIRES_CARD`.
- [ ] Activar el **email real** (ver 2.7) para verificación/bienvenida.

### 2.6 Fase 5 — Observabilidad / CI-CD
- [ ] **Secretos de CI** (GitHub): `GHCR_TOKEN`/`GITHUB_TOKEN`, `STAGING_SSH_KEY`,
      `PROD_SSH_KEY`, hosts, `DOMAIN`. Configurar **branch protection** en `master`
      (requerir `test-root`, `test-spa`, `docker-build`) y el **Environment `production`
      con required reviewers**. Workflows: `.github/workflows/{ci,deploy-staging,deploy-prod}.yml`.
- [ ] `SENTRY_DSN` (api/worker) y `VITE_SENTRY_DSN` (spa) reales; `GIT_SHA` inyectado por CI.
- [ ] **Uptime monitor externo** (UptimeRobot/Better Stack) sobre `/health`.
- [ ] **Canal de alertas** (email/Telegram) cableado al sink de `src/lib/alerts.ts`.
- [ ] Centralización de logs (driver Docker → Loki/Better Stack).

### 2.7 Fase 6 — Legal / email / GTM
- [ ] **Validar los textos legales con abogado** de la jurisdicción elegida (borradores
      en `docs/legal/`). Marcado `[LEGAL-EXT]`.
- [ ] **Email real**: `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY`, `EMAIL_FROM`; dominio
      verificado **SPF/DKIM/DMARC**. Código: `api/src/lib/email.ts` (`ResendEmailSender`).
- [ ] **Deploy de la landing** en Netlify (`/landing`, rutas legales públicas).
      `netlify.toml` ya existe.
- [ ] Mejora: **export como ZIP + URL firmada/expirable** (hoy es bundle JSON;
      `api/src/services/dataExport.ts`).
- [ ] Definir canal y SLA de **soporte**.

---

## 3. Fase 7 — Beta cerrada → Go-Live (operacional)
Runbook listo: `docs/runbooks/2026-06-18-go-live-runbook.md` (+ `incident-response.md`).
- [ ] Beta con los 2 tenants bajo el flujo self-service real.
- [ ] Validar **costos/márgenes** por tenant (OpenRouter) vs precio del plan.
- [ ] **Go/No-Go** contra el checklist; plan de rollback.

## 4. Fase 8 — Multicanal v2 (post-lanzamiento)
Spec/plan: `docs/superpowers/{specs,plans}/2026-06-18-fase8-*`.
- [ ] **8A SMS (Twilio)** — ~2 semanas: reutiliza el pipeline; dos adaptadores
      (`TwilioSmsInboundSource`/`TwilioSmsSender`) + número por tenant. La capa de canal
      (`src/channels/types.ts`, `channel` en `Message`/`Contact`) ya está lista.
- [ ] **8B Voz en vivo (Twilio Media Streams)** — 6–10+ semanas: servicio `voice-gateway`
      nuevo (STT→LLM→TTS, barge-in, consentimiento). Posible add-on de precio.

---

## 5. Qué está hecho y verificado en sandbox (no rehacer)

- **Fase 1**: cookies HttpOnly+CSRF, login por email, recuperación/cambio de contraseña,
  rate-limit, helmet, CORS estricto, aislamiento entre tenants, backoff Baileys,
  clasificación OpenRouter, redacción de secretos en logs.
- **Fase 2**: `TenantManager` shardeable (alta/baja en caliente), `TenantSettings`,
  ruteo `wa-status` por tenant/shard, capa de canal, `externalMsgId`+`channel`.
- **Fase 3**: `Plan/Subscription/StripeEvent`, Checkout/Portal/status, webhook firmado
  e idempotente + máquina de estados, enforcement 402 + suspend/resume del bot, SPA billing.
- **Fase 4**: signup transaccional + verificación de email, provisioning idempotente,
  plantillas por industria → `TenantSettings`, wizard reanudable, E2E.
- **Fase 5**: CI/CD (workflows), logs con `tenantId`/`service`, error tracking (Sentry
  no-op sin DSN) en api/worker/spa, métricas `/internal/metrics`, `/health` enriquecido,
  alertas (umbrales+deduper), panel de operador `/admin` + `OperatorAuditLog`.
- **Fase 6**: `LegalAcceptance` en signup, export/borrado por tenant + retención,
  `EmailService`/Resend, páginas legales + landing.

**Tests:** raíz ~364 (incluye `api/`), SPA ~46, `typecheck` limpio en ambos.
Todo en commits incrementales en `claude/production-roadmap-plan-s0kic2`.

---

## 6. Notas de implementación a tener presentes
- **No existe `api/package.json`**: un solo `npm test` raíz cubre `tests/**` y `api/tests/**`
  (lo refleja `ci.yml`). NO usar `cd api && npm test`.
- Enforcement 402 centralizado en `authenticate`; rutas exentas: `/auth`, `/billing`,
  `/onboarding`, `/admin`, `/tenant/`, `/health`.
- CSRF solo se exige cuando hay cookie de sesión (Bearer queda exento) — por eso los
  tests con `authHeader` siguen funcionando.
- En tests, `seedTenantAndUser` siembra una suscripción **activa** por defecto
  (los tests de billing/enforcement piden `{ activeSub: false }`).
- 2 tests negativos del SPA (409 / token inválido) se omitieron por un falso-rojo del
  reporter de rechazos de vitest v2; esas rutas están cubiertas en el backend.
