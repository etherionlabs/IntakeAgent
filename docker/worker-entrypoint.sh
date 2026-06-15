#!/bin/sh
set -e

echo "[entrypoint] aplicando migraciones (prisma migrate deploy)…"
npx prisma migrate deploy

echo "[entrypoint] arrancando worker para TENANT_ID=${TENANT_ID}"
exec "$@"
