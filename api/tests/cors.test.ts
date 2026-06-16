import { describe, it, expect, afterAll } from 'vitest';
import { buildTestApp } from './helpers/app';

/**
 * Regresión: el preflight CORS debe permitir PUT/PATCH/DELETE. El default de
 * @fastify/cors solo permitía GET,HEAD,POST, lo que hacía fallar TODO guardado
 * (PUT /settings, PATCH /jobs…) con "Failed to fetch" en el navegador.
 */
describe('CORS preflight', () => {
  afterAll(() => {
    delete process.env.CORS_ORIGIN;
  });

  it('permite PUT en el preflight de /settings/profile', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/settings/profile',
      headers: {
        origin: 'https://panel.example',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(res.statusCode).toBeLessThan(300);
    const methods = String(res.headers['access-control-allow-methods'] ?? '');
    expect(methods).toMatch(/PUT/);
    expect(methods).toMatch(/PATCH/);
    await app.close();
  });

  it('no combina origin "*" con credentials (inválido en CORS)', async () => {
    delete process.env.CORS_ORIGIN; // cae a '*'
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/settings/config',
      headers: {
        origin: 'https://panel.example',
        'access-control-request-method': 'PUT',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    await app.close();
  });
});
