import type { Stripe } from './stripe';

export interface SubPatch {
  status?: string;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  gracePeriodEndsAt?: Date | null;
  stripeSubscriptionId?: string | null;
}

export interface CurrentSub {
  status: string;
  currentPeriodEnd: Date | null;
}

export interface StateResult {
  patch: SubPatch;
  /** Efecto operativo sobre el bot del tenant. */
  effect: 'suspend' | 'resume' | null;
  /** El evento se ignora (fuera de orden / no relevante). */
  ignored?: boolean;
}

const NO_OP: StateResult = { patch: {}, effect: null, ignored: true };

function toDate(unixSeconds: number | null | undefined): Date | null {
  return typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000) : null;
}

/** Estados en los que el bot debe operar. */
export function isOperative(status: string): boolean {
  return status === 'active' || status === 'trialing';
}

/**
 * Mapea un evento de Stripe a una transición del espejo local. Función PURA:
 * recibe el estado actual y el evento, devuelve el patch + efecto. Sin DB ni HTTP.
 */
export function applyStripeEvent(
  current: CurrentSub | null,
  event: Stripe.Event,
  opts: { graceDays: number; now: Date },
): StateResult {
  const obj = event.data.object as any;

  switch (event.type) {
    case 'checkout.session.completed': {
      // Alta confirmada: vincula la subscription y queda operativa.
      const status = 'active';
      return {
        patch: {
          stripeSubscriptionId: typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id ?? null,
          status,
          cancelAtPeriodEnd: false,
        },
        effect: 'resume',
      };
    }

    case 'customer.subscription.updated': {
      const newPeriodEnd = toDate(obj.current_period_end);
      // Fuera de orden: si el periodo es más viejo que el aplicado, ignorar.
      if (current?.currentPeriodEnd && newPeriodEnd && newPeriodEnd < current.currentPeriodEnd) {
        return NO_OP;
      }
      const status = String(obj.status);
      return {
        patch: {
          status,
          currentPeriodEnd: newPeriodEnd,
          cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
          ...(isOperative(status) ? { gracePeriodEndsAt: null } : {}),
        },
        effect: isOperative(status) ? 'resume' : (status === 'canceled' || status === 'unpaid' ? 'suspend' : null),
      };
    }

    case 'customer.subscription.deleted': {
      return { patch: { status: 'canceled' }, effect: 'suspend' };
    }

    case 'invoice.payment_failed': {
      const grace = new Date(opts.now.getTime() + opts.graceDays * 24 * 60 * 60 * 1000);
      // Aún operativo durante la gracia; el bloqueo lo decide isTenantActive.
      return { patch: { status: 'past_due', gracePeriodEndsAt: grace }, effect: null };
    }

    case 'invoice.payment_succeeded': {
      return { patch: { status: 'active', gracePeriodEndsAt: null }, effect: 'resume' };
    }

    default:
      return NO_OP;
  }
}
