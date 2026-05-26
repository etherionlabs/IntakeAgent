import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

let _client: PrismaClient | null = null;

function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? 'file:./data/intake.db';
}

export function getPrisma(): PrismaClient {
  if (!_client) {
    const adapter = new PrismaBetterSqlite3({ url: getDatabaseUrl() });
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
