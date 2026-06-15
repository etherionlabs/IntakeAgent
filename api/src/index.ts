import 'dotenv/config';
import { buildServer } from './server';
import { PORT } from './env';
import { disconnectPrisma } from './db';

async function main() {
  const app = await buildServer();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  const shutdown = async () => { await app.close(); await disconnectPrisma(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
main().catch((e) => { console.error(e); process.exit(1); });
