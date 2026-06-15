import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Configuración de la CLI de Prisma (Prisma 7).
 *
 * En Prisma 7 la URL de conexión ya no vive en schema.prisma; los comandos de
 * migración / introspección la leen desde aquí. El cliente en runtime usa el
 * adapter better-sqlite3 (ver src/storage/client.ts), no este archivo.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgres://intake:intake@localhost:5432/intake',
  },
});
