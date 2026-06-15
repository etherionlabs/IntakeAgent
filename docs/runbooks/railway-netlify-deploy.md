# Despliegue a producción — Railway (backend) + Netlify (SPA)

Stack real elegido: **Railway** para Postgres + API + worker, **Netlify** para la SPA, dominio **`etherionlabs.com`** (DNS gestionado por Netlify).

```
Netlify (SPA)  etherionlabs.com ──HTTPS──>  Railway: API service  (api.etherionlabs.com, TLS auto)
                                                         │  red privada IPv6 de Railway (*.railway.internal)
                                          ┌──────────────┼───────────────────┐
                                          ▼                                  ▼
                               Railway: Postgres (privado)        Railway: worker-tapiceria (privado, sin dominio)
```

Railway **no usa `docker-compose.yml`** — despliega cada servicio por separado desde su `Dockerfile`. El compose queda solo para desarrollo local. Railway da **Postgres gestionado, TLS y dominios automáticos**: no hay nginx ni certbot que configurar.

> Requisito de código ya aplicado: la API escucha en `process.env.PORT` (Railway lo inyecta) y los servidores aceptan `HOST=::` para la red privada IPv6 de Railway.

---

## A. Mapa de dominios (DNS en Netlify)
- **`etherionlabs.com`** (apex) → la **SPA en Netlify**.
- **`api.etherionlabs.com`** → la **API en Railway** (registro CNAME en Netlify DNS apuntando al dominio que Railway te dé para el servicio API).

---

## B. Railway — crear el proyecto y los 3 servicios

### B.1 Postgres
1. Railway → New Project → **Add → Database → PostgreSQL**.
2. Queda privado por defecto. Expone la variable `DATABASE_URL` (referénciala en otros servicios como `${{Postgres.DATABASE_URL}}`).

### B.2 Servicio API (público)
1. **New → Deploy from GitHub repo** → `etherionlabs/IntakeAgent`.
2. Settings → **Build**: Builder = Dockerfile, **Dockerfile Path = `Dockerfile.api`**.
3. Settings → **Networking**: *Generate Domain* (Railway te da `xxx.up.railway.app`); luego **Custom Domain → `api.etherionlabs.com`** (Railway te dará el CNAME a poner en Netlify DNS; emite TLS solo).
4. **Variables**:
   ```
   DATABASE_URL = ${{Postgres.DATABASE_URL}}
   JWT_SECRET = <openssl rand -hex 32>
   INTERNAL_API_TOKEN = <openssl rand -hex 32>
   WORKER_INTERNAL_URL = http://worker-tapiceria.railway.internal:3002
   CORS_ORIGIN = https://etherionlabs.com
   HOST = ::
   ```
   (No definas `PORT`/`API_PORT`: Railway inyecta `PORT` y la API lo usa.)
5. El entrypoint corre `prisma migrate deploy` en cada deploy → las migraciones se aplican solas.

### B.3 Servicio worker-tapiceria (privado, sin dominio)
1. **New → Deploy from GitHub repo** → mismo repo `etherionlabs/IntakeAgent`.
2. Nómbralo **`worker-tapiceria`** (debe coincidir con el host en `WORKER_INTERNAL_URL` de la API).
3. Settings → **Build**: Dockerfile Path = **`Dockerfile.worker`**.
4. Settings → **Networking**: NO generes dominio (queda solo en red privada).
5. **Volume** (clave): añade un **Volume** montado en **`/app/data`**. Ahí vive la sesión de Baileys (`/app/data/baileys-session`) → sin esto, tendrías que reescanear el QR en cada redeploy.
   - Para que los archivos de media también persistan, pon en `config.json` `media.storeDir = "./data/media"` (mismo volumen). Si no, la media es efímera (aceptable para el piloto).
6. **Variables**:
   ```
   DATABASE_URL = ${{Postgres.DATABASE_URL}}
   TENANT_ID = <uuid del tenant — ver paso C>
   OPENROUTER_API_KEY = <tu key con límite de gasto>
   INTERNAL_PORT = 3002
   INTERNAL_API_TOKEN = <el MISMO valor que en la API>
   HOST = ::
   ```

---

## C. Sembrar el tenant + usuario del panel (una vez)
Desde tu máquina con Railway CLI (`npm i -g @railway/cli`, `railway login`, `railway link` al proyecto), apuntando al servicio API:

```bash
# Crear el tenant (imprime su id):
railway run --service api node -e "import('@prisma/client').then(async({PrismaClient})=>{const {PrismaPg}=await import('@prisma/adapter-pg');const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});const t=await p.tenant.create({data:{slug:'tapiceria-demo',name:'Tapicería Demo',industry:'tapiceria',profileDir:'./profiles/tapiceria'}});console.log('TENANT_ID=',t.id);process.exit(0)})"
# Copia el TENANT_ID → variable TENANT_ID del servicio worker-tapiceria (y redeploy del worker).

# Crear el usuario admin del panel:
railway run --service api npm run api:create-user -- tapiceria-demo admin 'ClaveFuerteDelDueño'
```
(Alternativa sin CLI: usa el shell/one-off command del servicio API en el dashboard de Railway.)

---

## D. Arranque y WhatsApp
1. Redeploy del **worker-tapiceria** ya con `TENANT_ID`.
2. Abre los **logs** del worker en Railway → aparece el **QR de Baileys** → escanéalo con el WhatsApp del negocio. (También consultable luego vía `GET https://api.etherionlabs.com/wa-status` autenticado.)
3. La sesión queda en el volumen → no se vuelve a pedir el QR salvo logout.

---

## E. Netlify — la SPA
1. Netlify → Add new site → Import from Git → repo `etherionlabs/IntakeAgent`.
2. Build settings (ya en `netlify.toml`): **Base = `spa`**, **Build = `npm run build`**, **Publish = `spa/dist`**.
3. **Environment variable**: `VITE_API_URL = https://api.etherionlabs.com`.
4. **Domain**: asigna el apex **`etherionlabs.com`** (y `www` → redirect) a este sitio Netlify.
5. En Netlify DNS añade el **CNAME `api` → el dominio de Railway** del servicio API (paso B.2.3).
6. Verifica que `CORS_ORIGIN` de la API == `https://etherionlabs.com` (si usas también `www`, añade ambos o usa el que sea canónico).

---

## F. Backups
- Railway Postgres ofrece backups gestionados (actívalos en el plan correspondiente).
- Adicional/portátil: `scripts/backup-postgres.sh` sirve si algún día migras a VPS; en Railway usa sus backups nativos o `railway run --service api pg_dump`.

---

## G. Smoke de producción
1. `curl https://api.etherionlabs.com/health` → `{"ok":true}`.
2. Abre `https://etherionlabs.com` → login con el usuario creado → carga el dashboard.
3. Envía un WhatsApp al número del bot → aparece un job en el dashboard.
4. `GET /wa-status` (autenticado) → `connected: true`.

---

## Checklist de variables (resumen)
| Servicio | Variables |
|----------|-----------|
| **Postgres** | (gestionado; expone `DATABASE_URL`) |
| **API** | `DATABASE_URL`, `JWT_SECRET`, `INTERNAL_API_TOKEN`, `WORKER_INTERNAL_URL`, `CORS_ORIGIN`, `HOST=::` |
| **worker-tapiceria** | `DATABASE_URL`, `TENANT_ID`, `OPENROUTER_API_KEY`, `INTERNAL_PORT=3002`, `INTERNAL_API_TOKEN`, `HOST=::` + **Volume en `/app/data`** |
| **Netlify (SPA)** | `VITE_API_URL=https://api.etherionlabs.com` |

## Pendiente solo tuyo antes de ir en vivo
- `config.json → owner.phoneE164` = WhatsApp real del dueño (hoy es de prueba).
- OpenRouter: límite de gasto + key revocable.
- Número de WhatsApp del bot para escanear el QR.

## Deuda técnica (migrar antes de escalar)
JWT en localStorage → cookie HttpOnly · login con `tenantSlug` · un worker por tenant → TenantManager · config en profileDir → tabla TenantSettings · onboarding self-service · `wa-status.phone` vacío · billing (Stripe).
