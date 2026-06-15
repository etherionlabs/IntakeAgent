import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTestApp, seedTenantAndUser, authHeader, cleanupDb } from './helpers/app';

describe('profile', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;
  beforeEach(async () => { userId = await seedTenantAndUser(); app = await buildTestApp(); });
  afterAll(async () => { await cleanupDb(); });

  it('GET /profile con auth devuelve intakeSchema con sections', async () => {
    const res = await app.inject({ method: 'GET', url: '/profile', headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.intakeSchema).toBeDefined();
    expect(Array.isArray(body.intakeSchema.sections)).toBe(true);
    expect(body.intakeSchema.sections.length).toBeGreaterThan(0);
  });

  it('GET /profile sin auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/profile' });
    expect(res.statusCode).toBe(401);
  });
});
