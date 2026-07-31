import { getPrisma } from '../db';
import { loadEffectiveProfile } from '../../../src/config/loader';
import { validateIntakeSchema } from '../../../src/config/intake-schema';
import { logger } from '../../../src/lib/logger';

const cache = new Map<string, Awaited<ReturnType<typeof loadEffectiveProfile>>>();

export async function getTenantProfile(tenantId: string) {
  const cached = cache.get(tenantId);
  if (cached) return cached;
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`tenant ${tenantId} no existe`);
  // Perfil efectivo: archivos base + override guardado en DB (panel).
  const base = await loadEffectiveProfile(prisma, tenantId, tenant.profileDir);
  // La ESTRUCTURA del intake (secciones y campos) es la del tenant, igual que en
  // el worker (buildTenantConfig). Sin esto el panel mostraría la plantilla del
  // giro mientras el bot pide los campos que el dueño configuró: dos fuentes de
  // verdad para lo mismo. Si la fila no existe o trae algo inválido, se cae a los
  // archivos en vez de romper el panel.
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { intakeSchema: true },
  });
  let profile = base;
  if (settings?.intakeSchema) {
    const result = validateIntakeSchema(settings.intakeSchema);
    if (result.ok) {
      profile = { ...base, intakeSchema: result.schema };
    } else {
      logger.warn(
        { tenantId, error: result.error },
        'tenant_profile.intake_schema_invalido_usando_archivos',
      );
    }
  }
  cache.set(tenantId, profile);
  return profile;
}

/**
 * Invalida la caché de perfiles. Llamar tras escribir los archivos del perfil
 * (pantallas de configuración) para que el siguiente GET lea la versión nueva.
 * Sin argumento limpia toda la caché.
 */
export function clearTenantProfileCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/** Devuelve el directorio de perfil del tenant (donde viven los .json del perfil). */
export async function getTenantProfileDir(tenantId: string): Promise<string> {
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`tenant ${tenantId} no existe`);
  return tenant.profileDir;
}
