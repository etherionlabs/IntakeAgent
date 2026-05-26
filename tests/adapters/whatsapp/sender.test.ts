import { describe, it, expect, vi } from 'vitest';
import { WhatsAppSender } from '../../../src/adapters/whatsapp/sender';
import type { WASocket } from '../../../src/adapters/whatsapp/types';

function makeFakeSocket(): WASocket & { sent: Array<{ jid: string; content: any }> } {
  const sent: Array<{ jid: string; content: any }> = [];
  return {
    sent,
    sendMessage: vi.fn(async (jid: string, content: { text: string }) => {
      sent.push({ jid, content });
    }),
  };
}

describe('WhatsAppSender', () => {
  it('convierte +52155... a JID correcto y llama sendMessage', async () => {
    const socket = makeFakeSocket();
    const sender = new WhatsAppSender(() => socket);
    await sender.sendText('+5215555555555', 'hola María');
    expect(socket.sent).toEqual([
      { jid: '5215555555555@s.whatsapp.net', content: { text: 'hola María' } },
    ]);
  });

  it('omite el "+" inicial del número', async () => {
    const socket = makeFakeSocket();
    const sender = new WhatsAppSender(() => socket);
    await sender.sendText('+521', 'x');
    expect(socket.sent[0].jid).toBe('521@s.whatsapp.net');
  });

  it('arroja si el socket aún no está disponible', async () => {
    const sender = new WhatsAppSender(() => null);
    await expect(sender.sendText('+1', 'hi')).rejects.toThrow(/socket/i);
  });
});
