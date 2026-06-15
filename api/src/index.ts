import 'dotenv/config';
import { buildServer } from './server';
import { PORT } from './env';
import { disconnectPrisma } from './db';

// En Railway la red (pública y privada) usa IPv6; set HOST=:: en el servicio.
// Local/Docker-compose: 0.0.0.0 por defecto.
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  const app = await buildServer();
  await app.listen({ port: PORT, host: HOST });
  const shutdown = async () => { await app.close(); await disconnectPrisma(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
main().catch((e) => { console.error(e); process.exit(1); });
