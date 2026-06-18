import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startInternalServer, type InternalServer } from '../../src/internal/server';

const TOKEN = 'test-internal-token';
let server: InternalServer;

const fakeState = () => ({ connected: true, qr: null as string | null, phone: '+5215551234567' });
const calls: string[] = [];
const actions = {
  logout: async () => { calls.push('logout'); },
  reconnect: async () => { calls.push('reconnect'); },
};

describe('internal status server', () => {
  beforeAll(async () => {
    process.env.INTERNAL_API_TOKEN = TOKEN;
    process.env.INTERNAL_PORT = '0'; // puerto efímero
    server = await startInternalServer({ adapterState: { state: fakeState }, actions });
  });
  afterAll(() => server.close());

  it('401 sin token', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/internal/wa-status' });
    expect(res.statusCode).toBe(401);
  });

  it('401 con token incorrecto', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/internal/wa-status',
      headers: { authorization: 'Bearer wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('200 + estado con token correcto', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/internal/wa-status',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ connected: true, qr: null, phone: '+5215551234567' });
  });

  it('POST /internal/wa-logout con token ejecuta la acción', async () => {
    const res = await server.app.inject({ method: 'POST', url: '/internal/wa-logout', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls).toContain('logout');
  });

  it('POST /internal/wa-reconnect con token ejecuta la acción', async () => {
    const res = await server.app.inject({ method: 'POST', url: '/internal/wa-reconnect', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.statusCode).toBe(200);
    expect(calls).toContain('reconnect');
  });

  it('POST /internal/wa-logout sin token → 401', async () => {
    const res = await server.app.inject({ method: 'POST', url: '/internal/wa-logout' });
    expect(res.statusCode).toBe(401);
  });

  it('503 si el server no tiene actions', async () => {
    process.env.INTERNAL_PORT = '0';
    const noActions = await startInternalServer({ adapterState: { state: fakeState } });
    const res = await noActions.app.inject({ method: 'POST', url: '/internal/wa-logout', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.statusCode).toBe(503);
    await noActions.close();
  });
});
