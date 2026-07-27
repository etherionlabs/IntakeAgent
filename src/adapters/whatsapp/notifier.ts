import type {
  OwnerReadyPayload,
  DisconnectPayload,
  UsageLimitPayload,
} from '../../services/notification';
import type { OutboundSender } from '../../services/outbound';
import type { ChannelNotifier } from '../../channels/types';
import type { Channel } from '../../pipeline/types';
import { logger } from '../../lib/logger';

export class WhatsAppNotifier implements ChannelNotifier {
  readonly channel: Channel = 'whatsapp';
  constructor(
    private readonly sender: OutboundSender,
    private readonly ownerPhoneE164: string,
  ) {}

  async notifyOwnerReady(payload: OwnerReadyPayload): Promise<void> {
    const name = payload.contactDisplayName ?? payload.contactPhone;
    // Los extras aceptados se destacan aparte del resumen: son la parte de la
    // orden que el dueño podría pasar por alto al cotizar y la que más margen deja.
    const extras = payload.extras ?? [];
    const extrasLine =
      extras.length > 0 ? `Extras aceptados: ${extras.join(', ')}\n` : '';
    const text =
      `🪡 Nuevo intake listo\n\n` +
      `Cliente: ${name}\n` +
      `Resumen: ${payload.summary}\n` +
      extrasLine +
      `\nVer: ${payload.panelUrl}/panel/jobs/${payload.jobId}`;
    await this.safeSend(text);
  }

  async notifyDisconnect(payload: DisconnectPayload): Promise<void> {
    const text =
      `⚠️ WhatsApp desconectado.\n` +
      `Motivo: ${payload.reason}\n` +
      `Revisa el panel para reconectar.`;
    await this.safeSend(text);
  }

  async notifyUsageLimit(payload: UsageLimitPayload): Promise<void> {
    const text =
      `🚦 Tu recepcionista alcanzó el límite mensual del plan gratuito ` +
      `(${payload.limit} respuestas). Dejará de responder hasta el próximo mes; ` +
      `los mensajes de tus clientes se siguen guardando en el panel.`;
    await this.safeSend(text);
  }

  private async safeSend(text: string): Promise<void> {
    try {
      await this.sender.sendText(this.ownerPhoneE164, text);
    } catch (e) {
      logger.warn(
        { err: e instanceof Error ? e.message : String(e) },
        'whatsapp_notifier.send_failed',
      );
    }
  }
}
