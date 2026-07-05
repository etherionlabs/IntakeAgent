import { describe, it, expect } from 'vitest';
import { requiredBootSecrets } from '../src/env';

describe('requiredBootSecrets', () => {
  it('en modo approval (v1 free) solo exige JWT_SECRET — Stripe dormante', () => {
    expect(requiredBootSecrets('approval')).toEqual(['JWT_SECRET']);
  });

  it('en modo subscription exige también los secretos de Stripe', () => {
    expect(requiredBootSecrets('subscription')).toEqual([
      'JWT_SECRET',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
    ]);
  });
});
