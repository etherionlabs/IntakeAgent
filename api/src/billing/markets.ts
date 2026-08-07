/**
 * Mercados de lanzamiento. El precio de Intake cambia por país (US$99 EE.UU.,
 * US$69 México, US$59 Colombia), así que el mercado no es un dato de marketing:
 * es lo que decide qué `Plan` cobra el Checkout.
 *
 * La lista tiene que coincidir con la que el asistente de venta usa para cotizar
 * (`profiles/intake/business-facts.json` y el campo `country` de su intake). Si
 * se abre un mercado nuevo, se añade aquí, se crea su `Plan` y se actualiza el
 * perfil de venta — en ese orden, porque cotizar un país sin plan es prometer un
 * precio que no se puede cobrar.
 */
export const MARKETS = ['US', 'MX', 'CO'] as const;

export type Market = (typeof MARKETS)[number];

/** Etiqueta para el panel y los formularios (el nombre que el dueño reconoce). */
export const MARKET_LABELS: Record<Market, string> = {
  US: 'Estados Unidos',
  MX: 'México',
  CO: 'Colombia',
};

export function isMarket(value: unknown): value is Market {
  return typeof value === 'string' && (MARKETS as readonly string[]).includes(value);
}

/** Opciones para los selects del panel (mismo formato que el catálogo de giros). */
export function marketOptions(): { value: Market; label: string }[] {
  return MARKETS.map((value) => ({ value, label: MARKET_LABELS[value] }));
}
