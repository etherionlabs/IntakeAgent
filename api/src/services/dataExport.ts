import type { PrismaClient } from '@prisma/client';

/**
 * Exporta TODOS los datos de un tenant (derecho de acceso/portabilidad). Cada
 * query filtra por `tenantId` — cero filas de otros tenants. MVP: bundle JSON por
 * entidad; el empaquetado en ZIP con URL firmada es mejora de producción.
 */
export async function exportTenantData(prisma: PrismaClient, tenantId: string) {
  const [contacts, jobs, messages, agentRuns] = await Promise.all([
    prisma.contact.findMany({ where: { tenantId } }),
    prisma.job.findMany({ where: { tenantId } }),
    prisma.message.findMany({ where: { tenantId } }),
    prisma.agentRun.findMany({ where: { tenantId } }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    tenantId,
    contacts,
    jobs,
    messages,
    agentRuns,
  };
}
