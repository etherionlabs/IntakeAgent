import type { PrismaClient } from '@prisma/client';
import { workerCall } from '../lib/worker-client';
import type { EmailSender } from '../lib/email';
import { accountApprovedEmail, accountRejectedEmail } from '../email/templates';

export interface ApprovalDeps {
  doFetch: typeof fetch;
  emailSender: Pick<EmailSender, 'send'>;
}

/** Email del dueño del tenant (primer PanelUser admin por antigüedad). */
export async function ownerEmail(prisma: PrismaClient, tenantId: string): Promise<string | null> {
  const u = await prisma.panelUser.findFirst({
    where: { tenantId, role: 'admin' },
    orderBy: { createdAt: 'asc' },
    select: { email: true },
  });
  return u?.email ?? null;
}

/**
 * Aprueba un tenant: lo marca como aprobado, lo activa y lo levanta en el worker
 * si ya está aprovisionado. Avisa al dueño por email (silencia fallos de SMTP).
 * Devuelve null si el tenant no existe.
 */
export async function approveTenant(
  prisma: PrismaClient,
  deps: ApprovalDeps,
  tenantId: string,
) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return null;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { approvalStatus: 'approved', approvedAt: new Date(), active: true },
  });
  if (tenant.status === 'provisioning' || tenant.status === 'active') {
    await workerCall(deps.doFetch, 'POST', tenantId, '/internal/tenant/add');
  }
  const email = await ownerEmail(prisma, tenantId);
  if (email) {
    const { subject, body } = accountApprovedEmail(tenant.name);
    await deps.emailSender.send(email, subject, body).catch(() => {});
  }
  return tenant;
}

/**
 * Rechaza un tenant: lo marca como rechazado, lo desactiva y lo suspende en el
 * worker si estaba conectado. Avisa al dueño por email (silencia fallos de SMTP).
 * Devuelve null si el tenant no existe.
 */
export async function rejectTenant(
  prisma: PrismaClient,
  deps: ApprovalDeps,
  tenantId: string,
) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return null;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { approvalStatus: 'rejected', active: false },
  });
  await workerCall(deps.doFetch, 'POST', tenantId, '/internal/tenant/suspend');
  const email = await ownerEmail(prisma, tenantId);
  if (email) {
    const { subject, body } = accountRejectedEmail(tenant.name);
    await deps.emailSender.send(email, subject, body).catch(() => {});
  }
  return tenant;
}
