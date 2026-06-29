import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db';
import { resolveManagerUrl } from '../lib/manager-url';

export interface AdminRouteOptions {
  fetcher?: typeof fetch;
}

/**
 * Panel de operador de plataforma. Todas las rutas exigen `operator` (preHandler
 * authenticate + requireOperator). Consume Subscription (Fase 3) y el estado del
 * bot vía el worker (Fase 2). Las acciones quedan auditadas en OperatorAuditLog.
 */
export async function adminRoutes(app: FastifyInstance, opts: AdminRouteOptions = {}) {
  const prisma = getPrisma();
  const doFetch = opts.fetcher ?? fetch;
  const guard = { preHandler: [app.authenticate, app.requireOperator] };

  async function workerCall(method: 'GET' | 'POST', tenantId: string, path: string) {
    const base = resolveManagerUrl(tenantId);
    const token = process.env.INTERNAL_API_TOKEN;
    if (!base || !token) return null;
    try {
      const url = method === 'GET' ? `${base}${path}?tenantId=${encodeURIComponent(tenantId)}` : `${base}${path}`;
      const res = await doFetch(url, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify({ tenantId }) } : {}),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  async function audit(operatorUserId: string, tenantId: string, action: string) {
    await prisma.operatorAuditLog.create({ data: { operatorUserId, tenantId, action } });
  }

  app.get('/admin/tenants', guard, async () => {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: { subscription: { select: { status: true, currentPeriodEnd: true } } },
    });
    return {
      tenants: tenants.map((t) => ({
        id: t.id, slug: t.slug, name: t.name, industry: t.industry,
        status: t.status, createdAt: t.createdAt,
        subscription: t.subscription?.status ?? null,
        currentPeriodEnd: t.subscription?.currentPeriodEnd ?? null,
      })),
    };
  });

  app.get('/admin/tenants/:id', guard, async (request: any, reply) => {
    const id = request.params.id as string;
    const tenant = await prisma.tenant.findUnique({ where: { id }, include: { subscription: true } });
    if (!tenant) return reply.code(404).send({ error: 'tenant no encontrado' });
    const bot = await workerCall('GET', id, '/internal/wa-status'); // null si worker no alcanzable
    return {
      id: tenant.id, slug: tenant.slug, name: tenant.name, industry: tenant.industry,
      status: tenant.status, createdAt: tenant.createdAt,
      subscription: tenant.subscription ? { status: tenant.subscription.status, currentPeriodEnd: tenant.subscription.currentPeriodEnd } : null,
      bot: bot ?? { connected: false, status: 'unknown' },
    };
  });

  app.post('/admin/tenants/:id/suspend', guard, async (request: any) => {
    const id = request.params.id as string;
    await workerCall('POST', id, '/internal/tenant/suspend');
    await prisma.tenant.update({ where: { id }, data: { status: 'suspended' } });
    await audit(request.authUser.userId, id, 'suspend');
    return { ok: true };
  });

  app.post('/admin/tenants/:id/reactivate', guard, async (request: any) => {
    const id = request.params.id as string;
    await workerCall('POST', id, '/internal/tenant/resume');
    await prisma.tenant.update({ where: { id }, data: { status: 'active' } });
    await audit(request.authUser.userId, id, 'reactivate');
    return { ok: true };
  });

  app.post('/admin/tenants/:id/bot/reconnect', guard, async (request: any) => {
    const id = request.params.id as string;
    await workerCall('POST', id, '/internal/wa-reconnect');
    await audit(request.authUser.userId, id, 'bot_reconnect');
    return { ok: true };
  });
}
