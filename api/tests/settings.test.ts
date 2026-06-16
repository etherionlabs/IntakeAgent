import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTestApp, testPrisma, cleanupDb } from './helpers/app';

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

  it('PUT /settings/profile escribe los archivos y refleja los cambios', async () => {
    const { tenantId, userId, profileDir } = await seedTenantWithTempProfile();
    const current = (await app.inject({ method: 'GET', url: '/settings', headers: admin(tenantId, userId) })).json();
    const payload = {
      ...current.profile,
      businessName: 'Tapicería Nueva',
      businessDomain: 'tapicería premium',
      welcome: '¡Bienvenido nuevo!',
      vars: { ...current.profile.vars, tone: 'Tono actualizado' },
      businessFacts: {
        facts: [{ topic: 'envíos', aliases: [], answer: 'Hacemos envíos a todo el país.' }],
        freeContext: 'Contexto nuevo.',
      },
    };
    const res = await app.inject({ method: 'PUT', url: '/settings/profile', headers: admin(tenantId, userId), payload });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.businessName).toBe('Tapicería Nueva');

    // Verificar que efectivamente se escribió a disco.
    const schema = JSON.parse(await readFile(join(profileDir, 'intake-schema.json'), 'utf-8'));
    expect(schema.$businessName).toBe('Tapicería Nueva');
    expect(Array.isArray(schema.sections)).toBe(true); // sections preservadas
    const promptVars = JSON.parse(await readFile(join(profileDir, 'prompt-vars.json'), 'utf-8'));
    expect(promptVars.vars.tone).toBe('Tono actualizado');
    expect(promptVars.promptTemplate).toBeTruthy(); // template preservado
    const welcome = await readFile(join(profileDir, 'welcome.txt'), 'utf-8');
    expect(welcome).toBe('¡Bienvenido nuevo!');
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

  it('PUT /settings/config fusiona y preserva campos no editables', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    const path = await useTempConfig();
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

    const written = JSON.parse(await readFile(path, 'utf-8'));
    expect(written.model).toBe('openai/gpt-4o');
    expect(written.temperature).toBe(0.7);
    expect(written.limits.monthlyCostUsd).toBe(99);
    // Campos no editables preservados.
    expect(written.profile).toBe('./profiles/tapiceria');
    expect(written.panel).toBeDefined();
    expect(written.media).toBeDefined();
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
