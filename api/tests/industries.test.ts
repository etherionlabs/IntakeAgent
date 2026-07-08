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
    expect(body.industries).toHaveLength(INDUSTRY_CATALOG.length);
    expect(body.industries[0]).toHaveProperty('value');
    expect(body.industries[0]).toHaveProperty('label');
    expect(body.industries[0]).not.toHaveProperty('domain');
    expect(body.industries.map((i: any) => i.value)).toContain('mecanica');
  });

  it('cada giro del catálogo tiene una plantilla cargable en profiles/', async () => {
    for (const ind of INDUSTRY_CATALOG) {
      await expect(loadProfile(`./profiles/${ind.value}`)).resolves.toBeTruthy();
    }
  });
});
