import type { PrismaClient } from '@prisma/client';
import { seedTenantSettingsFromTemplate, type Industry } from './templates';
import { resolveManagerUrl } from '../lib/manager-url';

export interface ProvisionDeps {
  /** Alta del tenant en el worker (TenantManager.addTenant). Inyectable en tests. */
  addTenant: (tenantId: string) => Promise<void>;
  /** Sembrado de TenantSettings desde plantilla. Default: TemplateLoader. */
  seedSettings?: (tenantId: string, industry: Industry, vars: { businessName: string }) => Promise<void>;
}

/**
 * Aprovisiona un tenant verificado: siembra TenantSettings desde la plantilla de
 * su industria y crea su conexión en el worker. IDEMPOTENTE (guard por status):
 * un webhook duplicado no re-aprovisiona. Requiere email verificado.
 */
export async function provisionTenant(
  prisma: PrismaClient,
  tenantId: string,
  deps: ProvisionDeps,
): Promise<{ provisioned: boolean; reason?: string }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { provisioned: false, reason: 'not_found' };
  if (tenant.status === 'provisioning' || tenant.status === 'active') {
    return { provisioned: false, reason: 'already' }; // idempotente
  }
  if (tenant.status !== 'verified') return { provisioned: false, reason: 'not_verified' };

  const seed = deps.seedSettings ??
    ((id, industry, vars) => seedTenantSettingsFromTemplate(prisma, id, industry, vars));
  await seed(tenant.id, tenant.industry as Industry, { businessName: tenant.name });

  await prisma.tenant.update({ where: { id: tenant.id }, data: { status: 'provisioning' } });
  await deps.addTenant(tenant.id);
  await prisma.tenant.update({ where: { id: tenant.id }, data: { status: 'active' } });
  return { provisioned: true };
}

/** addTenant de producción: POST al endpoint interno del worker que posee el shard. */
export function workerAddTenant(fetcher: typeof fetch = fetch) {
  return async (tenantId: string): Promise<void> => {
    const base = resolveManagerUrl(tenantId);
    const token = process.env.INTERNAL_API_TOKEN;
    if (!base || !token) throw new Error('worker no configurado (TENANT_MANAGER_URL/INTERNAL_API_TOKEN)');
    const res = await fetcher(`${base}/internal/tenant/add`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId }),
    });
    if (!res.ok) throw new Error(`worker respondió ${res.status} al aprovisionar`);
  };
}
