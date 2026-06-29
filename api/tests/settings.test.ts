import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, copyFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTestApp, testPrisma, cleanupDb } from './helpers/app';
import { seedTestPlan, TEST_PLAN_ID } from '../../tests/helpers/db';

const TEST_JWT_SECRET = 'test-jwt-secret';

/** Crea un tenant con un profileDir temporal (copia del perfil real) + un admin. */
async function seedTenantWithTempProfile() {
  const dir = await mkdtemp(join(tmpdir(), 'intake-profile-'));
  for (const f of ['intake-schema.json', 'prompt-vars.json', 'business-facts.json', 'welcome.txt']) {
    await copyFile(join('./profiles/tapiceria', f), join(dir, f));
  }
  const tenant = await testPrisma.tenant.create({
    data: { slug: `s-${Date.now()}`, name: 'T', industry: 'test', profileDir: dir },
  });
  const user = await testPrisma.panelUser.create({
    data: { tenantId: tenant.id, username: `u-${Date.now()}`, passwordHash: 'x', role: 'admin' },
  });
  await seedTestPlan();
  await testPrisma.subscription.create({
    data: { tenantId: tenant.id, planId: TEST_PLAN_ID, stripeCustomerId: `cus_${tenant.id}`, status: 'active' },
  });
  return { tenantId: tenant.id, userId: user.id, profileDir: dir };
}

/** Copia config.json a un archivo temporal y apunta CONFIG_PATH ahí. */
async function useTempConfig() {
  const dir = await mkdtemp(join(tmpdir(), 'intake-config-'));
  const path = join(dir, 'config.json');
  await copyFile('./config.json', path);
  process.env.CONFIG_PATH = path;
  return path;
}

describe('settings', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    await cleanupDb();
    app = await buildTestApp();
  });
  afterAll(async () => {
    await cleanupDb();
    delete process.env.CONFIG_PATH;
  });

  function admin(tenantId: string, userId: string) {
    const token = app.jwt.sign({ userId, tenantId, role: 'admin' });
    return { authorization: `Bearer ${token}` };
  }
  function viewer(tenantId: string, userId: string) {
    const token = app.jwt.sign({ userId, tenantId, role: 'viewer' });
    return { authorization: `Bearer ${token}` };
  }

  it('GET /settings devuelve perfil + config', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await useTempConfig();
    const res = await app.inject({ method: 'GET', url: '/settings', headers: admin(tenantId, userId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profile.businessName).toBeTruthy();
    expect(body.profile.vars.tone).toBeTruthy();
    expect(Array.isArray(body.profile.businessFacts.facts)).toBe(true);
    expect(body.config.model).toBeTruthy();
    expect(typeof body.config.temperature).toBe('number');
  });

  it('GET /settings sin auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/settings' });
    expect(res.statusCode).toBe(401);
  });

  it('PUT /settings/profile persiste en DB (compartida con el worker) sin tocar archivos', async () => {
    const { tenantId, userId, profileDir } = await seedTenantWithTempProfile();
    const current = (await app.inject({ method: 'GET', url: '/settings', headers: admin(tenantId, userId) })).json();
    const payload = {
      ...current.profile,
      businessName: 'Mecánica Nueva',
      businessDomain: 'mecánica automotriz',
      welcome: '¡Bienvenido al taller!',
      vars: { ...current.profile.vars, tone: 'Tono actualizado' },
      businessFacts: {
        facts: [{ topic: 'envíos', aliases: [], answer: 'Hacemos envíos a todo el país.' }],
        freeContext: 'Contexto nuevo.',
      },
    };
    const res = await app.inject({ method: 'PUT', url: '/settings/profile', headers: admin(tenantId, userId), payload });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.businessName).toBe('Mecánica Nueva');

    // Un GET posterior (lo que vería el worker al releer la DB) refleja el cambio.
    const after = (await app.inject({ method: 'GET', url: '/settings', headers: admin(tenantId, userId) })).json();
    expect(after.profile.businessName).toBe('Mecánica Nueva');
    expect(after.profile.businessDomain).toBe('mecánica automotriz');
    expect(after.profile.welcome).toBe('¡Bienvenido al taller!');
    expect(after.profile.vars.tone).toBe('Tono actualizado');
    expect(after.profile.businessFacts.facts[0].topic).toBe('envíos');

    // El override se guardó en la tabla Setting (recurso compartido con el worker).
    const row = await testPrisma.setting.findUnique({ where: { key: `profile:${tenantId}` } });
    expect(row).not.toBeNull();
    expect(JSON.parse(row!.value).businessDomain).toBe('mecánica automotriz');

    // Los archivos base NO se mutan (defaults intactos; el override vive en DB).
    const schema = JSON.parse(await readFile(join(profileDir, 'intake-schema.json'), 'utf-8'));
    expect(schema.$businessName).toBe('Tapicería Demo');
    expect(Array.isArray(schema.sections)).toBe(true);
  });

  it('PUT /settings/profile rechaza payload inválido → 400', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/profile',
      headers: admin(tenantId, userId),
      payload: { businessName: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /settings/profile con rol viewer → 403', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/profile',
      headers: viewer(tenantId, userId),
      payload: { businessName: 'x', businessDomain: 'y', welcome: 'z', vars: {}, businessFacts: { facts: [], freeContext: '' } },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PUT /settings/config persiste el override editable en DB', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await useTempConfig();
    const current = (await app.inject({ method: 'GET', url: '/settings', headers: admin(tenantId, userId) })).json();
    const payload = {
      ...current.config,
      model: 'openai/gpt-4o',
      temperature: 0.7,
      limits: { ...current.config.limits, monthlyCostUsd: 99 },
    };
    const res = await app.inject({ method: 'PUT', url: '/settings/config', headers: admin(tenantId, userId), payload });
    expect(res.statusCode).toBe(200);
    expect(res.json().config.model).toBe('openai/gpt-4o');

    // Un GET posterior refleja los valores nuevos (lo que verá el worker).
    const after = (await app.inject({ method: 'GET', url: '/settings', headers: admin(tenantId, userId) })).json();
    expect(after.config.model).toBe('openai/gpt-4o');
    expect(after.config.temperature).toBe(0.7);
    expect(after.config.limits.monthlyCostUsd).toBe(99);

    // El override se guardó en la tabla Setting global.
    const row = await testPrisma.setting.findUnique({ where: { key: 'config' } });
    expect(row).not.toBeNull();
    expect(JSON.parse(row!.value).model).toBe('openai/gpt-4o');
  });

  it('PUT /settings/config rechaza temperatura fuera de rango → 400', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await useTempConfig();
    const current = (await app.inject({ method: 'GET', url: '/settings', headers: admin(tenantId, userId) })).json();
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/config',
      headers: admin(tenantId, userId),
      payload: { ...current.config, temperature: 5 },
    });
    expect(res.statusCode).toBe(400);
  });
});
