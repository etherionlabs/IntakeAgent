import { defineConfig } from '@prisma/internals';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || `file:${__dirname}/../data/intake.db`,
    },
  },
});
