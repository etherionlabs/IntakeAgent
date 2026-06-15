import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getPrisma, disconnectPrisma } from '../db';

// Uso: npm run api:create-user -- <tenantSlug> <username> <password> [role]
async function main() {
  const [slug, username, password, role = 'admin'] = process.argv.slice(2);
  if (!slug || !username || !password) {
    console.error('Uso: npm run api:create-user -- <tenantSlug> <username> <password> [admin|viewer]');
    process.exit(1);
  }
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) { console.error(`No existe tenant con slug "${slug}"`); process.exit(1); }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.panelUser.create({ data: { tenantId: tenant.id, username, passwordHash, role } });
  console.log(`PanelUser creado: ${user.username} (${user.role}) para tenant ${slug} [${tenant.id}]`);
  await disconnectPrisma();
}
main().catch((e) => { console.error(e); process.exit(1); });
