import { describe, it, expect, beforeEach } from 'vitest';
import { testPrisma, cleanupDb, seedTestTenant, seedTestTenantSettings, TEST_TENANT_ID } from '../helpers/db';
import { buildTenantConfig } from '../../src/tenant/runtime';
import { writeProfileOverride } from '../../src/config/overrides';

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

  it('aplica el toggle editImages por-tenant sobre config.media', async () => {
    await seedTestTenantSettings(TEST_TENANT_ID, { industry: 'wrapping', editImages: true });
    const { config } = await buildTenantConfig(testPrisma, TEST_TENANT_ID, './config.json');
    expect(config.media.editImages).toBe(true);
  });

  it('la selección de skills del tenant (arreglo) gana sobre las del perfil del giro', async () => {
    // wrapping referencia ["ventas"]; el tenant la desactiva con un arreglo vacío.
    await seedTestTenantSettings(TEST_TENANT_ID, { industry: 'wrapping', skills: [] });
    const { profile } = await buildTenantConfig(testPrisma, TEST_TENANT_ID, './config.json');
    expect(profile.skills).toEqual([]);
  });

  it('skills null en el tenant → hereda las del perfil del giro', async () => {
    await seedTestTenantSettings(TEST_TENANT_ID, { industry: 'wrapping' });
    const { profile } = await buildTenantConfig(testPrisma, TEST_TENANT_ID, './config.json');
    expect(profile.skills.map((s) => s.name)).toContain('ventas');
  });

  it('aplica el override editado en el panel (Setting) sobre el perfil del giro', async () => {
    await seedTestTenantSettings(TEST_TENANT_ID, { industry: 'mecanica', welcomeTemplate: 'welcome viejo' });
    await writeProfileOverride(testPrisma, TEST_TENANT_ID, {
      businessName: 'Taller El Rayo',
      businessDomain: 'mecánica automotriz',
      welcome: 'Bienvenido a Taller El Rayo, ¿en qué te ayudo?',
      vars: { tone: 'muy formal', imageFocus: 'fíjate en la pieza dañada' },
      businessFacts: { facts: [{ topic: 'promo', aliases: ['descuento'], answer: '10% en frenos este mes.' }], freeContext: 'Taller de barrio.' },
    });
    const { profile } = await buildTenantConfig(testPrisma, TEST_TENANT_ID, './config.json');
    // Los datos que el dueño editó GANAN sobre el archivo del giro.
    expect(profile.welcome).toBe('Bienvenido a Taller El Rayo, ¿en qué te ayudo?');
    expect(profile.businessFacts.facts.map((f) => f.topic)).toEqual(['promo']);
    expect(profile.promptVars.vars.tone).toBe('muy formal');
    expect(profile.imageFocus).toBe('fíjate en la pieza dañada');
  });
});
