import { describe, it, expect, afterEach } from 'vitest';
import { isTenantActive } from '../src/billing/access';

const T = 'tenant-1';
const future = new Date(Date.now() + 3600_000);
const past = new Date(Date.now() - 3600_000);

describe('isTenantActive', () => {
  afterEach(() => { delete process.env.BILLING_EXEMPT_TENANT_IDS; });

  it('sin suscripción → false', () => {
    expect(isTenantActive(T, null)).toBe(false);
  });
  it('active / trialing → true', () => {
    expect(isTenantActive(T, { status: 'active', gracePeriodEndsAt: null })).toBe(true);
    expect(isTenantActive(T, { status: 'trialing', gracePeriodEndsAt: null })).toBe(true);
  });
  it('past_due dentro de gracia → true; fuera → false', () => {
    expect(isTenantActive(T, { status: 'past_due', gracePeriodEndsAt: future })).toBe(true);
    expect(isTenantActive(T, { status: 'past_due', gracePeriodEndsAt: past })).toBe(false);
    expect(isTenantActive(T, { status: 'past_due', gracePeriodEndsAt: null })).toBe(false);
  });
  it('incomplete / canceled / unpaid → false', () => {
    for (const status of ['incomplete', 'canceled', 'unpaid']) {
      expect(isTenantActive(T, { status, gracePeriodEndsAt: null })).toBe(false);
    }
  });
  it('tenant en BILLING_EXEMPT_TENANT_IDS → true aunque no tenga suscripción', () => {
    process.env.BILLING_EXEMPT_TENANT_IDS = `otro, ${T} `;
    expect(isTenantActive(T, null)).toBe(true);
  });
});
