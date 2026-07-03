import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db';
import { resolveManagerUrl } from '../lib/manager-url';
import { freeMonthlyRunLimit } from '../env';
import { getEmailSender, type EmailSender } from '../lib/email';
import { accountApprovedEmail, accountRejectedEmail } from '../email/templates';

export interface AdminRouteOptions {
  fetcher?: typeof fetch;
  emailSender?: EmailSender;
}

/** Inicio del mes calendario en curso (UTC) para el conteo del plan gratuito. */
export function startOfMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Panel de operador de plataforma. Todas las rutas exigen `operator` (preHandler
 * authenticate + requireOperator). Consume Subscription (Fase 3) y el estado del
 * bot vía el worker (Fase 2). Las acciones quedan auditadas en OperatorAuditLog.
 */
export async function adminRoutes(app: FastifyInstance, opts: AdminRouteOptions = {}) {
  const prisma = getPrisma();
  const doFetch = opts.fetcher ?? fetch;
  const emailSender = opts.emailSender ?? getEmailSender();
  const guard = { preHandler: [app.authenticate, app.requireOperator] };

  /** Email del admin dueño del tenant (para avisos de aprobación/rechazo). */
  async function ownerEmail(tenantId: string): Promise<string | null> {
    const u = await prisma.panelUser.findFirst({
      where: { tenantId, role: 'admin' },
      orderBy: { createdAt: 'asc' },
      select: { email: true },
    });
    return u?.email ?? null;
  }

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
    const [tenants, usage] = await Promise.all([
      prisma.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        include: { subscription: { select: { status: true, currentPeriodEnd: true } } },
      }),
      prisma.agentRun.groupBy({
        by: ['tenantId'],
        where: { createdAt: { gte: startOfMonthUtc() } },
        _count: { _all: true },
      }),
    ]);
    const usedByTenant = new Map(usage.map((u) => [u.tenantId, u._count._all]));
    return {
      defaultMonthlyLimit: freeMonthlyRunLimit(),
      tenants: tenants.map((t) => ({
        id: t.id, slug: t.slug, name: t.name, industry: t.industry,
        status: t.status, createdAt: t.createdAt,
        approvalStatus: t.approvalStatus, approvedAt: t.approvedAt,
        monthlyRunLimit: t.monthlyRunLimit,
        monthUsed: usedByTenant.get(t.id) ?? 0,
        subscription: t.subscription?.status ?? null,
        currentPeriodEnd: t.subscription?.currentPeriodEnd ?? null,
      })),
    };
  });

  // Aprobación manual de cuentas (v1 free): la cuenta no opera hasta este paso.
  // Activa el tenant y, si ya está aprovisionado, lo levanta en caliente en el worker.
  app.post('/admin/tenants/:id/approve', guard, async (request: any, reply) => {
    const id = request.params.id as string;
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.code(404).send({ error: 'tenant no encontrado' });
    await prisma.tenant.update({
      where: { id },
      data: { approvalStatus: 'approved', approvedAt: new Date(), active: true },
    });
    if (tenant.status === 'provisioning' || tenant.status === 'active') {
      await workerCall('POST', id, '/internal/tenant/add'); // idempotente; null si worker no alcanzable
    }
    await audit(request.authUser.userId, id, 'approve');
    const email = await ownerEmail(id);
    if (email) {
      const { subject, body } = accountApprovedEmail(tenant.name);
      await emailSender.send(email, subject, body).catch(() => {});
    }
    return { ok: true, approvalStatus: 'approved' };
  });

  app.post('/admin/tenants/:id/reject', guard, async (request: any, reply) => {
    const id = request.params.id as string;
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return reply.code(404).send({ error: 'tenant no encontrado' });
    await prisma.tenant.update({
      where: { id },
      data: { approvalStatus: 'rejected', active: false },
    });
    await workerCall('POST', id, '/internal/tenant/suspend'); // por si estaba conectado
    await audit(request.authUser.userId, id, 'reject');
    const email = await ownerEmail(id);
    if (email) {
      const { subject, body } = accountRejectedEmail(tenant.name);
      await emailSender.send(email, subject, body).catch(() => {});
    }
    return { ok: true, approvalStatus: 'rejected' };
  });

  // Límite mensual del plan gratuito por tenant. null → vuelve al default global.
  app.patch('/admin/tenants/:id/limit', guard, async (request: any, reply) => {
    const id = request.params.id as string;
    const raw = (request.body as any)?.monthlyRunLimit;
    const monthlyRunLimit = raw === null ? null : Number(raw);
    if (monthlyRunLimit !== null && (!Number.isInteger(monthlyRunLimit) || monthlyRunLimit < 0)) {
      return reply.code(400).send({ error: 'monthlyRunLimit debe ser un entero >= 0 o null' });
    }
    const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!tenant) return reply.code(404).send({ error: 'tenant no encontrado' });
    await prisma.tenant.update({ where: { id }, data: { monthlyRunLimit } });
    await audit(request.authUser.userId, id, 'set_limit');
    return { ok: true, monthlyRunLimit };
  });

  app.get('/admin/tenants/:id', guard, async (request: any, reply) => {
    const id = request.params.id as string;
    const tenant = await prisma.tenant.findUnique({ where: { id }, include: { subscription: true } });
    if (!tenant) return reply.code(404).send({ error: 'tenant no encontrado' });
    const bot = await workerCall('GET', id, '/internal/wa-status'); // null si worker no alcanzable
    const monthUsed = await prisma.agentRun.count({
      where: { tenantId: id, createdAt: { gte: startOfMonthUtc() } },
    });
    return {
      id: tenant.id, slug: tenant.slug, name: tenant.name, industry: tenant.industry,
      status: tenant.status, createdAt: tenant.createdAt,
      approvalStatus: tenant.approvalStatus, approvedAt: tenant.approvedAt,
      monthlyRunLimit: tenant.monthlyRunLimit, monthUsed,
      defaultMonthlyLimit: freeMonthlyRunLimit(),
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
