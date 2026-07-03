import type { PrismaClient } from '@prisma/client';
import type { Config, Profile } from '../config/schema';
import type { Notifier } from '../services/notification';
import type { OutboundSender } from '../services/outbound';
import type { Transcriber } from '../media/transcriber';
import type { Describer } from '../media/describer';
import type { MediaStore } from '../media/store';
import type { AgentFactory } from '../agent/types';

export type Channel = 'whatsapp' | 'sms' | 'voice';

export interface RawInboundMessage {
  /** ID del mensaje en el canal de origen (idempotencia). Antes `whatsappMsgId`. */
  externalMsgId: string;
  /** Canal por el que entró el mensaje. */
  channel: Channel;
  fromPhoneE164: string;
  chatKind: 'individual' | 'group' | 'status' | 'other';
  fromMe: boolean;
  kind: 'text' | 'image' | 'audio' | 'sticker' | 'location' | 'other';
  text: string | null;
  media: { buffer: Buffer; mimetype: string } | null;
  raw: unknown;
  receivedAt: string;
}

export interface PipelineDeps {
  prisma: PrismaClient;
  tenantId: string;
  config: Config;
  profile: Profile;
  notifier: Notifier;
  sender: OutboundSender;
  transcriber: Transcriber;
  /** Describer de imágenes. Opcional: si falta, las fotos no se describen. */
  describer?: Describer;
  mediaStore: MediaStore;
  agentFactory: AgentFactory;
  now: () => Date;
  /**
   * Recarga config+perfil frescos desde disco por turno (hot-reload tras editar
   * los ajustes en el panel). Si falta, se usan los `config`/`profile` estáticos
   * que se pasaron al construir el coordinator. Pensado para inyectar
   * `ConfigCache.refresh()`, que mantiene la última versión válida ante errores.
   */
  reloadConfig?: () => Promise<{ config: Config; profile: Profile }>;
}

export type PrefilterResult =
  | { rejected: false }
  | { rejected: true; reason: 'group' | 'from_me' | 'status' | 'other_kind' };
