import { describe, it, expect, beforeEach } from 'vitest';
import { writeFile, copyFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  testPrisma as prisma,
  cleanupDb,
  seedTestTenant,
  TEST_TENANT_ID,
} from '../helpers/db';
import {
  ConfigCache,
  loadEffectiveProfile,
  loadEffectiveConfig,
} from '../../src/config/loader';
import {
  writeProfileOverride,
  writeConfigOverride,
  readProfileOverride,
} from '../../src/config/overrides';

/**
 * Verifica el contrato entre-procesos: lo que la API guarda como override en la
 * DB (tabla Setting) es lo que el worker lee al cargar el perfil/config efectivo.
 * Antes esto vivía en archivos por-contenedor que no se comparten, así que el
 * worker nunca veía los cambios del panel.
 */
describe('overrides DB (perfil/config compartidos entre API y worker)', () => {
  beforeEach(async () => {
    await cleanupDb();
    await seedTestTenant();
  });

  it('loadEffectiveProfile aplica el override de perfil sobre los archivos base', async () => {
    // Sin override: defaults de archivo (tapicería).
    const base = await loadEffectiveProfile(prisma, TEST_TENANT_ID, './profiles/tapiceria');
    expect(base.intakeSchema.$businessDomain).toContain('tapicería');

    // La API guarda el cambio a mecánica.
    const baseSettings = (await readProfileOverride(prisma, TEST_TENANT_ID)) ?? {
      businessName: 'Tapicería Demo',
      businessDomain: 'tapicería de muebles',
      welcome: base.welcome,
      vars: base.promptVars.vars,
      businessFacts: base.businessFacts,
    };
    await writeProfileOverride(prisma, TEST_TENANT_ID, {
      ...baseSettings,
      businessName: 'Mecánica Demo',
      businessDomain: 'mecánica automotriz',
      welcome: 'Bienvenido al taller de {{businessDomain}}.',
    });

    // El worker (otro proceso) ahora ve mecánica, sin tocar archivos.
    const effective = await loadEffectiveProfile(prisma, TEST_TENANT_ID, './profiles/tapiceria');
    expect(effective.intakeSchema.$businessName).toBe('Mecánica Demo');
    expect(effective.intakeSchema.$businessDomain).toBe('mecánica automotriz');
    expect(effective.welcome).toContain('taller');
    // sections del intake se preservan de los archivos.
    expect(effective.intakeSchema.sections.length).toBeGreaterThan(0);
    // El hash cambia respecto al base (configHash refleja la edición).
    expect(effective.hash).not.toBe(base.hash);
  });

  it('ConfigCache con db recoge el override en el siguiente refresh (sin reiniciar)', async () => {
    // config.json temporal apuntando al perfil real.
    const dir = await mkdtemp(join(tmpdir(), 'intake-cfg-'));
    const cfgPath = join(dir, 'config.json');
    await copyFile('./config.json', cfgPath);

    const cache = new ConfigCache(cfgPath, undefined, { prisma, tenantId: TEST_TENANT_ID });
    const first = await cache.refresh();
    expect(first.config.model).toBe('openai/gpt-4o-mini');
    expect(first.profile.intakeSchema.$businessDomain).toContain('tapicería');

    // La API guarda overrides mientras el worker sigue vivo.
    await writeConfigOverride(prisma, {
      model: 'openai/gpt-4o',
      temperature: 0.9,
      maxSteps: 8,
      hours: first.config.hours,
      owner: first.config.owner,
      limits: first.config.limits,
    });
    await writeProfileOverride(prisma, TEST_TENANT_ID, {
      businessName: 'Mecánica Demo',
      businessDomain: 'mecánica automotriz',
      welcome: first.profile.welcome,
      vars: first.profile.promptVars.vars,
      businessFacts: first.profile.businessFacts,
    });

    // Próximo turno del worker: refresh sin reiniciar el proceso.
    const next = await cache.refresh();
    expect(next.config.model).toBe('openai/gpt-4o');
    expect(next.config.temperature).toBe(0.9);
    expect(next.profile.intakeSchema.$businessDomain).toBe('mecánica automotriz');
  });

  it('loadEffectiveConfig devuelve defaults de archivo cuando no hay override', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'intake-cfg-'));
    const cfgPath = join(dir, 'config.json');
    await writeFile(
      cfgPath,
      JSON.stringify({ profile: './profiles/tapiceria', model: 'x/y', owner: { phoneE164: '+5215555555555' } }),
    );
    const cfg = await loadEffectiveConfig(prisma, cfgPath);
    expect(cfg.model).toBe('x/y');
  });
});
