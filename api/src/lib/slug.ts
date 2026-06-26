import type { PrismaClient } from '@prisma/client';

/** Normaliza a slug: minúsculas, sin acentos, guiones. */
export function slugify(input: string): string {
  return input
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'negocio';
}

/** Slug único contra Tenant.slug (@unique): añade sufijo numérico si colisiona. */
export async function uniqueSlug(prisma: PrismaClient, businessName: string): Promise<string> {
  const base = slugify(businessName);
  let candidate = base;
  let n = 1;
  while (await prisma.tenant.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}
