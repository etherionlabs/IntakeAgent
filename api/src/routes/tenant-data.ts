import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db';
import { resolveManagerUrl } from '../lib/manager-url';
import { exportTenantData } from '../services/dataExport';
import { deleteContactData, deleteTenantData } from '../services/dataDeletion';

export interface TenantDataOptions { fetcher?: typeof fetch; }

/**
 * Derechos de datos por tenant (Fase 6): export (acceso/portabilidad) y borrado
 * (olvido), siempre filtrados por el `tenantId` del JWT. Solo rol admin.
 */
export async function tenantDataRoutes(app: FastifyInstance, opts: TenantDataOptions = {}) {
  const prisma = getPrisma();
  const doFetch = opts.fetcher ?? fetch;

  const adminGuard = {
    preHandler: [app.authenticate, async (request: any, reply: any) => {
      if (request.authUser?.role !== 'admin') return reply.code(403).send({ error: 'admin_required' });
    }],
  };

  // Export: bundle JSON por entidad, solo del tenant del JWT.
  app.post('/tenant/data-export', adminGuard, async (request: any) => {
    return exportTenantData(prisma, request.tenantId);
  });

  // Borrado de un cliente final (idempotente, aislado por tenant).
  app.delete('/tenant/contacts/:contactId/data', adminGuard, async (request: any) => {
    await deleteContactData(prisma, request.tenantId, request.params.contactId);
    return { ok: true };
  });

  // Borrado total del tenant: requiere confirmar con el nombre del negocio.
  app.post('/tenant/data-deletion', adminGuard, async (request: any, reply) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: request.tenantId } });
    const confirm = (request.body as any)?.confirm;
    if (!tenant || confirm !== tenant.name) {
      return reply.code(400).send({ error: 'confirmación incorrecta (escribe el nombre del negocio)' });
    }
    const removeTenant = async (id: string) => {
      const base = resolveManagerUrl(id); const token = process.env.INTERNAL_API_TOKEN;
      if (!base || !token) return;
      await doFetch(`${base}/internal/tenant/remove`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId: id }),
      }).catch(() => {});
    };
    await deleteTenantData(prisma, request.tenantId, { removeTenant });
    return { ok: true };
  });
}
