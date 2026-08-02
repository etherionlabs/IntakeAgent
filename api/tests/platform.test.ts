import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, cleanupDb, testPrisma, seedTenantAndUser, authHeader, loginCookie } from './helpers/app';

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

async function seedPendingTenant() {
  const tenant = await testPrisma.tenant.create({
    data: { slug: `s-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, name: 'N', industry: 'tapiceria', profileDir: './profiles/tapiceria', status: 'provisioning', approvalStatus: 'pending', active: false },
  });
  await testPrisma.panelUser.create({ data: { tenantId: tenant.id, username: 'd', email: `d-${Date.now()}@x.com`, passwordHash: 'x', role: 'admin' } });
  return tenant;
}

describe('platform admin', () => {
  beforeEach(async () => {
    await cleanupDb();
  });

  it('un slug inválido dice QUÉ está mal, no «tenant invalido»', async () => {
    const app = await buildTestApp();
    const platform = await platformHeader(app);
    const res = await app.inject({
      method: 'POST', url: '/platform/tenants', headers: platform,
      payload: { slug: 'Palatine detail', name: 'Palatine detail', industry: 'mecanica', profileDir: './profiles/mecanica' },
    });
    expect(res.statusCode).toBe(400);
    // Un genérico obliga a adivinar cuál de los cuatro campos falla.
    expect(res.json().error).toMatch(/slug/i);
    expect(res.json().error).toMatch(/minúsculas/i);
  });

  it('crea el tenant aunque el navegador traiga una cookie de sesión de tenant', async () => {
    // El caso que fallaba con «csrf token inválido»: entrar antes al panel de un
    // negocio deja la cookie, y el panel de plataforma va con Bearer sin
    // double-submit. La petición no autentica por cookie, así que no hay CSRF.
    const app = await buildTestApp();
    await seedTenantAndUser();
    const { headers: cookieHeaders } = await loginCookie(app);
    const platform = await platformHeader(app);

    const res = await app.inject({
      method: 'POST',
      url: '/platform/tenants',
      headers: { ...cookieHeaders, ...platform },
      payload: {
        slug: `etherion-${Date.now()}`,
        name: 'Etherion Labs',
        industry: 'intake',
        profileDir: './profiles/intake',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().tenant.industry).toBe('intake');
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
      payload: { slug: 'garage-demo', name: 'Garage Demo', industry: 'tapiceria', profileDir: './profiles/tapiceria' },
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

  it('crear tenant siembra TenantSettings desde la plantilla y lo deja active', async () => {
    const app = await buildTestApp();
    const headers = await platformHeader(app);
    const res = await app.inject({
      method: 'POST', url: '/platform/tenants', headers,
      payload: { slug: `s-${Date.now()}`, name: 'Taller X', industry: 'mecanica', profileDir: './profiles/mecanica' },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().tenant.id;
    const settings = await testPrisma.tenantSettings.findUnique({ where: { tenantId: id } });
    expect(settings).not.toBeNull();
    expect(settings!.businessName).toBe('Taller X');
    const t = await testPrisma.tenant.findUnique({ where: { id } });
    expect(t!.status).toBe('active');
  }, 20000);

  it('crear tenant con giro sin plantilla → 400 (no deja tenant huérfano)', async () => {
    const app = await buildTestApp();
    const headers = await platformHeader(app);
    const res = await app.inject({
      method: 'POST', url: '/platform/tenants', headers,
      payload: { slug: `s-${Date.now()}-x`, name: 'X', industry: 'giro-inexistente', profileDir: './profiles/giro-inexistente' },
    });
    expect(res.statusCode).toBe(400);
    expect(await testPrisma.tenant.count({ where: { slug: { startsWith: 's-' } } })).toBeGreaterThanOrEqual(0);
    expect(await testPrisma.tenant.findFirst({ where: { name: 'X' } })).toBeNull();
  }, 20000);

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

  it('aprobar cuenta desde el superadmin', async () => {
    const fetcher = (async () => ({ ok: true, json: async () => ({ ok: true }) })) as any;
    const app = await buildTestApp({ fetcher });
    const headers = await platformHeader(app);
    const tenant = await seedPendingTenant();
    const res = await app.inject({ method: 'POST', url: `/platform/tenants/${tenant.id}/approve`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().approvalStatus).toBe('approved');
    const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(after!.active).toBe(true);
    expect(await testPrisma.operatorAuditLog.count({ where: { tenantId: tenant.id, action: 'approve' } })).toBe(1);
  }, 20000);

  it('rechazar cuenta', async () => {
    const fetcher = (async () => ({ ok: true, json: async () => ({}) })) as any;
    const app = await buildTestApp({ fetcher });
    const headers = await platformHeader(app);
    const tenant = await seedPendingTenant();
    const res = await app.inject({ method: 'POST', url: `/platform/tenants/${tenant.id}/reject`, headers });
    expect(res.statusCode).toBe(200);
    expect((await testPrisma.tenant.findUnique({ where: { id: tenant.id } }))!.approvalStatus).toBe('rejected');
  }, 20000);

  it('editar límite mensual', async () => {
    const app = await buildTestApp();
    const headers = await platformHeader(app);
    const tenant = await seedPendingTenant();
    const res = await app.inject({ method: 'PATCH', url: `/platform/tenants/${tenant.id}/limit`, headers, payload: { monthlyRunLimit: 500 } });
    expect(res.statusCode).toBe(200);
    expect((await testPrisma.tenant.findUnique({ where: { id: tenant.id } }))!.monthlyRunLimit).toBe(500);
  }, 20000);

  it('GET /platform/tenants incluye approvalStatus y monthUsed', async () => {
    const app = await buildTestApp();
    const headers = await platformHeader(app);
    await seedPendingTenant();
    const res = await app.inject({ method: 'GET', url: '/platform/tenants', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().tenants[0]).toHaveProperty('approvalStatus');
    expect(res.json().tenants[0]).toHaveProperty('monthUsed');
  }, 20000);

  it('editar nombre/industria del tenant', async () => {
    const app = await buildTestApp();
    const headers = await platformHeader(app);
    const tenant = await seedTenantRow();
    const res = await app.inject({ method: 'PATCH', url: `/platform/tenants/${tenant.id}`, headers, payload: { name: 'Nuevo Nombre', industry: 'paqueteria' } });
    expect(res.statusCode).toBe(200);
    const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(after!.name).toBe('Nuevo Nombre');
    expect(after!.industry).toBe('paqueteria');
  }, 20000);

  it('eliminar tenant exige confirmSlug correcto', async () => {
    const app = await buildTestApp();
    const headers = await platformHeader(app);
    const tenant = await seedTenantRow();
    const bad = await app.inject({ method: 'DELETE', url: `/platform/tenants/${tenant.id}`, headers, payload: { confirmSlug: 'otro' } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'DELETE', url: `/platform/tenants/${tenant.id}`, headers, payload: { confirmSlug: tenant.slug } });
    expect(ok.statusCode).toBe(200);
    expect(await testPrisma.tenant.count({ where: { id: tenant.id } })).toBe(0);
  }, 20000);

  it('eliminar tenant inexistente → 404', async () => {
    const app = await buildTestApp();
    const headers = await platformHeader(app);
    const res = await app.inject({ method: 'DELETE', url: `/platform/tenants/no-existe`, headers, payload: { confirmSlug: 'x' } });
    expect(res.statusCode).toBe(404);
  }, 20000);
});
