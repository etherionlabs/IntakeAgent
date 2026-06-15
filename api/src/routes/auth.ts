import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getPrisma } from '../db';

const LoginZ = z.object({ username: z.string().min(1), password: z.string().min(1) });

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (request, reply) => {
    const parse = LoginZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'username y password requeridos' });
    const { username, password } = parse.data;
    const prisma = getPrisma();
    // MVP: username globalmente único (deuda: incluir tenantSlug). findFirst evita ambigüedad determinista.
    const user = await prisma.panelUser.findFirst({ where: { username } });
    if (!user) return reply.code(401).send({ error: 'credenciales inválidas' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'credenciales inválidas' });
    const token = app.jwt.sign({ userId: user.id, tenantId: user.tenantId, role: user.role });
    return { token, user: { id: user.id, username: user.username, role: user.role, tenantId: user.tenantId } };
  });
}
