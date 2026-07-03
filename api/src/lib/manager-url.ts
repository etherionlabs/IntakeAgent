import { shardOf, getShardCount } from '../../../src/tenant/shard';

/**
 * Resuelve la URL interna del TenantManager que POSEE al tenant (decisión #1,
 * spec §5.2). Con SHARD_COUNT=1 hay una sola URL (`TENANT_MANAGER_URL`, con
 * fallback al histórico `WORKER_INTERNAL_URL`); con N shards, `TENANT_MANAGER_URL_<n>`.
 */
export function resolveManagerUrl(tenantId: string): string | null {
  const count = getShardCount();
  if (count <= 1) {
    return process.env.TENANT_MANAGER_URL ?? process.env.WORKER_INTERNAL_URL ?? null;
  }
  const shard = shardOf(tenantId, count);
  return process.env[`TENANT_MANAGER_URL_${shard}`] ?? null;
}
