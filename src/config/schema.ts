import { z } from 'zod';

export const PromptVarsZ = z.object({
  promptTemplate: z.string().min(20),
  vars: z.record(z.string(), z.string()),
});
export type PromptVars = z.infer<typeof PromptVarsZ>;

export const BusinessFactsZ = z.object({
  facts: z
    .array(
      z.object({
        topic: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        answer: z.string().min(1),
      }),
    )
    .default([]),
  freeContext: z.string().default(''),
});
export type BusinessFacts = z.infer<typeof BusinessFactsZ>;

export const ConfigZ = z.object({
  profile: z.string().min(1),
  model: z.string().min(1).default('openrouter/auto'),
  maxSteps: z.number().int().positive().default(6),
  temperature: z.number().min(0).max(2).default(0.4),
  debounceMs: z.number().int().positive().default(5000),
  fallbackOnError: z
    .string()
    .default('Disculpa, tuve un problema. ¿Me lo repites?'),
  outOfScopeNudge: z
    .string()
    .default('Esto es solo para temas de {{businessDomain}}. ¿Cómo puedo ayudarte?'),
  hours: z
    .object({
      enabled: z.boolean().default(false),
      timezone: z.string().default('America/Mexico_City'),
      schedule: z.record(z.string(), z.union([z.tuple([z.string(), z.string()]), z.null()])).default({}),
      outOfHoursNotice: z.string().default(''),
    })
    .default({ enabled: false, timezone: 'America/Mexico_City', schedule: {}, outOfHoursNotice: '' }),
  owner: z.object({
    phoneE164: z.string().min(5),
    notifyOnReady: z.boolean().default(true),
    notifyOnDisconnect: z.boolean().default(true),
    panelUrl: z.string().url().default('http://localhost:3000'),
  }),
  panel: z
    .object({
      users: z
        .array(
          z.object({
            username: z.string().min(1),
            passwordHashEnv: z.string().min(1),
          }),
        )
        .default([]),
    })
    .default({ users: [] }),
  media: z
    .object({
      storeDir: z.string().default('./media'),
      transcribeAudio: z.boolean().default(true),
      whisperModel: z.string().default('openai/whisper-1'),
    })
    .default({ storeDir: './media', transcribeAudio: true, whisperModel: 'openai/whisper-1' }),
  limits: z
    .object({
      monthlyCostUsd: z.number().positive().default(50),
      alertOnCostUsd: z.number().positive().default(40),
      maxConsecutiveErrors: z.number().int().positive().default(3),
    })
    .default({ monthlyCostUsd: 50, alertOnCostUsd: 40, maxConsecutiveErrors: 3 }),
});
export type Config = z.infer<typeof ConfigZ>;

export interface Profile {
  intakeSchema: import('./intake-schema').IntakeSchema;
  promptVars: PromptVars;
  businessFacts: BusinessFacts;
  welcome: string;
  hash: string;
}
