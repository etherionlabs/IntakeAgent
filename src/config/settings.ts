import { z } from 'zod';
import { BusinessFactsZ, type BusinessFacts } from './schema';

/**
 * Formas editables de la configuración que el panel modifica y que se persisten
 * en la base de datos (recurso compartido entre el contenedor de la API y el del
 * worker). Los archivos del perfil / config.json siguen siendo los DEFAULTS de
 * arranque; estos overrides se aplican encima en ambos procesos.
 *
 * Viven en `src/` (no en `api/`) para que el worker pueda importarlos sin
 * depender del paquete de la API.
 */

// ---- PERFIL editable (por-tenant) ----

export interface ProfileSettings {
  businessName: string;
  businessDomain: string;
  welcome: string;
  /** Variables del prompt (tone, coreInstructions, hardRules, …). */
  vars: Record<string, string>;
  businessFacts: BusinessFacts;
}

export const ProfileSettingsZ = z.object({
  businessName: z.string().min(1),
  businessDomain: z.string().min(1),
  welcome: z.string().min(1),
  vars: z.record(z.string(), z.string()),
  businessFacts: BusinessFactsZ,
});

// ---- CONFIG editable (global) ----

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
}

export const ConfigSettingsZ = z.object({
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
});
