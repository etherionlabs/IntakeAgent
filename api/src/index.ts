import 'dotenv/config';
import { buildServer } from './server';
import { PORT, requireEnv, requiredBootSecrets } from './env';
import { disconnectPrisma } from './db';
import { initErrorTracking } from '../../src/lib/observability';

// En Railway la red (pública y privada) usa IPv6; set HOST=:: en el servicio.
// Local/Docker-compose: 0.0.0.0 por defecto.
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  // Fail-fast de secretas al arrancar (no en el primer request). Los tests usan
  // buildServer directamente con un cliente Stripe mock, por lo que no pasan por aquí.
  // En v1 free (ACCESS_MODE=approval) Stripe está dormante → no se exige.
  for (const name of requiredBootSecrets()) requireEnv(name);
  await initErrorTracking({ service: 'api' });
  const app = await buildServer();
  await app.listen({ port: PORT, host: HOST });
  const shutdown = async () => { await app.close(); await disconnectPrisma(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
main().catch((e) => { console.error(e); process.exit(1); });
