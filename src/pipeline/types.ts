import type { PrismaClient } from '@prisma/client';
import type { Config, Profile } from '../config/schema';
import type { Notifier } from '../services/notification';
import type { OutboundSender } from '../services/outbound';
import type { Transcriber } from '../media/transcriber';
import type { Describer } from '../media/describer';
import type { ImageEditor } from '../media/imageEditor';
import type { MediaStore } from '../media/store';
import type { AgentFactory } from '../agent/types';

// El canal define qué entra y por dónde; el pipeline solo lo consume. Se
// reexportan para no tocar a quien ya los importaba de aquí.
export type { Channel, RawInboundMessage } from '../channels/types';

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
  /** Editor de imágenes. Opcional: si falta (o el toggle está apagado), no hay previsualizaciones. */
  imageEditor?: ImageEditor;
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
