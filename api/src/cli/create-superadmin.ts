import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getPrisma, disconnectPrisma } from '../db';

// Uso: npm run platform:create-superadmin -- <username> <password>
async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Uso: npm run platform:create-superadmin -- <username> <password>');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('La contrasena debe tener al menos 8 caracteres.');
    process.exit(1);
  }

  const prisma = getPrisma();
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.platformUser.upsert({
    where: { username },
    update: { passwordHash, role: 'superadmin' },
    create: { username, passwordHash, role: 'superadmin' },
  });
  console.log(`PlatformUser listo: ${user.username} (${user.role})`);
  await disconnectPrisma();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
