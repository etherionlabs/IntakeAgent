import { billingExemptTenantIds } from '../env';

export interface SubLike {
  status: string;
  gracePeriodEndsAt: Date | null;
}

/**
 * ¿El tenant puede operar (panel + bot)? Fuente de verdad para el enforcement.
 * - active / trialing → sí
 * - past_due → sí solo dentro de la gracia
 * - incomplete / canceled / unpaid / sin suscripción → no
 * - tenant en BILLING_EXEMPT_TENANT_IDS → sí (bypass temporal del piloto)
 */
export function isTenantActive(tenantId: string, sub: SubLike | null, now: Date = new Date()): boolean {
  if (billingExemptTenantIds().has(tenantId)) return true;
  if (!sub) return false;
  if (sub.status === 'active' || sub.status === 'trialing') return true;
  if (sub.status === 'past_due') {
    return sub.gracePeriodEndsAt ? now < sub.gracePeriodEndsAt : false;
  }
  return false;
}
