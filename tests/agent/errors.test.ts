import { describe, it, expect } from 'vitest';
import { classifyLlmError, isActionableLlmError } from '../../src/agent/errors';

describe('classifyLlmError', () => {
  it('402 / saldo agotado → insufficient_credits (no reintentar, accionable)', () => {
    expect(classifyLlmError({ status: 402 })).toBe('insufficient_credits');
    expect(classifyLlmError(new Error('Insufficient credits to run this model'))).toBe('insufficient_credits');
    expect(classifyLlmError(new Error('Payment Required'))).toBe('insufficient_credits');
    expect(isActionableLlmError('insufficient_credits')).toBe(true);
  });

  it('429 → rate_limit', () => {
    expect(classifyLlmError({ statusCode: 429 })).toBe('rate_limit');
    expect(classifyLlmError(new Error('Rate limit exceeded'))).toBe('rate_limit');
    expect(isActionableLlmError('rate_limit')).toBe(false);
  });

  it('5xx / red → transient', () => {
    expect(classifyLlmError({ status: 503 })).toBe('transient');
    expect(classifyLlmError(new Error('fetch failed: ECONNRESET'))).toBe('transient');
    expect(classifyLlmError(new Error('request timed out'))).toBe('transient');
  });

  it('otros → other', () => {
    expect(classifyLlmError(new Error('something weird'))).toBe('other');
    expect(classifyLlmError({ status: 400 })).toBe('other');
  });
});
