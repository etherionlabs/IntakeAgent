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
