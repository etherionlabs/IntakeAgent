import { describe, it, expect } from 'vitest';
import { MemorySender } from '../../src/services/outbound';

describe('MemorySender', () => {
  it('sendText guarda el mensaje en sent[]', async () => {
    const s = new MemorySender();
    await s.sendText('+5215555', 'hola María');
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toEqual({ to: '+5215555', text: 'hola María' });
  });

  it('múltiples envíos preservan el orden', async () => {
    const s = new MemorySender();
    await s.sendText('+521', 'uno');
    await s.sendText('+521', 'dos');
    expect(s.sent.map((m) => m.text)).toEqual(['uno', 'dos']);
  });

  it('clear() vacía el historial', async () => {
    const s = new MemorySender();
    await s.sendText('+1', 'x');
    s.clear();
    expect(s.sent).toHaveLength(0);
  });
});
