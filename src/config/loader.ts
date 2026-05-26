import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  ConfigZ,
  PromptVarsZ,
  BusinessFactsZ,
  type Config,
  type Profile,
} from './schema';
import { validateIntakeSchema } from './intake-schema';

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
    hash,
  };
}

/** Carga config + profile manteniendo última versión válida en cache. */
export class ConfigCache {
  private lastValid: { config: Config; profile: Profile } | null = null;

  constructor(
    private readonly configPath: string,
    private readonly logger?: { warn: (msg: string) => void },
  ) {}

  async refresh(): Promise<{ config: Config; profile: Profile }> {
    try {
      const config = await loadConfig(this.configPath);
      const profile = await loadProfile(config.profile);
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
