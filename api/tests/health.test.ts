import { describe, it, expect, afterAll } from 'vitest';
import { buildTestApp } from './helpers/app';

describe('health', () => {
  it('GET /health → 200 { ok: true }', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
