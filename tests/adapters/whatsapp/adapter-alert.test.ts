import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaileysAdapter } from '../../../src/adapters/whatsapp/adapter';
import { NoopNotifier } from '../../../src/services/notification';

// Construye un adapter sin arrancar Baileys (no se llama a start()/connect()).
function makeAdapter(notifier: NoopNotifier, thresholdMs: number) {
  return new BaileysAdapter({
    sessionDir: '/tmp/never-used',
    coordinator: {} as any,
    notifier,
    tenantId: 'tenant-x',
    alertThresholdMs: thresholdMs,
  });
}

describe('BaileysAdapter — alerta de desconexión sostenida', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('alerta al dueño si la desconexión persiste más del umbral', () => {
    const notifier = new NoopNotifier();
    const adapter = makeAdapter(notifier, 5000);
    (adapter as any).handleStatusChange('disconnected', 'socket down');

    vi.advanceTimersByTime(4000);
    expect(notifier.history).toHaveLength(0); // aún no

    vi.advanceTimersByTime(2000); // supera 5000
    expect(notifier.history).toHaveLength(1);
    expect(notifier.history[0].kind).toBe('disconnect_alert');
  });

  it('si reconecta antes del umbral, NO alerta', () => {
    const notifier = new NoopNotifier();
    const adapter = makeAdapter(notifier, 5000);
    (adapter as any).handleStatusChange('disconnected', 'socket down');
    vi.advanceTimersByTime(2000);
    (adapter as any).handleStatusChange('connected', undefined);
    vi.advanceTimersByTime(10000);
    expect(notifier.history).toHaveLength(0);
  });

  it('logged_out marca acción de re-vincular en el aviso al dueño', () => {
    const notifier = new NoopNotifier();
    const adapter = makeAdapter(notifier, 1000);
    (adapter as any).handleStatusChange('logged_out', 'logged out');
    vi.advanceTimersByTime(1500);
    expect(notifier.history).toHaveLength(1);
    expect((notifier.history[0].payload as any).reason).toContain('re-vincula');
  });
});
