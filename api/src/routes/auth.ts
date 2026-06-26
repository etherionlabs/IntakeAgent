import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { getPrisma } from '../db';
import {
  SESSION_COOKIE,
  CSRF_COOKIE,
  JWT_EXPIRES_IN,
  sessionCookieOptions,
  csrfCookieOptions,
  clearCookieOptions,
} from '../lib/auth-cookies';
import { checkPassword } from '../lib/password-policy';
import { getEmailSender, type EmailSender } from '../lib/email';
import { uniqueSlug } from '../lib/slug';
import { randomToken, in24h } from '../lib/tokens';
import { verificationEmail, welcomeEmail } from '../email/templates';
import { trialRequiresCard } from '../env';
import { LEGAL_DOCUMENTS, LEGAL_VERSIONS } from '../legal/versions';

const LoginZ = z.object({ email: z.string().email(), password: z.string().min(1) });
const ForgotZ = z.object({ email: z.string().email() });
const ResetZ = z.object({ token: z.string().min(1), newPassword: z.string().min(1) });
const ChangeZ = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) });
const SignupZ = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  businessName: z.string().min(1).max(120),
  industry: z.enum(['tapiceria', 'paqueteria', 'generico']),
  // Aceptación legal obligatoria; el riesgo WhatsApp es una casilla SEPARADA.
  acceptedTerms: z.literal(true),
  acceptedWhatsappRisk: z.literal(true),
});

const RESET_TTL_MS = 45 * 60 * 1000; // 45 min
const SPA_URL = process.env.CORS_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:5173';

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function publicUser(u: { id: string; username: string; email: string | null; role: string; tenantId: string }) {
  return { id: u.id, username: u.username, email: u.email, role: u.role, tenantId: u.tenantId };
}

export async function authRoutes(
  app: FastifyInstance,
  opts: { emailSender?: EmailSender; provision?: (tenantId: string) => Promise<void> } = {},
) {
  const emailSender = opts.emailSender ?? getEmailSender();

  // Signup self-service: crea Tenant + PanelUser admin + EmailVerification de forma
  // atómica, y envía el correo de verificación. Anti-abuso por rate-limit.
  app.post('/auth/signup', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const parse = SignupZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'datos de registro inválidos' });
    const { email, password, businessName, industry } = parse.data;
    const policy = checkPassword(password);
    if (!policy.ok) return reply.code(400).send({ error: policy.error });

    const prisma = getPrisma();
    const slug = await uniqueSlug(prisma, businessName);
    const passwordHash = await bcrypt.hash(password, 10);
    const token = randomToken();
    const ipAddress = request.ip ?? null;
    const userAgent = (request.headers['user-agent'] as string | undefined) ?? null;
    try {
      const tenant = await prisma.$transaction(async (tx) => {
        const t = await tx.tenant.create({
          data: { slug, name: businessName, industry, profileDir: '', status: 'pending_verification' },
        });
        const user = await tx.panelUser.create({
          data: { tenantId: t.id, username: email.split('@')[0], email, passwordHash, role: 'admin' },
        });
        await tx.emailVerification.create({
          data: { tenantId: t.id, email, token, expiresAt: in24h() },
        });
        // Rastro legal: una fila por documento, dentro de la MISMA transacción.
        await tx.legalAcceptance.createMany({
          data: LEGAL_DOCUMENTS.map((document) => ({
            tenantId: t.id, userId: user.id, document, version: LEGAL_VERSIONS[document], ipAddress, userAgent,
          })),
        });
        return t;
      });
      const { subject, body } = verificationEmail(token);
      await emailSender.send(email, subject, body);
      return reply.code(201).send({ tenantId: tenant.id, status: 'pending_verification' });
    } catch (e: any) {
      if (e?.code === 'P2002') return reply.code(409).send({ error: 'email ya registrado' });
      throw e;
    }
  });

  // Verificación de email (token de un solo uso). Obligatoria antes de operar.
  app.get('/auth/verify-email', async (request, reply) => {
    const token = (request.query as any)?.token as string | undefined;
    if (!token) return reply.code(400).send({ error: 'token requerido' });
    const prisma = getPrisma();
    const rec = await prisma.emailVerification.findUnique({ where: { token } });
    if (!rec || rec.verifiedAt || rec.expiresAt.getTime() < Date.now()) {
      return reply.code(400).send({ error: 'token inválido o expirado' });
    }
    const [, tenant] = await prisma.$transaction([
      prisma.emailVerification.update({ where: { id: rec.id }, data: { verifiedAt: new Date() } }),
      prisma.tenant.update({ where: { id: rec.tenantId }, data: { status: 'verified' } }),
    ]);
    const wel = welcomeEmail(tenant.name);
    await emailSender.send(rec.email, wel.subject, wel.body).catch(() => {});
    // Trial sin tarjeta: la verificación dispara el provisioning. Con tarjeta, lo
    // dispara el webhook de Checkout (Fase 3), no aquí.
    if (!trialRequiresCard() && opts.provision) {
      await opts.provision(rec.tenantId).catch(() => {});
    }
    return { status: 'verified' };
  });

  // Reenvío de verificación: 200 genérico (no revela si el email existe).
  app.post('/auth/resend-verification', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const parse = ForgotZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'email requerido' });
    const prisma = getPrisma();
    const user = await prisma.panelUser.findUnique({ where: { email: parse.data.email } });
    if (user) {
      const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId } });
      if (tenant && tenant.status === 'pending_verification') {
        await prisma.emailVerification.deleteMany({ where: { tenantId: tenant.id, verifiedAt: null } });
        const token = randomToken();
        await prisma.emailVerification.create({ data: { tenantId: tenant.id, email: parse.data.email, token, expiresAt: in24h() } });
        const { subject, body } = verificationEmail(token);
        await emailSender.send(parse.data.email, subject, body);
      }
    }
    return { ok: true };
  });

  // Emite cookies de sesión (HttpOnly) + CSRF (legible) y NO devuelve el token.
  function issueSession(reply: any, claims: { userId: string; tenantId: string; role: string }) {
    const token = app.jwt.sign(claims, { expiresIn: JWT_EXPIRES_IN });
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions());
    reply.setCookie(CSRF_COOKIE, crypto.randomBytes(24).toString('hex'), csrfCookieOptions());
  }

  app.post('/auth/login', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const parse = LoginZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'email y password requeridos' });
    const { email, password } = parse.data;
    const prisma = getPrisma();
    // Identidad por email global único: búsqueda determinista (un email → un user).
    const user = await prisma.panelUser.findUnique({ where: { email } });
    if (!user) return reply.code(401).send({ error: 'credenciales inválidas' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'credenciales inválidas' });
    issueSession(reply, { userId: user.id, tenantId: user.tenantId, role: user.role });
    return { user: publicUser(user) };
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (request: any) => {
    const prisma = getPrisma();
    const user = await prisma.panelUser.findUnique({ where: { id: request.authUser.userId } });
    if (!user) return { user: null };
    return { user: publicUser(user) };
  });

  app.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, clearCookieOptions());
    reply.clearCookie(CSRF_COOKIE, clearCookieOptions());
    return { ok: true };
  });

  // Siempre 200 (anti-enumeración de emails).
  app.post('/auth/forgot-password', async (request, reply) => {
    const parse = ForgotZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'email requerido' });
    const { email } = parse.data;
    const prisma = getPrisma();
    const user = await prisma.panelUser.findUnique({ where: { email } });
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      });
      const link = `${SPA_URL}/reset?token=${token}`;
      await emailSender.send(email, 'Restablece tu contraseña', `Abre este enlace para continuar: ${link}`);
    }
    return { ok: true };
  });

  app.post('/auth/reset-password', async (request, reply) => {
    const parse = ResetZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'token y newPassword requeridos' });
    const { token, newPassword } = parse.data;
    const policy = checkPassword(newPassword);
    if (!policy.ok) return reply.code(400).send({ error: policy.error });
    const prisma = getPrisma();
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      return reply.code(400).send({ error: 'token inválido o expirado' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const now = new Date();
    await prisma.$transaction([
      prisma.panelUser.update({ where: { id: record.userId }, data: { passwordHash, passwordChangedAt: now } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: now } }),
    ]);
    return { ok: true };
  });

  app.post('/auth/change-password', { preHandler: app.authenticate }, async (request: any, reply) => {
    const parse = ChangeZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'currentPassword y newPassword requeridos' });
    const { currentPassword, newPassword } = parse.data;
    const policy = checkPassword(newPassword);
    if (!policy.ok) return reply.code(400).send({ error: policy.error });
    const prisma = getPrisma();
    const user = await prisma.panelUser.findUnique({ where: { id: request.authUser.userId } });
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return reply.code(403).send({ error: 'contraseña actual incorrecta' });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.panelUser.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date() } });
    return { ok: true };
  });
}
