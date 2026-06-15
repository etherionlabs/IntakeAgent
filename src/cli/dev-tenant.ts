import type { PrismaClient } from '@prisma/client';

/**
 * Resuelve el tenantId para las CLIs de desarrollo. Usa process.env.TENANT_ID si
 * está definido (asegurando que la fila exista); si no, upserta un tenant 'dev'
 * estable para que las CLIs funcionen sin configuración previa.
 */
export async function ensureDevTenant(prisma: PrismaClient): Promise<string> {
  const envId = process.env.TENANT_ID;
  if (envId) {
    await prisma.tenant.upsert({
      where: { id: envId },
      update: {},
      create: { id: envId, slug: `dev-${envId.slice(0, 8)}`, name: 'Dev Tenant', industry: 'dev', profileDir: './profiles/tapiceria' },
    });
    return envId;
  }
  const DEV_ID = '00000000-0000-0000-0000-0000000000de';
  await prisma.tenant.upsert({
    where: { id: DEV_ID },
    update: {},
    create: { id: DEV_ID, slug: 'dev', name: 'Dev Tenant', industry: 'dev', profileDir: './profiles/tapiceria' },
  });
  return DEV_ID;
}
