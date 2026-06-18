import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { buildServer } from '../src/server';
import { seedTenantAndUser, cleanupDb, TEST_JWT_SECRET, TEST_TENANT_ID } from './helpers/app';

const WORKER_JSON = { ok: true, connected: true, qr: null, phone: '' };

function stubFetcher(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(WORKER_JSON), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

function tokenFor(app: Awaited<ReturnType<typeof buildServer>>, userId: string) {
  return app.jwt.sign({ userId, tenantId: TEST_TENANT_ID, role: 'admin' });
}

describe('wa-status', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let userId: string;
  let savedUrl: string | undefined;
  let savedToken: string | undefined;

  beforeEach(async () => {
    userId = await seedTenantAndUser();
    app = await buildServer({ jwtSecret: TEST_JWT_SECRET, fetcher: stubFetcher() });
    savedUrl = process.env.WORKER_INTERNAL_URL;
    savedToken = process.env.INTERNAL_API_TOKEN;
  });

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.WORKER_INTERNAL_URL;
    else process.env.WORKER_INTERNAL_URL = savedUrl;
    if (savedToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = savedToken;
  });

  afterAll(async () => { await cleanupDb(); });

  it('GET /wa-status con auth y worker configurado → 200 con JSON del worker', async () => {
    process.env.WORKER_INTERNAL_URL = 'http://worker-x:3002';
    process.env.INTERNAL_API_TOKEN = 't';
    const res = await app.inject({
      method: 'GET',
      url: '/wa-status',
      headers: { authorization: `Bearer ${tokenFor(app, userId)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ connected: true });
  });

  it('GET /wa-status sin WORKER_INTERNAL_URL/INTERNAL_API_TOKEN → 503', async () => {
    delete process.env.WORKER_INTERNAL_URL;
    delete process.env.INTERNAL_API_TOKEN;
    const res = await app.inject({
      method: 'GET',
      url: '/wa-status',
      headers: { authorization: `Bearer ${tokenFor(app, userId)}` },
    });
    expect(res.statusCode).toBe(503);
  });

  it('GET /wa-status sin token → 401', async () => {
    process.env.WORKER_INTERNAL_URL = 'http://worker-x:3002';
    process.env.INTERNAL_API_TOKEN = 't';
    const res = await app.inject({ method: 'GET', url: '/wa-status' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /wa-status/reconnect proxied → 200', async () => {
    process.env.WORKER_INTERNAL_URL = 'http://worker-x:3002';
    process.env.INTERNAL_API_TOKEN = 't';
    const res = await app.inject({ method: 'POST', url: '/wa-status/reconnect', headers: { authorization: `Bearer ${tokenFor(app, userId)}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('POST /wa-status/logout sin envs → 503', async () => {
    delete process.env.WORKER_INTERNAL_URL;
    delete process.env.INTERNAL_API_TOKEN;
    const res = await app.inject({ method: 'POST', url: '/wa-status/logout', headers: { authorization: `Bearer ${tokenFor(app, userId)}` } });
    expect(res.statusCode).toBe(503);
  });

  it('POST /wa-status/logout sin token → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/wa-status/logout' });
    expect(res.statusCode).toBe(401);
  });
});
