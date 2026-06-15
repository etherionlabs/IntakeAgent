import type { FastifyInstance } from 'fastify';
import { getTenantProfile } from '../lib/tenant-profile';

export async function profileRoutes(app: FastifyInstance) {
  app.get('/profile', { preHandler: app.authenticate }, async (request) => {
    const profile = await getTenantProfile(request.tenantId);
    return { intakeSchema: profile.intakeSchema };
  });
}
