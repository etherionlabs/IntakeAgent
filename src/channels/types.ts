import type { OutboundSender } from '../services/outbound';
import type { Notifier } from '../services/notification';

/**
 * Canales soportados. Vive aquí y no en el pipeline porque es vocabulario del
 * CANAL: el pipeline consume canales, no al revés. Tenerlo del otro lado hacía
 * que `channels/` dependiera del pipeline y, por él, de la base de datos.
 */
export type Channel = 'whatsapp' | 'sms' | 'voice';

/**
 * Mensaje entrante tal como lo entrega un canal, antes de que nadie lo
 * interprete ni lo persista. Es la frontera de entrada: un adaptador produce
 * esto y no necesita saber qué pasa después.
 */
export interface RawInboundMessage {
  /** ID del mensaje en el canal de origen (idempotencia). */
  externalMsgId: string;
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

/**
 * A dónde entrega un adaptador lo que recibe.
 *
 * Es un método, y por eso es una interfaz: antes el adaptador de WhatsApp
 * importaba la clase concreta `InboundCoordinator`, y con ella arrastraba el
 * pipeline entero y Prisma. Un adaptador no debe saber qué se hace con el
 * mensaje — solo que alguien lo recoge.
 */
export interface InboundSink {
  handleInbound(raw: RawInboundMessage): Promise<void>;
}

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
