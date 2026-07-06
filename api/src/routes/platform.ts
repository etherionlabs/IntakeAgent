import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getPrisma } from '../db';

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

export async function platformRoutes(app: FastifyInstance) {
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
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        name: true,
        industry: true,
        profileDir: true,
        createdAt: true,
        _count: { select: { panelUsers: true, contacts: true, jobs: true } },
      },
    });
    return { tenants };
  });

  app.post('/platform/tenants', { preHandler: app.authenticatePlatform }, async (request, reply) => {
    const parse = CreateTenantZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'tenant invalido' });

    const prisma = getPrisma();
    try {
      const tenant = await prisma.tenant.create({ data: parse.data });
      return reply.code(201).send({ tenant });
    } catch (err: any) {
      if (err?.code === 'P2002') return reply.code(409).send({ error: 'slug ya existe' });
      throw err;
    }
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
}
