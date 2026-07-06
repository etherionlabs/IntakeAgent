import type { PrismaClient } from '@prisma/client';

export interface DeletionCounts {
  passwordResetTokens: number; notifications: number; agentRuns: number;
  messages: number; jobs: number; contacts: number; panelUsers: number;
  emailVerifications: number; tenantSettings: number; subscriptions: number; tenant: number;
}

/**
 * Borra un tenant y TODOS sus datos en orden FK-seguro, dentro de una transacción.
 * PRESERVA LegalAcceptance y OperatorAuditLog (sin FK a Tenant → defensa legal/auditoría).
 */
export async function hardDeleteTenant(prisma: PrismaClient, tenantId: string): Promise<DeletionCounts> {
  const users = await prisma.panelUser.findMany({ where: { tenantId }, select: { id: true } });
  const userIds = users.map((u) => u.id);

  return prisma.$transaction(async (tx) => {
    const passwordResetTokens = userIds.length
      ? (await tx.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } })).count : 0;
    const notifications = (await tx.notification.deleteMany({ where: { tenantId } })).count;
    const agentRuns = (await tx.agentRun.deleteMany({ where: { tenantId } })).count;
    const messages = (await tx.message.deleteMany({ where: { tenantId } })).count;
    const jobs = (await tx.job.deleteMany({ where: { tenantId } })).count;
    const contacts = (await tx.contact.deleteMany({ where: { tenantId } })).count;
    const panelUsers = (await tx.panelUser.deleteMany({ where: { tenantId } })).count;
    const emailVerifications = (await tx.emailVerification.deleteMany({ where: { tenantId } })).count;
    const tenantSettings = (await tx.tenantSettings.deleteMany({ where: { tenantId } })).count;
    const subscriptions = (await tx.subscription.deleteMany({ where: { tenantId } })).count;
    await tx.tenant.delete({ where: { id: tenantId } });
    return { passwordResetTokens, notifications, agentRuns, messages, jobs, contacts, panelUsers, emailVerifications, tenantSettings, subscriptions, tenant: 1 };
  });
}
