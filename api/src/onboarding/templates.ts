import type { PrismaClient } from '@prisma/client';
import { loadProfile } from '../../../src/config/loader';

export type Industry = 'tapiceria' | 'paqueteria' | 'generico';

const INDUSTRY_DOMAIN: Record<Industry, string> = {
  tapiceria: 'tapicería de muebles',
  paqueteria: 'paquetería y envíos',
  generico: 'servicios',
};

function subst(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

/**
 * Copia la plantilla read-only de `profiles/<industry>/` a `TenantSettings` (la
 * instancia editable), sustituyendo {{businessName}}/{{businessDomain}}. El disco
 * es la plantilla; la DB es la instancia. Idempotente (upsert por tenantId).
 */
export async function seedTenantSettingsFromTemplate(
  prisma: PrismaClient,
  tenantId: string,
  industry: Industry,
  vars: { businessName: string },
): Promise<void> {
  const dir = `./profiles/${industry}`;
  let profile;
  try {
    profile = await loadProfile(dir);
  } catch (e) {
    throw new Error(`Plantilla de industria '${industry}' no disponible: ${(e as Error).message}`);
  }
  const businessDomain = INDUSTRY_DOMAIN[industry] ?? 'servicios';
  const subVars = { businessName: vars.businessName, businessDomain };

  const schema = JSON.parse(subst(JSON.stringify(profile.intakeSchema), subVars));
  // Forzar la identidad del negocio aunque la plantilla traiga valores demo.
  schema.$businessName = vars.businessName;
  schema.$businessDomain = businessDomain;
  const welcome = subst(profile.welcome, subVars);

  const data = {
    industry,
    businessName: vars.businessName,
    businessDomain,
    ownerPhoneE164: '', // se completa al vincular WhatsApp / en el wizard
    welcomeTemplate: welcome,
    intakeSchema: schema,
  };
  await prisma.tenantSettings.upsert({
    where: { tenantId },
    update: data,
    create: { tenantId, ...data },
  });
}

export const INDUSTRIES: Industry[] = ['tapiceria', 'paqueteria', 'generico'];
