import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../db';
import { setBotActive } from '../../../src/services/contact';

const ToggleZ = z.object({ botPaused: z.boolean() });

export async function contactsRoutes(app: FastifyInstance) {
  app.get('/contacts', { preHandler: app.authenticate }, async (request) => {
    const prisma = getPrisma();
    const contacts = await prisma.contact.findMany({ where: { tenantId: request.tenantId }, orderBy: { updatedAt: 'desc' } });
    return { contacts };
  });

  app.patch('/contacts/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const parse = ToggleZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: parse.error.message });
    const existing = await prisma.contact.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!existing) return reply.code(404).send({ error: 'contacto no encontrado' });
    const updated = await setBotActive(prisma, request.tenantId, id, !parse.data.botPaused);
    return { ok: true, contact: updated };
  });
}
