import type { PrismaClient } from '@prisma/client';

/**
 * Borra los datos de UN cliente final dentro de un tenant (derecho al olvido).
 * Idempotente. Filtra por `tenantId` — un contacto de otro tenant es intocable.
 */
export async function deleteContactData(prisma: PrismaClient, tenantId: string, contactId: string): Promise<void> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!contact) return; // idempotente / aislamiento
  const jobs = await prisma.job.findMany({ where: { tenantId, contactId }, select: { id: true } });
  const jobIds = jobs.map((j) => j.id);
  await prisma.$transaction([
    prisma.message.deleteMany({ where: { tenantId, contactId } }),
    prisma.agentRun.deleteMany({ where: { tenantId, jobId: { in: jobIds } } }),
    prisma.notification.deleteMany({ where: { tenantId, jobId: { in: jobIds } } }),
    prisma.job.deleteMany({ where: { tenantId, contactId } }),
    prisma.contact.deleteMany({ where: { tenantId, id: contactId } }),
  ]);
}

export interface TenantDeletionDeps {
  /** Cierra la conexión del worker y borra la sesión (Fase 2). Inyectable. */
  removeTenant?: (tenantId: string) => Promise<void>;
}

/**
 * Borrado total del tenant (derecho al olvido del negocio). Elimina los datos
 * operativos y de cuenta; CONSERVA LegalAcceptance y Subscription (defensa legal
 * / contabilidad de Stripe). Idempotente; marca el tenant como 'deleted' y dispara
 * removeTenant. Las copias de seguridad se purgan en su rotación (declarar en Privacidad).
 */
export async function deleteTenantData(prisma: PrismaClient, tenantId: string, deps: TenantDeletionDeps = {}): Promise<void> {
  await prisma.$transaction([
    prisma.message.deleteMany({ where: { tenantId } }),
    prisma.agentRun.deleteMany({ where: { tenantId } }),
    prisma.notification.deleteMany({ where: { tenantId } }),
    prisma.job.deleteMany({ where: { tenantId } }),
    prisma.contact.deleteMany({ where: { tenantId } }),
    prisma.emailVerification.deleteMany({ where: { tenantId } }),
    prisma.tenantSettings.deleteMany({ where: { tenantId } }),
    prisma.tenant.update({ where: { id: tenantId }, data: { status: 'deleted', active: false } }),
  ]);
  // PanelUser + sus tokens (fuera de la tx para no romper si no hay).
  const users = await prisma.panelUser.findMany({ where: { tenantId }, select: { id: true } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.panelUser.deleteMany({ where: { tenantId } });
  if (deps.removeTenant) await deps.removeTenant(tenantId).catch(() => {});
}
