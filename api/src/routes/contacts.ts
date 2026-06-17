import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../db';
import { setBotActive, updateContact, archiveContact, restoreContact, hardDeleteContact } from '../../../src/services/contact';

const PatchZ = z.object({
  botPaused: z.boolean().optional(),
  displayName: z.string().min(1).optional(),
  unflag: z.boolean().optional(),
}).refine((d) => d.botPaused !== undefined || d.displayName !== undefined || d.unflag !== undefined, {
  message: 'se requiere al menos un campo: botPaused, displayName o unflag',
});

export async function contactsRoutes(app: FastifyInstance) {
  app.get('/contacts', { preHandler: app.authenticate }, async (request) => {
    const prisma = getPrisma();
    const includeArchived = (request.query as any)?.includeArchived === 'true';
    const contacts = await prisma.contact.findMany({
      where: { tenantId: request.tenantId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: { updatedAt: 'desc' },
    });
    return { contacts };
  });

  app.patch('/contacts/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const parse = PatchZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: parse.error.message });
    const existing = await prisma.contact.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!existing) return reply.code(404).send({ error: 'contacto no encontrado' });
    if (parse.data.botPaused !== undefined) {
      await setBotActive(prisma, request.tenantId, id, !parse.data.botPaused);
    }
    if (parse.data.displayName !== undefined || parse.data.unflag !== undefined) {
      await updateContact(prisma, request.tenantId, id, { displayName: parse.data.displayName, unflag: parse.data.unflag });
    }
    const updated = await prisma.contact.findFirst({ where: { id, tenantId: request.tenantId } });
    return { ok: true, contact: updated };
  });

  app.post('/contacts/:id/archive', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const existing = await prisma.contact.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!existing) return reply.code(404).send({ error: 'contacto no encontrado' });
    const contact = await archiveContact(prisma, request.tenantId, id);
    return { ok: true, contact };
  });

  app.post('/contacts/:id/restore', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const existing = await prisma.contact.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!existing) return reply.code(404).send({ error: 'contacto no encontrado' });
    const contact = await restoreContact(prisma, request.tenantId, id);
    return { ok: true, contact };
  });

  app.delete('/contacts/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const existing = await prisma.contact.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!existing) return reply.code(404).send({ error: 'contacto no encontrado' });
    await hardDeleteContact(prisma, request.tenantId, id);
    return { ok: true };
  });
}
