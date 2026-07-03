import { describe, it, expect, vi } from 'vitest';
import { shouldAlertBotDown, shouldAlertErrorRate, shouldAlertOpenRouter, AlertDeduper } from '../../src/lib/alerts';

describe('reglas de alerta', () => {
  it('bot caído: alerta tras N min sostenidos; no si es loggedOut; no si reconectó', () => {
    const now = 10 * 60000;
    expect(shouldAlertBotDown({ disconnectedSinceMs: now - 6 * 60000, now, loggedOut: false, minutes: 5 })).toBe(true);
    expect(shouldAlertBotDown({ disconnectedSinceMs: now - 2 * 60000, now, loggedOut: false, minutes: 5 })).toBe(false);
    expect(shouldAlertBotDown({ disconnectedSinceMs: now - 6 * 60000, now, loggedOut: true, minutes: 5 })).toBe(false);
    expect(shouldAlertBotDown({ disconnectedSinceMs: null, now, loggedOut: false })).toBe(false);
  });

  it('error rate: alerta si supera el umbral con muestra suficiente', () => {
    expect(shouldAlertErrorRate(5, 100, 0.1)).toBe(false);
    expect(shouldAlertErrorRate(15, 100, 0.1)).toBe(true);
    expect(shouldAlertErrorRate(10, 10, 0.1)).toBe(false); // muestra insuficiente
  });

  it('openrouter: alerta con >= umbral de errores de saldo', () => {
    expect(shouldAlertOpenRouter(0)).toBe(false);
    expect(shouldAlertOpenRouter(1)).toBe(true);
  });

  it('deduper: no repite la misma alerta hasta limpiarla', async () => {
    const sink = vi.fn();
    const d = new AlertDeduper(sink);
    await d.emit({ kind: 'bot_down', severity: 'alta', tenantId: 't1', message: 'x' });
    await d.emit({ kind: 'bot_down', severity: 'alta', tenantId: 't1', message: 'x' });
    expect(sink).toHaveBeenCalledTimes(1);
    d.clear('bot_down', 't1');
    await d.emit({ kind: 'bot_down', severity: 'alta', tenantId: 't1', message: 'x' });
    expect(sink).toHaveBeenCalledTimes(2);
  });
});
