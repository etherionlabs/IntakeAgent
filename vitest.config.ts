import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Tests Prisma comparten data/intake.db: forzar ejecución secuencial entre archivos
    // para que los `deleteMany` de un test no pisen el estado de otro.
    fileParallelism: false,
  },
});
