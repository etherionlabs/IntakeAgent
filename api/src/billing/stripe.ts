import Stripe from 'stripe';
import { requireEnv } from '../env';

/**
 * Subconjunto de la API de Stripe que usamos. Permite inyectar un mock en tests
 * sin pegarle a Stripe real (mismo patrón que el `fetcher` de wa-status).
 */
export interface StripeLike {
  customers: {
    create(params: { metadata?: Record<string, string>; email?: string }): Promise<{ id: string }>;
  };
  checkout: {
    sessions: {
      create(params: unknown): Promise<{ id: string; url: string | null }>;
    };
  };
  billingPortal: {
    sessions: {
      create(params: { customer: string; return_url: string }): Promise<{ url: string }>;
    };
  };
  webhooks: {
    constructEvent(payload: string | Buffer, sig: string | string[], secret: string): Stripe.Event;
  };
}

let singleton: Stripe | null = null;

/** Cliente Stripe perezoso (solo se construye si se usa de verdad). */
export function getStripe(): StripeLike {
  if (!singleton) {
    singleton = new Stripe(requireEnv('STRIPE_SECRET_KEY'), { apiVersion: '2025-08-27.basil' } as any);
  }
  return singleton as unknown as StripeLike;
}

export type { Stripe };
