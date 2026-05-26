import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InboundDebouncer } from '../../src/pipeline/debouncer';

describe('InboundDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flush dispara una vez después de los ms configurados', async () => {
    const flushed: Array<string[]> = [];
    const deb = new InboundDebouncer({
      debounceMs: 5000,
      onFlush: async (contactId, ids) => {
        flushed.push(ids);
      },
    });
    deb.enqueue('c1', 'm1');
    deb.enqueue('c1', 'm2');
    deb.enqueue('c1', 'm3');
    await vi.advanceTimersByTimeAsync(5001);
    expect(flushed).toEqual([['m1', 'm2', 'm3']]);
  });

  it('cada mensaje nuevo resetea el timer (sólo dispara cuando hay 5s de silencio)', async () => {
    const flushed: Array<string[]> = [];
    const deb = new InboundDebouncer({
      debounceMs: 5000,
      onFlush: async (_c, ids) => {
        flushed.push(ids);
      },
    });
    deb.enqueue('c1', 'm1');
    await vi.advanceTimersByTimeAsync(3000);
    deb.enqueue('c1', 'm2');
    await vi.advanceTimersByTimeAsync(3000);
    expect(flushed).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2001);
    expect(flushed).toEqual([['m1', 'm2']]);
  });

  it('contactos distintos se procesan en paralelo (cada uno tiene su buffer)', async () => {
    const flushed: Array<{ c: string; ids: string[] }> = [];
    const deb = new InboundDebouncer({
      debounceMs: 5000,
      onFlush: async (c, ids) => {
        flushed.push({ c, ids });
      },
    });
    deb.enqueue('c1', 'a');
    deb.enqueue('c2', 'b');
    await vi.advanceTimersByTimeAsync(5001);
    expect(flushed.sort((x, y) => x.c.localeCompare(y.c))).toEqual([
      { c: 'c1', ids: ['a'] },
      { c: 'c2', ids: ['b'] },
    ]);
  });

  it('mensajes que entran durante processing se procesan en la siguiente vuelta', async () => {
    const calls: Array<string[]> = [];
    let resolveFirst!: () => void;
    const firstFlush = new Promise<void>((r) => (resolveFirst = r));
    const deb = new InboundDebouncer({
      debounceMs: 5000,
      onFlush: async (_c, ids) => {
        calls.push(ids);
        if (calls.length === 1) await firstFlush;
      },
    });
    deb.enqueue('c1', 'm1');
    await vi.advanceTimersByTimeAsync(5001);
    deb.enqueue('c1', 'm2');
    deb.enqueue('c1', 'm3');
    resolveFirst();
    await vi.runAllTimersAsync();
    expect(calls).toEqual([['m1'], ['m2', 'm3']]);
  });
});
