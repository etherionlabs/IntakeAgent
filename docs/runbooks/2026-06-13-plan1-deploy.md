# Runbook — Plan 1: Despliegue Infra + Worker (VPS + Docker)

## Superficies públicas (regla de oro)
- **PostgreSQL:** nunca expone puerto. Solo red interna Docker.
- **Worker:** nunca expone puerto. Endpoint interno `:3002/internal/wa-status` solo en la red Docker, protegido con `INTERNAL_API_TOKEN`.
- **API (Plan 2):** única superficie pública del backend (`api.etherionlabs.com`), detrás de nginx con TLS en el host.
- **SPA (Plan 3):** Netlify, habla solo con la API.

## Variables de entorno (host `.env`, copiar de `.env.example`)
- `POSTGRES_PASSWORD`, `INTERNAL_API_TOKEN`, `OPENROUTER_API_KEY`, `TENANT_<NEGOCIO>_ID`.

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

## Migraciones
- `prisma migrate deploy` corre automáticamente en el entrypoint del worker. Nunca usar `migrate dev` en producción.
- Alternativa: un servicio `migrate` de un solo uso en compose que corre `prisma migrate deploy` y termina, con los workers en `depends_on`.

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
