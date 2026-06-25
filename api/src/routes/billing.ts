import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db';
import { SPA_URL } from '../env';
import { getStripe, type StripeLike } from '../billing/stripe';

export interface BillingRouteOptions {
  /** Cliente Stripe inyectable (tests). Default: singleton real. */
  stripe?: StripeLike;
  /** fetcher para llamar al worker (suspend/resume). Default: fetch global. */
  fetcher?: typeof fetch;
}

export async function billingRoutes(app: FastifyInstance, opts: BillingRouteOptions = {}) {
  const stripe = () => opts.stripe ?? getStripe();
  const prisma = getPrisma();

  // Estado de la suscripción (espejo local; no pega a Stripe).
  app.get('/billing/status', { preHandler: app.authenticate }, async (request: any) => {
    const sub = await prisma.subscription.findUnique({
      where: { tenantId: request.tenantId },
      include: { plan: true },
    });
    if (!sub) return { status: 'none', planName: null };
    return {
      status: sub.status,
      planName: sub.plan.name,
      amountCents: sub.plan.amountCents,
      currency: sub.plan.currency,
      interval: sub.plan.interval,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      gracePeriodEndsAt: sub.gracePeriodEndsAt,
    };
  });

  // Alta de suscripción: crea/reutiliza Customer + Checkout Session. NO marca
  // active aquí (eso lo hace el webhook).
  app.post('/billing/checkout', { preHandler: app.authenticate }, async (request: any, reply) => {
    const tenantId = request.tenantId as string;
    const plan = await prisma.plan.findFirst({ where: { active: true } });
    if (!plan) return reply.code(409).send({ error: 'no hay plan activo configurado' });

    let sub = await prisma.subscription.findUnique({ where: { tenantId } });
    let customerId = sub?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe().customers.create({ metadata: { tenantId } });
      customerId = customer.id;
      sub = await prisma.subscription.create({
        data: { tenantId, planId: plan.id, stripeCustomerId: customerId, status: 'incomplete' },
      });
    }

    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      client_reference_id: tenantId,
      metadata: { tenantId },
      success_url: `${SPA_URL}/billing?checkout=success`,
      cancel_url: `${SPA_URL}/billing?checkout=cancel`,
      ...(plan.trialDays > 0 ? { subscription_data: { trial_period_days: plan.trialDays } } : {}),
    });
    return { url: session.url };
  });

  // Autogestión (cambiar tarjeta / cancelar) vía Customer Portal.
  app.post('/billing/portal', { preHandler: app.authenticate }, async (request: any, reply) => {
    const sub = await prisma.subscription.findUnique({ where: { tenantId: request.tenantId } });
    if (!sub) return reply.code(409).send({ error: 'sin suscripción; usa checkout primero' });
    const session = await stripe().billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${SPA_URL}/billing`,
    });
    return { url: session.url };
  });
}
