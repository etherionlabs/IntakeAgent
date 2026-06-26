import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startInternalServer, type InternalServer, type TenantDispatcher } from '../../src/internal/server';
import type { TenantStatus } from '../../src/tenant/types';

const TOKEN = 'test-internal-token';
let server: InternalServer;

const STATUS_A: TenantStatus = {
  tenantId: 'tenant-a', connected: true, qr: null, phone: '+5215551234567',
  status: 'connected', lastConnectedAt: null, lastError: null,
};
const calls: string[] = [];
const dispatcher: TenantDispatcher = {
  getStatus: (id) => (id === 'tenant-a' ? STATUS_A : null),
  logout: async (id) => { calls.push(`logout:${id}`); },
  reconnect: async (id) => { calls.push(`reconnect:${id}`); },
  suspendTenant: async (id) => { calls.push(`suspend:${id}`); },
  resumeTenant: async (id) => { calls.push(`resume:${id}`); },
  addTenant: async (id) => { calls.push(`add:${id}`); },
};

describe('internal status server (dispatch por tenant)', () => {
  beforeAll(async () => {
    process.env.INTERNAL_API_TOKEN = TOKEN;
    process.env.INTERNAL_PORT = '0';
    server = await startInternalServer({ dispatcher });
  });
  afterAll(() => server.close());

  const auth = { authorization: `Bearer ${TOKEN}` };

  it('401 sin token', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/internal/wa-status?tenantId=tenant-a' });
    expect(res.statusCode).toBe(401);
  });

  it('200 + estado del tenant pedido', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/internal/wa-status?tenantId=tenant-a', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().phone).toBe('+5215551234567');
    expect(res.json().connected).toBe(true);
  });

  it('404 para un tenant sin runtime (no devuelve el estado de otro)', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/internal/wa-status?tenantId=desconocido', headers: auth });
    expect(res.statusCode).toBe(404);
  });

  it('400 sin tenantId', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/internal/wa-status', headers: auth });
    expect(res.statusCode).toBe(400);
  });

  it('logout/reconnect despachan al tenantId correcto', async () => {
    calls.length = 0;
    await server.app.inject({ method: 'POST', url: '/internal/wa-logout', headers: auth, payload: { tenantId: 'tenant-a' } });
    await server.app.inject({ method: 'POST', url: '/internal/wa-reconnect', headers: auth, payload: { tenantId: 'tenant-b' } });
    expect(calls).toContain('logout:tenant-a');
    expect(calls).toContain('reconnect:tenant-b');
  });

  it('POST sin token → 401', async () => {
    const res = await server.app.inject({ method: 'POST', url: '/internal/wa-logout', payload: { tenantId: 'x' } });
    expect(res.statusCode).toBe(401);
  });

  it('suspend/resume despachan por tenantId', async () => {
    calls.length = 0;
    await server.app.inject({ method: 'POST', url: '/internal/tenant/suspend', headers: auth, payload: { tenantId: 'tenant-a' } });
    await server.app.inject({ method: 'POST', url: '/internal/tenant/resume', headers: auth, payload: { tenantId: 'tenant-a' } });
    expect(calls).toContain('suspend:tenant-a');
    expect(calls).toContain('resume:tenant-a');
  });
});
