import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  PromptVarsZ,
  BusinessFactsZ,
  ConfigZ,
  type BusinessFacts,
} from '../../../src/config/schema';
import { validateIntakeSchema } from '../../../src/config/intake-schema';

/**
 * Lee/escribe los ajustes editables del negocio (perfil del tenant) y del
 * sistema (config.json global). Mantiene la lógica de archivos fuera de la ruta
 * para poder probarla aislada.
 */

// ---- Forma editable del PERFIL (por-tenant) ----

export interface ProfileSettings {
  businessName: string;
  businessDomain: string;
  welcome: string;
  /** Variables del prompt (tone, coreInstructions, hardRules, …). */
  vars: Record<string, string>;
  businessFacts: BusinessFacts;
}

export const ProfileSettingsInputZ = z.object({
  businessName: z.string().min(1),
  businessDomain: z.string().min(1),
  welcome: z.string().min(1),
  vars: z.record(z.string(), z.string()),
  businessFacts: BusinessFactsZ,
});
export type ProfileSettingsInput = z.infer<typeof ProfileSettingsInputZ>;

// ---- Forma editable del CONFIG (global) ----

export interface ConfigSettings {
  model: string;
  temperature: number;
  maxSteps: number;
  hours: {
    enabled: boolean;
    timezone: string;
    schedule: Record<string, [string, string] | null>;
    outOfHoursNotice: string;
  };
  owner: {
    phoneE164: string;
    notifyOnReady: boolean;
    notifyOnDisconnect: boolean;
    panelUrl: string;
  };
  limits: {
    monthlyCostUsd: number;
    alertOnCostUsd: number;
    maxConsecutiveErrors: number;
  };
  media: {
    transcribeAudio: boolean;
    describeImages: boolean;
    visionModel: string;
  };
}

export const ConfigSettingsInputZ = z.object({
  model: z.string().min(1),
  temperature: z.number().min(0).max(2),
  maxSteps: z.number().int().positive(),
  hours: z.object({
    enabled: z.boolean(),
    timezone: z.string().min(1),
    schedule: z.record(z.string(), z.union([z.tuple([z.string(), z.string()]), z.null()])),
    outOfHoursNotice: z.string(),
  }),
  owner: z.object({
    phoneE164: z.string().min(5),
    notifyOnReady: z.boolean(),
    notifyOnDisconnect: z.boolean(),
    panelUrl: z.string().url(),
  }),
  limits: z.object({
    monthlyCostUsd: z.number().positive(),
    alertOnCostUsd: z.number().positive(),
    maxConsecutiveErrors: z.number().int().positive(),
  }),
  media: z.object({
    transcribeAudio: z.boolean(),
    describeImages: z.boolean(),
    visionModel: z.string().min(1),
  }),
});
export type ConfigSettingsInput = z.infer<typeof ConfigSettingsInputZ>;

// ---- Helpers de archivos ----

async function readJson(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function writeJson(path: string, obj: unknown): Promise<void> {
  return writeFile(path, `${JSON.stringify(obj, null, 2)}\n`, 'utf-8');
}

// ---- Lectura ----

export async function readProfileSettings(profileDir: string): Promise<ProfileSettings> {
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

export async function readConfigSettings(configPath: string): Promise<ConfigSettings> {
  const cfg = ConfigZ.parse(await readJson(configPath));
  return {
    model: cfg.model,
    temperature: cfg.temperature,
    maxSteps: cfg.maxSteps,
    hours: cfg.hours,
    owner: cfg.owner,
    limits: cfg.limits,
    media: {
      transcribeAudio: cfg.media.transcribeAudio,
      describeImages: cfg.media.describeImages,
      visionModel: cfg.media.visionModel,
    },
  };
}

// ---- Escritura ----

/**
 * Escribe los archivos del perfil con los ajustes nuevos. Preserva los campos
 * que la UI no edita (sections del intake, promptTemplate). Valida cada archivo
 * antes de tocar disco; si algo no valida, lanza y no escribe nada.
 */
export async function writeProfileSettings(
  profileDir: string,
  input: ProfileSettingsInput,
): Promise<void> {
  const schemaPath = join(profileDir, 'intake-schema.json');
  const promptPath = join(profileDir, 'prompt-vars.json');
  const factsPath = join(profileDir, 'business-facts.json');
  const welcomePath = join(profileDir, 'welcome.txt');

  // intake-schema: parchar solo nombre/dominio, preservar sections y validar.
  const schema = await readJson(schemaPath);
  schema.$businessName = input.businessName;
  schema.$businessDomain = input.businessDomain;
  const schemaCheck = validateIntakeSchema(schema);
  if (!schemaCheck.ok) {
    throw new Error(`intake-schema inválido: ${schemaCheck.error}`);
  }

  // prompt-vars: preservar promptTemplate, reemplazar vars, validar.
  const promptVars = await readJson(promptPath);
  const nextPromptVars = { ...promptVars, vars: input.vars };
  const promptCheck = PromptVarsZ.safeParse(nextPromptVars);
  if (!promptCheck.success) {
    throw new Error(`prompt-vars inválido: ${promptCheck.error.message}`);
  }

  // business-facts: validar input completo.
  const factsCheck = BusinessFactsZ.safeParse(input.businessFacts);
  if (!factsCheck.success) {
    throw new Error(`business-facts inválido: ${factsCheck.error.message}`);
  }

  // Todo validó: escribir. (Las escrituras no son atómicas entre sí, pero
  // validamos todo antes para minimizar estados inconsistentes.)
  await writeJson(schemaPath, schema);
  await writeJson(promptPath, nextPromptVars);
  await writeJson(factsPath, factsCheck.data);
  await writeFile(welcomePath, input.welcome, 'utf-8');
}

/**
 * Escribe el config.json fusionando los campos editables sobre el contenido
 * actual (preserva profile, panel.users, media, mensajes de fallback, etc.).
 * Valida el resultado con ConfigZ antes de escribir.
 */
export async function writeConfigSettings(
  configPath: string,
  input: ConfigSettingsInput,
): Promise<void> {
  const current = await readJson(configPath);
  const merged = {
    ...current,
    model: input.model,
    temperature: input.temperature,
    maxSteps: input.maxSteps,
    hours: input.hours,
    owner: { ...(current.owner as object), ...input.owner },
    limits: input.limits,
    // Preservar campos de media no editables (storeDir, whisperModel).
    media: { ...(current.media as object), ...input.media },
  };
  const check = ConfigZ.safeParse(merged);
  if (!check.success) {
    throw new Error(`config inválido: ${check.error.message}`);
  }
  await writeJson(configPath, merged);
}
