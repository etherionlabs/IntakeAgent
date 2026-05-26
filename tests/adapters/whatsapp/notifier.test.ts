import { describe, it, expect } from 'vitest';
import { WhatsAppNotifier } from '../../../src/adapters/whatsapp/notifier';
import { MemorySender } from '../../../src/services/outbound';

describe('WhatsAppNotifier', () => {
  it('notifyOwnerReady envía mensaje formateado al teléfono del dueño', async () => {
    const sender = new MemorySender();
    const notifier = new WhatsAppNotifier(sender, '+5210000000000');
    await notifier.notifyOwnerReady({
      jobId: 'j1',
      contactDisplayName: 'María González',
      contactPhone: '+5215555',
      summary: 'Retapizado de sillón 3 plazas en Polanco.',
      panelUrl: 'http://localhost:3000',
    });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe('+5210000000000');
    expect(sender.sent[0].text).toContain('Nuevo intake');
    expect(sender.sent[0].text).toContain('María González');
    expect(sender.sent[0].text).toContain('Retapizado de sillón');
    expect(sender.sent[0].text).toContain('http://localhost:3000');
  });

  it('notifyOwnerReady usa el teléfono cuando displayName es null', async () => {
    const sender = new MemorySender();
    const notifier = new WhatsAppNotifier(sender, '+5210000000000');
    await notifier.notifyOwnerReady({
      jobId: 'j1',
      contactDisplayName: null,
      contactPhone: '+5215555',
      summary: 'x'.repeat(30),
      panelUrl: 'http://x',
    });
    expect(sender.sent[0].text).toContain('+5215555');
  });

  it('notifyDisconnect envía aviso con la razón', async () => {
    const sender = new MemorySender();
    const notifier = new WhatsAppNotifier(sender, '+5210000000000');
    await notifier.notifyDisconnect({ reason: 'session expired' });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].text).toMatch(/desconect/i);
    expect(sender.sent[0].text).toContain('session expired');
  });

  it('si el sender falla, el notifier no propaga', async () => {
    const failingSender = {
      sendText: async () => {
        throw new Error('socket down');
      },
    };
    const notifier = new WhatsAppNotifier(failingSender, '+521');
    await expect(
      notifier.notifyDisconnect({ reason: 'x' }),
    ).resolves.toBeUndefined();
  });
});
