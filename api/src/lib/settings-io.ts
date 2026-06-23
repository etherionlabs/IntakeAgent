import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { BusinessFactsZ } from '../../../src/config/schema';
import { ConfigZ } from '../../../src/config/schema';
import {
  ProfileSettingsZ,
  ConfigSettingsZ,
  type ProfileSettings,
  type ConfigSettings,
} from '../../../src/config/settings';
import {
  readProfileOverride,
  readConfigOverride,
} from '../../../src/config/overrides';

/**
 * Lee los ajustes EFECTIVOS del negocio (perfil por-tenant) y del sistema
 * (config global): archivos base + override persistido en la base de datos.
 *
 * La escritura ya NO toca archivos: el contenedor de la API y el del worker no
 * comparten filesystem, así que los cambios se guardan como overrides en
 * Postgres (ver src/config/overrides.ts), que ambos servicios sí comparten.
 */

// Re-export de las formas editables + sus validadores de input (Zod) que usa la
// ruta. Viven en src/ para que el worker también pueda importarlos.
export {
  ProfileSettingsZ as ProfileSettingsInputZ,
  ConfigSettingsZ as ConfigSettingsInputZ,
} from '../../../src/config/settings';
export type {
  ProfileSettings,
  ConfigSettings,
} from '../../../src/config/settings';
export type ProfileSettingsInput = ProfileSettings;
export type ConfigSettingsInput = ConfigSettings;

// ---- Helpers de archivos (DEFAULTS de arranque) ----

async function readJson(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Perfil base desde los archivos del profileDir (defaults antes de overrides). */
async function readProfileDefaults(profileDir: string): Promise<ProfileSettings> {
  const schema = await readJson(join(profileDir, 'intake-schema.json'));
  const promptVars = await readJson(join(profileDir, 'prompt-vars.json'));
  const facts = BusinessFactsZ.parse(await readJson(join(profileDir, 'business-facts.json')));
  const welcome = await readFile(join(profileDir, 'welcome.txt'), 'utf-8');
  return {
    businessName: String(schema.$businessName ?? ''),
    businessDomain: String(schema.$businessDomain ?? ''),
    welcome,
    vars: (promptVars.vars as Record<string, string>) ?? {},
    businessFacts: facts,
  };
}

/** Config base desde config.json (defaults antes de overrides). */
async function readConfigDefaults(configPath: string): Promise<ConfigSettings> {
  const cfg = ConfigZ.parse(await readJson(configPath));
  return {
    model: cfg.model,
    temperature: cfg.temperature,
    maxSteps: cfg.maxSteps,
    hours: cfg.hours,
    owner: cfg.owner,
    limits: cfg.limits,
  };
}

// ---- Lectura efectiva (defaults + override de DB) ----

export async function readProfileSettings(
  prisma: PrismaClient,
  tenantId: string,
  profileDir: string,
): Promise<ProfileSettings> {
  const override = await readProfileOverride(prisma, tenantId);
  return override ?? readProfileDefaults(profileDir);
}

export async function readConfigSettings(
  prisma: PrismaClient,
  configPath: string,
): Promise<ConfigSettings> {
  const override = await readConfigOverride(prisma);
  return override ?? readConfigDefaults(configPath);
}
