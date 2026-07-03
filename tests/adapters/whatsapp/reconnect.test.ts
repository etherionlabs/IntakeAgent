import { describe, it, expect } from 'vitest';
import { DisconnectReason } from 'baileys';
import { reconnectDelay, reconnectDelayCeiling, classifyDisconnect } from '../../../src/adapters/whatsapp/reconnect';

describe('reconnect backoff', () => {
  it('el techo crece exponencialmente y se topa en 30s', () => {
    expect(reconnectDelayCeiling(0)).toBe(1000);
    expect(reconnectDelayCeiling(1)).toBe(2000);
    expect(reconnectDelayCeiling(2)).toBe(4000);
    expect(reconnectDelayCeiling(3)).toBe(8000);
    expect(reconnectDelayCeiling(10)).toBe(30000); // topado
    expect(reconnectDelayCeiling(100)).toBe(30000);
  });

  it('el delay con jitter cae dentro de [0, techo]', () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const ceiling = reconnectDelayCeiling(attempt);
      for (let i = 0; i < 50; i++) {
        const d = reconnectDelay(attempt);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(ceiling);
      }
    }
  });
});

describe('classifyDisconnect', () => {
  it('loggedOut → no reintentar', () => {
    expect(classifyDisconnect(DisconnectReason.loggedOut)).toEqual({ action: 'logged_out' });
  });

  it('códigos transitorios → reintentar', () => {
    expect(classifyDisconnect(DisconnectReason.restartRequired)).toEqual({ action: 'retry' });
    expect(classifyDisconnect(DisconnectReason.connectionLost)).toEqual({ action: 'retry' });
    expect(classifyDisconnect(DisconnectReason.timedOut)).toEqual({ action: 'retry' });
    expect(classifyDisconnect(503)).toEqual({ action: 'retry' });
    expect(classifyDisconnect(undefined)).toEqual({ action: 'retry' });
  });
});
