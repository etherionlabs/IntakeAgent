import { accessMode, billingExemptTenantIds } from '../env';

export interface SubLike {
  status: string;
  gracePeriodEndsAt: Date | null;
}

export interface TenantAccessLike {
  approvalStatus: string;
  status: string;
}

/**
 * ¿El tenant puede operar (panel + bot)? Fuente de verdad para el enforcement.
 * Modo 'subscription' (Fase 3, dormante en v1):
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

export type AccessDenial = 'pending_approval' | 'rejected' | 'suspended' | 'subscription_inactive';

/**
 * Decisión de acceso según ACCESS_MODE (v1: 'approval').
 * Modo 'approval': la cuenta opera solo si el superadmin la aprobó desde el panel de plataforma y
 * no está suspendida. El límite mensual NO bloquea el panel (solo las respuestas
 * del bot, en el worker): el cliente debe poder ver su uso y sus datos.
 * Modo 'subscription': delega en isTenantActive (Stripe).
 */
export function checkTenantAccess(
  tenantId: string,
  tenant: TenantAccessLike | null,
  sub: SubLike | null,
  now: Date = new Date(),
): { allowed: true } | { allowed: false; reason: AccessDenial } {
  if (accessMode() === 'subscription') {
    return isTenantActive(tenantId, sub, now)
      ? { allowed: true }
      : { allowed: false, reason: 'subscription_inactive' };
  }
  if (tenant?.status === 'suspended') return { allowed: false, reason: 'suspended' };
  if (tenant?.approvalStatus === 'approved') return { allowed: true };
  if (tenant?.approvalStatus === 'rejected') return { allowed: false, reason: 'rejected' };
  return { allowed: false, reason: 'pending_approval' };
}
