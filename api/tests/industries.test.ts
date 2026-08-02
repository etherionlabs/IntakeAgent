import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/app';
import { INDUSTRY_CATALOG } from '../src/onboarding/industries';
import { loadProfile } from '../../src/config/loader';

describe('catálogo de giros', () => {
  it('GET /onboarding/industries devuelve el catálogo (público, sin dominio interno)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/onboarding/industries' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const publicos = INDUSTRY_CATALOG.filter((i) => !('internal' in i && i.internal));
    expect(body.industries).toHaveLength(publicos.length);
    expect(body.industries[0]).toHaveProperty('value');
    expect(body.industries[0]).toHaveProperty('label');
    expect(body.industries[0]).not.toHaveProperty('domain');
    expect(body.industries.map((i: any) => i.value)).toContain('mecanica');
  });

  it('los giros internos no se ofrecen en el alta pública', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/onboarding/industries' });
    // Un prospecto no debe poder registrarse como «Intake» y quedarse con el
    // guion de venta del propio producto.
    expect(res.json().industries.map((i: any) => i.value)).not.toContain('intake');
    // Pero el giro existe y tiene plantilla: el superadmin sí puede usarlo.
    expect(INDUSTRY_CATALOG.map((i) => i.value)).toContain('intake');
  });

  it('cada giro del catálogo tiene una plantilla cargable en profiles/', async () => {
    for (const ind of INDUSTRY_CATALOG) {
      await expect(loadProfile(`./profiles/${ind.value}`)).resolves.toBeTruthy();
    }
  });
});

describe('catálogo del panel del superadmin', () => {
  /** Token de plataforma para las rutas /platform/*. */
  async function platformHeader(app: Awaited<ReturnType<typeof buildTestApp>>) {
    const bcrypt = (await import('bcryptjs')).default;
    const { testPrisma } = await import('./helpers/app');
    await testPrisma.platformUser.create({
      data: {
        username: `sa-${Date.now()}@x.com`,
        passwordHash: await bcrypt.hash('supersecret', 8),
        role: 'superadmin',
      },
    });
    const user = await testPrisma.platformUser.findFirst({ orderBy: { createdAt: 'desc' } });
    return { authorization: `Bearer ${app.jwt.sign({ userId: user!.id, scope: 'platform', role: 'superadmin' })}` };
  }

  it('incluye los giros internos, que el alta pública omite', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET', url: '/platform/industries', headers: await platformHeader(app),
    });
    expect(res.statusCode).toBe(200);
    const values = res.json().industries.map((i: any) => i.value);
    // El giro con el que nos vendemos solo se puede crear desde aquí: si no
    // aparece, no hay forma de dar de alta ese tenant.
    expect(values).toContain('intake');
    expect(values).toHaveLength(INDUSTRY_CATALOG.length);
    // Y viene marcado, para que el selector pueda distinguirlo.
    expect(res.json().industries.find((i: any) => i.value === 'intake').internal).toBe(true);
    expect(res.json().industries.find((i: any) => i.value === 'mecanica').internal).toBe(false);
  });

  it('sin token de plataforma no se sirve', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/platform/industries' });
    expect(res.statusCode).toBe(401);
  });
});
