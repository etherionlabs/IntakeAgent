import 'dotenv/config';
import { buildServer } from './server';
import { PORT, requireEnv } from './env';
import { disconnectPrisma } from './db';

// En Railway la red (pública y privada) usa IPv6; set HOST=:: en el servicio.
// Local/Docker-compose: 0.0.0.0 por defecto.
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  // Fail-fast de secretas al arrancar (no en el primer request). Los tests usan
  // buildServer directamente con un cliente Stripe mock, por lo que no pasan por aquí.
  requireEnv('JWT_SECRET');
  requireEnv('STRIPE_SECRET_KEY');
  requireEnv('STRIPE_WEBHOOK_SECRET');
  const app = await buildServer();
  await app.listen({ port: PORT, host: HOST });
  const shutdown = async () => { await app.close(); await disconnectPrisma(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
main().catch((e) => { console.error(e); process.exit(1); });
