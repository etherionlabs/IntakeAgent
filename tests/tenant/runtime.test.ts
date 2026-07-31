import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
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
    // Dos tareas agendadas: el reintento de arranque y el barrido de seguimiento.
    expect(scheduled).toHaveLength(2);
    // disparar el reintento programado (el primero en agendarse)
    await scheduled[0]();
    expect(src.startCalls).toBe(2);
    expect(rt.getStatus().status).toBe('connected');
  });

  // El scheduler recibe un callback síncrono que dispara trabajo async con I/O
  // real (el barrido consulta la base); hay que darle tiempo antes de asertar.
  const flush = async () => { for (let i = 0; i < 20; i++) await delay(5); };

  it('agenda el barrido de seguimiento y lo re-agenda tras cada pasada', async () => {
    const src = fakeSource();
    const scheduled: Array<{ fn: () => void; ms: number }> = [];
    const rt = await createTenantRuntime(TEST_TENANT_ID, {
      prisma: testPrisma,
      buildSource: () => src,
      scheduler: (fn, ms) => { scheduled.push({ fn, ms }); },
    });
    await rt.start();

    // Arranque OK: la única tarea agendada es el barrido, con el intervalo del config.
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBe(30 * 60_000);

    // Al ejecutarlo se vuelve a agendar: el bucle se sostiene solo.
    scheduled[0].fn();
    await flush();
    expect(scheduled).toHaveLength(2);

    // Y deja de agendarse cuando el tenant se detiene.
    await rt.stop();
    scheduled[1].fn();
    await flush();
    expect(scheduled).toHaveLength(2);
  });

  it('el barrido no falla ni muere si el bot no está conectado', async () => {
    const src = fakeSource({ failTimes: 99 }); // nunca conecta
    const scheduled: Array<{ fn: () => void; ms: number }> = [];
    const rt = await createTenantRuntime(TEST_TENANT_ID, {
      prisma: testPrisma,
      buildSource: () => src,
      scheduler: (fn, ms) => { scheduled.push({ fn, ms }); },
    });
    await rt.start();

    const sweepIdx = scheduled.findIndex((t) => t.ms === 30 * 60_000);
    expect(sweepIdx).toBeGreaterThanOrEqual(0);
    const before = scheduled.length;
    scheduled[sweepIdx].fn();
    await flush();
    // Se saltó el envío (no hay socket) pero el bucle sigue agendado.
    expect(scheduled.length).toBe(before + 1);
  });

  it('createTenantRuntime falla si no hay TenantSettings', async () => {
    await testPrisma.tenantSettings.deleteMany();
    await expect(
      createTenantRuntime(TEST_TENANT_ID, { prisma: testPrisma, buildSource: () => fakeSource() }),
    ).rejects.toThrow(/TenantSettings/);
  });
});
