import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db';
import { parseJobIntake } from '../../../src/services/job';

export async function jobsRoutes(app: FastifyInstance) {
  app.get('/jobs', { preHandler: app.authenticate }, async (request) => {
    const prisma = getPrisma();
    const status = (request.query as any)?.status as string | undefined;
    const jobs = await prisma.job.findMany({
      where: { tenantId: request.tenantId, ...(status ? { status } : {}) },
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
}
