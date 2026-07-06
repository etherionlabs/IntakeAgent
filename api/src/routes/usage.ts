import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db';
import { accessMode, freeMonthlyRunLimit } from '../env';
import { startOfMonthUtc } from '../lib/dates';

export async function usageRoutes(app: FastifyInstance) {
  app.get('/usage', { preHandler: app.authenticate }, async (request) => {
    const prisma = getPrisma();
    const where = { tenantId: request.tenantId };
    const mode = accessMode();
    const [agg, recent, tenant, monthUsed] = await Promise.all([
      prisma.agentRun.aggregate({
        where,
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
        _count: true,
      }),
      prisma.agentRun.findMany({ where, orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.tenant.findUnique({
        where: { id: request.tenantId },
        select: { monthlyRunLimit: true, approvalStatus: true },
      }),
      prisma.agentRun.count({ where: { ...where, createdAt: { gte: startOfMonthUtc() } } }),
    ]);
    // Plan gratuito (v1): límite mensual de respuestas. En modo subscription no aplica.
    const limit = mode === 'approval' ? (tenant?.monthlyRunLimit ?? freeMonthlyRunLimit()) : null;
    return {
      mode,
      approvalStatus: tenant?.approvalStatus ?? 'pending',
      plan: mode === 'approval'
        ? { name: 'Gratuito', monthlyLimit: limit, monthUsed, monthRemaining: limit === null ? null : Math.max(0, limit - monthUsed) }
        : null,
      totals: {
        runs: agg._count,
        costUsd: agg._sum.costUsd ?? 0,
        inputTokens: agg._sum.inputTokens ?? 0,
        outputTokens: agg._sum.outputTokens ?? 0,
      },
      recent,
    };
  });
}
