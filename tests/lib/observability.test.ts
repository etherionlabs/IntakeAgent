import { describe, it, expect, vi, afterEach } from 'vitest';
import { scrub, captureError, setReporter } from '../../src/lib/observability';

describe('scrub', () => {
  it('redacta claves secretas y enmascara teléfonos', () => {
    const out = scrub({
      authorization: 'Bearer x', password: 'secret', JWT_SECRET: 'j',
      nested: { OPENROUTER_API_KEY: 'sk', note: 'llama al +52 155 5123 4567' },
      safe: 'hola',
    }) as any;
    expect(out.authorization).toBe('[redacted]');
    expect(out.password).toBe('[redacted]');
    expect(out.JWT_SECRET).toBe('[redacted]');
    expect(out.nested.OPENROUTER_API_KEY).toBe('[redacted]');
    expect(out.nested.note).toContain('[phone]');
    expect(out.safe).toBe('hola');
  });
});

describe('captureError', () => {
  afterEach(() => setReporter(() => {}));
  it('reporta con tenantId y extra ya scrubbed', () => {
    const reporter = vi.fn();
    setReporter(reporter);
    const err = new Error('boom');
    captureError(err, { tenantId: 't1', service: 'worker', extra: { password: 'p', ok: 1 } });
    expect(reporter).toHaveBeenCalledTimes(1);
    const [reportedErr, ctx] = reporter.mock.calls[0];
    expect(reportedErr).toBe(err);
    expect(ctx.tenantId).toBe('t1');
    expect((ctx.extra as any).password).toBe('[redacted]');
    expect((ctx.extra as any).ok).toBe(1);
  });

  it('nunca lanza aunque el reporter falle', () => {
    setReporter(() => { throw new Error('reporter down'); });
    expect(() => captureError(new Error('x'))).not.toThrow();
  });
});
