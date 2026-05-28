import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { setBotActive } from '../../services/contact';

export function registerContactRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
): void {
  app.get('/panel/contacts', async (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    const contacts = await prisma.contact.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { jobs: true, messages: true } },
        jobs: {
          where: { status: { in: ['OPEN_INTAKE', 'READY_FOR_REVIEW', 'IN_PROGRESS'] } },
          select: { status: true, openedAt: true },
          orderBy: { openedAt: 'desc' },
          take: 1,
        },
      },
      take: 200,
    });
    return reply.view('contacts.hbs', {
      title: 'Contactos',
      username: (req as any).panelUser,
      contacts,
    });
  });

  app.post<{ Params: { id: string } }>(
    '/panel/api/contacts/:id/bot-toggle',
    async (req, reply) => {
      if (!(req as any).panelUser) {
        reply.code(401);
        return { error: 'unauthorized' };
      }
      const c = await prisma.contact.findUnique({ where: { id: req.params.id } });
      if (!c) {
        reply.code(404);
        return { error: 'not_found' };
      }
      const updated = await setBotActive(prisma, c.id, !c.botActive);
      reply.header(
        'HX-Trigger',
        JSON.stringify({ panelToast: `Bot ${updated.botActive ? 'reactivado' : 'pausado'}` }),
      );
      reply.header('HX-Refresh', 'true');
      return '';
    },
  );
}
