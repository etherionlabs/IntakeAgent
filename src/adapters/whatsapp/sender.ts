import type { OutboundSender } from '../../services/outbound';
import type { WASocket } from './types';

/**
 * Sender que envía mensajes vía Baileys.
 *
 * Acepta dos formas de destino:
 * - **E.164** (ej. "+5215555555555"): se convierte a `5215555555555@s.whatsapp.net`.
 * - **JID directo** (ej. "166137958535379@lid"): se usa tal cual. Esto es
 *   necesario para responder a cuentas con LID (Baileys 7).
 */
export class WhatsAppSender implements OutboundSender {
  constructor(private readonly getSocket: () => WASocket | null) {}

  async sendText(target: string, text: string): Promise<void> {
    const socket = this.getSocket();
    if (!socket) {
      throw new Error('WhatsAppSender: socket no disponible (¿desconectado?)');
    }
    const jid = targetToJid(target);
    if (!jid) {
      throw new Error(`WhatsAppSender: destino inválido "${target}"`);
    }
    await socket.sendMessage(jid, { text });
  }
}

/**
 * Resuelve el destino a un JID válido de Baileys.
 * - "+5215..." → "5215...@s.whatsapp.net"
 * - "166...@lid" → "166...@lid" (pass-through)
 * - "" o solo "+" → null (inválido)
 */
export function targetToJid(target: string): string | null {
  if (!target) return null;
  // Ya es un JID completo (contiene @).
  if (target.includes('@')) return target;
  // E.164 — quitar el "+" inicial.
  const num = target.startsWith('+') ? target.slice(1) : target;
  if (!num) return null;
  return `${num}@s.whatsapp.net`;
}

// Mantener export anterior por compatibilidad con tests existentes.
export const e164ToJid = targetToJid;
