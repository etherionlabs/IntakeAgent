import type { Channel } from '../pipeline/types';
import type { OutboundSender } from '../services/outbound';
import type { Notifier } from '../services/notification';

/**
 * Frontera del worker: contratos por canal. WhatsApp (Baileys) es UNA
 * implementación; SMS/voz (Fase 8) y la API oficial de WhatsApp (decisión #10)
 * entran como otras implementaciones SIN tocar el pipeline.
 *
 * Diseño neutral: estas interfaces NO exponen detalles específicos de Baileys
 * (sesión, QR) en su forma común — `qr` es opcional/`null` en canales sin QR.
 */

/** Fuente entrante: ciclo de vida de la conexión que empuja mensajes al pipeline. */
export interface InboundSource {
  readonly channel: Channel;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Sender de salida con su canal declarado. */
export interface ChannelOutboundSender extends OutboundSender {
  readonly channel: Channel;
}

/** Notificador (al dueño) con su canal declarado. */
export interface ChannelNotifier extends Notifier {
  readonly channel: Channel;
}

/** Estado de conexión neutral al canal (qr null en canales sin QR). */
export interface ChannelStatusSnapshot {
  status: 'connecting' | 'qr_required' | 'connected' | 'disconnected' | 'logged_out';
  qr: string | null;
  phone: string | null;
  lastError: string | null;
  lastConnectedAt: string | null;
}

/** Control de la conexión que el TenantRuntime/Manager necesita para status/acciones. */
export interface ConnectionControl {
  state(): ChannelStatusSnapshot;
  logout(): Promise<void>;
  reconnect(): Promise<void>;
}
