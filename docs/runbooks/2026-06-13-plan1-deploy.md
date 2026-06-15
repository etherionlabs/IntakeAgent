# Runbook — Plan 1: Despliegue Infra + Worker (VPS + Docker)

## Superficies públicas (regla de oro)
- **PostgreSQL:** nunca expone puerto. Solo red interna Docker.
- **Worker:** nunca expone puerto. Endpoint interno `:3002/internal/wa-status` solo en la red Docker, protegido con `INTERNAL_API_TOKEN`.
- **API (Plan 2):** única superficie pública del backend (`api.etherionlabs.com`), detrás de nginx con TLS en el host.
- **SPA (Plan 3):** Netlify, habla solo con la API.

## Variables de entorno (host `.env`, copiar de `.env.example`)
- `POSTGRES_PASSWORD`, `INTERNAL_API_TOKEN`, `OPENROUTER_API_KEY`, `TENANT_<NEGOCIO>_ID`.
- **API (Plan 2):** `JWT_SECRET` (secreto fuerte; rotarlo invalida todas las sesiones), `CORS_ORIGIN` (URL del sitio Netlify, ej. `https://intake.netlify.app`).

## Primer despliegue
1. Clonar el repo en el VPS (ej. `/opt/intake`).
2. `cp .env.example .env` y rellenar valores reales.
3. `docker compose build`
4. `docker compose up -d postgres` y esperar healthy.
5. Sembrar el primer tenant (operador, manual por ahora — onboarding self-service es deuda técnica):
   ```bash
   docker compose run --rm worker-tapiceria \
     node -e "import('@prisma/client').then(async ({PrismaClient})=>{const {PrismaPg}=await import('@prisma/adapter-pg');const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});const t=await p.tenant.create({data:{slug:'tapiceria-demo',name:'Tapicería Demo',industry:'tapiceria',profileDir:'./profiles/tapiceria'}});console.log('TENANT_ID=',t.id);process.exit(0)})"
   ```
   Copiar el `TENANT_ID` impreso a `TENANT_TAPICERIA_ID` en `.env`.
6. `docker compose up -d worker-tapiceria`. El entrypoint corre `prisma migrate deploy` antes de arrancar.
7. Ver el QR de Baileys: `docker compose logs -f worker-tapiceria` (primera vez) o vía el endpoint interno cuando la API esté lista (Plan 2). Escanear desde WhatsApp.

## API Central (Plan 2)
- **Única superficie pública** del backend, en el puerto `3001` (mapea `3001:3001`). Detrás de nginx con TLS en el host (`api.etherionlabs.com → localhost:3001`). Postgres y workers nunca exponen puerto.
- Arranque: `docker compose up -d api`. El entrypoint corre `prisma migrate deploy` antes de arrancar (es el lugar natural de las migraciones; el worker también lo corre de forma idempotente — Prisma usa advisory lock).
- **Crear el primer usuario del panel** (tras sembrar el tenant en el paso 5):
  ```bash
  docker compose run --rm api npm run api:create-user -- <tenantSlug> <username> <password> [admin|viewer]
  # ej: docker compose run --rm api npm run api:create-user -- tapiceria-demo admin 'unaClaveFuerte'
  ```
- **Verificar:** `curl -s https://api.etherionlabs.com/health` → `{"ok":true}`; `POST /auth/login {username,password}` → `{ token, user }`.
- **Endpoints:** `POST /auth/login`, `GET /profile`, `GET /jobs[?status=]`, `GET /jobs/:id`, `PATCH /jobs/:id/intake`, `POST /jobs/:id/actions {mark_ready|close}`, `GET /contacts`, `PATCH /contacts/:id {botPaused}`, `GET /usage`, `GET /wa-status` (proxy al worker). Todos salvo `/health` y `/auth/login` exigen `Authorization: Bearer <JWT>` y filtran por el `tenantId` del token.
- **nginx (host, fuera de compose):** TLS termination + proxy_pass a `http://localhost:3001`. La SPA en Netlify habla solo con esta API; `CORS_ORIGIN` debe ser la URL del sitio Netlify.
- **Nota multi-tenant del login (deuda):** hoy el `username` debe ser globalmente único (el login no recibe tenant). Al escalar, incluir `tenantSlug` en el login.

## Migraciones
- `prisma migrate deploy` corre automáticamente en el entrypoint de la API y del worker. Nunca usar `migrate dev` en producción.
- Alternativa: un servicio `migrate` de un solo uso en compose que corre `prisma migrate deploy` y termina, con api/workers en `depends_on`.

## Backups
- Configurar cron en el host: `0 3 * * * /opt/intake/scripts/backup-postgres.sh`.
- Verificar restore en staging: `gunzip -c backup-XXXX.sql.gz | docker compose exec -T postgres psql -U intake intake`.

## Agregar un tenant nuevo
1. Crear la fila `Tenant` (paso 5).
2. Duplicar el bloque `worker-<slug>` en `docker-compose.yml` con su `TENANT_ID`, `profileDir` y volúmenes propios.
3. Añadir `TENANT_<SLUG>_ID` al `.env`.
4. `docker compose up -d worker-<slug>`. Sin cambios de código.

## Deuda técnica registrada (spec §9)
Auth en localStorage → cookie HttpOnly; un worker por tenant → TenantManager; config en profileDir → tabla TenantSettings; onboarding manual → self-service; sin billing → Stripe.
