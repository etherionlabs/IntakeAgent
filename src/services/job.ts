import type { PrismaClient, Job } from '@prisma/client';
import { ServiceError } from './errors';
import type { IntakeState } from './intake';

export const JOB_STATUS = {
  OPEN: 'OPEN_INTAKE',
  READY: 'READY_FOR_REVIEW',
  IN_PROGRESS: 'IN_PROGRESS',
  CLOSED: 'CLOSED',
} as const;

export async function openJob(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
  initialIntake: IntakeState,
): Promise<Job> {
  return prisma.job.create({
    data: {
      tenantId,
      contactId,
      status: JOB_STATUS.OPEN,
      intake: JSON.stringify(initialIntake),
    },
  });
}

export async function markReadyForReview(
  prisma: PrismaClient,
  tenantId: string,
  jobId: string,
  summary: string,
): Promise<Job> {
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId } });
  if (!job) throw new ServiceError(`job ${jobId} no existe`, 'JOB_NOT_FOUND');
  if (job.status !== JOB_STATUS.OPEN) {
    throw new ServiceError(
      `markReadyForReview requiere status=${JOB_STATUS.OPEN}, actual=${job.status}`,
      'INVALID_TRANSITION',
    );
  }
  return prisma.job.update({
    where: { id: jobId, tenantId },
    data: {
      status: JOB_STATUS.READY,
      summary,
      readyAt: new Date(),
      intakeComplete: true,
    },
  });
}

export async function markInProgress(
  prisma: PrismaClient,
  tenantId: string,
  jobId: string,
): Promise<Job> {
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId } });
  if (!job) throw new ServiceError(`job ${jobId} no existe`, 'JOB_NOT_FOUND');
  if (job.status !== JOB_STATUS.READY) {
    throw new ServiceError(
      `markInProgress requiere status=${JOB_STATUS.READY}, actual=${job.status}`,
      'INVALID_TRANSITION',
    );
  }
  return prisma.job.update({
    where: { id: jobId, tenantId },
    data: { status: JOB_STATUS.IN_PROGRESS },
  });
}

export async function closeJob(
  prisma: PrismaClient,
  tenantId: string,
  jobId: string,
): Promise<Job> {
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId } });
  if (!job) throw new ServiceError(`job ${jobId} no existe`, 'JOB_NOT_FOUND');
  if (job.status !== JOB_STATUS.OPEN && job.status !== JOB_STATUS.READY) {
    throw new ServiceError(
      `closeJob requiere status OPEN_INTAKE o READY_FOR_REVIEW, actual=${job.status}`,
      'INVALID_TRANSITION',
    );
  }
  return prisma.job.update({
    where: { id: jobId, tenantId },
    data: { status: JOB_STATUS.CLOSED, closedAt: new Date() },
  });
}

export async function reopenJob(
  prisma: PrismaClient,
  tenantId: string,
  jobId: string,
): Promise<Job> {
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId } });
  if (!job) throw new ServiceError(`job ${jobId} no existe`, 'JOB_NOT_FOUND');
  if (job.status !== JOB_STATUS.CLOSED && job.status !== JOB_STATUS.IN_PROGRESS) {
    throw new ServiceError(
      `reopenJob requiere status CLOSED o IN_PROGRESS, actual=${job.status}`,
      'INVALID_TRANSITION',
    );
  }
  return prisma.job.update({
    where: { id: jobId, tenantId },
    data: { status: JOB_STATUS.OPEN, closedAt: null, readyAt: null },
  });
}

export async function findOpenJobsForContact(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
): Promise<Job[]> {
  return prisma.job.findMany({
    where: {
      tenantId,
      contactId,
      status: { in: [JOB_STATUS.OPEN, JOB_STATUS.READY] },
    },
    orderBy: { openedAt: 'asc' },
  });
}

export async function updateJobIntake(
  prisma: PrismaClient,
  tenantId: string,
  jobId: string,
  intake: IntakeState,
): Promise<Job> {
  return prisma.job.update({
    where: { id: jobId, tenantId },
    data: { intake: JSON.stringify(intake) },
  });
}

export function parseJobIntake(job: Job): IntakeState {
  return JSON.parse(job.intake) as IntakeState;
}
