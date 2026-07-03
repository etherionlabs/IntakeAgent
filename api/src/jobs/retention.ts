import type { PrismaClient } from '@prisma/client';

/**
 * Purga de mensajes más viejos que la ventana de retención de cada tenant
 * (TenantSettings.messageRetentionMonths). Idempotente y por-tenant. Engánchese a
 * un cron del host o a un worker periódico. Devuelve cuántos mensajes borró.
 */
export async function purgeOldMessages(prisma: PrismaClient, now: Date = new Date()): Promise<{ deleted: number }> {
  const settings = await prisma.tenantSettings.findMany({ select: { tenantId: true, messageRetentionMonths: true } });
  let deleted = 0;
  for (const s of settings) {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - s.messageRetentionMonths);
    const res = await prisma.message.deleteMany({ where: { tenantId: s.tenantId, createdAt: { lt: cutoff } } });
    deleted += res.count;
  }
  return { deleted };
}
