import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getPrisma, disconnectPrisma } from '../db';

// Uso: npm run api:create-user -- <tenantSlug> <email> <password> [username] [role]
async function main() {
  const [slug, email, password, username, role = 'admin'] = process.argv.slice(2);
  if (!slug || !email || !password) {
    console.error('Uso: npm run api:create-user -- <tenantSlug> <email> <password> [username] [admin|viewer]');
    process.exit(1);
  }
  const displayName = username || email.split('@')[0];
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) { console.error(`No existe tenant con slug "${slug}"`); process.exit(1); }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.panelUser.create({
    data: { tenantId: tenant.id, username: displayName, email, passwordHash, role },
  });
  console.log(`PanelUser creado: ${user.email} (${user.role}) para tenant ${slug} [${tenant.id}]`);
  await disconnectPrisma();
}
main().catch((e) => { console.error(e); process.exit(1); });
