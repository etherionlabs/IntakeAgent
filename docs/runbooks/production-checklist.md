# Checklist de despliegue a producción — Intake SaaS

Arquitectura desplegada (Enfoque C mínimo):

```
Netlify (SPA)  ──HTTPS──>  nginx (host, TLS)  ──>  api:3001 (Docker)
                                                      │
                                   red interna Docker │
                              ┌───────────────────────┼─────────────────────┐
                              ▼                        ▼                     ▼
                         postgres:5432          worker-<tenant>:3002    (más workers)
                         (sin puerto público)   (sin puerto público)
```

Reglas de oro: **Postgres y los workers nunca exponen puertos públicos.** La **API (3001) es la única superficie pública** del backend, detrás de nginx con TLS. La SPA en Netlify habla **solo** con la API.

---

## 0. Pre-requisitos en el VPS
- Docker + Docker Compose plugin.
- nginx + certbot (`sudo apt install nginx certbot python3-certbot-nginx`).
- DNS: `api.<tu-dominio>` → IP del VPS.
- Cuenta Netlify conectada al repo.

## 1. Secretos (genera valores fuertes — NO reutilizar el .env de ejemplo)
```bash
cp .env.example .env
# Genera secretos:
openssl rand -hex 32   # POSTGRES_PASSWORD
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # INTERNAL_API_TOKEN
```
Rellena en `.env`: `POSTGRES_PASSWORD`, `JWT_SECRET`, `INTERNAL_API_TOKEN`, `OPENROUTER_API_KEY` (con **límite de gasto** configurado en OpenRouter y clave revocable), `CORS_ORIGIN=https://<tu-sitio>.netlify.app`, y los `TENANT_<NEGOCIO>_ID` (se llenan en el paso 4).

## 2. config.json del negocio (POR REVISAR antes de producción)
- ⚠️ `owner.phoneE164` está hoy en un número de prueba (`+13058799511`). **Cámbialo al WhatsApp real del dueño** que recibirá las notificaciones, o el bot notificará a un número equivocado.
- Revisa `model`, `limits.monthlyCostUsd`, horarios y el `profile` activo.
- El perfil del negocio (schema de intake, prompt) vive en `profiles/<negocio>/`.

## 3. Construir e iniciar la base
```bash
docker compose build
docker compose up -d postgres        # espera "healthy"
docker compose up -d api             # su entrypoint corre `prisma migrate deploy`
curl -s https://api.<dominio>/health # tras configurar nginx (paso 6) → {"ok":true}
```

## 4. Sembrar tenant(s) + usuario(s) del panel
```bash
# Crear el tenant (devuelve su id):
docker compose run --rm api node -e "import('@prisma/client').then(async({PrismaClient})=>{const {PrismaPg}=await import('@prisma/adapter-pg');const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});const t=await p.tenant.create({data:{slug:'tapiceria-demo',name:'Tapicería Demo',industry:'tapiceria',profileDir:'./profiles/tapiceria'}});console.log('TENANT_ID=',t.id);process.exit(0)})"
# Copia el TENANT_ID a TENANT_TAPICERIA_ID en .env.
# Crear el usuario admin del panel:
docker compose run --rm api npm run api:create-user -- tapiceria-demo admin 'ClaveFuerteDelDueño'
```

## 5. Iniciar el worker del tenant
```bash
docker compose up -d worker-tapiceria
docker compose logs -f worker-tapiceria   # primera vez: escanea el QR de WhatsApp
```
(El QR también es consultable vía la API: `GET /wa-status`.)

## 6. nginx + TLS (host)
```bash
sudo cp nginx/intake-api.conf.example /etc/nginx/sites-available/intake-api.conf
# edita server_name al dominio real
sudo ln -s /etc/nginx/sites-available/intake-api.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d api.<dominio>
sudo nginx -t && sudo systemctl reload nginx
```

## 7. SPA en Netlify
- Base dir: `spa` · Build: `npm run build` · Publish: `spa/dist`.
- Env de Netlify: `VITE_API_URL=https://api.<dominio>`.
- Asegura que `CORS_ORIGIN` de la API == URL del sitio Netlify, y redeploy de la API si lo cambiaste.

## 8. Backups (desde el día uno)
```bash
sudo crontab -e
# 0 3 * * * /opt/intake/scripts/backup-postgres.sh >> /var/log/intake-backup.log 2>&1
```
Verifica un restore en staging al menos una vez (ver runbook Plan 1).

## 9. Smoke de producción
- `curl https://api.<dominio>/health` → `{"ok":true}`.
- Login en la SPA con el usuario creado → carga el dashboard.
- Enviar un WhatsApp de prueba al número del bot → aparece un job en el dashboard.

## Deuda técnica registrada (migrar antes de escalar)
1. JWT en `localStorage` → cookie `HttpOnly` + CSRF.
2. Login sin tenant (username global) → incluir `tenantSlug`.
3. Un worker por tenant → `TenantManager` multi-conexión (Enfoque A).
4. Config en `profileDir` (JSON) → tabla `TenantSettings` editable por UI.
5. Onboarding manual → self-service.
6. `wa-status.phone` vacío (el adapter no rastrea el teléfono) → exponerlo.
7. Sin billing → Stripe.
