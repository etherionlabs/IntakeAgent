import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTestApp, seedTenantAndUser, TEST_USER, cleanupDb } from './helpers/app';

describe('rate-limit en /auth/login', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  beforeEach(async () => { await seedTenantAndUser(); app = await buildTestApp(); });
  afterAll(async () => { await cleanupDb(); });

  it('6 intentos fallidos desde la misma IP → el 6º responde 429 con Retry-After', async () => {
    const inject = () => app.inject({
      method: 'POST', url: '/auth/login',
      headers: { 'x-forwarded-for': '203.0.113.7' },
      remoteAddress: '203.0.113.7',
      payload: { email: TEST_USER.email, password: 'malísima-x' },
    });
    let last;
    for (let i = 0; i < 6; i++) last = await inject();
    expect(last!.statusCode).toBe(429);
    expect(last!.headers['retry-after']).toBeDefined();
  });
});
