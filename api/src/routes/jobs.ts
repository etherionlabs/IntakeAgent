import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../db';
import { parseJobIntake, updateJobIntake, markReadyForReview, closeJob, archiveJob, restoreJob, hardDeleteJob } from '../../../src/services/job';
import { bulkUpdate, isIntakeComplete } from '../../../src/services/intake';
import { getTenantProfile } from '../lib/tenant-profile';

const PatchIntakeZ = z.object({
  path: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  declined: z.boolean().optional(),
  declined_reason: z.string().optional(),
});

const ActionZ = z.object({ action: z.enum(['mark_ready', 'close']), summary: z.string().optional() });

export async function jobsRoutes(app: FastifyInstance) {
  app.get('/jobs', { preHandler: app.authenticate }, async (request) => {
    const prisma = getPrisma();
    const q = request.query as any;
    const status = q?.status as string | undefined;
    const includeArchived = q?.includeArchived === 'true';
    const jobs = await prisma.job.findMany({
      where: {
        tenantId: request.tenantId,
        ...(status ? { status } : {}),
        ...(includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: { openedAt: 'desc' },
      include: { contact: true },
    });
    return { jobs };
  });

  app.get('/jobs/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const job = await prisma.job.findFirst({ where: { id, tenantId: request.tenantId }, include: { contact: true } });
    if (!job) return reply.code(404).send({ error: 'job no encontrado' });
    const messages = await prisma.message.findMany({
      where: { jobId: job.id, tenantId: request.tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return { job, intake: parseJobIntake(job), messages };
  });

  app.patch('/jobs/:id/intake', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const parse = PatchIntakeZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: parse.error.message });
    const job = await prisma.job.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!job) return reply.code(404).send({ error: 'job no encontrado' });
    const profile = await getTenantProfile(request.tenantId);
    const current = parseJobIntake(job);
    const result = bulkUpdate(profile.intakeSchema, current, [parse.data], { now: new Date().toISOString(), source_message_id: null });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    await updateJobIntake(prisma, request.tenantId, job.id, result.intake);
    return { ok: true, intake: result.intake };
  });

  app.post('/jobs/:id/actions', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const parse = ActionZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: parse.error.message });
    const job = await prisma.job.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!job) return reply.code(404).send({ error: 'job no encontrado' });
    try {
      if (parse.data.action === 'close') {
        const updated = await closeJob(prisma, request.tenantId, job.id);
        return { ok: true, status: updated.status };
      }
      const summary = parse.data.summary ?? job.summary ?? '';
      if (summary.trim().length < 20) return reply.code(400).send({ error: 'mark_ready requiere summary de al menos 20 caracteres' });
      // Guard de producción: no permitir marcar listo un intake incompleto
      // (mismo invariante que aplica la tool del agente en buildMarkReadyTool).
      const profile = await getTenantProfile(request.tenantId);
      if (!isIntakeComplete(profile.intakeSchema, parseJobIntake(job))) {
        return reply.code(400).send({ error: 'el intake tiene campos requeridos sin satisfacer (valor o declined)' });
      }
      const updated = await markReadyForReview(prisma, request.tenantId, job.id, summary);
      return { ok: true, status: updated.status };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/jobs/:id/archive', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const job = await prisma.job.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!job) return reply.code(404).send({ error: 'job no encontrado' });
    const updated = await archiveJob(prisma, request.tenantId, id);
    return { ok: true, job: updated };
  });

  app.post('/jobs/:id/restore', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const job = await prisma.job.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!job) return reply.code(404).send({ error: 'job no encontrado' });
    const updated = await restoreJob(prisma, request.tenantId, id);
    return { ok: true, job: updated };
  });

  app.delete('/jobs/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const job = await prisma.job.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!job) return reply.code(404).send({ error: 'job no encontrado' });
    await hardDeleteJob(prisma, request.tenantId, id);
    return { ok: true };
  });
}
