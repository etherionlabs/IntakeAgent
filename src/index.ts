#!/usr/bin/env tsx
import 'dotenv/config';
/**
 * Punto de entrada del worker Intake (Fase 2: multi-tenant).
 *
 * Ya NO es "un proceso = un tenant". Instancia un `TenantManager` que mantiene N
 * conexiones (una por tenant) en este proceso/shard, levanta los tenants `active`
 * que le corresponden (SHARD_ID/SHARD_COUNT), y expone un endpoint interno que
 * despacha status/acciones por `tenantId`.
 *
 *   npm start
 *
 * Cada tenant guarda su sesión Baileys en ./data/baileys-session/<tenantId>.
 */
import { getPrisma, disconnectPrisma } from './storage/client';
import { TenantManagerImpl } from './tenant/manager';
import { createTenantRuntime } from './tenant/runtime';
import { startInternalServer } from './internal/server';
import { getShardId, getShardCount } from './tenant/shard';
import { logger } from './lib/logger';
import { initErrorTracking, captureError } from './lib/observability';

async function main() {
  await initErrorTracking({ service: 'worker' });
  process.on('unhandledRejection', (e) => captureError(e, { service: 'worker' }));
  const prisma = getPrisma();
  logger.info({ shardId: getShardId(), shardCount: getShardCount() }, 'bootstrap.worker_starting');

  const manager = new TenantManagerImpl({
    prisma,
    runtimeFactory: (tenantId) => createTenantRuntime(tenantId, { prisma }),
  });

  // Endpoint interno (solo red Docker, protegido con INTERNAL_API_TOKEN). El
  // manager ES el dispatcher: getStatus/logout/reconnect por tenantId.
  const internalServer = await startInternalServer({ dispatcher: manager, connectedCount: () => manager.connectedCount() });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'bootstrap.shutdown');
    await internalServer.close();
    await manager.stop();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await manager.start();

  // Atajo de desarrollo local: si se define TENANT_ID, lo levanta aunque no esté
  // en este shard. No es el camino de producción.
  if (process.env.TENANT_ID) {
    await manager.addTenant(process.env.TENANT_ID);
  }

  logger.info('bootstrap.worker_ready');
  await new Promise(() => {}); // mantener proceso vivo
}

main().catch((e) => {
  logger.error({ err: e instanceof Error ? e.stack : String(e) }, 'bootstrap.failed');
  process.exit(1);
});
