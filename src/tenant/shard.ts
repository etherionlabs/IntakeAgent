/**
 * Asignación tenant→shard (decisión #1, spec §2.1). Permite escalar
 * horizontalmente subiendo réplicas del worker, cada una con su SHARD_ID, sin
 * cambios de código. Con SHARD_COUNT=1 (default), un proceso atiende a todos.
 *
 * La MISMA función la usa la API para rutear `wa-status` al shard correcto, por
 * lo que el hash debe ser estable y determinista (no Math.random ni el hash de V8).
 */

/** djb2: hash estable y determinista de un string a entero sin signo de 32 bits. */
export function stableHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; // h*33 + c, mod 2^32
  }
  return h >>> 0;
}

export function getShardId(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.SHARD_ID ?? 0);
}

export function getShardCount(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.SHARD_COUNT ?? 1);
  return n > 0 ? n : 1;
}

/** ¿Este shard posee al tenant? */
export function ownsTenant(tenantId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return shardOf(tenantId, getShardCount(env)) === getShardId(env);
}

/** Índice de shard que posee al tenant, dado un total de shards. */
export function shardOf(tenantId: string, shardCount: number = getShardCount()): number {
  return stableHash(tenantId) % shardCount;
}
