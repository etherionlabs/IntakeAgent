import { getPrisma } from '../db';
import { loadEffectiveProfile } from '../../../src/config/loader';

const cache = new Map<string, Awaited<ReturnType<typeof loadEffectiveProfile>>>();

export async function getTenantProfile(tenantId: string) {
  const cached = cache.get(tenantId);
  if (cached) return cached;
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`tenant ${tenantId} no existe`);
  // Perfil efectivo: archivos base + override guardado en DB (panel).
  const profile = await loadEffectiveProfile(prisma, tenantId, tenant.profileDir);
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
