#!/usr/bin/env tsx
/**
 * Genera un bcrypt hash para PANEL_PASSWORD_HASH del .env.
 *
 * Uso:
 *   npm run panel:hash -- mi-password-segura
 */
import { hashPassword } from '../panel/auth';

async function main() {
  const pw = process.argv[2];
  if (!pw) {
    console.error('Uso: npm run panel:hash -- <password>');
    process.exit(1);
  }
  const hash = await hashPassword(pw);
  console.log('\nAgrega esto a tu .env:\n');
  console.log(`PANEL_PASSWORD_HASH=${hash}`);
  console.log();
}

main();
