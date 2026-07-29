import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db';
import { buildOverview } from '../services/overview';

export async function overviewRoutes(app: FastifyInstance) {
  /** Resumen de la pantalla principal: qué necesita atención y cómo va la venta. */
  app.get('/overview', { preHandler: app.authenticate }, async (request) => {
    const prisma = getPrisma();
    return buildOverview(prisma, request.tenantId, new Date());
  });
}
