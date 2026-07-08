import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getPrisma } from '../db';
import { startOfMonthUtc } from '../lib/dates';
import { workerCall } from '../lib/worker-client';
import { approveTenant, rejectTenant } from '../services/tenantApproval';
import { getEmailSender, type EmailSender } from '../lib/email';
import { freeMonthlyRunLimit } from '../env';
import { hardDeleteTenant } from '../services/tenantDeletion';
import { seedTenantSettingsFromTemplate, type Industry } from '../onboarding/templates';

const PlatformLoginZ = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const CreateTenantZ = z.object({
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  industry: z.string().min(1),
  profileDir: z.string().min(1).default('./profiles/tapiceria'),
});

const CreateTenantUserZ = z.object({
  username: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

const UpdateTenantUserZ = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
});

const UpdateTenantZ = z.object({
  name: z.string().min(1).optional(),
  industry: z.string().min(1).optional(),
});

export async function platformRoutes(app: FastifyInstance, opts: { fetcher?: typeof fetch; emailSender?: EmailSender } = {}) {
  const doFetch = opts.fetcher ?? fetch;
  const emailSender = opts.emailSender ?? getEmailSender();
  app.post('/platform/auth/login', async (request, reply) => {
    const parse = PlatformLoginZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'username y password requeridos' });

    const prisma = getPrisma();
    const user = await prisma.platformUser.findUnique({ where: { username: parse.data.username } });
    if (!user) return reply.code(401).send({ error: 'credenciales invalidas' });

    const ok = await bcrypt.compare(parse.data.password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'credenciales invalidas' });

    const token = app.jwt.sign({ userId: user.id, scope: 'platform', role: user.role });
    return { token, user: { id: user.id, username: user.username, role: user.role } };
  });

  app.get('/platform/me', { preHandler: app.authenticatePlatform }, async (request) => ({
    user: request.platformUser,
  }));

  app.get('/platform/tenants', { preHandler: app.authenticatePlatform }, async () => {
    const prisma = getPrisma();
    const [tenants, usage] = await Promise.all([
      prisma.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          subscription: { select: { status: true, currentPeriodEnd: true } },
          _count: { select: { panelUsers: true, contacts: true, jobs: true } },
        },
      }),
      prisma.agentRun.groupBy({ by: ['tenantId'], where: { createdAt: { gte: startOfMonthUtc() } }, _count: { _all: true } }),
    ]);
    const used = new Map(usage.map((u) => [u.tenantId, u._count._all]));
    return {
      defaultMonthlyLimit: freeMonthlyRunLimit(),
      tenants: tenants.map((t) => ({
        id: t.id, slug: t.slug, name: t.name, industry: t.industry, profileDir: t.profileDir,
        status: t.status, createdAt: t.createdAt, approvalStatus: t.approvalStatus, approvedAt: t.approvedAt,
        monthlyRunLimit: t.monthlyRunLimit, monthUsed: used.get(t.id) ?? 0,
        subscription: t.subscription?.status ?? null, currentPeriodEnd: t.subscription?.currentPeriodEnd ?? null,
        _count: t._count,
      })),
    };
  });

  app.post('/platform/tenants', { preHandler: app.authenticatePlatform }, async (request, reply) => {
    const parse = CreateTenantZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'tenant invalido' });

    const prisma = getPrisma();
    let tenant;
    try {
      // Alta directa por el superadmin: el tenant nace 'active' (no pasa por la
      // verificación de email del self-service).
      tenant = await prisma.tenant.create({ data: { ...parse.data, status: 'active' } });
    } catch (err: any) {
      if (err?.code === 'P2002') return reply.code(409).send({ error: 'slug ya existe' });
      throw err;
    }
    // Sembrar TenantSettings desde la plantilla del giro. Sin esto el worker no
    // puede levantar el tenant ("TenantSettings ausente") y acceder a él falla.
    try {
      await seedTenantSettingsFromTemplate(prisma, tenant.id, parse.data.industry as Industry, { businessName: parse.data.name });
    } catch (seedErr) {
      await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
      return reply.code(400).send({ error: `plantilla '${parse.data.industry}' no disponible` });
    }
    return reply.code(201).send({ tenant });
  });

  app.get('/platform/tenants/:tenantId/users', { preHandler: app.authenticatePlatform }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const prisma = getPrisma();
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return reply.code(404).send({ error: 'tenant no encontrado' });

    const users = await prisma.panelUser.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, username: true, email: true, role: true, createdAt: true },
    });
    return { users };
  });

  app.post('/platform/tenants/:tenantId/users', { preHandler: app.authenticatePlatform }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const parse = CreateTenantUserZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'usuario invalido' });

    const prisma = getPrisma();
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return reply.code(404).send({ error: 'tenant no encontrado' });

    const passwordHash = await bcrypt.hash(parse.data.password, 10);
    try {
      const user = await prisma.panelUser.create({
        data: { tenantId, username: parse.data.username, email: parse.data.email, passwordHash, role: 'admin' },
        select: { id: true, username: true, email: true, role: true, createdAt: true },
      });
      return reply.code(201).send({ user });
    } catch (err: any) {
      if (err?.code === 'P2002') return reply.code(409).send({ error: 'usuario ya existe para este tenant' });
      throw err;
    }
  });

  app.patch('/platform/tenants/:tenantId/users/:userId', { preHandler: app.authenticatePlatform }, async (request, reply) => {
    const { tenantId, userId } = request.params as { tenantId: string; userId: string };
    const parse = UpdateTenantUserZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'datos invalidos' });
    const prisma = getPrisma();
    const existing = await prisma.panelUser.findFirst({ where: { id: userId, tenantId } });
    if (!existing) return reply.code(404).send({ error: 'usuario no encontrado' });
    const data: Record<string, unknown> = {};
    if (parse.data.email !== undefined) data.email = parse.data.email;
    if (parse.data.password !== undefined) {
      data.passwordHash = await bcrypt.hash(parse.data.password, 10);
      data.passwordChangedAt = new Date();
    }
    try {
      const user = await prisma.panelUser.update({
        where: { id: userId }, data,
        select: { id: true, username: true, email: true, role: true, createdAt: true },
      });
      return { ok: true, user };
    } catch (err: any) {
      if (err?.code === 'P2002') return reply.code(409).send({ error: 'email ya existe' });
      throw err;
    }
  });

  app.delete('/platform/tenants/:tenantId/users/:userId', { preHandler: app.authenticatePlatform }, async (request, reply) => {
    const { tenantId, userId } = request.params as { tenantId: string; userId: string };
    const prisma = getPrisma();
    const existing = await prisma.panelUser.findFirst({ where: { id: userId, tenantId } });
    if (!existing) return reply.code(404).send({ error: 'usuario no encontrado' });
    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { userId } }),
      prisma.panelUser.delete({ where: { id: userId } }),
    ]);
    return { ok: true };
  });

  async function audit(platformUserId: string, tenantId: string, action: string) {
    await getPrisma().operatorAuditLog.create({ data: { operatorUserId: platformUserId, tenantId, action } });
  }

  app.post('/platform/tenants/:id/approve', { preHandler: app.authenticatePlatform }, async (request: any, reply) => {
    const t = await approveTenant(getPrisma(), { doFetch, emailSender }, request.params.id);
    if (!t) return reply.code(404).send({ error: 'tenant no encontrado' });
    await audit(request.platformUser.userId, request.params.id, 'approve');
    return { ok: true, approvalStatus: 'approved' };
  });

  app.post('/platform/tenants/:id/reject', { preHandler: app.authenticatePlatform }, async (request: any, reply) => {
    const t = await rejectTenant(getPrisma(), { doFetch, emailSender }, request.params.id);
    if (!t) return reply.code(404).send({ error: 'tenant no encontrado' });
    await audit(request.platformUser.userId, request.params.id, 'reject');
    return { ok: true, approvalStatus: 'rejected' };
  });

  app.patch('/platform/tenants/:id/limit', { preHandler: app.authenticatePlatform }, async (request: any, reply) => {
    const raw = request.body?.monthlyRunLimit;
    const monthlyRunLimit = raw === null ? null : Number(raw);
    if (monthlyRunLimit !== null && (!Number.isInteger(monthlyRunLimit) || monthlyRunLimit < 0)) {
      return reply.code(400).send({ error: 'monthlyRunLimit debe ser entero >= 0 o null' });
    }
    const prisma = getPrisma();
    const tenant = await prisma.tenant.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!tenant) return reply.code(404).send({ error: 'tenant no encontrado' });
    await prisma.tenant.update({ where: { id: request.params.id }, data: { monthlyRunLimit } });
    await audit(request.platformUser.userId, request.params.id, 'set_limit');
    return { ok: true, monthlyRunLimit };
  });

  app.post('/platform/tenants/:id/suspend', { preHandler: app.authenticatePlatform }, async (request: any) => {
    await workerCall(doFetch, 'POST', request.params.id, '/internal/tenant/suspend');
    await getPrisma().tenant.update({ where: { id: request.params.id }, data: { status: 'suspended' } });
    await audit(request.platformUser.userId, request.params.id, 'suspend');
    return { ok: true };
  });

  app.post('/platform/tenants/:id/reactivate', { preHandler: app.authenticatePlatform }, async (request: any) => {
    await workerCall(doFetch, 'POST', request.params.id, '/internal/tenant/resume');
    await getPrisma().tenant.update({ where: { id: request.params.id }, data: { status: 'active' } });
    await audit(request.platformUser.userId, request.params.id, 'reactivate');
    return { ok: true };
  });

  app.post('/platform/tenants/:id/bot/reconnect', { preHandler: app.authenticatePlatform }, async (request: any) => {
    await workerCall(doFetch, 'POST', request.params.id, '/internal/wa-reconnect');
    await audit(request.platformUser.userId, request.params.id, 'bot_reconnect');
    return { ok: true };
  });

  app.patch('/platform/tenants/:id', { preHandler: app.authenticatePlatform }, async (request: any, reply) => {
    const parse = UpdateTenantZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'datos invalidos' });
    const prisma = getPrisma();
    const tenant = await prisma.tenant.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!tenant) return reply.code(404).send({ error: 'tenant no encontrado' });
    const updated = await prisma.tenant.update({ where: { id: request.params.id }, data: parse.data });
    return { ok: true, tenant: { id: updated.id, slug: updated.slug, name: updated.name, industry: updated.industry } };
  });

  app.delete('/platform/tenants/:id', { preHandler: app.authenticatePlatform }, async (request: any, reply) => {
    const prisma = getPrisma();
    const tenant = await prisma.tenant.findUnique({ where: { id: request.params.id } });
    if (!tenant) return reply.code(404).send({ error: 'tenant no encontrado' });
    if ((request.body?.confirmSlug ?? '') !== tenant.slug) {
      return reply.code(400).send({ error: 'confirmSlug no coincide con el slug del tenant' });
    }
    await audit(request.platformUser.userId, tenant.id, 'delete'); // antes de borrar; OperatorAuditLog sobrevive
    await workerCall(doFetch, 'POST', tenant.id, '/internal/tenant/suspend');
    const counts = await hardDeleteTenant(prisma, tenant.id);
    return { ok: true, counts };
  });
}
