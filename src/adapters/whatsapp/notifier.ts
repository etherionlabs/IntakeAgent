import type {
  Notifier,
  OwnerReadyPayload,
  DisconnectPayload,
} from '../../services/notification';
import type { OutboundSender } from '../../services/outbound';
import { logger } from '../../lib/logger';

export class WhatsAppNotifier implements Notifier {
  constructor(
    private readonly sender: OutboundSender,
    private readonly ownerPhoneE164: string,
  ) {}

  async notifyOwnerReady(payload: OwnerReadyPayload): Promise<void> {
    const name = payload.contactDisplayName ?? payload.contactPhone;
    const text =
      `🪡 Nuevo intake listo\n\n` +
      `Cliente: ${name}\n` +
      `Resumen: ${payload.summary}\n\n` +
      `Ver: ${payload.panelUrl}/panel/jobs/${payload.jobId}`;
    await this.safeSend(text);
  }

  async notifyDisconnect(payload: DisconnectPayload): Promise<void> {
    const text =
      `⚠️ WhatsApp desconectado.\n` +
      `Motivo: ${payload.reason}\n` +
      `Revisa el panel para reconectar.`;
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
