#!/bin/sh
set -e
echo "[api-entrypoint] prisma migrate deploy…"
npx prisma migrate deploy
echo "[api-entrypoint] arrancando API"
exec "$@"
