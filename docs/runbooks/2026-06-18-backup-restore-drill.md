# Runbook — Backup de PostgreSQL y Restore Drill

**Fecha:** 2026-06-18
**Aplica a:** Intake SaaS (Postgres + worker Baileys + media)
**Objetivo operativo:** No solo *tener* backups, sino **poder recuperarse**. Este
runbook cubre el backup diario de Postgres, su retención, el procedimiento de
restore verificable en staging, y la política de sesiones Baileys / media.

**RPO objetivo:** 24 h (backup diario). **RTO objetivo:** < 30 min (medirlo en el
primer drill y registrarlo abajo).

> Compatibilidad de plataforma: el stack local/VPS usa `docker compose`
> (`docker-compose.yml`). En Railway, Postgres es gestionado y ofrece backups
> nativos; ahí usa los backups de Railway o `railway run --service api pg_dump`
> (ver §7). Los comandos de este runbook asumen el stack `docker compose` salvo
> donde se indique.

---

## 1. Backup de PostgreSQL (pg_dump vía Docker)

El script `scripts/backup-postgres.sh` ya existe en el repo. Hace `pg_dump` del
contenedor `postgres`, lo comprime con gzip y aplica retención.

### 1.1 Instalación en el host (una vez)

```bash
# Copia el script al host de producción (ruta convencional /opt/intake):
sudo mkdir -p /opt/intake/scripts /opt/intake/backups
sudo cp scripts/backup-postgres.sh /opt/intake/scripts/
sudo chmod +x /opt/intake/scripts/backup-postgres.sh
```

### 1.2 Ejecución manual (verifica antes de automatizar)

```bash
# Desde el directorio del compose (donde vive docker-compose.yml):
docker compose exec -T postgres pg_dump -U intake intake | gzip > /opt/intake/backups/backup-manual-$(date +%F_%H%M).sql.gz

# O usando el script (respeta BACKUP_DIR / RETENTION_DAYS):
BACKUP_DIR=/opt/intake/backups RETENTION_DAYS=7 /opt/intake/scripts/backup-postgres.sh
```

Verifica que el archivo no esté vacío y sea un gzip válido:

```bash
ls -lh /opt/intake/backups/
gunzip -t /opt/intake/backups/backup-*.sql.gz && echo "gzip OK"
```

### 1.3 Cron diario (desde el día uno)

```bash
sudo crontab -e
# Backup diario a las 03:00, log a /var/log/intake-backup.log:
0 3 * * * BACKUP_DIR=/opt/intake/backups RETENTION_DAYS=7 /opt/intake/scripts/backup-postgres.sh >> /var/log/intake-backup.log 2>&1
```

Checklist post-instalación del cron:

- [ ] `sudo crontab -l` muestra la línea.
- [ ] Al día siguiente existe `backup-YYYY-MM-DD_0300.sql.gz`.
- [ ] `tail /var/log/intake-backup.log` termina en `[backup] OK`.

### 1.4 Retención

- El script borra los `backup-*.sql.gz` con más de `RETENTION_DAYS` (default 7).
- **Recomendado**: conservar **7 diarios + 4 semanales**. Para los semanales,
  copia el backup del domingo a una carpeta aparte que el `find` no toque:

```bash
# Cron semanal (domingos 04:00) — promueve el último diario a "semanal":
0 4 * * 0 cp "$(ls -t /opt/intake/backups/backup-*.sql.gz | head -1)" /opt/intake/backups/weekly/ 2>/dev/null
```

### 1.5 Copia off-host (sobrevivir a la pérdida del VPS)

Un backup que vive en el mismo disco que la DB **no protege** contra perder el
VPS. Replica los dumps fuera del host (bucket S3/R2/GCS u otro servidor):

```bash
# Ejemplo con rclone hacia un bucket (configura el remote 'offsite' una vez):
rclone copy /opt/intake/backups offsite:intake-backups --include 'backup-*.sql.gz'
```

- [ ] Copia off-host automatizada (cron tras el backup diario).
- [ ] Acceso al bucket con credenciales de **solo escritura** desde el host.

---

## 2. Restore Drill (procedimiento verificable en staging)

**La diferencia entre "tengo backups" y "puedo recuperarme".** Este drill se
ejecuta en **staging** (nunca contra producción) y debe completarse al menos
una vez antes del Go-Live y luego con la frecuencia de §5.

> Regla de oro: **nunca** restaures sobre la base de producción. Restaura contra
> una instancia limpia y verifícala antes de tomar cualquier decisión sobre prod.

### 2.1 Preparar una Postgres limpia en staging

```bash
# Opción A — contenedor efímero dedicado al drill (no toca el stack):
docker run -d --name postgres-restore-drill \
  -e POSTGRES_DB=intake -e POSTGRES_USER=intake -e POSTGRES_PASSWORD=drill \
  postgres:16

# Espera a que esté listo:
until docker exec postgres-restore-drill pg_isready -U intake -d intake; do sleep 1; done
```

### 2.2 Restaurar el dump

```bash
# Elige el backup a verificar (p. ej. el más reciente):
BACKUP=/opt/intake/backups/backup-2026-06-18_0300.sql.gz

# Restaura dentro del contenedor de drill:
gunzip -c "$BACKUP" | docker exec -i postgres-restore-drill psql -U intake intake
```

Si en su lugar restauras contra el stack de staging (`docker-compose.yml` de
staging), el comando equivalente es:

```bash
gunzip -c "$BACKUP" | docker compose exec -T postgres psql -U intake intake
```

### 2.3 Validar integridad (lo que da confianza)

Compara conteos contra lo esperado del día del backup. Tablas clave del schema
multi-tenant (todas con `tenantId`):

```bash
docker exec -i postgres-restore-drill psql -U intake intake <<'SQL'
\dt
SELECT 'tenants'   AS tabla, count(*) FROM "Tenant"
UNION ALL SELECT 'panelUsers',  count(*) FROM "PanelUser"
UNION ALL SELECT 'contacts',    count(*) FROM "Contact"
UNION ALL SELECT 'jobs',        count(*) FROM "Job"
UNION ALL SELECT 'messages',    count(*) FROM "Message";
-- Aislamiento: cada tenant debe verse con sus propios datos
SELECT "tenantId", count(*) AS jobs FROM "Job" GROUP BY "tenantId";
SQL
```

Checklist de validación:

- [ ] `\dt` lista todas las tablas esperadas (incluye `_prisma_migrations`).
- [ ] Los conteos coinciden (±tráfico del día) con los del día del backup.
- [ ] Cada `tenantId` aparece con sus jobs/contactos (aislamiento intacto).
- [ ] **Prueba viva (recomendada):** apunta una API/worker de staging a la DB
      restaurada y verifica login + dashboard:

```bash
# DATABASE_URL apuntando al contenedor de drill, luego smoke:
curl -s http://localhost:3001/health   # → {"ok":true}
# Login en la SPA de staging con un usuario conocido → carga el dashboard.
```

### 2.4 Registrar RTO/RPO y limpiar

```bash
# Cronometra desde "elegir backup" hasta "login OK". Anótalo abajo.
docker rm -f postgres-restore-drill   # limpia el contenedor del drill
```

> **Atajo:** el script `scripts/restore-postgres.sh <archivo.sql.gz> [base]` hace
> el restore a una base efímera y muestra los conteos de verificación. Úsalo para
> el drill en vez de tipear los pasos a mano.

| Métrica | Objetivo | Último drill |
|---------|----------|--------------------------|
| RPO (pérdida máxima) | 24 h | 24 h |
| RTO (tiempo de restore) | < 30 min | < 1 min (round-trip local) |
| Fecha del drill | — | 2026-06-20 |
| Backup verificado | — | round-trip `pg_dump → restore` |
| Resultado | — | ✅ OK |

> **Drill ejecutado (2026-06-20):** round-trip `pg_dump` → base efímera
> `intake_restore` validado contra la base de desarrollo: el restore termina sin
> error, un tenant testigo aparece tras restaurar y los conteos coinciden. Falta
> repetirlo en el **staging real con Docker** una vez aprovisionado (Fase 7), con
> la verificación de login de §2.3 y los tiempos reales de RTO.

---

## 3. Respaldo y re-vinculación de sesiones Baileys (WhatsApp)

La sesión de WhatsApp vive en un volumen Docker (`baileys-tapiceria` →
`/app/data/baileys-session` según `docker-compose.yml`). La media vive en
`media-tapiceria` → `/app/media`.

**Política Fase 1 (decidida):**
- **Sesión Baileys:** se acepta **re-vinculación por QR** como recuperación
  (más simple; una caída → re-escanear). Opcionalmente respaldar el volumen.
- **Media:** **sí se respalda** (es irrecuperable si se pierde).

### 3.1 Respaldo opcional del volumen de sesión

```bash
# Snapshot del volumen de sesión Baileys a un tar (evita reescanear el QR):
docker run --rm -v baileys-tapiceria:/data -v /opt/intake/backups:/backup \
  alpine tar czf /backup/baileys-tapiceria-$(date +%F).tar.gz -C /data .
```

### 3.2 Respaldo de media (recomendado)

```bash
docker run --rm -v media-tapiceria:/data -v /opt/intake/backups:/backup \
  alpine tar czf /backup/media-tapiceria-$(date +%F).tar.gz -C /data .
```

### 3.3 Flujo de re-vinculación por QR (recuperación aceptada)

Si la sesión se pierde (volumen borrado, `loggedOut`, migración de host):

```bash
# 1. Asegura que el worker está arriba:
docker compose up -d worker-tapiceria

# 2. Mira los logs: la primera vez (sesión vacía) imprime el QR:
docker compose logs -f worker-tapiceria
#    → escanea el QR con el WhatsApp del negocio.

# 3. Alternativa vía API (autenticado):
curl -s https://api.<dominio>/wa-status   # estado/QR de la conexión
```

- [ ] Tras escanear, `wa-status` reporta `connected: true`.
- [ ] La sesión queda persistida en el volumen → no se vuelve a pedir el QR
      salvo `loggedOut`.

### 3.4 Restaurar un volumen de sesión respaldado (si se eligió respaldarlo)

```bash
docker compose stop worker-tapiceria
docker run --rm -v baileys-tapiceria:/data -v /opt/intake/backups:/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/baileys-tapiceria-2026-06-18.tar.gz -C /data"
docker compose up -d worker-tapiceria
```

---

## 4. Verificación de extremo a extremo tras un restore real (producción)

Si alguna vez restauras producción de verdad (no un drill), tras §2:

- [ ] `curl https://api.<dominio>/health` → `{"ok":true}`.
- [ ] Login en la SPA → dashboard carga con datos.
- [ ] `GET /wa-status` (autenticado) → `connected: true` (re-vincula QR si no).
- [ ] WhatsApp de prueba al bot → aparece un job nuevo.
- [ ] Comunicar a los tenants la ventana y cualquier pérdida dentro del RPO.

---

## 5. Frecuencia recomendada

| Acción | Frecuencia |
|--------|-----------|
| Backup de Postgres (cron) | Diario (03:00) |
| Copia off-host | Diario (tras el backup) |
| Respaldo de media | Diario o semanal |
| **Restore drill en staging** | **Mensual** + antes de cada Go-Live + tras cambios mayores de schema |
| Revisión de retención / espacio en disco | Semanal |

---

## 6. Diagnóstico rápido de fallos de backup

| Síntoma | Causa probable | Acción |
|---------|----------------|--------|
| Dump de 0 bytes | `postgres` no estaba `healthy` o nombre de servicio incorrecto | `docker compose ps`; reintentar tras `healthy` |
| `gunzip -t` falla | gzip corrupto / disco lleno durante el dump | `df -h`; liberar espacio; re-ejecutar |
| `pg_dump: connection refused` | contenedor caído | `docker compose up -d postgres` |
| Cron no corre | ruta absoluta o permisos | usar rutas absolutas; `chmod +x`; revisar `/var/log/intake-backup.log` |
| Restore deja tablas vacías | dump tomado antes de migrar / DB equivocada | verificar `_prisma_migrations`; usar el backup correcto |

---

## 7. Nota Railway

En Railway no hay `docker compose` ni cron del host:

- Activa los **backups gestionados** de Railway Postgres en el plan correspondiente.
- Para un dump portátil: `railway run --service api pg_dump -U <user> <db> | gzip > backup.sql.gz`.
- El **restore drill** se hace igual: levanta una Postgres de staging (otro
  servicio o contenedor local) y aplica los pasos §2.2–§2.4.
- La sesión Baileys vive en el **Volume** montado en `/app/data` del servicio
  `worker-tapiceria`; la re-vinculación por QR (§3.3) aplica igual.
