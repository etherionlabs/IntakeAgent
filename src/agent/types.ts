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
}

/** Snapshot mínimo de un job abierto para `select_or_open_job`. */
export interface OpenJobSummary {
  id: string;
  summary: string | null;
  openedAt: Date;
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
}

/** Dependencias externas inyectables (DB, notifier, factory del SDK). */
export interface AgentDeps {
  prisma: PrismaClient;
  config: Config;
  profile: Profile;
  notifier: import('../services/notification').Notifier;
  /** Factory del SDK — el runner llama `deps.createAgent({...})`. Permite stub en tests. */
  createAgent: AgentFactory;
}

/** Tipos mínimos del SDK que el runner consume. */
export interface AgentLike {
  on(event: string, handler: (...args: unknown[]) => void): void;
  sendSync(userMessage: string): Promise<AgentResponse>;
}

export interface AgentResponse {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
}

export interface AgentFactoryConfig {
  apiKey: string;
  model: string;
  instructions: string;
  tools: unknown[];
  maxSteps?: number;
  temperature?: number;
}

export type AgentFactory = (config: AgentFactoryConfig) => AgentLike;

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
}
