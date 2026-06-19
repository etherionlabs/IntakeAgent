# Plan Fase 5 — Observabilidad y operaciones

> **Para agentes:** SUB-SKILL REQUERIDA: usa superpowers:executing-plans (o subagent-driven-development) para ejecutar este plan tarea por tarea. Los pasos usan checkbox (`- [ ]`) para seguimiento.

**Objetivo:** Operar el SaaS con varios tenants sin volar a ciegas: automatizar build/test/deploy (CI/CD), instrumentar errores/logs/métricas con `tenantId`, enriquecer `/health` con un monitor externo, definir alertas operativas accionables, y dar a soporte un panel de operador para ver y actuar sobre cada tenant. Cierra las brechas 7 (sin CI/CD) y 8 (sin observabilidad) del roadmap y es requisito del Go/No-Go ("Monitoreo y alertas activos").

**Arquitectura:** No se reescribe la app; se la instrumenta. CI/CD vive en `.github/workflows/` (carpeta nueva). El rastreo de errores (Sentry) se inicializa en los tres bootstraps: `api/src/index.ts`, `src/index.ts` (worker), `spa/src/main.tsx`. Las métricas se exponen como endpoints Prometheus-text protegidos con `INTERNAL_API_TOKEN` (la API y el worker reusan su servidor interno existente, `src/internal/server.ts`). Los logs siguen siendo pino → stdout JSON, ahora con child loggers que aportan `tenantId`/`service`. El panel de operador es un conjunto de rutas `/admin/*` en la API (rol nuevo `operator`) consumidas por una sección `/admin` en la SPA; se apoya en `TenantManager` (Fase 2) y `Subscription` (Fase 3).

**Stack:** GitHub Actions (Node 20, `actions/checkout@v4`, `actions/setup-node@v4`, `docker/build-push-action@v6`, GHCR), `@sentry/node` (api/worker) + `@sentry/react` (spa), pino 10 (logs), Fastify 5 (endpoints de métricas/health/admin), Prometheus text format, monitor externo (UptimeRobot/Better Stack), Postgres 16 (servicio de CI para tests Prisma).

---

## Estado actual verificado (punto de partida)

| Pieza | Estado en el código (verificado) | Implicación |
|-------|----------------------------------|-------------|
| CI/CD | **No existe** `.github/` (verificado). | Construir desde cero. |
| Test raíz + api | `package.json`: `"test": "vitest run"`; `vitest.config.ts` `include: ['tests/**/*.test.ts', 'api/tests/**/*.test.ts']`, `fileParallelism: false`. **No existe `api/package.json`** (verificado). | UN solo job `npm test` cubre raíz **y** `api/`. **Prohibido** `cd api && npm test`. |
| Test SPA | `spa/package.json`: `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`. | Job de CI separado con `working-directory: spa`. |
| Typecheck raíz | `package.json`: `"typecheck": "tsc --noEmit"`. | Job de CI. |
| Imágenes | `Dockerfile.api` y `Dockerfile.worker` existen (verificado). | CI valida que ambas compilan. |
| Health | `api/src/server.ts:44` → `app.get('/health', async () => ({ ok: true }))`. | Trivial; se enriquece (DB, versión, uptime). |
| Logger | `src/lib/logger.ts` = `pino({ level: LOG_LEVEL ?? 'info' })`, sin `tenantId`. La API usa `Fastify({ logger: false })` (`api/src/server.ts:19`). | Falta `tenantId`/`service` y unificación de formato. |
| Endpoint interno worker | `src/internal/server.ts` existe: Fastify protegido con `INTERNAL_API_TOKEN`, ya expone `/internal/wa-status`, `/internal/wa-logout`, `/internal/wa-reconnect`. | Punto natural para `/internal/metrics`. |
| Auth API | `api/src/server.ts:34` decora `authenticate`, expone `request.tenantId`/`request.authUser` desde el JWT. | Base para el rol `operator` y el tag `tenantId` en Sentry. |
| Rastreo de errores | **No existe.** | Construir desde cero (api, worker, spa). |

**Dependencias entre fases (del spec §1):** CI/CD, logs y errores no dependen de nada y van primero. Métricas de "bots conectados" se refinan con `TenantManager` (Fase 2). Alertas de pago fallido se cablean cuando Fase 3 (Stripe) aterrice. El panel de operador consume `TenantManager` (Fase 2) y `Subscription` (Fase 3); hasta entonces lo que dependa de esas piezas queda como TODO referenciado.

**Convenciones del plan:**
- Ningún secreto en logs/errores ni en CI: `OPENROUTER_API_KEY`, `INTERNAL_API_TOKEN`, JWT y teléfonos solo en `.env` de cada VPS / GitHub Secrets. Sentry filtra vía `beforeSend`.
- Cada paso termina con verificación ejecutable: `npm test`, `npm run typecheck`, o (para los workflows) un PR de prueba que dispare Actions.
- Tras cada tarea con código: suite verde + typecheck.

---

## Orden de ejecución (resumen)

1. **Grupo 1 — CI con GitHub Actions** (Tareas 1–3): habilita señal de calidad antes de tocar la app.
2. **Grupo 5 — Logs estructurados con `tenantId`** (Tarea 4): base para correlacionar errores y métricas; va antes que Sentry porque comparte el contexto de `tenantId`.
3. **Grupo 2 — Error tracking (Sentry)** (Tareas 5–7): api, worker, spa.
4. **Grupo 3 — Métricas + health enriquecido + uptime monitor** (Tareas 8–10).
5. **Grupo 4 — Alertas operativas** (Tarea 11).
6. **Grupo 6 — Panel de operador** (Tareas 12–14): depende de Fase 2/3; se construye cuando existan.

> CI/CD, logs y errores sirven a todas las fases y van primero. Panel y alertas de billing cuando sus dependencias estén.

---

## GRUPO 1 — CI con GitHub Actions

### Tarea 1: `ci.yml` — calidad en cada PR (test raíz+api, test SPA, typecheck, docker build)

**Objetivo:** Que un PR no sea mergeable si fallan tests (raíz+api en un solo `npm test`, y SPA) o typecheck (raíz y SPA), o si no compilan las imágenes Docker.

**Archivos:**
- Crear: `.github/workflows/ci.yml` (DESCRITO aquí; el agente lo crea en la ejecución del plan, no como parte de este documento).

**Cambios — describir el workflow con estos jobs:**

- **Triggers:** `pull_request` contra `main` + `push` a `main`. `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`.
- **Job `test-root`** (cubre raíz **y** `api/` — comparten un único `vitest run`):
  - `actions/checkout@v4`; `actions/setup-node@v4` con `node-version: '20'`, `cache: 'npm'`.
  - `services: postgres:16` con `POSTGRES_DB/USER/PASSWORD=intake` y `options` de healthcheck; exportar `DATABASE_URL=postgres://intake:intake@localhost:5432/intake`.
  - `npm ci` → `npx prisma generate` → `npx prisma migrate deploy` (los tests tocan Postgres) → `npm run typecheck` → `npm test`.
  - **Nota obligatoria en el archivo:** NO usar `cd api && npm test` — no existe `api/package.json`; `api/tests/**` ya corre dentro del `npm test` raíz vía `vitest.config.ts`.
- **Job `test-spa`** (paquete independiente):
  - `defaults: { run: { working-directory: spa } }`. `setup-node` con `cache-dependency-path: spa/package-lock.json`.
  - `npm ci` → `npm run typecheck` (`tsc --noEmit`) → `npm test` (`vitest run`). Sin Postgres.
- **Job `docker-build`** (valida que ambas imágenes compilan, **sin push**):
  - `docker/setup-buildx-action@v3` + dos `docker/build-push-action@v6` con `file: Dockerfile.api` y `file: Dockerfile.worker`, `push: false`, `cache-from/to: type=gha`.
- **Branch protection en `main`** (paso de configuración, no de archivo): requerir `test-root`, `test-spa`, `docker-build` para mergear.

**Verificación:**
- Abrir un PR de prueba con un test que falle a propósito → CI rojo, merge bloqueado. Revertir el fallo → CI verde.
- Confirmar en la pestaña Actions que los tres jobs aparecen y que `test-root` ejecuta migraciones contra el `postgres:16` del runner.

**Riesgos:** tests que tocan Postgres fallan si el servicio o `DATABASE_URL` no se exportan; si algún test espera SQLite local, ajustar el helper (`tests/helpers/db.ts`) — pero Plan 1 ya migró a Postgres, así que solo hace falta el servicio en CI.

---

### Tarea 2: `deploy-staging.yml` — auto en merge a `main`

**Objetivo:** Que un merge a `main` despliegue automáticamente a staging, con `prisma migrate deploy` y smoke check a `/health`.

**Archivos:**
- Crear: `.github/workflows/deploy-staging.yml` (DESCRITO; no lo creas en este documento).

**Cambios — describir:**
- **Trigger:** `push: { branches: [main] }`. `concurrency: { group: deploy-staging, cancel-in-progress: false }`.
- **Job `build-push`:** login a GHCR; build + push de `ghcr.io/<org>/intake-api` y `intake-worker` con tags `:<sha>` y `:staging` (reusa cache GHA de `ci.yml`).
- **Job `deploy`** (`needs: build-push`, `environment: staging`): SSH a la VPS de staging →
  1. `docker compose pull`
  2. `docker compose run --rm migrate` (= `prisma migrate deploy`) **antes** de levantar api/worker.
  3. `docker compose up -d`
  4. `curl -fsS https://api-staging.<dominio>/health` → si no responde 200, el job falla.

**Verificación:** un merge real a `main` deja staging en la nueva imagen; el job muestra el `/health` 200 al final. Forzar un fallo de migración → el deploy se detiene antes del `up -d`.

**Riesgos:** secretos SSH mal configurados; orden migración↔up incorrecto. Definir `STAGING_SSH_KEY`, host y `GHCR_TOKEN`/`GITHUB_TOKEN` como GitHub Secrets/Environment.

---

### Tarea 3: `deploy-prod.yml` — manual con aprobación

**Objetivo:** Deploy a producción manual y aprobado, promoviendo la **misma imagen** probada en staging.

**Archivos:**
- Crear: `.github/workflows/deploy-prod.yml` (DESCRITO; no lo creas).

**Cambios — describir:**
- **Trigger:** `workflow_dispatch` con input `image_sha` (SHA probado en staging, `required: true`).
- **Job `deploy`** con `environment: production` (GitHub Environment con **required reviewers** → aprobación manual):
  1. Re-tag `ghcr.io/<org>/intake-api:<sha>` → `:prod` (y worker). No reconstruye.
  2. SSH a VPS prod: `docker compose pull` → `migrate deploy` → `up -d` → smoke `curl /health`.

**Verificación:** disparar el workflow desde la UI; comprobar que GitHub pide aprobación de un reviewer antes de ejecutar `deploy`. Tras aprobar, prod corre la imagen `:<sha>` indicada.

**Riesgos:** promover un SHA no presente en GHCR (validar que el tag existe antes del re-tag); olvidar configurar required reviewers (sin ellos no hay gate de aprobación).

**Secretos de CI (todas las tareas del grupo):** `GHCR_TOKEN`/`GITHUB_TOKEN`, `STAGING_SSH_KEY`, `PROD_SSH_KEY`, hosts. Nunca `OPENROUTER_API_KEY` ni claves de tenant en CI.

---

## GRUPO 5 — Logs estructurados con `tenantId`

### Tarea 4: `tenantId` + `service` en cada línea de log (worker y API)

**Objetivo:** Toda línea de log lleva `tenantId` y `service` (`'api' | 'worker'`) para que soporte filtre "todos los logs del tenant X en la última hora". Sin secretos.

**Archivos:**
- Modificar: `src/lib/logger.ts` (campo `service` base; helper `forTenant`).
- Modificar: `src/pipeline/coordinator.ts` (child logger por mensaje/conexión con `tenantId`).
- Modificar: `api/src/server.ts` (activar logger Fastify con serializers `tenantId`/`reqId`/`service`).
- Crear: `tests/lib/logger.test.ts` (assert: el child logger emite `tenantId` y `service`).

**Cambios:**
- En `src/lib/logger.ts`: añadir `base: { service: 'worker' }` y exportar `export const loggerForTenant = (tenantId: string) => logger.child({ tenantId });`. Mantener `level: LOG_LEVEL ?? 'info'`.
- En el worker (`coordinator.ts`), al procesar un mensaje/operar una conexión: derivar `const log = logger.child({ tenantId })` y usarlo en lugar del logger base. Con `TenantManager` (Fase 2), cada conexión tiene su child con su `tenantId`.
- En la API: cambiar `Fastify({ logger: false })` → logger pino habilitado con `base: { service: 'api' }`, y un hook `onRequest`/`preHandler` que haga `request.log = request.log.child({ tenantId: request.tenantId, reqId: request.id })` tras `authenticate`. Unificar campos: `tenantId`, `reqId`, `service`, `level`, `time`.
- Regla de no-secretos: redactar `authorization`, `OPENROUTER_API_KEY`, teléfonos vía `redact` de pino o serializers.

**Verificación:** `npm test` (incluye el nuevo test del logger) + `npm run typecheck`. Manualmente: arrancar worker con `TENANT_ID` y confirmar que las líneas JSON contienen `tenantId` y `service`.

**Riesgos:** activar el logger Fastify cambia el formato de salida de la API (hoy `logger: false`); revisar tests de la API que asuman ausencia de logs. La centralización (driver Docker → Loki/Better Stack/Vector) es **configuración de infra**, no código: documentarla en el runbook, no en este plan.

---

## GRUPO 2 — Error tracking (Sentry) con `tenantId`

### Tarea 5: Sentry en la API con tag `tenantId`

**Objetivo:** Todo error 5xx / excepción no capturada de la API llega a Sentry con `environment`, `release` (sha) y tag `tenantId`.

**Archivos:**
- Modificar: `package.json` (dependencia `@sentry/node`).
- Crear: `api/src/lib/sentry.ts` (init + `beforeSend` de scrubbing).
- Modificar: `api/src/index.ts` (init al arranque), `api/src/server.ts` (hook que setea el tag `tenantId` por request; `setErrorHandler` que captura 5xx).
- Crear: `api/tests/sentry.test.ts` (con un transport/cliente fake: un 5xx captura un evento con tag `tenantId`).

**Cambios:**
- `api/src/lib/sentry.ts`: `Sentry.init({ dsn: SENTRY_DSN, environment: NODE_ENV, release: process.env.GIT_SHA, tracesSampleRate: 0.1, beforeSend })`. Si `SENTRY_DSN` no está, no-op (no rompe dev/tests). `beforeSend` borra `OPENROUTER_API_KEY`, `INTERNAL_API_TOKEN`, JWT y teléfonos.
- En `server.ts`: tras `authenticate`, en un hook usar un scope aislado por request: `Sentry.getCurrentScope().setTag('tenantId', request.tenantId)`. `setErrorHandler` reporta 5xx al 100% (errores) y deja pasar el manejo normal.

**Verificación:** `npm test` + `npm run typecheck`. El test de Sentry usa un cliente fake y verifica el tag. Sin `SENTRY_DSN`, init es no-op y los tests existentes siguen verdes.

**Riesgos:** doble init si index y server lo llaman; centralizar en `lib/sentry.ts` con guard idempotente.

---

### Tarea 6: Sentry en el worker con `tenantId` por mensaje

**Objetivo:** Un crash en el pipeline de un tenant se atribuye al tenant correcto, no a "el worker".

**Archivos:**
- Crear: `src/lib/sentry.ts` (init compartiendo patrón con la API).
- Modificar: `src/index.ts` (init al bootstrap; `release`=sha; `environment`).
- Modificar: `src/pipeline/coordinator.ts` (envolver el procesamiento de cada mensaje en un scope con `tenantId`).
- Crear: `tests/lib/sentry.test.ts` (cliente fake: una excepción en el pipeline captura evento con tag `tenantId`).

**Cambios:**
- `Sentry.init` igual que la API. En el coordinator, `Sentry.withScope(scope => { scope.setTag('tenantId', tenantId); ... })` alrededor del handler. Hoy `tenantId` viene de `process.env.TENANT_ID`; con `TenantManager` (Fase 2), del `tenantId` de la conexión activa (TODO referenciado).
- Reusar el mismo `beforeSend` de scrubbing.

**Verificación:** `npm test` + `npm run typecheck`. Test confirma el tag bajo error simulado.

**Riesgos:** errores asíncronos de Baileys fuera del scope del mensaje quedan sin `tenantId`; capturar a nivel proceso (`process.on('unhandledRejection')`) con `service: 'worker'` aunque sin tenant.

---

### Tarea 7: Sentry en la SPA con `tenantId` tras login

**Objetivo:** Errores de render y promesas rechazadas en la SPA llegan con `tenantId`, sin PII ni contenido de mensajes.

**Archivos:**
- Modificar: `spa/package.json` (dependencia `@sentry/react`).
- Modificar: `spa/src/main.tsx` (`Sentry.init` en el bootstrap) y el contexto de auth (`Sentry.setTag('tenantId', tenant.id)` tras login; limpiar en logout).
- Añadir un Error Boundary de Sentry alrededor de la app.
- Crear/Modificar: test SPA que verifique que tras "login" se setea el tag (mock de `@sentry/react`).

**Cambios:**
- `Sentry.init({ dsn, environment, release, tracesSampleRate: 0.1 })`; init no-op si no hay DSN (dev). `beforeSend` que **no** envía PII ni cuerpos de mensaje; solo IDs/metadatos.
- Tras login, leer `tenant.id` del perfil y `setTag('tenantId', tenant.id)`.

**Verificación:** `cd spa && npm run typecheck && npm test`. El test mockea Sentry y asegura el tag tras login.

**Riesgos:** enviar PII por defecto (Sentry captura inputs/breadcrumbs) — desactivar `sendDefaultPii` y revisar breadcrumbs.

---

## GRUPO 3 — Métricas + health enriquecido + uptime monitor

### Tarea 8: `/health` enriquecido (DB, versión, uptime)

**Objetivo:** `/health` reporta estado de DB y versión; 503 si Postgres no responde.

**Archivos:**
- Modificar: `api/src/server.ts:44` (`/health`).
- Opcional: nueva ruta `GET /health/worker` que proxyea al endpoint interno del worker.
- Crear: `api/tests/health.test.ts`.

**Cambios:**
- `GET /health` → `200 { ok: true, version: process.env.GIT_SHA, db: 'up', uptimeSec }` tras un `SELECT 1` con timeout corto; `503 { ok: false, db: 'down' }` si falla. Sigue público y barato, sin secretos.
- `version` = sha inyectado por CI como env (`GIT_SHA`).
- Opcional `GET /health/worker`: la API llama a `src/internal/server.ts` (`/internal/wa-status`) con `Authorization: Bearer ${INTERNAL_API_TOKEN}` y agrega el estado de conexiones.

**Verificación:** `npm test` (test con DB up → 200; con prisma mockeado fallando → 503) + `npm run typecheck`.

**Riesgos:** un `SELECT 1` sin timeout cuelga `/health` si Postgres está lento; usar timeout corto y no bloquear.

---

### Tarea 9: Métricas en endpoints `/internal/metrics` (Prometheus text)

**Objetivo:** Exponer mensajes/min, errores LLM, bots conectados y latencia/errores HTTP en un endpoint protegido, en api y worker.

**Archivos:**
- Crear: `src/lib/metrics.ts` (contadores en memoria del worker, por `tenantId`).
- Modificar: `src/internal/server.ts` (añadir `GET /internal/metrics`, ya protegido por el hook bearer existente).
- Modificar: `src/pipeline/coordinator.ts` (incrementar `mensajes` por `tenantId`).
- Modificar: el manejo de límites OpenRouter (Fase 1.3) para incrementar `erroresLLM` por tipo (429/saldo/timeout).
- Modificar: la API para exponer su propio `GET /internal/metrics` (5xx, p95 HTTP) — bajo un guard `INTERNAL_API_TOKEN`.
- Crear: `tests/internal/metrics.test.ts` y `api/tests/metrics.test.ts`.

**Cambios:**
- `metrics.ts`: contadores `messages_total{tenant}`, `llm_errors_total{type}`, `bots_connected` (del adapter; con `TenantManager` de Fase 2, del manager), expuestos en formato Prometheus text.
- El worker reusa su servidor interno (no monta Prometheus completo: para el MVP basta exponer el endpoint y que monitor/alertas lo lean). Histórico (Prometheus+Grafana) queda diferido sin cambiar la instrumentación.

**Verificación:** `npm test` + `npm run typecheck`. Tests: `GET /internal/metrics` sin token → 401; con token → 200 y cuerpo Prometheus con los contadores.

**Riesgos:** `bots_connected` real depende de Fase 2 (`TenantManager`); hasta entonces se deriva del adapter actual vía endpoint interno (TODO referenciado).

---

### Tarea 10: Uptime monitor externo

**Objetivo:** Alertar si la API no responde 200, desde fuera del VPS.

**Archivos:** ninguno de código. Configuración externa + documentación.

**Cambios — describir en el runbook (no en este plan de código):**
- Dar de alta un monitor externo (UptimeRobot / Better Stack / Healthchecks.io — Decisión abierta) que sondee `https://api.<dominio>/health` cada 1–5 min y alerte si no responde 200.
- Externo a propósito: si la VPS entera cae, un monitor interno no avisaría.

**Verificación:** apagar staging a propósito (o devolver 503) y confirmar que el monitor dispara la alerta al canal del operador.

**Riesgos:** depender de un único proveedor; idealmente el mismo que logs/alertas para consolidar.

---

## GRUPO 4 — Alertas operativas

### Tarea 11: Reglas de alerta accionables

**Objetivo:** Convertir métricas/health en avisos al operador, cada uno apuntando al tenant afectado cuando aplique. Criterio duro: **caída de bot → alerta en < 5 min**.

**Archivos:**
- Crear: `src/lib/alerts.ts` (o un job de sondeo dentro del worker/un sidecar ligero) que lea métricas/estado y emita al canal.
- Configuración externa del canal (email + webhook Slack/Telegram — Decisión abierta).
- Crear: `tests/lib/alerts.test.ts` (lógica de umbrales: N min de desconexión dispara; reconexión limpia no dispara).

**Cambios — definir las reglas (del spec §6):**

| Alerta | Disparador | Origen | Severidad |
|--------|-----------|--------|-----------|
| Bot caído | conexión Baileys > N min desconectada (no `loggedOut` esperado) | métrica `bots_connected` + lógica de reconexión Fase 1.3 | alta — objetivo < 5 min |
| Pago fallido | webhook Stripe `invoice.payment_failed` / `past_due` | webhooks Fase 3 (**TODO hasta Fase 3**) | media |
| Error rate alto | tasa de 5xx API o errores de pipeline > umbral en ventana | métricas API / Sentry | alta |
| Saldo OpenRouter bajo | `llm_errors_total` por saldo/429 > umbral, o sondeo de saldo | métrica errores LLM | alta |
| Disco / DB | disco VPS > 85% o `/health` = 503 | uptime monitor + chequeo de disco en el host | crítica |

- **Bot caído:** el sondeo de `bots_connected` corre cada ≤1 min; la alerta se emite tras N min de desconexión sostenida → cumple el criterio < 5 min.
- **Pago fallido:** diseñada aquí, **se cablea cuando Fase 3 exista**; el disparador queda como TODO referenciado al webhook.

**Verificación:** `npm test` (test de umbrales). Manualmente: tumbar la conexión del bot en staging y cronometrar que la alerta llega en < 5 min.

**Riesgos:** flapping (reconexiones rápidas) genera ruido; usar histéresis (N min sostenidos) y deduplicación por tenant. Umbrales (N min, error rate, saldo) son Decisión abierta — afinar con datos de beta.

---

## GRUPO 6 — Panel de operador interno

> Depende de `TenantManager` (Fase 2) y `Subscription` (Fase 3). Construir cuando esas piezas existan; lo que dependa de ellas queda como TODO referenciado.

### Tarea 12: Rol `operator` y guard de autorización

**Objetivo:** Un rol nuevo `operator` (superusuario de plataforma) protege `/admin/*`; un `admin` de tenant no puede acceder.

**Archivos:**
- Modificar: `prisma/schema.prisma` (campo/rol `operator` en el usuario de plataforma; o tabla `OperatorUser`).
- Modificar: `api/src/server.ts` (decorator `requireOperator` análogo a `authenticate`).
- Crear: `api/tests/admin-auth.test.ts`.

**Cambios:** validar el rol `operator` contra el JWT; `requireOperator` rechaza con 403 a roles `admin`/`viewer` de tenant. Toda ruta `/admin/*` lo exige.

**Verificación:** `npm test` — un JWT de `admin` de tenant → 403 en `/admin/*`; un JWT `operator` → pasa.

**Riesgos:** mezclar el rol de plataforma con los roles por tenant; mantenerlos separados explícitamente.

---

### Tarea 13: Rutas `/admin/*` (lista, estado de bot, estado de suscripción, acciones)

**Objetivo:** Listar tenants con estado de bot y de suscripción; suspender/reactivar/reconectar; acciones auditadas.

**Archivos:**
- Crear: `api/src/routes/admin.ts` (`GET /admin/tenants`, `GET /admin/tenants/:id`, `POST /admin/tenants/:id/suspend`, `.../reactivate`, `.../bot/reconnect`).
- Modificar: `api/src/server.ts` (registrar `adminRoutes`).
- Modificar: `prisma/schema.prisma` (tabla `OperatorAuditLog`: quién, cuándo, sobre qué tenant, acción).
- Crear: `api/tests/admin.test.ts`.

**Cambios:**
- `GET /admin/tenants`: `slug`, nombre, industria, fecha de alta, estado.
- Estado de bot por tenant: consume el estado de conexiones — vía `TenantManager.getStatus(tenantId)` (Fase 2); hasta entonces, vía el endpoint interno del worker (`/internal/wa-status`).
- Estado de suscripción: `Subscription.status` (`trial`/`active`/`past_due`/`canceled`) + `currentPeriodEnd` — **consume `Subscription` de Fase 3** (TODO hasta entonces).
- Acciones: **suspender** = cerrar la conexión Baileys en caliente (`TenantManager.removeTenant`) + cortar acceso; **reactivar** = recrearla (`addTenant`); **reconnect/logout** del bot. Sin reiniciar el proceso ni tocar `docker-compose.yml` (lo que Fase 2 habilita). La suspensión **manual** del operador (p. ej. abuso) es independiente del enforcement por impago de Fase 3 y se registra como tal.
- Toda acción escribe en `OperatorAuditLog`.

**Verificación:** `npm test` — suspender devuelve 200, registra auditoría y (mock de `TenantManager`) llama `removeTenant`; las acciones exigen `operator`.

**Riesgos:** acoplar el panel a la forma exacta de `TenantManager`/`Subscription` antes de que existan; aislar tras una interfaz y mockear en tests.

---

### Tarea 14: Sección `/admin` en la SPA

**Objetivo:** UI mínima sólida para operación: lista + estados + suspender/reactivar; visible solo a `operator`.

**Archivos:**
- Crear: ruta/sección `spa/src/pages/Admin/*` bajo `/admin`, reusando el design system.
- Modificar: el router SPA (mostrar `/admin` solo si el usuario es `operator`).
- Crear: test SPA de la vista admin.

**Cambios:** tabla de tenants con estado de bot y de suscripción; botones suspender/reactivar/reconectar que llaman a `/admin/*`; link "ver últimos errores" a Sentry filtrado por `tenantId`. Para el MVP: lista + estados + suspender/reactivar (gráficas ricas, después).

**Verificación:** `cd spa && npm run typecheck && npm test`. Manualmente: con usuario `operator` se ve `/admin`; con `admin` de tenant, no.

**Riesgos:** exponer `/admin` a roles no autorizados en el cliente (la autorización real es server-side en Tarea 12; el guard SPA es solo UX).

---

## Riesgos globales

1. **`cd api && npm test` en CI** — error clásico: NO existe `api/package.json`. El único `npm test` raíz cubre `tests/**` y `api/tests/**`. Documentarlo en el propio `ci.yml`.
2. **Tests Prisma en CI** — requieren `postgres:16` como servicio + `migrate deploy`; sin eso fallan con "relation does not exist".
3. **Secretos en logs/errores/CI** — `beforeSend` de Sentry y `redact` de pino deben cubrir `OPENROUTER_API_KEY`, `INTERNAL_API_TOKEN`, JWT, teléfonos. Nunca claves de tenant en GitHub.
4. **Activar el logger Fastify** cambia la salida de la API (hoy `logger: false`); revisar tests que asuman silencio.
5. **Dependencias de fase** — `bots_connected`, suspender/reactivar (Fase 2) y estado de suscripción / pago fallido (Fase 3) quedan como TODO referenciado hasta que esas fases aterricen; no bloquean CI/CD, logs ni errores.
6. **Flapping de alertas** — usar histéresis y deduplicación por tenant.
7. **Doble init de Sentry** — guard idempotente en `lib/sentry.ts`.

---

## Decisiones abiertas (heredadas del spec §10)

1. Proveedor de error tracking: Sentry SaaS (default) vs. self-host vs. GlitchTip (¿exige Fase 6 que los datos no salgan del VPS?).
2. Proveedor de logs centralizados: Better Stack / Grafana Loki (self-host) / Datadog.
3. Uptime monitor: UptimeRobot / Better Stack / Healthchecks.io.
4. Canal de alertas: email + Telegram probablemente basta para 2 tenants; PagerDuty es sobre-ingeniería.
5. Prometheus/Grafana ahora o después (MVP solo expone endpoints).
6. Registro de imágenes: GHCR (menor fricción).
7. Umbrales: N min de "bot caído", error rate, saldo OpenRouter — afinar en beta.

---

## Checklist final de aceptación

- [ ] Existe `.github/workflows/ci.yml`; un PR **no es mergeable** si fallan tests (raíz+api en un `npm test`, y SPA) o `typecheck` (raíz y SPA).
- [ ] CI construye `Dockerfile.api` y `Dockerfile.worker` en cada PR; un fallo de build bloquea el merge.
- [ ] Merge a `main` despliega automáticamente a **staging** (`prisma migrate deploy` + smoke `/health`).
- [ ] Deploy a **producción** es manual y requiere aprobación (Environment `production` con reviewer), promoviendo la imagen ya probada en staging.
- [ ] Un error en producción aparece en Sentry con el `tenantId` correcto, en **api, worker y spa**.
- [ ] `/health` reporta estado de DB y versión; un **uptime monitor externo** alerta si la API no responde.
- [ ] Hay métricas de mensajes/min, errores LLM y bots conectados en un endpoint protegido (`/internal/metrics`).
- [ ] Una **caída de bot dispara alerta al operador en < 5 min**.
- [ ] Existen alertas para pago fallido (cableada cuando Fase 3 exista), error rate alto, saldo OpenRouter bajo y disco/DB.
- [ ] Los logs están centralizados y cada línea lleva `tenantId` y `service`; soporte puede filtrar por tenant. Ningún log contiene secretos.
- [ ] El **panel de operador** lista tenants con estado de bot y de suscripción y permite suspender/reactivar, conectado a `TenantManager` (Fase 2) y `Subscription` (Fase 3); acciones auditadas y restringidas al rol `operator`.
- [ ] Suite raíz+api (`npm test`) y SPA (`cd spa && npm test`) verdes; `npm run typecheck` (raíz y SPA) sin errores.
