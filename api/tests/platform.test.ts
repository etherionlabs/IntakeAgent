import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, cleanupDb, testPrisma, seedTenantAndUser, authHeader } from './helpers/app';

async function seedPlatformUser() {
  const passwordHash = await bcrypt.hash('supersecret', 8);
  return testPrisma.platformUser.create({
    data: { username: 'owner@example.com', passwordHash, role: 'superadmin' },
  });
}

async function platformHeader(app: Awaited<ReturnType<typeof buildTestApp>>): Promise<{ authorization: string }> {
  await seedPlatformUser();
  const res = await app.inject({
    method: 'POST', url: '/platform/auth/login',
    payload: { username: 'owner@example.com', password: 'supersecret' },
  });
  return { authorization: `Bearer ${res.json().token}` };
}

async function seedTenantRow() {
  return testPrisma.tenant.create({
    data: { slug: `s-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, name: 'N', industry: 'tapiceria', profileDir: './profiles/tapiceria' },
  });
}

describe('platform admin', () => {
  beforeEach(async () => {
    await cleanupDb();
  });

  it('login de superadmin devuelve token de plataforma', async () => {
    const app = await buildTestApp();
    await seedPlatformUser();

    const res = await app.inject({
      method: 'POST',
      url: '/platform/auth/login',
      payload: { username: 'owner@example.com', password: 'supersecret' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({ username: 'owner@example.com', role: 'superadmin' });
    expect(body.token).toEqual(expect.any(String));
  }, 20000);

  it('rechaza tokens tenant en endpoints de plataforma', async () => {
    const app = await buildTestApp();
    const userId = await seedTenantAndUser();

    const res = await app.inject({
      method: 'GET',
      url: '/platform/tenants',
      headers: await authHeader(app, userId),
    });

    expect(res.statusCode).toBe(401);
  });

  it('crea tenants y usuarios tenant desde superadmin', async () => {
    const app = await buildTestApp();
    const platformUser = await seedPlatformUser();
    const token = app.jwt.sign({ userId: platformUser.id, scope: 'platform', role: 'superadmin' });
    const headers = { authorization: `Bearer ${token}` };

    const tenantRes = await app.inject({
      method: 'POST',
      url: '/platform/tenants',
      headers,
      payload: { slug: 'garage-demo', name: 'Garage Demo', industry: 'auto', profileDir: './profiles/tapiceria' },
    });
    expect(tenantRes.statusCode).toBe(201);

    const tenant = tenantRes.json().tenant;
    const userRes = await app.inject({
      method: 'POST',
      url: `/platform/tenants/${tenant.id}/users`,
      headers,
      payload: { username: 'admin', email: 'admin@garage-demo.com', password: 'tenantsecret' },
    });
    expect(userRes.statusCode).toBe(201);
    expect(userRes.json().user).toMatchObject({ username: 'admin', email: 'admin@garage-demo.com', role: 'admin' });

    const listRes = await app.inject({ method: 'GET', url: '/platform/tenants', headers });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().tenants[0]).toMatchObject({ slug: 'garage-demo', _count: { panelUsers: 1 } });
  });

  it('rechaza tokens de plataforma en endpoints tenant', async () => {
    const app = await buildTestApp();
    const platformUser = await seedPlatformUser();
    const token = app.jwt.sign({ userId: platformUser.id, scope: 'platform', role: 'superadmin' });

    const res = await app.inject({
      method: 'GET',
      url: '/jobs',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('crear dueño exige email y el dueño puede loguear (Bug 1)', async () => {
    const app = await buildTestApp();
    const headers = await platformHeader(app);
    const tenant = await seedTenantRow();
    const res = await app.inject({ method: 'POST', url: `/platform/tenants/${tenant.id}/users`, headers, payload: { username: 'dueno', email: 'dueno@negocio.com', password: 'clave1234' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({ username: 'dueno', email: 'dueno@negocio.com', role: 'admin' });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'dueno@negocio.com', password: 'clave1234' } });
    expect(login.statusCode).toBe(200);
  }, 20000);

  it('crear dueño sin email → 400', async () => {
    const app = await buildTestApp();
    const headers = await platformHeader(app);
    const tenant = await seedTenantRow();
    const res = await app.inject({ method: 'POST', url: `/platform/tenants/${tenant.id}/users`, headers, payload: { username: 'dueno', password: 'clave1234' } });
    expect(res.statusCode).toBe(400);
  }, 20000);

  it('editar dueño: nuevo password permite loguear', async () => {
    const app = await buildTestApp();
    const headers = await platformHeader(app);
    const tenant = await seedTenantRow();
    const created = (await app.inject({ method: 'POST', url: `/platform/tenants/${tenant.id}/users`, headers, payload: { username: 'd', email: 'd@x.com', password: 'viejo1234' } })).json().user;
    const res = await app.inject({ method: 'PATCH', url: `/platform/tenants/${tenant.id}/users/${created.id}`, headers, payload: { password: 'nuevo1234' } });
    expect(res.statusCode).toBe(200);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'd@x.com', password: 'nuevo1234' } });
    expect(login.statusCode).toBe(200);
  }, 20000);

  it('eliminar dueño lo quita', async () => {
    const app = await buildTestApp();
    const headers = await platformHeader(app);
    const tenant = await seedTenantRow();
    const created = (await app.inject({ method: 'POST', url: `/platform/tenants/${tenant.id}/users`, headers, payload: { username: 'd', email: 'd2@x.com', password: 'viejo1234' } })).json().user;
    const res = await app.inject({ method: 'DELETE', url: `/platform/tenants/${tenant.id}/users/${created.id}`, headers });
    expect(res.statusCode).toBe(200);
    expect(await testPrisma.panelUser.count({ where: { id: created.id } })).toBe(0);
  }, 20000);
});
