import type { PrismaClient } from '@prisma/client';
import type { Notifier } from '../services/notification';
import { logger } from '../lib/logger';

/**
 * Límite mensual de respuestas del bot en el plan gratuito (v1, ACCESS_MODE=approval).
 * Una "respuesta" = un turno del agente (fila AgentRun). Los mensajes entrantes se
 * siguen registrando siempre; solo se corta la generación de respuestas.
 */

/** Inicio del mes calendario en curso (UTC). */
export function startOfMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Límite efectivo del tenant: override por tenant (Tenant.monthlyRunLimit) o el
 * default global FREE_MONTHLY_RUN_LIMIT. `null` → sin límite (modo subscription,
 * donde cobra Stripe y no aplica el plan gratuito).
 */
export async function monthlyRunLimitFor(prisma: PrismaClient, tenantId: string): Promise<number | null> {
  if (process.env.ACCESS_MODE === 'subscription') return null;
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { monthlyRunLimit: true } });
  if (t?.monthlyRunLimit != null) return t.monthlyRunLimit;
  const n = Number(process.env.FREE_MONTHLY_RUN_LIMIT ?? 300);
  return Number.isFinite(n) && n > 0 ? n : 300;
}

export interface UsageCheck {
  limited: boolean;
  used: number;
  limit: number | null;
}

/** ¿El tenant ya agotó sus respuestas del mes? */
export async function checkMonthlyLimit(
  prisma: PrismaClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<UsageCheck> {
  const limit = await monthlyRunLimitFor(prisma, tenantId);
  if (limit === null) return { limited: false, used: 0, limit: null };
  const used = await prisma.agentRun.count({
    where: { tenantId, createdAt: { gte: startOfMonthUtc(now) } },
  });
  return { limited: used >= limit, used, limit };
}

/**
 * Notifica al dueño UNA sola vez por mes que se alcanzó el límite. La marca de
 * "ya avisado" es una fila Notification kind='usage_limit' dentro del mes en
 * curso (atada al job que disparó el corte).
 */
export async function notifyLimitOnce(
  prisma: PrismaClient,
  tenantId: string,
  jobId: string,
  notifier: Notifier,
  usage: { used: number; limit: number },
  now: Date = new Date(),
): Promise<void> {
  const already = await prisma.notification.findFirst({
    where: { tenantId, kind: 'usage_limit', sentAt: { gte: startOfMonthUtc(now) } },
    select: { id: true },
  });
  if (already) return;
  await prisma.notification.create({
    data: { tenantId, jobId, kind: 'usage_limit', sentVia: notifier.notifyUsageLimit ? 'whatsapp' : 'panel_only' },
  });
  try {
    await notifier.notifyUsageLimit?.({ used: usage.used, limit: usage.limit });
  } catch (e) {
    logger.warn({ tenantId, err: e instanceof Error ? e.message : String(e) }, 'usage_limit.notify_failed');
  }
}
