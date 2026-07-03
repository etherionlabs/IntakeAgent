#!/bin/sh
# Restore de un backup de PostgreSQL del stack Intake (para el restore drill).
# Uso:
#   scripts/restore-postgres.sh <archivo.sql.gz> [base_destino]
# Por seguridad NO restaura sobre la base de producción por defecto: usa una base
# de staging/efímera. Verifica el contenido (login, conteos) tras restaurar.
set -e

BACKUP_FILE="$1"
TARGET_DB="${2:-intake_restore}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-postgres}"

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Uso: $0 <archivo.sql.gz> [base_destino]" >&2
  exit 1
fi

echo "[restore] creando base destino '$TARGET_DB' (si no existe)"
docker compose exec -T "$COMPOSE_SERVICE" psql -U intake -d postgres \
  -c "CREATE DATABASE \"$TARGET_DB\";" 2>/dev/null || true

echo "[restore] restaurando $BACKUP_FILE → $TARGET_DB"
gunzip -c "$BACKUP_FILE" | docker compose exec -T "$COMPOSE_SERVICE" psql -U intake -d "$TARGET_DB"

echo "[restore] conteos de verificación:"
docker compose exec -T "$COMPOSE_SERVICE" psql -U intake -d "$TARGET_DB" -c \
  "SELECT 'tenants' t, count(*) FROM \"Tenant\" UNION ALL \
   SELECT 'users', count(*) FROM \"PanelUser\" UNION ALL \
   SELECT 'jobs', count(*) FROM \"Job\" UNION ALL \
   SELECT 'contacts', count(*) FROM \"Contact\";"

echo "[restore] OK — apunta una API/worker de staging a '$TARGET_DB' y valida login."
