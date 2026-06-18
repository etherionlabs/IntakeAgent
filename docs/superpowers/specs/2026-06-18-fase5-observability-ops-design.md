# Fase 5 — Observabilidad y operaciones — Diseño

**Fecha:** 2026-06-18
**Estado:** Propuesta para implementación
**Fase del roadmap:** 5 (de `docs/ROADMAP-PRODUCCION.md`)
**Esfuerzo estimado:** 1.5–2 semanas

---

## 1. Objetivo

Poder **operar el SaaS con varios clientes sin volar a ciegas**: detectar y
diagnosticar fallos antes (o a la vez) que el cliente, automatizar el ciclo de
build/test/deploy, y dar a soporte una herramienta para ver y actuar sobre el
estado de cada tenant. Cierra las **brechas 7 (sin CI/CD) y 8 (sin
observabilidad)** de la línea base del roadmap.

La pregunta que guía cada decisión: *"¿esto nos avisa de un problema antes de que
nos lo cuente un cliente enojado, y nos deja arreglarlo rápido?"*.

### Posición en el roadmap

Esta fase **puede correr en paralelo desde la Fase 1** y no está en la ruta
crítica (1 → 2 → 3 → 4 → 7), pero **es requisito del Go/No-Go**: el checklist de
lanzamiento exige "Monitoreo y alertas activos". Sus piezas se construyen
incrementalmente:

- El **CI/CD** conviene tenerlo desde el inicio de la Fase 1 (cada PR de
  hardening ya se beneficia de tests automáticos).
- El **rastreo de errores y logs con `tenantId`** dependen de que `tenantId`
  exista en el contexto: el modelo ya lo tiene (línea base), así que se puede
  instrumentar en paralelo. El `TenantManager` (Fase 2) refina las métricas
  "bots conectados" hacia un modelo multi-conexión.
- Las **alertas de pago fallido** se conectan a los webhooks de Stripe (Fase 3),
  pero se diseñan aquí y se cablean cuando Fase 3 aterrice.
- El **panel de operador** consume `TenantManager` (Fase 2) y `Subscription`
  (Fase 3); se construye en cuanto esas piezas existan, sin bloquear el resto.

> No todo se entrega de golpe: CI/CD y logs/errores primero (sirven a todas las
> fases); panel de operador y alertas de billing cuando sus dependencias estén.

---

## 2. Estado actual verificado (punto de partida)

| Pieza | Estado en el código | Implicación |
|-------|---------------------|-------------|
| CI/CD | **No existe** `.github/workflows/` (verificado). Build/test/deploy son manuales. | Construir desde cero. |
| Tests raíz + api | `npm test` → `vitest run`; `vitest.config.ts` incluye `tests/**` y `api/tests/**` en un solo run (no hay `api/package.json` separado). `fileParallelism: false`. | El "test de api" **no** es un paquete aparte; corre dentro del `npm test` de la raíz. |
| Tests SPA | `spa/package.json`: `npm test` → `vitest run`, `npm run typecheck` → `tsc --noEmit`. | Job de CI separado con `working-directory: spa`. |
| Typecheck raíz | `package.json`: `npm run typecheck` → `tsc --noEmit`. | Job de CI. |
| Imágenes Docker | `Dockerfile.api` y `Dockerfile.worker` (ambos `node:20-bookworm-slim`, `npm ci` + `prisma generate`). | El build de CI valida que ambas imágenes compilan. |
| Health | `api/src/server.ts:44` → `app.get('/health', async () => ({ ok: true }))`. | Existe pero es trivial; se enriquece (DB, worker, build). |
| Logs | `src/lib/logger.ts` = `pino({ level: LOG_LEVEL ?? 'info' })`, sin binding de `tenantId`, sin transporte centralizado. La API usa el logger de Fastify por separado. | Falta `tenantId` y centralización. |
| Endpoint interno worker | `src/internal/server.ts` expone status protegido con `INTERNAL_API_TOKEN`. | Punto natural para exponer métricas del worker. |
| Rastreo de errores | **No existe.** | Construir desde cero (API, worker, SPA). |

---

## 3. CI/CD con GitHub Actions

Carpeta nueva `.github/workflows/`. Tres workflows: **`ci.yml`** (calidad en cada
PR), **`deploy-staging.yml`** (auto en merge a `main`) y **`deploy-prod.yml`**
(manual/aprobado).

### 3.1 `ci.yml` — en cada Pull Request

**Trigger:** `pull_request` contra `main` (+ `push` a `main` para tener señal en
la rama protegida). Concurrency con `cancel-in-progress` para no acumular runs.

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  test-root:        # raíz + api/ (un solo vitest run) + typecheck raíz
  test-spa:         # spa/: tsc --noEmit + vitest
  docker-build:     # build de Dockerfile.api y Dockerfile.worker (sin push)
```

**Job `test-root`** (cubre raíz **y** `api/`, porque comparten un `vitest run`):

```yaml
  test-root:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npx prisma generate
      - run: npm run typecheck      # tsc --noEmit (raíz)
      - run: npm test               # vitest: tests/** + api/tests/**
```

> Nota concreta: NO hay un `npm test` en `api/` (no existe `api/package.json`).
> Los tests de la API (`api/tests/*.test.ts`) ya están incluidos en el `npm test`
> de la raíz vía `vitest.config.ts`. El job no debe intentar `cd api && npm test`.
> Si algún test toca Postgres/Prisma, el job levanta un servicio `postgres:16`
> (`services:`) y exporta `DATABASE_URL`, replicando el compose; `prisma migrate
> deploy` antes de los tests.

**Job `test-spa`** (paquete independiente):

```yaml
  test-spa:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: spa } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: spa/package-lock.json }
      - run: npm ci
      - run: npm run typecheck      # tsc --noEmit
      - run: npm test               # vitest run
```

**Job `docker-build`** (valida que las imágenes compilan, sin publicar):

```yaml
  docker-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with: { context: ., file: Dockerfile.api, push: false, cache-from: type=gha, cache-to: type=gha,mode=max }
      - uses: docker/build-push-action@v6
        with: { context: ., file: Dockerfile.worker, push: false, cache-from: type=gha, cache-to: type=gha,mode=max }
```

**Branch protection en `main`:** requerir que `test-root`, `test-spa` y
`docker-build` pasen para poder mergear. Esto implementa el criterio "PR no
mergeable si fallan tests o typecheck".

### 3.2 `deploy-staging.yml` — auto en merge a `main`

**Trigger:** `push` a `main` (i.e. tras merge del PR). Reusa las imágenes:
construye y **publica** `api` y `worker` a un registro (GHCR), luego despliega a
la VPS de staging por SSH.

```yaml
name: Deploy staging
on:
  push: { branches: [main] }
concurrency: { group: deploy-staging, cancel-in-progress: false }
jobs:
  build-push:
    # build + push de ghcr.io/<org>/intake-api:sha y intake-worker:sha (tag :staging)
  deploy:
    needs: build-push
    environment: staging
    steps:
      - # ssh a la VPS de staging:
        #   docker compose pull
        #   docker compose run --rm migrate   (prisma migrate deploy)
        #   docker compose up -d
        #   curl -fsS https://api-staging.../health   (smoke check; falla el job si no responde)
```

Migraciones Prisma (`prisma migrate deploy`) corren como paso del deploy, **antes**
de levantar api/workers, consistente con la sección 8.1 del spec de despliegue.

### 3.3 `deploy-prod.yml` — manual / aprobado

**Trigger:** `workflow_dispatch` (botón manual) con input de la imagen/sha a
promover, **+ `environment: production` con required reviewers** (aprobación
manual de GitHub Environments). Promueve la **misma imagen** ya probada en
staging (re-tag `:staging` → `:prod`), no reconstruye desde cero.

```yaml
name: Deploy prod
on:
  workflow_dispatch:
    inputs:
      image_sha: { description: 'SHA de imagen a promover (probada en staging)', required: true }
jobs:
  deploy:
    environment: production    # ← GitHub pide aprobación de un reviewer aquí
    steps:
      - # re-tag ghcr image :<sha> → :prod
      - # ssh VPS prod: compose pull + migrate deploy + up -d + /health smoke
```

**Secretos de CI** (GitHub Secrets / Environments): `GHCR_TOKEN` (o `GITHUB_TOKEN`),
`STAGING_SSH_KEY`, `PROD_SSH_KEY`, hosts. Nunca claves de tenant ni
`OPENROUTER_API_KEY` en CI: esas viven solo en el `.env` de cada VPS.

---

## 4. Rastreo de errores (Sentry o equivalente)

Instrumentar **API, worker y SPA** con captura de excepciones no manejadas y
contexto de `tenantId`. Proveedor recomendado por defecto: **Sentry**
(self-host posible si el dato lo exige); ver Decisiones abiertas.

### 4.1 Principio: todo error lleva `tenantId`

El dato ya existe en el modelo (línea base: `tenantId` en todas las tablas) y en
el contexto de ejecución:

- **API:** el `tenantId` viene del JWT (`request.tenant`). Un hook
  `onRequest`/`preHandler` de Fastify hace `Sentry.getCurrentScope().setTag('tenantId', request.tenant.id)`
  por request (usando un scope aislado por request). Los errores 5xx y las
  excepciones no capturadas se reportan con ese tag.
- **Worker:** cada conexión Baileys opera bajo un `tenantId` (hoy
  `process.env.TENANT_ID`; con el `TenantManager` de Fase 2, el `tenantId` de la
  conexión activa). El procesamiento de cada mensaje se envuelve en un scope con
  el `tenantId` del mensaje, de modo que un crash en el pipeline de un tenant se
  atribuye al tenant correcto, no a "el worker".
- **SPA:** `Sentry.init` en el bootstrap de React; tras el login se hace
  `Sentry.setTag('tenantId', tenant.id)` (del perfil del usuario). Captura
  errores de render (Error Boundary) y promesas rechazadas. **No** se envían PII
  ni contenido de mensajes; solo IDs y metadatos.

### 4.2 Integración concreta

- API/worker: `@sentry/node` inicializado en el bootstrap (`api/src/index.ts`,
  `src/index.ts`), con `environment` (`staging`/`production`) y `release` = sha
  del deploy (lo aporta CI). El `LOG_LEVEL`/pino y Sentry conviven: pino para el
  flujo, Sentry para excepciones.
- Filtrado de ruido: scrubbing de datos sensibles (`OPENROUTER_API_KEY`,
  `INTERNAL_API_TOKEN`, JWT, teléfonos) vía `beforeSend`. Consistente con la
  regla de Fase 1 "nada de claves en logs".
- `tracesSampleRate` bajo (p. ej. 0.1) para no inflar costo; errores siempre al
  100%.

---

## 5. Métricas y health

### 5.1 `/health` enriquecido

Hoy `api/src/server.ts:44` devuelve `{ ok: true }`. Se amplía a un health
**con dependencias** (sigue siendo público y barato, sin filtrar secretos):

```
GET /health
  → 200 { ok: true, version: "<sha>", db: "up", uptimeSec: N }
  → 503 { ok: false, db: "down" }   // si Postgres no responde
```

- `db`: un `SELECT 1` con timeout corto.
- `version`: el sha del build (inyectado por CI como env).
- Opcional `GET /health/worker`: la API consulta el endpoint interno del worker
  (`src/internal/server.ts`, ya protegido con `INTERNAL_API_TOKEN`) y agrega el
  estado de las conexiones.

### 5.2 Métricas básicas

Métricas mínimas que importan para operar (no observabilidad de lujo):

| Métrica | Fuente | Para qué |
|---------|--------|----------|
| **mensajes/min** | contador en el pipeline del worker (por `tenantId`) | detectar caídas de tráfico / picos |
| **errores LLM** (429, saldo agotado, timeouts OpenRouter) | el manejo de límites de OpenRouter (Fase 1.3) incrementa un contador por tipo | alerta de saldo bajo / degradación |
| **bots conectados** | estado de las conexiones Baileys (Enfoque A: del `TenantManager`; hoy: del adapter via endpoint interno) | saber cuántos tenants tienen el bot vivo |
| **latencia/errores de la API** | métricas HTTP de Fastify (5xx, p95) | salud de la API |

**Cómo se exponen:** un endpoint `GET /internal/metrics` (en formato Prometheus
text, protegido con `INTERNAL_API_TOKEN`) tanto en la API como en el worker. El
worker reusa su servidor interno existente. Para el MVP **no** hace falta montar
un Prometheus completo: basta exponer el endpoint y que el monitor/alertas (o un
agente ligero) lo lean. Si más adelante se quiere histórico, se añade Prometheus
+ Grafana sin cambiar la instrumentación.

### 5.3 Uptime monitor externo

Un monitor **externo al VPS** (UptimeRobot / Better Stack / Healthchecks.io —
ver Decisiones abiertas) que sondea `https://api.<dominio>/health` cada 1–5 min y
**alerta si no responde 200**. Externo a propósito: si la VPS entera cae, un
monitor interno no podría avisar. Cubre el caso "la API está caída" que ninguna
métrica interna detectaría.

---

## 6. Alertas operativas

Las alertas son el producto real de esta fase: convierten métricas en avisos
accionables. Canal de entrega: **email + un webhook a Slack/Telegram del
operador** (decidir canal exacto en Decisiones abiertas). Cada alerta apunta al
tenant afectado cuando aplica.

| Alerta | Disparador | Origen | Severidad |
|--------|-----------|--------|-----------|
| **Bot caído** | una conexión Baileys lleva > N min desconectada (no `loggedOut` esperado) | métrica "bots conectados" + lógica de reconexión de Fase 1.3 | alta — objetivo < 5 min |
| **Pago fallido** | webhook Stripe `invoice.payment_failed` / `subscription` a `past_due` | webhooks de Fase 3 | media (avisa a operador + dueño) |
| **Error rate alto** | tasa de 5xx de la API o de errores en el pipeline supera umbral en ventana | métricas API / Sentry | alta |
| **Saldo OpenRouter bajo** | contador "errores LLM" por saldo/429 supera umbral, o sondeo del saldo de la cuenta | métrica errores LLM | alta — bloquea el servicio |
| **Disco / DB** | uso de disco del VPS > 85% o Postgres no responde (`/health` = 503) | uptime monitor + chequeo de disco en el host | crítica |

- **Bot caído** cumple directamente el criterio de aceptación "una caída de bot
  dispara alerta al operador en < 5 min": el sondeo de "bots conectados" corre
  cada ≤1 min y la alerta se emite tras N min de desconexión sostenida.
- **Saldo OpenRouter bajo** se ata al manejo de límites de Fase 1.3 (degradar sin
  perder mensajes) — la alerta avisa al operador para recargar antes de que
  afecte a clientes.
- **Pago fallido** se diseña aquí pero **se cablea cuando Fase 3 exista**; hasta
  entonces el disparador queda como TODO referenciado al webhook.

---

## 7. Logs estructurados centralizados

Pino ya está (`src/lib/logger.ts`). Dos cambios:

### 7.1 `tenantId` en cada log

El logger base no tiene binding de tenant. Se usa **child loggers** por contexto:

- **Worker:** al procesar un mensaje / operar una conexión, derivar
  `logger.child({ tenantId })`. Con `TenantManager` (Fase 2), cada conexión tiene
  su child logger con su `tenantId`.
- **API:** usar el logger por-request de Fastify enriquecido con
  `{ tenantId: request.tenant.id, reqId }` (Fastify ya inyecta `reqId`). Hoy la
  API y `src/lib/logger.ts` son dos caminos; se unifica el formato (campos
  `tenantId`, `reqId`, `service`, `level`, `time`) para que ambos sean
  agregables.
- Campo `service: 'api' | 'worker'` en cada línea para distinguir origen.

### 7.2 Centralización

Logs a **stdout en JSON** (pino ya lo hace) → recogidos por el runtime de Docker
y enviados a un destino central (Better Stack / Grafana Loki / Datadog — ver
Decisiones abiertas) vía un driver de logging o un agente (p. ej. Vector/Promtail
en el host). Con `tenantId` en cada línea, soporte puede filtrar "todos los logs
del tenant X en la última hora" — esencial para diagnosticar incidentes por
cliente. Se mantiene la regla de no loguear secretos ni contenido sensible.

---

## 8. Panel de operador / admin interno

Herramienta interna (no es el panel del cliente) para que **soporte/operación**
vea y actúe sobre el SaaS. Acceso restringido a un rol nuevo **`operator`**
(superusuario de plataforma, distinto de los roles `admin`/`viewer` por tenant).

### 8.1 Qué muestra y permite

- **Lista de tenants:** `slug`, nombre, industria, fecha de alta, estado.
- **Estado de bots por tenant:** conectado / desconectado / QR pendiente
  (consume el estado de conexiones).
- **Estado de suscripción por tenant:** `trial` / `active` / `past_due` /
  `canceled`, `currentPeriodEnd` (consume `Subscription` de Fase 3).
- **Acciones de soporte:** **suspender** y **reactivar** un tenant (corta/restaura
  el bot y el acceso), forzar reconexión/logout del bot, ver últimos errores
  (link a Sentry filtrado por `tenantId`).
- Todas las acciones de operador quedan **auditadas** (quién, cuándo, sobre qué
  tenant).

### 8.2 Cómo se conecta con las fases previas

- **Con `TenantManager` (Fase 2):** el panel lee el estado de conexiones y dispara
  `addTenant` / `removeTenant` / `getStatus(tenantId)` / reconnect del
  `TenantManager`. "Suspender un bot" = cerrar su conexión Baileys en caliente;
  "reactivar" = recrearla. Sin reiniciar el proceso ni tocar `docker-compose.yml`
  (justamente lo que Fase 2 habilita).
- **Con `Subscription` (Fase 3):** el panel lee `Subscription.status` para mostrar
  el estado de cobro y entender *por qué* un tenant está suspendido (impago vs.
  suspensión manual de soporte). Una suspensión por impago la maneja el
  enforcement de Fase 3; la suspensión **manual** del operador es independiente
  (p. ej. abuso) y se registra como tal.
- **Con auth (Fase 1):** el rol `operator` se valida contra el JWT; las rutas del
  panel exigen ese rol y van bajo `/admin/*` en la API, con su propio test de
  autorización (un `admin` de tenant no puede acceder).

### 8.3 Implementación

- Rutas API nuevas `GET /admin/tenants`, `GET /admin/tenants/:id`,
  `POST /admin/tenants/:id/suspend`, `POST /admin/tenants/:id/reactivate`,
  `POST /admin/tenants/:id/bot/reconnect`, protegidas por rol `operator`.
- UI: una sección/ruta separada en la SPA (`/admin`) visible solo a `operator`, o
  una app mínima aparte. Reusa el design system existente.
- Para el MVP de la fase, una versión sólida pero acotada: lista + estados +
  suspender/reactivar. Métricas ricas y gráficas pueden venir después.

---

## 9. Criterios de aceptación

- [ ] Existe `.github/workflows/ci.yml` y un PR **no es mergeable** si fallan los
      tests (raíz+api en un `npm test`, y SPA) o el `typecheck` (raíz y SPA).
- [ ] CI construye `Dockerfile.api` y `Dockerfile.worker` en cada PR; un fallo de
      build bloquea el merge.
- [ ] Merge a `main` despliega automáticamente a **staging** (con `prisma migrate
      deploy` y smoke check a `/health`).
- [ ] Deploy a **producción** es manual y requiere aprobación (GitHub
      Environment `production` con reviewer), promoviendo la imagen ya probada en
      staging.
- [ ] Un error en producción aparece en el rastreador (Sentry o equivalente) con
      el `tenantId` correcto, en API, worker y SPA.
- [ ] `/health` reporta estado de la DB y versión; un **uptime monitor externo**
      alerta si la API no responde.
- [ ] Hay métricas de mensajes/min, errores LLM y bots conectados, expuestas en
      un endpoint protegido.
- [ ] Una **caída de bot dispara alerta al operador en < 5 min**.
- [ ] Existen alertas para pago fallido (cableada cuando Fase 3 exista), error
      rate alto, saldo OpenRouter bajo y disco/DB.
- [ ] Los logs están centralizados y cada línea lleva `tenantId` y `service`;
      soporte puede filtrar por tenant. Ningún log contiene secretos.
- [ ] El **panel de operador** lista tenants con estado de bot y de suscripción y
      permite suspender/reactivar, conectado a `TenantManager` (Fase 2) y
      `Subscription` (Fase 3); las acciones quedan auditadas y restringidas al rol
      `operator`.

---

## 10. Decisiones abiertas

1. **Proveedor de rastreo de errores** — **Sentry** (SaaS) por defecto vs.
   Sentry self-host vs. alternativa (GlitchTip). Trade-off: costo y dónde viven
   los datos de error (¿exige el cumplimiento de Fase 6 que no salgan del VPS?).
2. **Proveedor de logs centralizados** — Better Stack / Grafana Loki
   (self-host, barato) / Datadog (caro, completo). Afecta costo recurrente y
   esfuerzo de operación del propio stack de logs.
3. **Uptime monitor** — UptimeRobot (gratis, simple) vs. Better Stack /
   Healthchecks.io. Idealmente el mismo proveedor que logs para consolidar.
4. **Canal de alertas** — email, Slack, Telegram o PagerDuty. Para 2 tenants
   iniciales probablemente email + Telegram basta; PagerDuty es sobre-ingeniería
   por ahora.
5. **¿Prometheus/Grafana ahora o después?** — el MVP expone endpoints de
   métricas; montar el histórico completo puede esperar hasta tener más tenants.
6. **Registro de imágenes Docker** — GHCR (integrado con Actions) vs. otro. GHCR
   es el camino de menor fricción.
7. **Umbrales de alerta** — definir N minutos de desconexión para "bot caído",
   umbral de error rate y de saldo OpenRouter; afinar con datos reales en beta.
