import type { PrismaClient, Job } from '@prisma/client';
import type { IntakeSchema } from '../config/intake-schema';
import { findOpenJobsForContact, openJob } from '../services/job';
import { createEmptyIntakeFromSchema } from '../services/intake';
import type { OpenJobSummary } from '../agent/types';

export interface JobResolution {
  job: Job;
  isFirstMessage: boolean;
  otherOpenJobs: OpenJobSummary[];
}

export async function resolveJobForMessage(
  prisma: PrismaClient,
  tenantId: string,
  schema: IntakeSchema,
  contactId: string,
  _messageId: string,
): Promise<JobResolution> {
  const open = await findOpenJobsForContact(prisma, tenantId, contactId);

  if (open.length === 0) {
    const totalJobs = await prisma.job.count({ where: { tenantId, contactId } });
    const isFirstMessage = totalJobs === 0;
    const job = await openJob(prisma, tenantId, contactId, createEmptyIntakeFromSchema(schema));
    return { job, isFirstMessage, otherOpenJobs: [] };
  }

  if (open.length === 1) {
    return { job: open[0], isFirstMessage: false, otherOpenJobs: [] };
  }

  // Con varios trabajos abiertos, el mensaje entra por el de la CONVERSACIÓN EN
  // CURSO: el del último mensaje de este contacto. Antes entraba siempre por el
  // más reciente, y eso deshacía en el turno siguiente cualquier cambio de
  // trabajo — el cliente decía «te hablo del sillón» y el mensaje después
  // volvía solo al trabajo nuevo. El mensaje que se está procesando todavía no
  // tiene jobId (se le asigna después de esto), así que no se cuenta a sí mismo.
  const lastAssigned = await prisma.message.findFirst({
    where: { tenantId, contactId, jobId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { jobId: true },
  });

  const byRecency = [...open].sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  const primary = open.find((j) => j.id === lastAssigned?.jobId) ?? byRecency[0];
  const rest = open.filter((j) => j.id !== primary.id);

  return {
    job: primary,
    isFirstMessage: false,
    otherOpenJobs: rest.map((j) => ({
      id: j.id,
      summary: j.summary,
      openedAt: j.openedAt,
    })),
  };
}
