import { getPrisma } from '../db';
import { loadProfile } from '../../../src/config/loader';

const cache = new Map<string, Awaited<ReturnType<typeof loadProfile>>>();

export async function getTenantProfile(tenantId: string) {
  const cached = cache.get(tenantId);
  if (cached) return cached;
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`tenant ${tenantId} no existe`);
  const profile = await loadProfile(tenant.profileDir);
  cache.set(tenantId, profile);
  return profile;
}
