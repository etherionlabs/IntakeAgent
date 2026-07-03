import { describe, it, expect } from 'vitest';
import { ownsTenant, shardOf, stableHash } from '../../src/tenant/shard';

describe('shard assignment', () => {
  it('stableHash es determinista', () => {
    expect(stableHash('abc')).toBe(stableHash('abc'));
    expect(stableHash('abc')).not.toBe(stableHash('abd'));
  });

  it('SHARD_COUNT=1 → este shard posee a todos', () => {
    for (const id of ['a', 'b', 'tenant-x', '00000000-0000-0000-0000-000000000001']) {
      expect(ownsTenant(id, { SHARD_ID: '0', SHARD_COUNT: '1' } as any)).toBe(true);
    }
  });

  it('SHARD_COUNT=2 → partición estable y disjunta entre shard 0 y 1', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `tenant-${i}`);
    const shard0 = ids.filter((id) => ownsTenant(id, { SHARD_ID: '0', SHARD_COUNT: '2' } as any));
    const shard1 = ids.filter((id) => ownsTenant(id, { SHARD_ID: '1', SHARD_COUNT: '2' } as any));
    // Sin solapamiento y cubren todo (sin huérfanos)
    expect(shard0.length + shard1.length).toBe(ids.length);
    expect(shard0.some((id) => shard1.includes(id))).toBe(false);
    // Reparte (no todo a un lado) — con djb2 sobre 200 ids ambos no vacíos
    expect(shard0.length).toBeGreaterThan(0);
    expect(shard1.length).toBeGreaterThan(0);
  });

  it('shardOf es consistente con ownsTenant', () => {
    expect(shardOf('tenant-7', 3)).toBe(stableHash('tenant-7') % 3);
  });
});
