import { z } from 'zod';

export const PromptVarsZ = z.object({
  promptTemplate: z.string().min(20),
  vars: z.record(z.string(), z.string()),
  /**
   * Nombres de "skills" (técnicas reutilizables: ventas, objeciones…) a cargar
   * desde la biblioteca `skills/`. Se resuelven a instrucciones que se inyectan
   * en el system prompt. Opcional; por defecto ninguna.
   */
  skills: z.array(z.string()).default([]),
  /**
   * Módulos de dominio que compone esta vertical (`src/domain/registry.ts`).
   * El defecto es la composición histórica de Intake: captar y además asesorar.
   * Una vertical de captación pura declara `["intake"]`.
   */
  modules: z.array(z.string()).min(1).default(['intake', 'ventas']),
});
export type PromptVars = z.infer<typeof PromptVarsZ>;

/**
 * Una "skill": un cuerpo de instrucciones reutilizable que enseña al modelo una
 * técnica (ej. venta consultiva) independiente del giro. Vive en
 * `skills/<name>/skill.json` y se referencia por nombre desde el perfil.
 */
export const SkillZ = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  instructions: z.string().min(1),
});
export type LoadedSkill = z.infer<typeof SkillZ>;

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
      describeImages: z.boolean().default(true),
      visionModel: z.string().default('openai/gpt-4o-mini'),
      // Edición/previsualización de imágenes (ej. rayas deportivas, color de wrap).
      // Opt-in: cuesta más y es más lento que describir. Requiere un modelo con
      // salida de imagen (ej. google/gemini-2.5-flash-image-preview).
      editImages: z.boolean().default(false),
      imageEditModel: z.string().default('google/gemini-2.5-flash-image-preview'),
    })
    .default({
      storeDir: './media',
      transcribeAudio: true,
      whisperModel: 'openai/whisper-1',
      describeImages: true,
      visionModel: 'openai/gpt-4o-mini',
      editImages: false,
      imageEditModel: 'google/gemini-2.5-flash-image-preview',
    }),
  /**
   * Divulgación de IA. El AI Act (art. 50, aplicable desde el 2026-08-02) exige
   * informar a la persona cuando interactúa con un sistema de IA. El texto es
   * global del deployment; encender o apagar el aviso es por tenant
   * (TenantSettings.aiDisclosure), porque depende de su jurisdicción.
   */
  disclosure: z
    .object({
      text: z
        .string()
        .default(
          'Te atiende un asistente automatizado. Si prefieres hablar con una persona, dímelo y te paso con el equipo.',
        ),
      /**
       * El aviso en otros idiomas. Si la bienvenida sale en inglés, el aviso de
       * IA tiene que salir en inglés: un aviso que el cliente no entiende no
       * informa a nadie, que es justo lo que el AI Act (art. 50) exige.
       */
      translations: z
        .record(z.string(), z.string())
        .default({
          en: "You're chatting with an automated assistant. If you'd rather talk to a person, just say so and I'll pass you to the team.",
        }),
    })
    .default({
      text: 'Te atiende un asistente automatizado. Si prefieres hablar con una persona, dímelo y te paso con el equipo.',
      translations: {
        en: "You're chatting with an automated assistant. If you'd rather talk to a person, just say so and I'll pass you to the team.",
      },
    }),
  /**
   * Seguimiento proactivo: el bot reabre la conversación cuando el cliente se
   * queda callado (una oferta sin responder, un intake a medias). Interruptor
   * GLOBAL del deployment; además cada tenant lo activa desde el panel
   * (TenantSettings.followUpEnabled), porque son mensajes NO solicitados y el
   * riesgo (molestar al cliente, que WhatsApp castigue el número) es del negocio.
   */
  followUp: z
    .object({
      enabled: z.boolean().default(true),
      /** Silencio del cliente (horas) antes del primer seguimiento. */
      afterHours: z.number().positive().default(24),
      /** Tope de seguimientos por job. Agotado, el bot no vuelve a insistir. */
      maxFollowUps: z.number().int().nonnegative().default(2),
      /** Espera mínima (horas) entre dos seguimientos del mismo job. */
      minHoursBetween: z.number().positive().default(24),
      /** Cada cuánto barre el worker buscando candidatos. */
      sweepMinutes: z.number().positive().default(30),
    })
    .default({
      enabled: true,
      afterHours: 24,
      maxFollowUps: 2,
      minHoursBetween: 24,
      sweepMinutes: 30,
    }),
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
  /**
   * Bienvenida en otros idiomas, por código ('en'). Se elige según el idioma en
   * que escribió el cliente; sin traducción para ese idioma se usa `welcome`.
   * En archivos son `welcome.<lang>.txt` junto a `welcome.txt`.
   */
  welcomeTranslations?: Record<string, string>;
  /** Instrucciones de foco para describir imágenes (vertical-specific). Opcional. */
  imageFocus: string;
  /** Guía de estilo para EDITAR imágenes / previsualizaciones (vertical-specific). Opcional. */
  imageEditGuidance: string;
  /** Skills (técnicas reutilizables) ya resueltas desde la biblioteca `skills/`. */
  skills: LoadedSkill[];
  /** Módulos de dominio compuestos por esta vertical, por nombre. */
  modules: string[];
  /** ¿Se avisa al cliente que le atiende una IA? Decisión por tenant. */
  aiDisclosure: boolean;
  hash: string;
}
