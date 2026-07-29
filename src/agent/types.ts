import type { PrismaClient, Job, Contact } from '@prisma/client';
import type { Config, Profile } from '../config/schema';
import type { IntakeState } from '../services/intake';

/** Mensaje del cliente ya normalizado por el inbound pipeline (Plan 3). */
export interface BatchMessage {
  id: string;
  kind: 'text' | 'image' | 'audio' | 'sticker' | 'location' | 'other';
  /** Texto del mensaje, transcripción del audio o anotación descriptiva. */
  body: string | null;
  /** Path relativo en media-store si aplica. */
  mediaPath?: string | null;
  /** Descripción textual generada por el modelo de visión (solo imágenes). */
  description?: string | null;
}

/** Foto disponible en el job, referenciable por la tool `reanalyze_image`. */
export interface AvailablePhoto {
  messageId: string;
  caption: string | null;
  description: string | null;
}

/** Snapshot mínimo de un job abierto para `select_or_open_job`. */
export interface OpenJobSummary {
  id: string;
  summary: string | null;
  openedAt: Date;
}

/**
 * Imagen que el agente generó durante el turno (ej. previsualización de un wrap)
 * y que el coordinator debe ENVIAR al cliente y persistir como mensaje outbound.
 */
export interface OutboundAttachment {
  /** ID del futuro mensaje outbound; ya se usó como nombre del archivo en el media-store. */
  messageId: string;
  /** Ruta relativa en el media-store del archivo generado. */
  mediaPath: string;
  mimetype: string;
  /** Texto que acompaña la imagen. */
  caption: string | null;
}

/** Todo lo que el turno necesita saber sobre el "ahora". */
export interface TurnContext {
  job: Job;
  contact: Contact;
  intake: IntakeState;
  batchMessages: BatchMessage[];
  /** Lista de OTROS jobs abiertos del contacto. Si length>=2, `select_or_open_job` se expone. */
  otherOpenJobs: OpenJobSummary[];
  /** Hora actual ISO 8601 (inyectable para tests). */
  now: string;
  /**
   * Turno iniciado por el SISTEMA, no por el cliente (seguimiento proactivo).
   * Cuando está presente, `batchMessages` viene vacío y esta instrucción ocupa
   * el lugar del mensaje del cliente en la conversación con el modelo.
   */
  systemDirective?: string;
  /**
   * Historial reciente del job (mensajes inbound + outbound previos al batch actual,
   * ordenados cronológicamente). El agente lo ve para mantener coherencia conversacional.
   * Opcional para retro-compatibilidad con tests existentes.
   */
  recentHistory?: HistoryEntry[];
  /**
   * Fotos del job (del batch actual y de turnos previos) que el agente puede
   * re-analizar con `reanalyze_image`. Si está vacío, la tool no se expone.
   */
  availablePhotos?: AvailablePhoto[];
  /**
   * Adjuntos que el agente generó en el turno (previsualizaciones). La tool
   * `generate_preview` los empuja aquí; el runner los expone en TurnResult y el
   * coordinator los envía + persiste. Mutable a propósito (igual que `intake`).
   */
  pendingAttachments?: OutboundAttachment[];
  /**
   * Costo extra (USD) acumulado por tools que llaman a otros modelos dentro del
   * turno (ej. `generate_preview`). El runner lo suma al costo del turno para que
   * el reporte de gasto (AgentRun.costUsd) sea completo. Mutable a propósito.
   */
  extraCostUsd?: number;
}

export interface HistoryEntry {
  direction: 'inbound' | 'outbound';
  kind: 'text' | 'image' | 'audio' | 'sticker' | 'location' | 'other';
  body: string | null;
  createdAt: string;
}

/** Dependencias externas inyectables (DB, notifier, factory del SDK). */
export interface AgentDeps {
  prisma: PrismaClient;
  tenantId: string;
  config: Config;
  profile: Profile;
  notifier: import('../services/notification').Notifier;
  /** Factory del SDK — el runner llama `deps.createAgent({...})`. Permite stub en tests. */
  createAgent: AgentFactory;
  /** Media-store para leer imágenes (necesario para `reanalyze_image`). Opcional. */
  mediaStore?: import('../media/store').MediaStore;
  /** Describer de imágenes (necesario para `reanalyze_image`). Opcional. */
  describer?: import('../media/describer').Describer;
  /** Editor de imágenes (necesario para `generate_preview`). Opcional. */
  imageEditor?: import('../media/imageEditor').ImageEditor;
}

/** Tipos mínimos del SDK que el runner consume. */
export interface AgentLike {
  on(event: string, handler: (...args: unknown[]) => void): void;
  sendSync(userMessage: string): Promise<AgentResponse>;
}

export interface AgentResponse {
  text: string;
  usage?: { inputTokens?: number | null; outputTokens?: number | null; costUsd?: number | null };
}

export interface AgentFactoryConfig {
  apiKey: string;
  model: string;
  instructions: string;
  tools: unknown[];
  maxSteps?: number;
  temperature?: number;
}

export type AgentFactory = (config: AgentFactoryConfig) => AgentLike | Promise<AgentLike>;

/** Resultado del turno. */
export interface ToolCallRecord {
  name: string;
  args: unknown;
  result: unknown;
  error: string | null;
}

export interface TurnResult {
  responseText: string;
  toolCalls: ToolCallRecord[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  error: string | null;
  /** Clasificación del error del LLM cuando `error` no es null. */
  errorKind?: import('./errors').LlmErrorKind;
  /** Imágenes generadas en el turno (previsualizaciones) a enviar al cliente. */
  attachments: OutboundAttachment[];
}
