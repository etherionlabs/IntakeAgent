import { describe, it, expect } from 'vitest';
import { NoopNotifier } from '../../src/services/notification';

describe('NoopNotifier', () => {
  it('notifyOwnerReady no arroja y guarda el evento en memoria', async () => {
    const n = new NoopNotifier();
    await n.notifyOwnerReady({
      jobId: 'j1',
      contactDisplayName: 'María',
      contactPhone: '+521',
      summary: 'Sillón a retapizar',
      panelUrl: 'http://localhost:3000',
    });
    expect(n.history).toHaveLength(1);
    expect(n.history[0].kind).toBe('owner_ready');
    expect((n.history[0].payload as any).jobId).toBe('j1');
  });

  it('notifyDisconnect agrega entrada con kind disconnect_alert', async () => {
    const n = new NoopNotifier();
    await n.notifyDisconnect({ reason: 'session expired' });
    expect(n.history).toHaveLength(1);
    expect(n.history[0].kind).toBe('disconnect_alert');
  });
});
