import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  ConfigZ,
  PromptVarsZ,
  BusinessFactsZ,
  type Config,
  type Profile,
} from './schema';
import { validateIntakeSchema } from './intake-schema';
import { readProfileOverride, readConfigOverride } from './overrides';
import type { ProfileSettings, ConfigSettings } from './settings';

export class ConfigLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigLoadError';
  }
}

export async function loadConfig(path: string): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (e) {
    throw new ConfigLoadError(`No se pudo leer config en ${path}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigLoadError(`JSON inválido en ${path}: ${(e as Error).message}`);
  }
  const result = ConfigZ.safeParse(parsed);
  if (!result.success) {
    throw new ConfigLoadError(`Config inválida: ${result.error.message}`);
  }
  return result.data;
}

export async function loadProfile(profileDir: string): Promise<Profile> {
  const dir = resolve(profileDir);
  const [schemaRaw, promptRaw, factsRaw, welcomeRaw] = await Promise.all([
    readFile(join(dir, 'intake-schema.json'), 'utf-8'),
    readFile(join(dir, 'prompt-vars.json'), 'utf-8'),
    readFile(join(dir, 'business-facts.json'), 'utf-8'),
    readFile(join(dir, 'welcome.txt'), 'utf-8'),
  ]);

  const schemaJson = JSON.parse(schemaRaw);
  const schemaResult = validateIntakeSchema(schemaJson);
  if (!schemaResult.ok) {
    throw new ConfigLoadError(`intake-schema.json inválido: ${schemaResult.error}`);
  }

  const promptVars = PromptVarsZ.safeParse(JSON.parse(promptRaw));
  if (!promptVars.success) {
    throw new ConfigLoadError(`prompt-vars.json inválido: ${promptVars.error.message}`);
  }

  const businessFacts = BusinessFactsZ.safeParse(JSON.parse(factsRaw));
  if (!businessFacts.success) {
    throw new ConfigLoadError(`business-facts.json inválido: ${businessFacts.error.message}`);
  }

  const combined = `${schemaRaw}\n${promptRaw}\n${factsRaw}\n${welcomeRaw}`;
  const hash = createHash('sha256').update(combined).digest('hex').slice(0, 12);

  return {
    intakeSchema: schemaResult.schema,
    promptVars: promptVars.data,
    businessFacts: businessFacts.data,
    welcome: welcomeRaw,
    // Foco para describir imágenes: convención en prompt-vars.json (vars.imageFocus).
    imageFocus: promptVars.data.vars.imageFocus ?? '',
    hash,
  };
}

/**
 * Aplica un override de perfil (editado en el panel, persistido en DB) sobre el
 * perfil base cargado de archivos. Solo toca los campos editables: nombre,
 * dominio, welcome, vars del prompt y business-facts. La estructura del intake
 * (sections) y la plantilla del prompt se conservan de los archivos. Recalcula
 * el hash a partir del contenido efectivo para que `configHash` refleje el cambio.
 */
export function applyProfileOverride(base: Profile, ov: ProfileSettings): Profile {
  const intakeSchema = {
    ...base.intakeSchema,
    $businessName: ov.businessName,
    $businessDomain: ov.businessDomain,
  };
  const promptVars = { ...base.promptVars, vars: ov.vars };
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        intakeSchema,
        promptVars,
        businessFacts: ov.businessFacts,
        welcome: ov.welcome,
      }),
    )
    .digest('hex')
    .slice(0, 12);
  return {
    intakeSchema,
    promptVars,
    businessFacts: ov.businessFacts,
    welcome: ov.welcome,
    imageFocus: ov.vars.imageFocus ?? base.imageFocus,
    hash,
  };
}

/**
 * Aplica un override de config global (panel → DB) sobre el config base de
 * archivo. Fusiona solo los campos editables; preserva profile, panel, media y
 * los mensajes de fallback que la UI no edita.
 */
export function applyConfigOverride(base: Config, ov: ConfigSettings): Config {
  return {
    ...base,
    model: ov.model,
    temperature: ov.temperature,
    maxSteps: ov.maxSteps,
    hours: ov.hours,
    owner: { ...base.owner, ...ov.owner },
    limits: ov.limits,
  };
}

/**
 * Carga el perfil efectivo: archivos base + override de DB (si existe).
 * Es lo que deben usar API y worker para ver la MISMA configuración.
 */
export async function loadEffectiveProfile(
  prisma: PrismaClient,
  tenantId: string,
  profileDir: string,
): Promise<Profile> {
  const base = await loadProfile(profileDir);
  const ov = await readProfileOverride(prisma, tenantId);
  return ov ? applyProfileOverride(base, ov) : base;
}

/** Carga el config efectivo: config.json base + override de DB (si existe). */
export async function loadEffectiveConfig(
  prisma: PrismaClient,
  configPath: string,
): Promise<Config> {
  const base = await loadConfig(configPath);
  const ov = await readConfigOverride(prisma);
  return ov ? applyConfigOverride(base, ov) : base;
}

/**
 * Carga config + profile manteniendo última versión válida en cache.
 *
 * Si se le pasa `db` ({ prisma, tenantId }), aplica los overrides persistidos en
 * la base de datos sobre los archivos en cada `refresh()`. Así el worker recoge
 * lo que se edita en el panel (otro contenedor) sin reiniciarse, porque ambos
 * comparten Postgres. Sin `db` opera solo con archivos (CLI local).
 */
export class ConfigCache {
  private lastValid: { config: Config; profile: Profile } | null = null;

  constructor(
    private readonly configPath: string,
    private readonly logger?: { warn: (msg: string) => void },
    private readonly db?: { prisma: PrismaClient; tenantId: string },
  ) {}

  async refresh(): Promise<{ config: Config; profile: Profile }> {
    try {
      const config = this.db
        ? await loadEffectiveConfig(this.db.prisma, this.configPath)
        : await loadConfig(this.configPath);
      const profile = this.db
        ? await loadEffectiveProfile(this.db.prisma, this.db.tenantId, config.profile)
        : await loadProfile(config.profile);
      this.lastValid = { config, profile };
      return this.lastValid;
    } catch (e) {
      if (this.lastValid) {
        this.logger?.warn?.(
          `Config/profile inválido, usando última versión válida: ${(e as Error).message}`,
        );
        return this.lastValid;
      }
      throw e;
    }
  }
}
