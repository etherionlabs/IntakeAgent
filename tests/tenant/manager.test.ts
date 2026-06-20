import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { testPrisma, cleanupDb, seedTestTenant, TEST_TENANT_ID } from '../helpers/db';
import { TenantManagerImpl } from '../../src/tenant/manager';
import type { TenantRuntime, TenantStatus } from '../../src/tenant/types';

const TENANT_B = '00000000-0000-0000-0000-0000000000b2';
const TENANT_C = '00000000-0000-0000-0000-0000000000c3';

function fakeRuntime(tenantId: string, opts: { failStart?: boolean } = {}): TenantRuntime {
  let started = false;
  return {
    start: vi.fn(async () => { if (opts.failStart) throw new Error('boom'); started = true; }),
    stop: vi.fn(async () => { started = false; }),
    logout: vi.fn(async () => {}),
    reconnect: vi.fn(async () => {}),
    getStatus: (): TenantStatus => ({
      tenantId, connected: started, qr: null, phone: started ? '+521' : '',
      status: started ? 'connected' : 'disconnected', lastConnectedAt: null, lastError: null,
    }),
  };
}

async function seedTenant(id: string, active = true) {
  await testPrisma.tenant.upsert({
    where: { id },
    update: { active },
    create: { id, slug: `s-${id.slice(-4)}`, name: id, industry: 'test', profileDir: './p', active },
  });
}

describe('TenantManager', () => {
  beforeEach(async () => { await cleanupDb(); });
  afterAll(async () => { await cleanupDb(); });

  it('addTenant es idempotente y getStatus refleja el runtime', async () => {
    const factory = vi.fn((id: string) => fakeRuntime(id));
    const m = new TenantManagerImpl({ prisma: testPrisma, runtimeFactory: factory, owns: () => true });
    await m.addTenant(TENANT_B);
    await m.addTenant(TENANT_B); // idempotente
    expect(factory).toHaveBeenCalledTimes(1);
    expect(m.getStatus(TENANT_B)?.status).toBe('connected');
  });

  it('getStatus de id desconocido es null; removeTenant de inexistente no lanza', async () => {
    const m = new TenantManagerImpl({ prisma: testPrisma, runtimeFactory: (id) => fakeRuntime(id), owns: () => true });
    expect(m.getStatus('nope')).toBeNull();
    await expect(m.removeTenant('nope')).resolves.toBeUndefined();
  });

  it('un factory que falla deja status:error y NO tumba a los demás', async () => {
    const factory = (id: string) => fakeRuntime(id, { failStart: id === TENANT_C });
    const m = new TenantManagerImpl({ prisma: testPrisma, runtimeFactory: factory, owns: () => true });
    await m.addTenant(TENANT_B);
    await m.addTenant(TENANT_C); // falla
    expect(m.getStatus(TENANT_B)?.status).toBe('connected');
    expect(m.getStatus(TENANT_C)?.status).toBe('error');
  });

  it('start() levanta solo los tenants active que el shard posee', async () => {
    await seedTestTenant();                 // TEST_TENANT_ID active
    await seedTenant(TENANT_B, true);
    await seedTenant(TENANT_C, false);      // inactivo
    const factory = vi.fn((id: string) => fakeRuntime(id));
    // owns: solo TEST_TENANT_ID
    const m = new TenantManagerImpl({ prisma: testPrisma, runtimeFactory: factory, owns: (id) => id === TEST_TENANT_ID });
    await m.start();
    expect(m.getStatus(TEST_TENANT_ID)?.status).toBe('connected');
    expect(m.getStatus(TENANT_B)).toBeNull(); // no es de este shard
    expect(m.getStatus(TENANT_C)).toBeNull(); // inactivo
  });

  it('stop() apaga todos los runtimes', async () => {
    const runtimes: Record<string, TenantRuntime> = {};
    const factory = (id: string) => (runtimes[id] = fakeRuntime(id));
    const m = new TenantManagerImpl({ prisma: testPrisma, runtimeFactory: factory, owns: () => true });
    await m.addTenant(TENANT_B);
    await m.stop();
    expect(runtimes[TENANT_B].stop).toHaveBeenCalled();
    expect(m.getStatus(TENANT_B)).toBeNull();
  });
});
