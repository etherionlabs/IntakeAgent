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
  schema: IntakeSchema,
  contactId: string,
  _messageId: string,
): Promise<JobResolution> {
  const open = await findOpenJobsForContact(prisma, contactId);

  if (open.length === 0) {
    const totalJobs = await prisma.job.count({ where: { contactId } });
    const isFirstMessage = totalJobs === 0;
    const job = await openJob(prisma, contactId, createEmptyIntakeFromSchema(schema));
    return { job, isFirstMessage, otherOpenJobs: [] };
  }

  if (open.length === 1) {
    return { job: open[0], isFirstMessage: false, otherOpenJobs: [] };
  }

  const sorted = [...open].sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  const [primary, ...rest] = sorted;
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
