import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { testPrisma, cleanupDb, seedTestTenant, seedTestTenantSettings, TEST_TENANT_ID } from '../helpers/db';
import { createTenantRuntime } from '../../src/tenant/runtime';
import type { InboundSource, ConnectionControl, ChannelStatusSnapshot } from '../../src/channels/types';

type Source = InboundSource & ConnectionControl;

function fakeSource(opts: { failTimes?: number } = {}): Source & { startCalls: number; sessionDir?: string } {
  let calls = 0;
  let connected = false;
  const s: any = {
    channel: 'whatsapp' as const,
    startCalls: 0,
    start: vi.fn(async () => {
      s.startCalls = ++calls;
      if (opts.failTimes && calls <= opts.failTimes) throw new Error('start boom');
      connected = true;
    }),
    stop: vi.fn(async () => { connected = false; }),
    logout: vi.fn(async () => {}),
    reconnect: vi.fn(async () => {}),
    state: (): ChannelStatusSnapshot => ({
      status: connected ? 'connected' : 'disconnected',
      qr: null, phone: connected ? '+521' : null, lastError: null, lastConnectedAt: null,
    }),
  };
  return s;
}

describe('createTenantRuntime', () => {
  beforeEach(async () => {
    await cleanupDb();
    await seedTestTenant();
    await seedTestTenantSettings();
  });
  afterAll(async () => { await cleanupDb(); });

  it('deriva sessionDir y mediaDir del tenantId', async () => {
    let captured: any = null;
    await createTenantRuntime(TEST_TENANT_ID, {
      prisma: testPrisma,
      buildSource: (args) => { captured = args; return fakeSource(); },
    });
    expect(captured.sessionDir).toBe(`./data/baileys-session/${TEST_TENANT_ID}`);
  });

  it('arranque OK → status connected', async () => {
    const src = fakeSource();
    const rt = await createTenantRuntime(TEST_TENANT_ID, { prisma: testPrisma, buildSource: () => src });
    await rt.start();
    expect(rt.getStatus().status).toBe('connected');
    expect(rt.getStatus().connected).toBe(true);
  });

  it('fallo de arranque NO propaga, deja status:error y reintenta (supervisión)', async () => {
    const src = fakeSource({ failTimes: 1 });
    const scheduled: Array<() => void> = [];
    const rt = await createTenantRuntime(TEST_TENANT_ID, {
      prisma: testPrisma,
      buildSource: () => src,
      scheduler: (fn) => { scheduled.push(fn); }, // captura el reintento sin esperar
    });
    await rt.start();
    expect(rt.getStatus().status).toBe('error'); // primer intento falló
    expect(scheduled).toHaveLength(1);
    // disparar el reintento programado
    await scheduled[0]();
    expect(src.startCalls).toBe(2);
    expect(rt.getStatus().status).toBe('connected');
  });

  it('createTenantRuntime falla si no hay TenantSettings', async () => {
    await testPrisma.tenantSettings.deleteMany();
    await expect(
      createTenantRuntime(TEST_TENANT_ID, { prisma: testPrisma, buildSource: () => fakeSource() }),
    ).rejects.toThrow(/TenantSettings/);
  });
});
