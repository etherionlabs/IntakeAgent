import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

let _client: PrismaClient | null = null;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL no está definida. El worker requiere una conexión PostgreSQL ' +
        '(ej. postgres://intake:***@postgres:5432/intake).',
    );
  }
  return url;
}

export function getPrisma(): PrismaClient {
  if (!_client) {
    const adapter = new PrismaPg({ connectionString: getDatabaseUrl() });
    _client = new PrismaClient({ adapter });
  }
  return _client;
}

export async function disconnectPrisma(): Promise<void> {
  if (_client) {
    await _client.$disconnect();
    _client = null;
  }
}
