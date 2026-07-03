import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../db';
import { accessMode, type AccessMode } from '../env';

type Onboarding = {
  businessDone?: boolean; welcomeDone?: boolean; schemaDone?: boolean;
  whatsappLinked?: boolean; testDone?: boolean; completed?: boolean;
};

/**
 * Deriva el primer paso pendiente del estado en servidor (reanudabilidad).
 * Modo 'approval' (v1 free): no hay paso de suscripción; el cliente configura su
 * negocio de inmediato, pero antes de vincular WhatsApp la cuenta debe estar
 * aprobada por el operador → paso 'awaiting_approval'.
 * Modo 'subscription' (dormante): flujo Fase 4 original con paso 'subscription'.
 */
export function deriveStep(
  tenantStatus: string,
  subStatus: string | null,
  ob: Onboarding | null,
  opts: { mode?: AccessMode; approvalStatus?: string } = {},
): string {
  const mode = opts.mode ?? 'subscription';
  if (tenantStatus === 'pending_verification') return 'verify_email';
  if (tenantStatus === 'verified') {
    if (mode === 'approval') return 'provisioning';
    const subOk = subStatus === 'trialing' || subStatus === 'active';
    return subOk ? 'provisioning' : 'subscription';
  }
  if (tenantStatus === 'provisioning') return 'provisioning';
  // active
  if (!ob?.businessDone) return 'business';
  if (!ob?.welcomeDone) return 'welcome';
  if (!ob?.schemaDone) return 'schema';
  // La compuerta de aprobación va DESPUÉS de la config (el cliente deja todo
  // listo) y ANTES de vincular el bot (nada opera sin tu visto bueno).
  if (mode === 'approval' && opts.approvalStatus !== 'approved') return 'awaiting_approval';
  if (!ob?.whatsappLinked) return 'whatsapp';
  if (!ob?.testDone) return 'test';
  if (!ob?.completed) return 'checklist';
  return 'done';
}

const BusinessZ = z.object({ businessName: z.string().min(1).max(120).optional(), ownerPhoneE164: z.string().min(5).optional() });
const WelcomeZ = z.object({ welcome: z.string().min(1) });
// intakeSchema opcional: omitirlo confirma la plantilla precargada sin cambiarla.
const SchemaZ = z.object({ intakeSchema: z.unknown().optional() });

export async function onboardingRoutes(app: FastifyInstance) {
  const prisma = getPrisma();

  async function setFlag(tenantId: string, patch: Onboarding) {
    const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { onboarding: true } });
    const ob = { ...(t?.onboarding as Onboarding | null ?? {}), ...patch };
    await prisma.tenant.update({ where: { id: tenantId }, data: { onboarding: ob } });
    return ob;
  }

  app.get('/onboarding/state', { preHandler: app.authenticate }, async (request: any) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: request.tenantId },
      include: { subscription: true },
    });
    const ob = (tenant?.onboarding as Onboarding | null) ?? null;
    const tenantStatus = tenant?.status ?? 'pending_verification';
    const subStatus = tenant?.subscription?.status ?? null;
    const mode = accessMode();
    const approvalStatus = tenant?.approvalStatus ?? 'pending';
    return {
      step: deriveStep(tenantStatus, subStatus, ob, { mode, approvalStatus }),
      tenantStatus, subStatus, mode, approvalStatus, flags: ob ?? {},
    };
  });

  app.patch('/onboarding/business', { preHandler: app.authenticate }, async (request: any, reply) => {
    const parse = BusinessZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'datos inválidos' });
    await prisma.tenantSettings.update({ where: { tenantId: request.tenantId }, data: parse.data });
    const flags = await setFlag(request.tenantId, { businessDone: true });
    return { ok: true, flags };
  });

  app.patch('/onboarding/welcome', { preHandler: app.authenticate }, async (request: any, reply) => {
    const parse = WelcomeZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'welcome requerido' });
    await prisma.tenantSettings.update({ where: { tenantId: request.tenantId }, data: { welcomeTemplate: parse.data.welcome } });
    const flags = await setFlag(request.tenantId, { welcomeDone: true });
    return { ok: true, flags };
  });

  app.patch('/onboarding/schema', { preHandler: app.authenticate }, async (request: any, reply) => {
    const parse = SchemaZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'intakeSchema requerido' });
    await prisma.tenantSettings.update({ where: { tenantId: request.tenantId }, data: { intakeSchema: parse.data.intakeSchema as object } });
    const flags = await setFlag(request.tenantId, { schemaDone: true });
    return { ok: true, flags };
  });

  // Marca hitos del wizard (whatsapp vinculado / prueba hecha).
  app.post('/onboarding/flag', { preHandler: app.authenticate }, async (request: any, reply) => {
    const body = request.body as Onboarding;
    const allowed: Onboarding = {};
    if (typeof body?.whatsappLinked === 'boolean') allowed.whatsappLinked = body.whatsappLinked;
    if (typeof body?.testDone === 'boolean') allowed.testDone = body.testDone;
    if (Object.keys(allowed).length === 0) return reply.code(400).send({ error: 'flag inválido' });
    const flags = await setFlag(request.tenantId, allowed);
    return { ok: true, flags };
  });

  app.post('/onboarding/complete', { preHandler: app.authenticate }, async (request: any) => {
    const flags = await setFlag(request.tenantId, { completed: true });
    return { ok: true, flags };
  });
}
