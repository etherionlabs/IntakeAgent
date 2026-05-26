import type { OutboundSender } from '../../services/outbound';
import type { WASocket } from './types';

export class WhatsAppSender implements OutboundSender {
  constructor(private readonly getSocket: () => WASocket | null) {}

  async sendText(toPhoneE164: string, text: string): Promise<void> {
    const socket = this.getSocket();
    if (!socket) {
      throw new Error('WhatsAppSender: socket no disponible (¿desconectado?)');
    }
    const jid = e164ToJid(toPhoneE164);
    await socket.sendMessage(jid, { text });
  }
}

export function e164ToJid(e164: string): string {
  const num = e164.startsWith('+') ? e164.slice(1) : e164;
  return `${num}@s.whatsapp.net`;
}
