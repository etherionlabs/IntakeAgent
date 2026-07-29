import type { PrismaClient } from '@prisma/client';

/**
 * Listado de contactos con el contexto que lo vuelve una agenda de trabajo y no
 * una tabla suelta: cuántos trabajos tiene cada quien, cuántos siguen abiertos,
 * cuándo fue la última vez que hablaron y a qué trabajo entrar.
 *
 * Se resuelve con un número FIJO de consultas (no una por contacto), para que la
 * página no se degrade cuando un negocio acumule cientos de clientes.
 */

const OPEN_STATUSES = ['OPEN_INTAKE', 'READY_FOR_REVIEW', 'IN_PROGRESS'];

export interface ContactListItem {
  id: string;
  phoneE164: string;
  displayName: string | null;
  botActive: boolean;
  flaggedNonIntake: boolean;
  flaggedReason: string | null;
  archivedAt: string | null;
  /** Trabajos no archivados del contacto. */
  jobCount: number;
  openJobCount: number;
  /** Último mensaje intercambiado, en cualquier dirección. */
  lastMessageAt: string | null;
  /** Trabajo más reciente, para entrar directo a su conversación. */
  lastJobId: string | null;
}

export async function listContacts(
  prisma: PrismaClient,
  tenantId: string,
  includeArchived: boolean,
): Promise<ContactListItem[]> {
  const contacts = await prisma.contact.findMany({
    where: { tenantId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: { updatedAt: 'desc' },
  });
  if (contacts.length === 0) return [];

  const ids = contacts.map((c) => c.id);

  const [jobCounts, openCounts, lastMessages, recentJobs] = await Promise.all([
    prisma.job.groupBy({
      by: ['contactId'],
      where: { tenantId, contactId: { in: ids }, archivedAt: null },
      _count: { _all: true },
    }),
    prisma.job.groupBy({
      by: ['contactId'],
      where: { tenantId, contactId: { in: ids }, archivedAt: null, status: { in: OPEN_STATUSES } },
      _count: { _all: true },
    }),
    prisma.message.groupBy({
      by: ['contactId'],
      where: { tenantId, contactId: { in: ids } },
      _max: { createdAt: true },
    }),
    // El trabajo más reciente por contacto: se ordena y se queda el primero de
    // cada uno, que evita una consulta por contacto.
    prisma.job.findMany({
      where: { tenantId, contactId: { in: ids }, archivedAt: null },
      orderBy: { openedAt: 'desc' },
      select: { id: true, contactId: true },
    }),
  ]);

  const jobCountBy = new Map(jobCounts.map((r) => [r.contactId, r._count._all]));
  const openCountBy = new Map(openCounts.map((r) => [r.contactId, r._count._all]));
  const lastMsgBy = new Map(lastMessages.map((r) => [r.contactId, r._max.createdAt]));
  const lastJobBy = new Map<string, string>();
  for (const j of recentJobs) {
    if (!lastJobBy.has(j.contactId)) lastJobBy.set(j.contactId, j.id);
  }

  return contacts.map((c) => ({
    id: c.id,
    phoneE164: c.phoneE164,
    displayName: c.displayName,
    botActive: c.botActive,
    flaggedNonIntake: c.flaggedNonIntake,
    flaggedReason: c.flaggedReason,
    archivedAt: c.archivedAt?.toISOString() ?? null,
    jobCount: jobCountBy.get(c.id) ?? 0,
    openJobCount: openCountBy.get(c.id) ?? 0,
    lastMessageAt: lastMsgBy.get(c.id)?.toISOString() ?? null,
    lastJobId: lastJobBy.get(c.id) ?? null,
  }));
}
