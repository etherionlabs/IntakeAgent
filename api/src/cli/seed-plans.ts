import 'dotenv/config';
import { getPrisma, disconnectPrisma } from '../db';
import { MARKETS, MARKET_LABELS, type Market } from '../billing/markets';

/**
 * Siembra los `Plan` de los tres mercados a partir de sus Price de Stripe.
 *
 * Existe porque sembrarlos a mano es donde se cuelan los dos errores caros: un
 * plan sin mercado (y entonces el Checkout no sabe a quién cobrárselo) y un plan
 * con `trialDays` en 0 (y entonces se le cobra el día 1 a quien le prometimos
 * 14 días de prueba). Aquí ambos son obligatorios y explícitos.
 *
 * Uso:
 *   npm run billing:seed-plans -- US=price_123 MX=price_456 CO=price_789
 *
 * Opcionales:
 *   --interval=month|year   (default: month)
 *   --trial-days=14         (default: 14, el plazo que promete la venta)
 *
 * Es idempotente: reejecutarlo con el mismo `price_…` actualiza el plan en vez
 * de duplicarlo. Al activar un plan nuevo para un mercado, desactiva el anterior
 * de ese mismo mercado e intervalo — la base de datos solo admite uno activo.
 */

/** Importe de display por mercado (el cobro real lo manda Stripe). */
const AMOUNT_CENTS: Record<Market, number> = { US: 9900, MX: 6900, CO: 5900 };

function parseArgs(argv: string[]) {
  const prices = new Map<Market, string>();
  let interval = 'month';
  let trialDays = 14;

  for (const arg of argv) {
    if (arg.startsWith('--interval=')) {
      interval = arg.slice('--interval='.length);
      continue;
    }
    if (arg.startsWith('--trial-days=')) {
      trialDays = Number(arg.slice('--trial-days='.length));
      continue;
    }
    const [market, priceId] = arg.split('=');
    if (!MARKETS.includes(market as Market) || !priceId?.startsWith('price_')) {
      throw new Error(`argumento inválido: «${arg}». Formato: US=price_123 (mercados: ${MARKETS.join(', ')})`);
    }
    prices.set(market as Market, priceId);
  }

  if (prices.size === 0) throw new Error('no se indicó ningún precio. Ej: npm run billing:seed-plans -- MX=price_123');
  if (interval !== 'month' && interval !== 'year') throw new Error(`intervalo inválido: «${interval}» (month|year)`);
  if (!Number.isInteger(trialDays) || trialDays < 0) throw new Error(`--trial-days inválido: «${trialDays}»`);
  return { prices, interval, trialDays };
}

async function main() {
  const { prices, interval, trialDays } = parseArgs(process.argv.slice(2));
  const prisma = getPrisma();

  if (trialDays === 0) {
    console.warn('⚠️  trialDays=0: se cobrará desde el día 1. Confirma que la venta no promete prueba.');
  }

  for (const [market, stripePriceId] of prices) {
    const name = `Intake ${MARKET_LABELS[market]}${interval === 'year' ? ' (anual)' : ''}`;
    const data = { market, name, amountCents: AMOUNT_CENTS[market], currency: 'usd', interval, trialDays, active: true };

    // Un solo plan activo por (mercado, intervalo): lo garantiza un índice único
    // parcial, así que hay que retirar el anterior ANTES de activar el nuevo.
    await prisma.plan.updateMany({
      where: { market, interval, active: true, stripePriceId: { not: stripePriceId } },
      data: { active: false },
    });

    const plan = await prisma.plan.upsert({
      where: { stripePriceId },
      update: data,
      create: { stripePriceId, ...data },
    });
    console.log(`✓ ${plan.name} — ${stripePriceId} · ${(plan.amountCents / 100).toFixed(2)} ${plan.currency.toUpperCase()}/${plan.interval} · ${plan.trialDays} días de prueba`);
  }

  const faltantes = MARKETS.filter((m) => !prices.has(m));
  if (faltantes.length) {
    console.warn(`⚠️  Sin plan en esta corrida: ${faltantes.join(', ')}. Un tenant de esos mercados no podrá pagar (409 en el checkout).`);
  }
  await disconnectPrisma();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
