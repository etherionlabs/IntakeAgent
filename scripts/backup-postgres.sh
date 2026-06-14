#!/bin/sh
# Backup diario de PostgreSQL del stack Intake.
# Uso (cron en el host):
#   0 3 * * * /opt/intake/scripts/backup-postgres.sh >> /var/log/intake-backup.log 2>&1
set -e

BACKUP_DIR="${BACKUP_DIR:-/opt/intake/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-postgres}"
STAMP="$(date +%F_%H%M)"

mkdir -p "$BACKUP_DIR"

echo "[backup] volcando base intake → $BACKUP_DIR/backup-$STAMP.sql.gz"
docker compose exec -T "$COMPOSE_SERVICE" pg_dump -U intake intake | gzip > "$BACKUP_DIR/backup-$STAMP.sql.gz"

echo "[backup] eliminando backups con más de $RETENTION_DAYS días"
find "$BACKUP_DIR" -name 'backup-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "[backup] OK"
