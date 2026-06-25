import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db';
import { SPA_URL, BILLING_GRACE_DAYS, requireEnv } from '../env';
import { getStripe, type StripeLike, type Stripe } from '../billing/stripe';
import { applyStripeEvent } from '../billing/state-machine';

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

  // Resuelve la Subscription espejo a partir del evento (tenantId, customer o sub id).
  async function resolveSub(event: Stripe.Event) {
    const obj = event.data.object as any;
    const tenantId = obj.metadata?.tenantId ?? obj.client_reference_id;
    if (tenantId) return prisma.subscription.findUnique({ where: { tenantId } });
    const customerId = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
    if (customerId) return prisma.subscription.findUnique({ where: { stripeCustomerId: customerId } });
    return null;
  }

  // Webhook: única vía por la que cambia Subscription.status. Sin JWT; verificado
  // por firma; idempotente por la PK de StripeEvent.
  app.post('/billing/webhook', async (request: any, reply) => {
    const sig = request.headers['stripe-signature'];
    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(request.rawBody, sig, requireEnv('STRIPE_WEBHOOK_SECRET'));
    } catch {
      return reply.code(400).send({ error: 'firma inválida' });
    }

    // Idempotencia: insertar el evt_… actúa como lock; duplicado → 200 sin reprocesar.
    try {
      await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } });
    } catch {
      return reply.send({ received: true, duplicate: true });
    }

    const sub = await resolveSub(event);
    if (sub) {
      const result = applyStripeEvent(
        { status: sub.status, currentPeriodEnd: sub.currentPeriodEnd },
        event,
        { graceDays: BILLING_GRACE_DAYS, now: new Date() },
      );
      if (!result.ignored) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { ...result.patch, lastEventId: event.id },
        });
        // Tarea 4: el efecto suspend/resume se propaga al worker (TenantManager).
        if (result.effect) await applyEffect(sub.tenantId, result.effect);
      }
    }
    return { received: true };
  });

  // Tarea 4: suspender/reactivar el bot del tenant vía el endpoint interno del worker.
  async function applyEffect(tenantId: string, effect: 'suspend' | 'resume') {
    const base = process.env.TENANT_MANAGER_URL ?? process.env.WORKER_INTERNAL_URL;
    const token = process.env.INTERNAL_API_TOKEN;
    if (!base || !token) return; // degradación segura: el panel ya bloquea
    const doFetch = opts.fetcher ?? fetch;
    try {
      await doFetch(`${base}/internal/tenant/${effect}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
    } catch {
      // no bloquea el webhook; Stripe reintenta y el panel ya bloquea
    }
  }
}
