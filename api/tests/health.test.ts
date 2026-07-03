import { describe, it, expect, afterAll } from 'vitest';
import { buildTestApp } from './helpers/app';

describe('health + metrics', () => {
  it('GET /health → 200 con db up, versión y uptime', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe('up');
    expect(typeof body.uptimeSec).toBe('number');
    await app.close();
  });

  it('GET /internal/metrics sin token → 401; con token → texto Prometheus', async () => {
    const prev = process.env.INTERNAL_API_TOKEN;
    process.env.INTERNAL_API_TOKEN = 'metrics-token';
    const app = await buildTestApp();
    const no = await app.inject({ method: 'GET', url: '/internal/metrics' });
    expect(no.statusCode).toBe(401);
    const ok = await app.inject({ method: 'GET', url: '/internal/metrics', headers: { authorization: 'Bearer metrics-token' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('intake_http_requests_total');
    await app.close();
    if (prev === undefined) delete process.env.INTERNAL_API_TOKEN; else process.env.INTERNAL_API_TOKEN = prev;
  });
});
