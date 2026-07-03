import 'dotenv/config';
import type { PrismaClient } from '@prisma/client';
import { getPrisma, disconnectPrisma } from '../src/storage/client';
import { loadConfig, loadProfile } from '../src/config/loader';

/**
 * Crea/actualiza la fila TenantSettings de cada Tenant a partir de su config.json
 * global + profileDir. Idempotente (upsert por tenantId). Debe correr en cada
 * entorno DESPUÉS de aplicar la migración de TenantSettings y ANTES de arrancar
 * el TenantManager. Deja de leerse `Tenant.profileDir` tras este backfill.
 */
export async function backfillTenantSettings(
  prisma: PrismaClient,
  configPath = './config.json',
): Promise<{ upserted: number }> {
  const config = await loadConfig(configPath);
  const tenants = await prisma.tenant.findMany();
  let upserted = 0;

  for (const tenant of tenants) {
    const profile = await loadProfile(tenant.profileDir);
    const data = {
      industry: tenant.industry,
      businessName: tenant.name,
      businessDomain: profile.intakeSchema.$businessDomain ?? tenant.industry,
      ownerPhoneE164: config.owner.phoneE164,
      welcomeTemplate: profile.welcome,
      intakeSchema: profile.intakeSchema as unknown as object,
      debounceMs: config.debounceMs,
      transcribeAudio: config.media.transcribeAudio,
      describeImages: config.media.describeImages,
      whisperModel: config.media.whisperModel ?? null,
      visionModel: config.media.visionModel ?? null,
      panelUrl: config.owner.panelUrl ?? null,
    };
    await prisma.tenantSettings.upsert({
      where: { tenantId: tenant.id },
      update: data,
      create: { tenantId: tenant.id, ...data },
    });
    upserted += 1;
  }
  return { upserted };
}

async function main() {
  const prisma = getPrisma();
  const { upserted } = await backfillTenantSettings(prisma);
  console.log(`[backfill] TenantSettings actualizado para ${upserted} tenant(s).`);
  await disconnectPrisma();
}

// Ejecutar solo si se invoca directo (no al importarlo en tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
