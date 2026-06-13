# Despliegue SaaS multi-tenant (VPS + Docker + Netlify) — Diseño

**Fecha:** 2026-06-13
**Estado:** Aprobado para implementación
**Enfoque elegido:** C (workers de bot + API compartida), en versión mínima para MVP

---

## 1. Objetivo

Llevar Intake de un monolito on-premise single-tenant a una arquitectura SaaS
multi-tenant desplegada online, **priorizando salir a producción rápido sin
cerrar el camino hacia el SaaS monolítico (Enfoque A) más adelante.**

La pregunta que guía cada decisión no es "qué arquitectura es más elegante",
sino "qué nos deja online más rápido sin cerrar el camino a SaaS".

**Contexto de negocio:**
- Plataforma SaaS general; cada negocio configura su propio perfil de intake.
- Primer mes: 2 tenants (tapicería y paquetería). Después, crecimiento grande
  pero no lineal.
- Estrategia: reducir complejidad → validar → escalar.

---

## 2. Arquitectura

```
Netlify SPA
    │  REST + JWT
    ▼
┌─────────────────────────────────────────────────────┐
│  VPS  — red Docker interna                          │
│                                                     │
│  ┌─────────────────┐                                │
│  │  api            │  único puerto público          │
│  │  (Fastify JSON) │  (443 vía nginx en el host)    │
│  └────┬──────┬─────┘                                │
│       │ SQL  │ HTTP interno (QR/status WA,          │
│       │      │      con INTERNAL_API_TOKEN)         │
│       ▼      ▼                                      │
│  ┌─────────┐  ┌──────────────────┐                  │
│  │ postgres│  │ worker-tenant1   │                  │
│  │ interno │◄─┤ Baileys + bot    │                  │
│  └─────────┘  │ escribe directo  │                  │
│               │ a postgres con   │                  │
│               │ tenant_id        │                  │
│               └──────────────────┘                  │
└─────────────────────────────────────────────────────┘
```

**Tres contenedores Docker + una base de datos compartida como punto de
integración.** El worker escribe directo a PostgreSQL; la API lee de PostgreSQL.
El acoplamiento worker→API se limita a lo estrictamente necesario (consulta de
estado de WhatsApp), nunca para datos de negocio.

### Reglas de red (seguridad)

| Servicio | Puerto público | Acceso |
|----------|---------------|--------|
| `postgres` | **NO** | Solo red interna Docker. Sin `ports:` en Compose. |
| `worker-*` | **NO** | Solo red interna Docker. Sin `ports:` en Compose. |
| `api` | **SÍ** (3001) | Único servicio expuesto. Nginx en el host hace TLS y proxea `api.etherionlabs.com → localhost:3001`. |

**La API es la única superficie pública del backend.** La SPA en Netlify solo
habla con `api.etherionlabs.com`. PostgreSQL y los workers nunca son accesibles
desde fuera del host.

---

## 3. Modelo de datos (PostgreSQL)

Migración de SQLite a PostgreSQL. **DB limpia en el primer despliegue — no hay
migración de datos existentes.**

### Tablas nuevas

```
Tenant
  id          uuid PK
  slug        text unique          -- "tapiceria-demo", "paqueteria-x"
  name        text                 -- nombre del negocio
  industry    text                 -- "tapiceria", "paqueteria", libre
  profileDir  text                 -- "./profiles/tapiceria"
  createdAt   timestamptz

PanelUser
  id           uuid PK
  tenantId     uuid FK → Tenant (NOT NULL)
  username     text
  passwordHash text                 -- bcrypt
  role         text                 -- "admin" | "viewer"
  createdAt    timestamptz
  UNIQUE (tenantId, username)
```

`PanelUser` reemplaza el `PANEL_PASSWORD_HASH` del `.env`.

### Tablas existentes — se añade `tenantId`

Todas reciben `tenantId uuid NOT NULL FK → Tenant`:

- `Contact`
- `Job`
- `Message`
- `AgentRun`
- `CostEntry`
- `WaSession` (aísla la sesión Baileys por tenant)

### Regla de aislamiento (crítica)

**Ningún servicio ni query puede escribir o leer sin `tenantId` explícito.**

- Los métodos de servicio (`contactService`, `jobService`, etc.) reciben
  `tenantId` como parámetro obligatorio — no opcional, no con default.
- El worker obtiene su `tenantId` de `process.env.TENANT_ID` y lo propaga.
- La API obtiene `tenantId` del JWT y filtra **todas** las queries por él.
- Nunca se permite una escritura con `tenantId` nulo o ausente.

### Fuera del MVP (deuda explícita)

- Sin tabla `Subscription` / `Plan` (billing más adelante).
- Solo roles `admin` y `viewer`.
- Config del bot sigue en `profileDir` (JSON), no en una tabla `TenantSettings`.

---

## 4. Worker — cambios mínimos

El código actual en `src/` sigue siendo el worker. Cambios acotados:

### 4.1 SQLite → PostgreSQL
`src/storage/client.ts` cambia de `better-sqlite3` + adaptador a `pg` + `PrismaPg`.
El resto de los servicios no cambia su lógica, solo el cliente Prisma subyacente.

### 4.2 `TENANT_ID` por env
`src/index.ts` lee `process.env.TENANT_ID` (obligatorio; si falta, el worker
falla al arrancar con error claro). Lo propaga a todos los service calls. Los
métodos de servicio reciben `tenantId` y lo usan al filtrar y escribir.

### 4.3 Sale el panel SSR
`src/index.ts` ya no arranca el servidor Fastify del panel (Handlebars + HTMX).
El worker solo arranca Baileys + pipeline + endpoint interno de status.

### 4.4 Endpoint interno de status (protegido)
El worker levanta un HTTP server mínimo en `INTERNAL_PORT` (ej. `3002`), solo
accesible dentro de la red Docker. Protegido con `INTERNAL_API_TOKEN` (header
`Authorization: Bearer <token>`) **aunque esté en red interna** — defensa en
profundidad.

```
GET /internal/wa-status
  Authorization: Bearer ${INTERNAL_API_TOKEN}
  → { connected: bool, qr: string | null, phone: string }
```

---

## 5. API Central — nuevo servicio `api/`

Nueva carpeta `api/` en la raíz. Fastify con JSON puro, sin Handlebars.

### 5.1 Auth
`POST /auth/login` con `{ username, password }` → JWT con claims
`{ userId, tenantId, role }`. Middleware valida el JWT y expone `request.tenant`
en rutas protegidas.

**Decisión MVP + deuda técnica:** El JWT se guarda en `localStorage` en la SPA
**solo como solución temporal de MVP**. Queda registrada la deuda técnica de
migrar a cookie `HttpOnly` + CSRF antes de escalar (ver sección 9).

### 5.2 Endpoints MVP
```
POST   /auth/login
GET    /jobs                 lista por status (filtrado por tenantId del JWT)
GET    /jobs/:id             detalle + intake + mensajes
PATCH  /jobs/:id/intake      editar un campo del intake
POST   /jobs/:id/actions     { action: 'mark_ready' | 'close' }
GET    /contacts             lista
PATCH  /contacts/:id         { botPaused: bool }
GET    /usage                costos + agent runs
GET    /wa-status            proxy → endpoint interno del worker
```

`GET /wa-status` resuelve el worker del tenant (por `slug`/config) y llama
`http://worker-<slug>:<INTERNAL_PORT>/internal/wa-status` con el
`INTERNAL_API_TOKEN`.

### 5.3 Estructura
```
api/
  src/
    index.ts        bootstrap Fastify
    auth/           login + JWT middleware
    routes/         jobs, contacts, usage, wa-status
    db.ts           Prisma client (schema compartido en /prisma)
  Dockerfile.api
```

El schema Prisma vive en `prisma/` en la raíz, **compartido** entre worker y API.

---

## 6. React SPA — alcance MVP

Solo lo necesario para que el piloto funcione online.

**Vistas:**
- **Login** — usuario + contraseña; guarda JWT en `localStorage` (deuda: §9).
- **Dashboard** — jobs por estado (columnas). Clic → detalle.
- **Job detail** — intake editable campo a campo, mensajes, botones de acción.
- **WhatsApp status** — badge conectado/desconectado, QR si está desconectado.
- **Contactos** — lista + toggle bot.

**Stack:** React + Vite + Tailwind. Sin SSR.
**Deploy:** `netlify deploy --prod` desde `spa/dist/`.
**Config:** `VITE_API_URL=https://api.etherionlabs.com` (única var que cambia
entre entornos).

El CSS/design system existente del panel se reutiliza como base de estilos.

---

## 7. Docker Compose

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: intake
      POSTGRES_USER: intake
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    # sin ports: — solo red interna

  api:
    build: { context: ., dockerfile: Dockerfile.api }
    environment:
      DATABASE_URL: postgres://intake:${POSTGRES_PASSWORD}@postgres:5432/intake
      JWT_SECRET: ${JWT_SECRET}
      INTERNAL_API_TOKEN: ${INTERNAL_API_TOKEN}
    ports: ["3001:3001"]
    depends_on: [postgres]

  worker-tapiceria:
    build: { context: ., dockerfile: Dockerfile.worker }
    environment:
      DATABASE_URL: postgres://intake:${POSTGRES_PASSWORD}@postgres:5432/intake
      TENANT_ID: ${TENANT_TAPICERIA_ID}
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY}
      INTERNAL_PORT: 3002
      INTERNAL_API_TOKEN: ${INTERNAL_API_TOKEN}
    volumes:
      - baileys-tapiceria:/app/data/baileys-session
      - media-tapiceria:/app/media
    # sin ports: — la api lo alcanza por nombre de servicio

volumes: [pgdata, baileys-tapiceria, media-tapiceria]
```

**Nginx en el host** (fuera de Compose) hace TLS termination y proxea
`api.etherionlabs.com → localhost:3001`. Worker y postgres nunca se exponen.

**Agregar un segundo tenant** = un registro en `Tenant`, un bloque
`worker-paqueteria` en `docker-compose.yml`, y `TENANT_PAQUETERIA_ID` en `.env`.
Sin cambios de código.

---

## 8. Operaciones

### 8.1 Migraciones Prisma
`prisma migrate deploy` corre como **parte del proceso de deploy**, antes de
arrancar la API y los workers (ej. en el entrypoint de la imagen `api` o como
servicio `migrate` de un solo uso en Compose). Nunca `migrate dev` en producción.

### 8.2 Backup de PostgreSQL (desde el primer despliegue)
Backup básico desde el día uno:
- `pg_dump` diario a un archivo con timestamp en un volumen/carpeta del host
  (ej. cron en el host: `docker exec postgres pg_dump -U intake intake | gzip > backup-$(date +%F).sql.gz`).
- Retención simple (ej. conservar los últimos 7 días).
- Documentado en el runbook de despliegue.

### 8.3 Superficies públicas (documentado)
- **PostgreSQL:** nunca expone puerto público. Solo red interna Docker.
- **Worker:** nunca expone puerto público. Solo red interna Docker.
- **API:** única superficie pública del backend (`api.etherionlabs.com`).
- **SPA:** Netlify, habla solo con la API.

---

## 9. Deuda técnica (registrada para migración futura → Enfoque A)

1. **Auth en `localStorage`** → migrar a cookie `HttpOnly` + protección CSRF
   antes de escalar más allá del piloto.
2. **Un worker por tenant** → eventualmente `TenantManager` multi-conexión en un
   solo proceso (Enfoque A) cuando el número de tenants lo justifique.
3. **Config en `profileDir` (JSON)** → tabla `TenantSettings` editable por UI.
4. **Onboarding manual** (operador crea Tenant + PanelUser a mano) → flujo
   self-service con validación.
5. **Sin billing** → Stripe/suscripciones cuando haya validación real.

---

## 10. Descomposición en planes de implementación

Tres planes secuenciales. Cada uno deja algo desplegable/usable.

| Plan | Contenido | Entregable |
|------|-----------|-----------|
| **1 — Infra + Worker** | Prisma → PostgreSQL, `tenantId` en schema, worker dockerizado con `TENANT_ID`, endpoint interno protegido, Docker Compose, migraciones, backup | Bot online en VPS escribiendo a PostgreSQL con aislamiento por tenant |
| **2 — API Central** | Carpeta `api/`, JWT auth, endpoints REST, proxy `wa-status`, Dockerfile.api | VPS expone API pública consumible |
| **3 — React SPA** | Frontend Vite + React + Tailwind, vistas MVP, deploy Netlify | Dashboard accesible online en Netlify |

Cada plan recibe su propio ciclo spec→plan→implementación según haga falta;
este documento es el spec maestro que los tres comparten.

---

## 11. Criterios de éxito (MVP)

- [ ] El bot de tapicería responde por WhatsApp corriendo en el VPS vía Docker.
- [ ] Todos los datos se persisten en PostgreSQL con `tenantId` correcto.
- [ ] PostgreSQL y el worker no son accesibles desde fuera del host.
- [ ] La API responde en `api.etherionlabs.com` con JWT auth.
- [ ] El dashboard en Netlify permite login, ver jobs, editar intake y ver el
      estado de WhatsApp.
- [ ] Existe un backup diario de PostgreSQL desde el primer día.
- [ ] Agregar el segundo tenant no requiere cambios de código, solo config.
