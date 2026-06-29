# Runbook — Cutover del piloto en vivo (single-tenant → Fases 1–6 multi-tenant)

**Aplica a:** migrar el **piloto que ya está corriendo** (worker single-tenant vía
`TENANT_ID`, auto-desplegado desde `master`) al código de las Fases 1–6 (PR #8:
worker multi-tenant `TenantManager` + 6 migraciones + billing + auth nuevo).

**Por qué necesita ventana coordinada:** el código viejo y la BD nueva son
**incompatibles entre sí** durante un instante (ver punto de acoplamiento abajo).
No se puede "migrar la BD y seguir con el binario viejo", ni "arrancar el binario
nuevo sin sembrar datos". Por eso es un cutover atómico, no un deploy normal.

> ⚠️ **Mientras no quieras el cutover, NO mergees el PR #8 a `master`.** El piloto
> se auto-despliega desde `master`: un push a `master` dispara `deploy-staging.yml`
> (`pull → prisma migrate deploy → up → smoke`). Con los secretos puestos, ese
> deploy **ejecutaría el cutover por su cuenta** — y de forma incompleta (ver §3).

---

## 1. Los 4 puntos de acoplamiento (lo que rompe si no se ordena)

| # | Qué cambia | Riesgo si se ignora | Mitigación |
|---|-----------|---------------------|------------|
| **A** | Migración `20260620010000` **renombra** `Message.whatsappMsgId → externalMsgId` | El código viejo consulta `whatsappMsgId`; tras migrar, **rompe** | Desplegar código nuevo **junto** con la migración (misma ventana) |
| **B** | Worker nuevo = `TenantManager`: levanta `Tenant` con `active=true` y **exige fila `TenantSettings`** por tenant | Sin `TenantSettings`, el bot lanza *"TenantSettings ausente"* y no conecta | Correr `scripts/backfill-tenant-settings.ts` **antes** de arrancar el worker |
| **C** | API aplica enforcement `402` si el tenant no tiene suscripción activa | El panel del piloto quedaría bloqueado (no hay Stripe) | `BILLING_EXEMPT_TENANT_IDS=<tenantId piloto>` (rápido) **o** crear una `Subscription` real |
| **D** | Worker pasa de `TENANT_ID` a `SHARD_ID`/`SHARD_COUNT` | Sin shard env, no se define qué tenants posee | `SHARD_ID=0`, `SHARD_COUNT=1` (un solo shard para el piloto) |

---

## 2. Prerrequisitos (antes de abrir la ventana)

- [ ] **Backup fresco** de la BD del piloto: `scripts/backup-postgres.sh` (o `pg_dump`).
      El RENAME (A) es el punto de no-retorno fácil; ten el dump a mano.
- [ ] **`tenantId` del piloto** identificado: `SELECT id, name, active FROM "Tenant";`
      Confirma `active = true`.
- [ ] **Decisión de billing del piloto** (C): exención por env **o** suscripción real.
      Para el piloto lo simple es `BILLING_EXEMPT_TENANT_IDS=<tenantId>`.
- [ ] **Env del worker** lista: `SHARD_ID=0`, `SHARD_COUNT=1` (D).
- [ ] **Secretos de CI** (si vas a usar el deploy automático después): `STAGING_SSH_KEY`,
      hosts, `DOMAIN`, GHCR. (Hoy faltan; ver `docs/HANDOFF.md`.)
- [ ] **Tests verdes** en la rama (CI del PR #8) — ya validado: 368 raíz + 46 SPA.

---

## 3. Por qué la PRIMERA transición se hace MANUAL (no con el auto-deploy)

`deploy-staging.yml` hace: `docker compose pull` → `prisma migrate deploy` →
`docker compose up -d` → smoke `/health`.

**No incluye el paso de backfill (B).** Si dejas que el auto-deploy haga el primer
cutover: aplica la migración (renombra la columna y crea tablas) y arranca el worker
nuevo **sin** `TenantSettings` → el `TenantManager` lanza *"TenantSettings ausente"*
y el bot del piloto **no levanta**.

→ **Haz la primera transición manualmente** con la secuencia de §4. Después del
backfill, el auto-deploy desde `master` vuelve a ser seguro (las migraciones
siguientes son aditivas y `TenantSettings` ya existe).

> Alternativa: añadir al deploy un paso
> `docker compose run --rm api npx tsx scripts/backfill-tenant-settings.ts`
> **entre** `migrate deploy` y `up -d`. Si lo haces, el auto-deploy también sirve
> para el primer cutover. Mientras no esté ese paso, usa §4 manual.

---

## 4. Secuencia de cutover (ventana con downtime corto)

```bash
# 0) Anota inicio de ventana. Acepta unos minutos de downtime del bot.

# 1) Backup
scripts/backup-postgres.sh                 # o pg_dump -Fc ... > pre-cutover.dump

# 2) Trae las imágenes nuevas SIN arrancar el worker todavía
docker compose pull
docker compose up -d db                     # asegúrate de que solo la BD está arriba

# 3) Aplica migraciones (incluye el RENAME del punto A)
docker compose run --rm api npx prisma migrate deploy

# 4) Backfill de TenantSettings del/los tenant(s) existentes (punto B)
docker compose run --rm api npx tsx scripts/backfill-tenant-settings.ts
#    Debe reportar "upserted: N" con N = nº de tenants del piloto.

# 5) Set de env nuevas en el entorno del worker/api (puntos C y D):
#    SHARD_ID=0
#    SHARD_COUNT=1
#    BILLING_EXEMPT_TENANT_IDS=<tenantId-del-piloto>
#    (TENANT_ID del worker viejo ya no se usa; puedes quitarlo)

# 6) Confirma el tenant activo
docker compose run --rm api node -e "/* o psql */ SELECT id, active FROM \"Tenant\";"

# 7) Arranca el stack nuevo completo (api + worker multi-tenant)
docker compose up -d

# 8) Smoke (ver §5). Si algo falla → §6 Rollback.
# 9) Cierra la ventana.
```

---

## 5. Verificación post-cutover (smoke)

- [ ] `GET /health` → 200 con DB ok.
- [ ] Login al panel (auth nuevo: cookie HttpOnly + CSRF) funciona.
- [ ] `wa-status` del tenant del piloto = **connected** (no requiere re-escanear QR:
      la sesión Baileys vive en `./data/baileys-session/<tenantId>` — confirma que la
      ruta del piloto coincide con el `tenantId`; si antes era una ruta sin tenant,
      mueve/renombra la carpeta de sesión a `<tenantId>` antes del paso 7).
- [ ] Enviar un WhatsApp de prueba al número del piloto → el bot responde.
- [ ] El panel NO devuelve `402` en rutas de negocio (gracias a `BILLING_EXEMPT_…`).
- [ ] Logs del worker con `tenantId`/`service`, sin secretos.

---

## 6. Rollback

Si el smoke falla **antes** de reanudar tráfico real:

1. **Restaurar imagen anterior** del worker/api (tag previo) y `docker compose up -d`.
2. **Revertir el RENAME** para que el código viejo vuelva a encontrar la columna:
   ```sql
   ALTER TABLE "Message" RENAME COLUMN "externalMsgId" TO "whatsappMsgId";
   ALTER INDEX "Message_tenantId_externalMsgId_key" RENAME TO "Message_tenantId_whatsappMsgId_key";
   ```
   (Las tablas nuevas creadas por las otras migraciones pueden quedarse; son aditivas
   y el código viejo las ignora.)
3. Si el estado quedó inconsistente, **restaurar el dump** del paso 1 de §4
   (`scripts/restore-postgres.sh`).

---

## 7. Después del cutover

- El auto-deploy desde `master` vuelve a ser seguro: migraciones futuras aditivas +
  `TenantSettings` ya sembrado.
- La sesión Baileys del piloto queda bajo `./data/baileys-session/<tenantId>` — sin
  re-escaneo de QR si la ruta se preservó.
- Pendiente de seguimiento (ya anotado en `docs/HANDOFF.md` §2.3): migrar la edición
  de config del panel (`api/src/routes/settings.ts`) por completo a `TenantSettings`.
- Para sumar el 2.º tenant (paquetería) ya es alta en caliente vía panel/onboarding,
  sin tocar infra.
