#!/usr/bin/env node
/**
 * Setup interactivo de Intake para un entorno nuevo (PC del cliente).
 *
 * Hace, de forma idempotente:
 *   1. Crea .env desde .env.example si no existe.
 *   2. Pide OPENROUTER_API_KEY si falta.
 *   3. Pide la contraseña del panel y guarda su hash bcrypt (PANEL_PASSWORD_HASH).
 *   4. Genera PANEL_SESSION_SECRET estable si falta.
 *   5. Ejecuta `prisma generate` y `prisma migrate deploy` (crea la base de datos).
 *
 * Reentrante: si un valor ya está configurado, no lo vuelve a pedir.
 *
 * Uso:
 *   npm run setup
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import bcrypt from 'bcryptjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const examplePath = join(root, '.env.example');

const PLACEHOLDERS = new Set(['', 'sk-or-...']);

/** Parsea un .env en pares clave→valor (simple, sin export ni comillas anidadas). */
function parseEnv(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

/** Reescribe (o añade) una clave en el contenido del .env preservando el resto. */
function setEnvValue(text, key, value) {
  const lines = text.split(/\r?\n/);
  const re = new RegExp(`^\\s*${key}\\s*=`);
  const rendered = `${key}=${value}`;
  let found = false;
  const out = lines.map((line) => {
    if (re.test(line)) {
      found = true;
      return rendered;
    }
    return line;
  });
  if (!found) out.push(rendered);
  return out.join('\n');
}

function isMissing(map, key) {
  const v = map.get(key);
  return v === undefined || PLACEHOLDERS.has(v.trim());
}

async function main() {
  console.log('\n=== Setup de Intake ===\n');

  // 1. .env
  if (!existsSync(envPath)) {
    copyFileSync(examplePath, envPath);
    console.log('• Creado .env a partir de .env.example');
  }
  let text = readFileSync(envPath, 'utf-8');
  let map = parseEnv(text);

  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  const rl = interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;

  // 2. OPENROUTER_API_KEY
  if (isMissing(map, 'OPENROUTER_API_KEY')) {
    if (rl) {
      const key = (await rl.question('OpenRouter API key (sk-or-...): ')).trim();
      if (key) {
        text = setEnvValue(text, 'OPENROUTER_API_KEY', key);
        console.log('• OPENROUTER_API_KEY guardada');
      } else {
        console.log('⚠ OPENROUTER_API_KEY quedó vacía — el agente no responderá sin ella');
      }
    } else {
      console.log('⚠ OPENROUTER_API_KEY no configurada (sesión no interactiva)');
    }
  } else {
    console.log('• OPENROUTER_API_KEY ya configurada');
  }

  // 3. PANEL_PASSWORD_HASH
  if (isMissing(map, 'PANEL_PASSWORD_HASH')) {
    if (rl) {
      let pw = '';
      while (!pw) {
        pw = (await rl.question('Contraseña para el panel web (usuario admin): ')).trim();
        if (!pw) console.log('  La contraseña no puede estar vacía.');
      }
      const hash = await bcrypt.hash(pw, 10);
      text = setEnvValue(text, 'PANEL_PASSWORD_HASH', hash);
      console.log('• PANEL_PASSWORD_HASH generado (usuario: admin)');
    } else {
      console.log('⚠ PANEL_PASSWORD_HASH no configurado (sesión no interactiva)');
    }
  } else {
    console.log('• PANEL_PASSWORD_HASH ya configurado');
  }

  // 4. PANEL_SESSION_SECRET
  if (isMissing(map, 'PANEL_SESSION_SECRET')) {
    const secret = randomBytes(32).toString('hex');
    text = setEnvValue(text, 'PANEL_SESSION_SECRET', secret);
    console.log('• PANEL_SESSION_SECRET generado');
  } else {
    console.log('• PANEL_SESSION_SECRET ya configurado');
  }

  writeFileSync(envPath, text);
  if (rl) rl.close();

  // 5. Base de datos
  if (process.env.SETUP_SKIP_DB === '1') {
    console.log('\n• (SETUP_SKIP_DB=1) Saltando pasos de base de datos');
  } else {
    console.log('\n• Generando cliente Prisma...');
    run('npx', ['prisma', 'generate']);
    console.log('• Aplicando migraciones (crea la base de datos)...');
    run('npx', ['prisma', 'migrate', 'deploy']);
  }

  console.log('\n=== Setup completo ===');
  console.log('Arranca con:  npm start');
  console.log('Luego escanea el código QR con WhatsApp y abre el panel en');
  console.log('http://localhost:3000  (usuario: admin)\n');
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: root,
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    console.error(`\n✖ Falló: ${cmd} ${args.join(' ')}`);
    process.exit(res.status ?? 1);
  }
}

main().catch((e) => {
  console.error('\n✖ Error en setup:', e?.message ?? e);
  process.exit(1);
});
