import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startInternalServer, type InternalServer } from '../../src/internal/server';

const TOKEN = 'test-internal-token';
let server: InternalServer;

const fakeState = () => ({ connected: true, qr: null as string | null, phone: '+5215551234567' });

describe('internal status server', () => {
  beforeAll(async () => {
    process.env.INTERNAL_API_TOKEN = TOKEN;
    process.env.INTERNAL_PORT = '0'; // puerto efímero
    server = await startInternalServer({ adapterState: { state: fakeState } });
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
});
