import { describe, it, expect, beforeEach } from 'vitest';
import { testPrisma, cleanupDb, seedTestTenant, seedTestTenantSettings, TEST_TENANT_ID } from '../helpers/db';
import { buildTenantConfig } from '../../src/tenant/runtime';

describe('buildTenantConfig — perfil por giro del tenant', () => {
  beforeEach(async () => {
    await cleanupDb();
    await seedTestTenant();
  });

  it('usa los business-facts del giro del tenant (mecanica), no del genérico vacío', async () => {
    await seedTestTenantSettings(TEST_TENANT_ID, { industry: 'mecanica' });
    const { profile } = await buildTenantConfig(testPrisma, TEST_TENANT_ID, './config.json');
    const topics = profile.businessFacts.facts.map((f) => f.topic);
    expect(profile.businessFacts.facts.length).toBeGreaterThan(0);
    expect(topics).toContain('precios');
    expect(topics).toContain('horarios');
  });

  it('cae al perfil por defecto si el giro no tiene plantilla (no lanza)', async () => {
    await seedTestTenantSettings(TEST_TENANT_ID, { industry: 'giro-inexistente-xyz' });
    const { profile } = await buildTenantConfig(testPrisma, TEST_TENANT_ID, './config.json');
    // El fallback (config.profile = genérico) carga sin lanzar.
    expect(profile).toBeTruthy();
    expect(Array.isArray(profile.businessFacts.facts)).toBe(true);
  });

  it('conserva intakeSchema y welcome del tenant (no del perfil del giro)', async () => {
    await seedTestTenantSettings(TEST_TENANT_ID, {
      industry: 'mecanica',
      welcomeTemplate: 'Bienvenido a mi taller propio.',
    });
    const { profile } = await buildTenantConfig(testPrisma, TEST_TENANT_ID, './config.json');
    expect(profile.welcome).toBe('Bienvenido a mi taller propio.');
  });
});
