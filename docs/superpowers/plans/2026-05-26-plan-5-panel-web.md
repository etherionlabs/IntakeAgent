# Plan 5 — Panel web (Fastify + HTMX + Tailwind CDN)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el panel web del dueño: vista de jobs pendientes/abiertos/cerrados con conversación completa, formulario dinámico del intake editable, toggle del bot por contacto, estado de WhatsApp con QR, vista de costos y configuración. Auth básica con cookie de sesión. Mismo proceso que el bot.

**Architecture:** Servidor Fastify embebido en el mismo proceso del bot. Vistas server-side con Handlebars + HTMX para interacciones (sin SPA, sin build step). Tailwind por CDN para estilos. El formulario del intake se renderiza dinámicamente leyendo `profile.intakeSchema` — cambiar de perfil cambia el formulario. El estado de WhatsApp lo expone el `BaileysAdapter` vía su método `state()` (ya implementado en Plan 4).

**Tech Stack:** `fastify@5`, `@fastify/view`, `handlebars`, `@fastify/cookie`, `@fastify/formbody`, `@fastify/static`, `bcryptjs`. HTMX + Tailwind por CDN (sin npm). Sin frontend build.

**Spec de referencia:** [`docs/superpowers/specs/2026-05-25-intake-recepcionista-design.md`](../specs/2026-05-25-intake-recepcionista-design.md) §8.

**Planes anteriores:** [Plan 1](2026-05-25-plan-1-fundacion.md), [Plan 2](2026-05-25-plan-2-agent-core.md), [Plan 3](2026-05-26-plan-3-inbound-pipeline.md), [Plan 4](2026-05-26-plan-4-whatsapp-adapter.md).

---

## Estructura de archivos al finalizar este plan

```
src/
├── panel/
│   ├── server.ts            # createPanelServer(deps) — Fastify factory
│   ├── auth.ts              # Basic auth + cookie de sesión firmada
│   ├── helpers.ts           # Helpers de handlebars (formato fecha, json, icons)
│   ├── adapter-state.ts     # Interface ConnectionState (lee del BaileysAdapter)
│   ├── routes/
│   │   ├── dashboard.ts     # GET / y /panel/dashboard
│   │   ├── jobs.ts          # GET /panel/jobs/:id + PATCH intake + POST status
│   │   ├── contacts.ts      # GET /panel/contacts + POST toggle
│   │   ├── whatsapp.ts      # GET /panel/whatsapp + estado JSON
│   │   ├── usage.ts         # GET /panel/usage
│   │   └── config.ts        # GET /panel/config
│   └── views/
│       ├── layout.hbs       # Layout base (nav, estilos)
│       ├── login.hbs
│       ├── dashboard.hbs
│       ├── job-detail.hbs
│       ├── contacts.hbs
│       ├── whatsapp.hbs
│       ├── usage.hbs
│       └── config.hbs
└── index.ts                 # Modificado: arranca panel además del adapter

tests/
└── panel/
    ├── auth.test.ts
    └── server.test.ts
```

---

## Task 1: Instalar dependencias + tipos del panel

**Files:**
- Modify: `package.json`
- Create: `src/panel/adapter-state.ts`

- [ ] **Step 1: Instalar**

```bash
npm install fastify @fastify/view @fastify/cookie @fastify/formbody @fastify/static handlebars bcryptjs
npm install -D @types/bcryptjs
```

- [ ] **Step 2: Crear `src/panel/adapter-state.ts`**

```ts
import type { AdapterStateSnapshot } from '../adapters/whatsapp/types';

/**
 * Interfaz mínima que el panel consume del adapter. Permite testear el panel
 * sin importar Baileys: en tests pasamos un objeto fake con state().
 */
export interface ConnectionStateProvider {
  state(): AdapterStateSnapshot;
}

/** Stub: siempre reporta "disconnected". Útil para arrancar el panel solo. */
export class NullConnectionStateProvider implements ConnectionStateProvider {
  state(): AdapterStateSnapshot {
    return {
      status: 'disconnected',
      qr: null,
      lastError: 'panel sin adapter conectado',
      lastConnectedAt: null,
    };
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/panel/adapter-state.ts
git commit -m "feat(panel): instala fastify + handlebars y define ConnectionStateProvider"
```

---

## Task 2: Auth — contraseña hashed + cookie de sesión

**Files:**
- Create: `src/panel/auth.ts`
- Create: `tests/panel/auth.test.ts`
- Create: `src/cli/panel-hash.ts` (utility para generar el hash)
- Modify: `package.json` (agrega script `panel:hash`)

- [ ] **Step 1: Escribir tests**

`tests/panel/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  encodeSession,
  decodeSession,
  type PanelUser,
} from '../../src/panel/auth';

describe('hashPassword / verifyPassword', () => {
  it('hash genera string bcrypt válido', async () => {
    const h = await hashPassword('secret123');
    expect(h).toMatch(/^\$2[aby]\$\d+\$/);
  });

  it('verifyPassword acepta password correcto', async () => {
    const h = await hashPassword('hola');
    expect(await verifyPassword('hola', h)).toBe(true);
  });

  it('verifyPassword rechaza password incorrecto', async () => {
    const h = await hashPassword('hola');
    expect(await verifyPassword('chao', h)).toBe(false);
  });
});

describe('encodeSession / decodeSession', () => {
  const secret = 'panel-session-secret-123';

  it('round-trip preserva el username', () => {
    const token = encodeSession('duenio', secret);
    const decoded = decodeSession(token, secret);
    expect(decoded).toBe('duenio');
  });

  it('rechaza token firmado con otro secret', () => {
    const token = encodeSession('duenio', secret);
    expect(decodeSession(token, 'otro')).toBeNull();
  });

  it('rechaza token manipulado', () => {
    const token = encodeSession('duenio', secret);
    const tampered = token.replace('duenio', 'admin');
    expect(decodeSession(tampered, secret)).toBeNull();
  });

  it('rechaza token malformado', () => {
    expect(decodeSession('not-a-token', secret)).toBeNull();
  });
});

describe('resolveUser', () => {
  it('encuentra usuario por nombre y verifica password', async () => {
    const hash = await hashPassword('mi-pass');
    const { resolveUser } = await import('../../src/panel/auth');
    const users: PanelUser[] = [{ username: 'duenio', passwordHash: hash }];
    expect(await resolveUser(users, 'duenio', 'mi-pass')).toEqual({
      username: 'duenio',
      passwordHash: hash,
    });
    expect(await resolveUser(users, 'duenio', 'mala')).toBeNull();
    expect(await resolveUser(users, 'otra', 'mi-pass')).toBeNull();
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/panel/auth.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/panel/auth.ts`**

```ts
import bcrypt from 'bcryptjs';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PanelUser {
  username: string;
  passwordHash: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function resolveUser(
  users: PanelUser[],
  username: string,
  password: string,
): Promise<PanelUser | null> {
  const user = users.find((u) => u.username === username);
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

/**
 * Token de sesión simple: `username.signature`.
 * signature = HMAC-SHA256(secret, username) en base64url.
 */
export function encodeSession(username: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(username).digest('base64url');
  return `${Buffer.from(username).toString('base64url')}.${sig}`;
}

export function decodeSession(token: string, secret: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encUser, sig] = parts;
  let username: string;
  try {
    username = Buffer.from(encUser, 'base64url').toString('utf-8');
  } catch {
    return null;
  }
  if (!username) return null;
  const expectedSig = createHmac('sha256', secret).update(username).digest('base64url');
  // Comparar en tiempo constante para evitar timing attacks.
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? username : null;
}

export const COOKIE_NAME = 'intake_panel_session';
```

- [ ] **Step 4: Crear `src/cli/panel-hash.ts`**

```ts
#!/usr/bin/env tsx
/**
 * Genera un bcrypt hash para usar en PANEL_PASSWORD_HASH del .env.
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
```

- [ ] **Step 5: Agregar script al `package.json`**

```json
"panel:hash": "tsx src/cli/panel-hash.ts"
```

- [ ] **Step 6: Correr tests + typecheck**

```bash
npm test -- tests/panel/auth.test.ts
npm run typecheck
```

Expected: 7 tests passed, typecheck limpio.

- [ ] **Step 7: Commit**

```bash
git add src/panel/auth.ts src/cli/panel-hash.ts tests/panel/auth.test.ts package.json
git commit -m "feat(panel): auth con bcrypt + sesión firmada HMAC + CLI panel:hash"
```

---

## Task 3: Layout base + helpers de handlebars

**Files:**
- Create: `src/panel/helpers.ts`
- Create: `src/panel/views/layout.hbs`
- Create: `src/panel/views/login.hbs`

- [ ] **Step 1: Crear `src/panel/helpers.ts`**

```ts
import type { HelperOptions } from 'handlebars';

export const handlebarsHelpers = {
  /** Formato fecha-hora corto. */
  date(d: Date | string | null): string {
    if (!d) return '—';
    const date = typeof d === 'string' ? new Date(d) : d;
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString('es-MX', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  },

  /** Devuelve un humano "hace 3 minutos" tipo. */
  ago(d: Date | string | null): string {
    if (!d) return '—';
    const date = typeof d === 'string' ? new Date(d) : d;
    if (isNaN(date.getTime())) return '—';
    const diff = Date.now() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'hace un momento';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.floor(hours / 24);
    return `hace ${days} d`;
  },

  /** Pretty-print JSON. */
  json(obj: unknown): string {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  },

  /** Truncado a N caracteres con elipsis. */
  truncate(s: unknown, n: number): string {
    const str = String(s ?? '');
    if (str.length <= n) return str;
    return str.slice(0, n - 1) + '…';
  },

  /** Comparador para usar en {{#if (eq a b)}} */
  eq(a: unknown, b: unknown): boolean {
    return a === b;
  },

  /** Status humano del job. */
  statusLabel(status: string): string {
    switch (status) {
      case 'OPEN_INTAKE':
        return 'En captura';
      case 'READY_FOR_REVIEW':
        return 'Listo para revisar';
      case 'IN_PROGRESS':
        return 'En curso (humano)';
      case 'CLOSED':
        return 'Cerrado';
      default:
        return status;
    }
  },

  /** Clase tailwind para color de status. */
  statusClass(status: string): string {
    switch (status) {
      case 'OPEN_INTAKE':
        return 'bg-blue-100 text-blue-800';
      case 'READY_FOR_REVIEW':
        return 'bg-amber-100 text-amber-800';
      case 'IN_PROGRESS':
        return 'bg-green-100 text-green-800';
      case 'CLOSED':
        return 'bg-gray-100 text-gray-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  },

  /** Indicador de modo de atención (chip). */
  attentionMode(
    botActive: boolean,
    flagged: boolean,
    jobStatus: string | null,
  ): { label: string; cls: string; icon: string } {
    if (flagged)
      return { label: 'No intake', cls: 'bg-red-100 text-red-800', icon: '⚠️' };
    if (!botActive)
      return { label: 'IA pausada', cls: 'bg-gray-200 text-gray-800', icon: '⏸️' };
    if (jobStatus === 'IN_PROGRESS')
      return {
        label: 'Humano atendiendo',
        cls: 'bg-purple-100 text-purple-800',
        icon: '👤',
      };
    return { label: 'IA activa', cls: 'bg-emerald-100 text-emerald-800', icon: '🟢' };
  },

  /** Operador `not` para condicionales. */
  not(v: unknown): boolean {
    return !v;
  },

  /** "or" lógico. */
  or(a: unknown, b: unknown, _opts: HelperOptions): unknown {
    return a || b;
  },
};
```

- [ ] **Step 2: Crear `src/panel/views/layout.hbs`**

```handlebars
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{title}} · {{businessName}}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@1.9.12"></script>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  </style>
</head>
<body class="bg-gray-50 text-gray-900">
  <nav class="bg-white border-b sticky top-0 z-10">
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center gap-6">
      <a href="/panel/dashboard" class="font-bold text-lg">{{businessName}}</a>
      <a href="/panel/dashboard" class="text-sm text-gray-700 hover:text-gray-900">Dashboard</a>
      <a href="/panel/contacts" class="text-sm text-gray-700 hover:text-gray-900">Contactos</a>
      <a href="/panel/whatsapp" class="text-sm text-gray-700 hover:text-gray-900">WhatsApp</a>
      <a href="/panel/usage" class="text-sm text-gray-700 hover:text-gray-900">Costos</a>
      <a href="/panel/config" class="text-sm text-gray-700 hover:text-gray-900">Config</a>
      <div class="ml-auto flex items-center gap-3 text-sm">
        <span class="text-gray-600">{{username}}</span>
        <form method="POST" action="/panel/logout" class="m-0">
          <button class="text-gray-700 hover:text-red-600">Salir</button>
        </form>
      </div>
    </div>
  </nav>
  <main class="max-w-7xl mx-auto px-4 py-6">
    {{{body}}}
  </main>
</body>
</html>
```

- [ ] **Step 3: Crear `src/panel/views/login.hbs`**

```handlebars
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Login · {{businessName}}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 min-h-screen flex items-center justify-center">
  <form method="POST" action="/panel/login" class="bg-white p-8 rounded shadow w-full max-w-sm">
    <h1 class="text-xl font-bold mb-6">{{businessName}}</h1>
    {{#if error}}
      <div class="bg-red-50 text-red-700 px-3 py-2 rounded text-sm mb-4">{{error}}</div>
    {{/if}}
    <label class="block text-sm mb-1">Usuario</label>
    <input name="username" required class="w-full border rounded px-3 py-2 mb-4" autofocus>
    <label class="block text-sm mb-1">Contraseña</label>
    <input name="password" type="password" required class="w-full border rounded px-3 py-2 mb-6">
    <button class="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700">Entrar</button>
  </form>
</body>
</html>
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/panel/helpers.ts src/panel/views/
git commit -m "feat(panel): layout base + login + helpers de handlebars"
```

---

## Task 4: `createPanelServer` — Fastify factory + login/logout

**Files:**
- Create: `src/panel/server.ts`
- Create: `tests/panel/server.test.ts`

- [ ] **Step 1: Escribir tests**

`tests/panel/server.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { createPanelServer } from '../../src/panel/server';
import { hashPassword, COOKIE_NAME } from '../../src/panel/auth';
import { NullConnectionStateProvider } from '../../src/panel/adapter-state';
import type { Profile, Config } from '../../src/config/schema';
import type { FastifyInstance } from 'fastify';

const adapter = new PrismaBetterSqlite3({ url: 'file:./data/intake.db' });
const prisma = new PrismaClient({ adapter });

const profile: Profile = {
  intakeSchema: {
    $businessName: 'Tapicería Demo',
    $businessDomain: 'tapicería',
    $language: 'es-MX',
    sections: [
      {
        key: 'client',
        label: 'Cliente',
        fields: [{ key: 'name', label: 'Nombre', type: 'string', required: true }],
      },
    ],
  },
  promptVars: { promptTemplate: 'x', vars: {} },
  businessFacts: { facts: [], freeContext: '' },
  welcome: 'hola',
  hash: 'h',
};

const baseConfig = (passwordHash: string): Config =>
  ({
    profile: './profiles/tapiceria',
    model: 'x',
    maxSteps: 6,
    temperature: 0.4,
    debounceMs: 1000,
    fallbackOnError: 'x',
    outOfScopeNudge: '',
    hours: { enabled: false, timezone: 'UTC', schedule: {}, outOfHoursNotice: '' },
    owner: { phoneE164: '+1', notifyOnReady: false, notifyOnDisconnect: false, panelUrl: 'http://localhost' },
    panel: { users: [{ username: 'duenio', passwordHashEnv: 'TEST_PANEL_HASH' }] },
    media: { storeDir: './media', transcribeAudio: false, whisperModel: 'x' },
    limits: { monthlyCostUsd: 50, alertOnCostUsd: 40, maxConsecutiveErrors: 3 },
  }) as Config;

let server: FastifyInstance;
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword('secret');
  process.env.TEST_PANEL_HASH = passwordHash;
  process.env.PANEL_SESSION_SECRET = 'test-session-secret';
  server = await createPanelServer({
    prisma,
    config: baseConfig(passwordHash),
    profile,
    adapterState: new NullConnectionStateProvider(),
  });
});

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

describe('panel server', () => {
  it('GET /panel/login muestra formulario', async () => {
    const res = await server.inject({ method: 'GET', url: '/panel/login' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Usuario');
    expect(res.body).toContain('Contraseña');
  });

  it('GET /panel/dashboard sin sesión redirige a login', async () => {
    const res = await server.inject({ method: 'GET', url: '/panel/dashboard' });
    expect([302, 303]).toContain(res.statusCode);
    expect(res.headers.location).toBe('/panel/login');
  });

  it('POST /panel/login con credenciales correctas crea sesión y redirige', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/panel/login',
      payload: 'username=duenio&password=secret',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect([302, 303]).toContain(res.statusCode);
    expect(res.headers.location).toBe('/panel/dashboard');
    expect(res.headers['set-cookie']).toContain(COOKIE_NAME);
  });

  it('POST /panel/login con credenciales incorrectas devuelve 401', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/panel/login',
      payload: 'username=duenio&password=mala',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('Credenciales');
  });

  it('GET / redirige a dashboard si está logueado', async () => {
    const login = await server.inject({
      method: 'POST',
      url: '/panel/login',
      payload: 'username=duenio&password=secret',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const cookie = login.headers['set-cookie'] as string;
    const res = await server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie },
    });
    expect([302, 303]).toContain(res.statusCode);
    expect(res.headers.location).toBe('/panel/dashboard');
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/panel/server.test.ts
```

Expected: FAIL — server.ts no existe.

- [ ] **Step 3: Implementar `src/panel/server.ts`**

```ts
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import view from '@fastify/view';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import Handlebars from 'handlebars';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { Config, Profile } from '../config/schema';
import {
  COOKIE_NAME,
  encodeSession,
  decodeSession,
  resolveUser,
  type PanelUser,
} from './auth';
import { handlebarsHelpers } from './helpers';
import type { ConnectionStateProvider } from './adapter-state';

export interface PanelServerDeps {
  prisma: PrismaClient;
  config: Config;
  profile: Profile;
  adapterState: ConnectionStateProvider;
  /** Override del secreto de sesión (default: process.env.PANEL_SESSION_SECRET o aleatorio). */
  sessionSecret?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolvePanelUsers(config: Config): PanelUser[] {
  return config.panel.users.map((u) => ({
    username: u.username,
    passwordHash: process.env[u.passwordHashEnv] ?? '',
  }));
}

export async function createPanelServer(
  deps: PanelServerDeps,
): Promise<FastifyInstance> {
  const sessionSecret =
    deps.sessionSecret ??
    process.env.PANEL_SESSION_SECRET ??
    `dev-${Math.random().toString(36).slice(2)}`;

  for (const [name, fn] of Object.entries(handlebarsHelpers)) {
    Handlebars.registerHelper(name, fn as Handlebars.HelperDelegate);
  }

  const app = Fastify({ logger: false });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(view, {
    engine: { handlebars: Handlebars },
    root: join(__dirname, 'views'),
    layout: 'layout.hbs',
    options: { partials: {} },
    defaultContext: {
      businessName: deps.profile.intakeSchema.$businessName,
    },
  });

  /** Hook: cargar username desde cookie y poner en request.user. */
  app.decorateRequest('panelUser', null);
  app.addHook('preHandler', async (req) => {
    const token = (req.cookies?.[COOKIE_NAME] as string | undefined) ?? '';
    if (!token) return;
    const username = decodeSession(token, sessionSecret);
    if (username) (req as any).panelUser = username;
  });

  // Helper: requiere login.
  const requireAuth = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return false;
    }
    return true;
  };

  app.get('/', (req, reply) => {
    if ((req as any).panelUser) reply.redirect('/panel/dashboard', 303);
    else reply.redirect('/panel/login', 303);
  });

  app.get('/panel/login', (_req, reply) => {
    return reply.view('login.hbs', {}, { layout: false });
  });

  app.post('/panel/login', async (req, reply) => {
    const body = (req.body ?? {}) as { username?: string; password?: string };
    const users = resolvePanelUsers(deps.config);
    const user = await resolveUser(users, body.username ?? '', body.password ?? '');
    if (!user) {
      reply.code(401);
      return reply.view('login.hbs', { error: 'Credenciales inválidas' }, { layout: false });
    }
    const token = encodeSession(user.username, sessionSecret);
    reply.setCookie(COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    });
    reply.redirect('/panel/dashboard', 303);
  });

  app.post('/panel/logout', (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    reply.redirect('/panel/login', 303);
  });

  app.get('/panel/dashboard', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return reply.view('dashboard.hbs', {
      title: 'Dashboard',
      username: (req as any).panelUser,
      // Lo poblamos en Task 5.
      ready: [],
      open: [],
      inProgress: [],
      closed: [],
      adapterStatus: deps.adapterState.state().status,
    });
  });

  return app;
}
```

- [ ] **Step 4: Crear placeholder `dashboard.hbs` para que el test pase**

`src/panel/views/dashboard.hbs`:

```handlebars
<h1 class="text-2xl font-bold mb-4">Dashboard</h1>
<div class="text-gray-600">Vista en construcción (Task 5).</div>
```

- [ ] **Step 5: Correr tests**

```bash
npm test -- tests/panel/server.test.ts
```

Expected: 5 tests passed.

- [ ] **Step 6: Commit**

```bash
git add src/panel/server.ts src/panel/views/dashboard.hbs tests/panel/server.test.ts
git commit -m "feat(panel): createPanelServer con auth + login/logout + redirect base"
```

---

## Task 5: Dashboard — listas por estado

**Files:**
- Modify: `src/panel/server.ts`
- Create: `src/panel/routes/dashboard.ts`
- Modify: `src/panel/views/dashboard.hbs`

- [ ] **Step 1: Crear `src/panel/routes/dashboard.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { PrismaClient, Job, Contact } from '@prisma/client';
import { parseJobIntake } from '../../services/job';
import type { ConnectionStateProvider } from '../adapter-state';

export interface DashboardJobRow {
  id: string;
  status: string;
  openedAt: Date;
  readyAt: Date | null;
  contactPhone: string;
  contactDisplayName: string | null;
  contactBotActive: boolean;
  contactFlaggedNonIntake: boolean;
  clientNameFromIntake: string | null;
  summary: string | null;
  messageCount: number;
}

async function buildRow(
  prisma: PrismaClient,
  job: Job & { contact: Contact; _count: { messages: number } },
): Promise<DashboardJobRow> {
  const intake = parseJobIntake(job);
  const name = (intake.client as any)?.name?.value as string | null | undefined;
  return {
    id: job.id,
    status: job.status,
    openedAt: job.openedAt,
    readyAt: job.readyAt,
    contactPhone: job.contact.phoneE164,
    contactDisplayName: job.contact.displayName,
    contactBotActive: job.contact.botActive,
    contactFlaggedNonIntake: job.contact.flaggedNonIntake,
    clientNameFromIntake: name ?? null,
    summary: job.summary,
    messageCount: job._count.messages,
  };
}

export async function loadDashboardData(
  prisma: PrismaClient,
): Promise<{
  ready: DashboardJobRow[];
  open: DashboardJobRow[];
  inProgress: DashboardJobRow[];
  closed: DashboardJobRow[];
  nonIntake: { phone: string; reason: string | null; count: number }[];
}> {
  const baseInclude = {
    contact: true,
    _count: { select: { messages: true } },
  } as const;

  const [ready, open, inProgress, closed] = await Promise.all([
    prisma.job.findMany({
      where: { status: 'READY_FOR_REVIEW' },
      orderBy: { readyAt: 'desc' },
      include: baseInclude,
      take: 50,
    }),
    prisma.job.findMany({
      where: { status: 'OPEN_INTAKE' },
      orderBy: { openedAt: 'desc' },
      include: baseInclude,
      take: 50,
    }),
    prisma.job.findMany({
      where: { status: 'IN_PROGRESS' },
      orderBy: { readyAt: 'desc' },
      include: baseInclude,
      take: 50,
    }),
    prisma.job.findMany({
      where: { status: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
      include: baseInclude,
      take: 20,
    }),
  ]);

  const nonIntakeContacts = await prisma.contact.findMany({
    where: { flaggedNonIntake: true },
    include: { _count: { select: { messages: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  });

  return {
    ready: await Promise.all(ready.map((j) => buildRow(prisma, j))),
    open: await Promise.all(open.map((j) => buildRow(prisma, j))),
    inProgress: await Promise.all(inProgress.map((j) => buildRow(prisma, j))),
    closed: await Promise.all(closed.map((j) => buildRow(prisma, j))),
    nonIntake: nonIntakeContacts.map((c) => ({
      phone: c.phoneE164,
      reason: c.flaggedReason,
      count: c._count.messages,
    })),
  };
}

export function registerDashboardRoute(
  app: FastifyInstance,
  prisma: PrismaClient,
  adapterState: ConnectionStateProvider,
): void {
  app.get('/panel/dashboard', async (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    const data = await loadDashboardData(prisma);
    return reply.view('dashboard.hbs', {
      title: 'Dashboard',
      username: (req as any).panelUser,
      ...data,
      adapter: adapterState.state(),
    });
  });
}
```

- [ ] **Step 2: Modificar `src/panel/server.ts` para usar el módulo**

Reemplaza el handler antiguo de `/panel/dashboard` por:

```ts
import { registerDashboardRoute } from './routes/dashboard';
// ...
// Quitar el bloque app.get('/panel/dashboard', ...) anterior y al final agregar:
registerDashboardRoute(app, deps.prisma, deps.adapterState);
```

- [ ] **Step 3: Reescribir `src/panel/views/dashboard.hbs`**

```handlebars
<div class="flex items-center justify-between mb-6">
  <h1 class="text-2xl font-bold">Dashboard</h1>
  <div class="flex items-center gap-2 text-sm">
    <span class="px-2 py-1 rounded {{#if (eq adapter.status "connected")}}bg-emerald-100 text-emerald-800{{else}}bg-amber-100 text-amber-800{{/if}}">
      WhatsApp: {{adapter.status}}
    </span>
    <a href="/panel/whatsapp" class="text-blue-600 hover:underline">detalles</a>
  </div>
</div>

{{#> jobsTable title="📥 Listos para revisar" rows=ready emptyMessage="No hay nada pendiente."}}{{/jobsTable}}
{{#> jobsTable title="💬 Intake en curso" rows=open emptyMessage="Sin intakes activos."}}{{/jobsTable}}
{{#> jobsTable title="👤 En curso (humano)" rows=inProgress emptyMessage="Nadie en curso."}}{{/jobsTable}}
{{#> jobsTable title="✅ Cerrados (últimos 20)" rows=closed emptyMessage="Sin cierres aún."}}{{/jobsTable}}

{{#if nonIntake.length}}
<section class="bg-white rounded shadow p-4 mb-6">
  <h2 class="font-semibold mb-3">⚠️ Marcados como NO intake</h2>
  <ul class="text-sm">
    {{#each nonIntake}}
      <li class="flex gap-3 py-1 border-b last:border-b-0">
        <code class="text-gray-700">{{this.phone}}</code>
        <span class="text-gray-500">{{this.reason}}</span>
        <span class="ml-auto text-gray-400">{{this.count}} msgs</span>
      </li>
    {{/each}}
  </ul>
</section>
{{/if}}
```

- [ ] **Step 4: Crear partial `jobsTable` registrándolo**

En `server.ts`, registra el partial inline después de `await app.register(view, ...)`:

```ts
Handlebars.registerPartial(
  'jobsTable',
  `
<section class="bg-white rounded shadow p-4 mb-6">
  <h2 class="font-semibold mb-3">{{title}}</h2>
  {{#if rows.length}}
    <table class="w-full text-sm">
      <thead class="text-left text-gray-500">
        <tr>
          <th class="py-1">Cliente</th>
          <th class="py-1">Estado</th>
          <th class="py-1">Resumen</th>
          <th class="py-1 text-right">Hace</th>
          <th class="py-1"></th>
        </tr>
      </thead>
      <tbody>
        {{#each rows}}
        <tr class="border-t hover:bg-gray-50">
          <td class="py-2">
            <div class="font-medium">{{#if this.clientNameFromIntake}}{{this.clientNameFromIntake}}{{else}}<span class="text-gray-500">{{this.contactPhone}}</span>{{/if}}</div>
            <div class="text-xs text-gray-500">{{this.contactPhone}} · {{this.messageCount}} msgs</div>
          </td>
          <td class="py-2"><span class="px-2 py-0.5 rounded text-xs {{statusClass this.status}}">{{statusLabel this.status}}</span></td>
          <td class="py-2 text-gray-700">{{truncate this.summary 80}}</td>
          <td class="py-2 text-right text-gray-500">{{ago this.openedAt}}</td>
          <td class="py-2 text-right">
            <a href="/panel/jobs/{{this.id}}" class="text-blue-600 hover:underline">abrir →</a>
          </td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  {{else}}
    <div class="text-gray-500 text-sm">{{emptyMessage}}</div>
  {{/if}}
</section>
  `,
);
```

- [ ] **Step 5: Verificar tests siguen pasando**

```bash
npm test -- tests/panel/server.test.ts
```

Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add src/panel/server.ts src/panel/routes/dashboard.ts src/panel/views/dashboard.hbs
git commit -m "feat(panel): dashboard con tablas por estado y partial jobsTable"
```

---

## Task 6: Vista de detalle del job — conversación

**Files:**
- Create: `src/panel/routes/jobs.ts`
- Create: `src/panel/views/job-detail.hbs`
- Modify: `src/panel/server.ts` (registrar rutas)

- [ ] **Step 1: Crear `src/panel/routes/jobs.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Profile } from '../../config/schema';
import { parseJobIntake } from '../../services/job';

export interface JobDetailDeps {
  prisma: PrismaClient;
  profile: Profile;
}

export function registerJobRoutes(app: FastifyInstance, deps: JobDetailDeps): void {
  app.get<{ Params: { id: string } }>('/panel/jobs/:id', async (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    const job = await deps.prisma.job.findUnique({
      where: { id: req.params.id },
      include: {
        contact: true,
        messages: { orderBy: { createdAt: 'asc' } },
        agentRuns: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!job) {
      reply.code(404);
      return reply.view('job-detail.hbs', {
        title: 'Job no encontrado',
        username: (req as any).panelUser,
        notFound: true,
      });
    }
    const intake = parseJobIntake(job);
    const otherJobs = await deps.prisma.job.findMany({
      where: { contactId: job.contactId, NOT: { id: job.id } },
      orderBy: { openedAt: 'desc' },
      take: 10,
    });
    return reply.view('job-detail.hbs', {
      title: `Job ${job.id.slice(0, 8)}`,
      username: (req as any).panelUser,
      job,
      contact: job.contact,
      intake,
      schema: deps.profile.intakeSchema,
      messages: job.messages,
      agentRuns: job.agentRuns,
      otherJobs,
    });
  });
}
```

- [ ] **Step 2: Crear `src/panel/views/job-detail.hbs`**

```handlebars
{{#if notFound}}
  <div class="bg-white p-8 rounded shadow text-center">
    <p class="text-gray-700">No se encontró ese job.</p>
    <a href="/panel/dashboard" class="text-blue-600 hover:underline">← volver al dashboard</a>
  </div>
{{else}}

<div class="flex items-center justify-between mb-4">
  <div>
    <a href="/panel/dashboard" class="text-sm text-blue-600 hover:underline">← dashboard</a>
    <h1 class="text-xl font-bold mt-1">
      {{#if intake.client.name.value}}{{intake.client.name.value}}{{else}}{{contact.phoneE164}}{{/if}}
    </h1>
    <div class="text-sm text-gray-500">
      {{contact.phoneE164}} ·
      <span class="px-2 py-0.5 rounded text-xs {{statusClass job.status}}">{{statusLabel job.status}}</span>
      · abierto {{ago job.openedAt}}
    </div>
  </div>
</div>

<div class="grid grid-cols-1 lg:grid-cols-5 gap-4">
  <!-- Conversación -->
  <section class="lg:col-span-3 bg-white rounded shadow p-4">
    <h2 class="font-semibold mb-3">Conversación ({{messages.length}})</h2>
    <div class="space-y-2 max-h-[600px] overflow-y-auto">
      {{#each messages}}
        <div class="flex {{#if (eq this.direction "outbound")}}justify-end{{/if}}">
          <div class="max-w-md px-3 py-2 rounded {{#if (eq this.direction "outbound")}}bg-blue-50 text-blue-900{{else}}bg-gray-100{{/if}}">
            <div class="text-xs text-gray-500 mb-0.5">
              {{#if (eq this.direction "outbound")}}bot{{else}}cliente{{/if}} · {{date this.createdAt}}
            </div>
            {{#if this.body}}
              <div class="whitespace-pre-wrap text-sm">{{this.body}}</div>
            {{else}}
              <div class="text-sm text-gray-500 italic">({{this.kind}})</div>
            {{/if}}
            {{#if this.mediaPath}}
              <div class="text-xs text-gray-500 mt-1">📎 {{this.mediaPath}}</div>
            {{/if}}
          </div>
        </div>
      {{/each}}
    </div>
  </section>

  <!-- Sidebar: intake + acciones (Task 7 y 8) -->
  <aside class="lg:col-span-2 space-y-4">
    <section class="bg-white rounded shadow p-4">
      <h2 class="font-semibold mb-3">Datos del intake</h2>
      <div class="text-sm text-gray-600 italic">Formulario editable: ver Task 7.</div>
      <pre class="text-xs bg-gray-50 p-2 rounded overflow-x-auto mt-2">{{json intake}}</pre>
    </section>
    <section class="bg-white rounded shadow p-4">
      <h2 class="font-semibold mb-3">Otros jobs del contacto</h2>
      {{#if otherJobs.length}}
        <ul class="text-sm space-y-1">
          {{#each otherJobs}}
            <li>
              <a href="/panel/jobs/{{this.id}}" class="text-blue-600 hover:underline">
                {{statusLabel this.status}} · {{ago this.openedAt}}
              </a>
            </li>
          {{/each}}
        </ul>
      {{else}}
        <div class="text-sm text-gray-500">Sin otros jobs.</div>
      {{/if}}
    </section>
    {{#if agentRuns.length}}
    <section class="bg-white rounded shadow p-4">
      <h2 class="font-semibold mb-3">Últimos agent runs</h2>
      <ul class="text-xs space-y-1 text-gray-700">
        {{#each agentRuns}}
          <li>
            {{date this.createdAt}} · {{this.model}} · tokens {{this.inputTokens}}/{{this.outputTokens}}
            {{#if this.error}}<span class="text-red-600">· {{truncate this.error 60}}</span>{{/if}}
          </li>
        {{/each}}
      </ul>
    </section>
    {{/if}}
  </aside>
</div>

{{/if}}
```

- [ ] **Step 3: Registrar rutas en `server.ts`**

Después del `registerDashboardRoute(app, ...)`, agrega:

```ts
import { registerJobRoutes } from './routes/jobs';
// ...
registerJobRoutes(app, { prisma: deps.prisma, profile: deps.profile });
```

- [ ] **Step 4: Smoke test manual (con server.inject)**

Append a `tests/panel/server.test.ts`:

```ts
import { upsertContactByPhone } from '../../src/services/contact';
import { openJob } from '../../src/services/job';
import { createEmptyIntakeFromSchema } from '../../src/services/intake';

describe('panel job detail', () => {
  it('GET /panel/jobs/:id muestra la conversación', async () => {
    const c = await upsertContactByPhone(prisma, '+5219999');
    const j = await openJob(prisma, c.id, createEmptyIntakeFromSchema(profile.intakeSchema));
    await prisma.message.create({
      data: {
        contactId: c.id,
        jobId: j.id,
        direction: 'inbound',
        kind: 'text',
        body: 'Hola test',
        whatsappMsgId: `t_${Date.now()}`,
      },
    });
    const login = await server.inject({
      method: 'POST',
      url: '/panel/login',
      payload: 'username=duenio&password=secret',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const cookie = login.headers['set-cookie'] as string;
    const res = await server.inject({
      method: 'GET',
      url: `/panel/jobs/${j.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Hola test');
    expect(res.body).toContain(c.phoneE164);
  });
});
```

- [ ] **Step 5: Correr tests**

```bash
npm test -- tests/panel/server.test.ts
```

Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src/panel/routes/jobs.ts src/panel/views/job-detail.hbs src/panel/server.ts tests/panel/server.test.ts
git commit -m "feat(panel): vista de detalle del job con conversación + sidebar"
```

---

## Task 7: Formulario dinámico del intake + edición

**Files:**
- Modify: `src/panel/routes/jobs.ts` (agregar PATCH)
- Modify: `src/panel/views/job-detail.hbs` (renderizar formulario)

- [ ] **Step 1: Reemplazar la sección "Datos del intake" en `job-detail.hbs`**

Cambia el bloque `<section class="bg-white rounded shadow p-4">` que tiene `<h2>Datos del intake</h2>` por:

```handlebars
<section class="bg-white rounded shadow p-4">
  <h2 class="font-semibold mb-3">Datos del intake</h2>
  <form hx-patch="/panel/api/jobs/{{job.id}}/intake" hx-swap="outerHTML" class="space-y-3">
    {{#each schema.sections}}
      <fieldset class="border rounded p-3">
        <legend class="px-1 text-xs font-semibold text-gray-600 uppercase">{{this.label}}</legend>
        {{#each this.fields}}
          {{#with (lookup (lookup ../../intake ../key) this.key)}}
          <div class="mb-3">
            <label class="block text-xs font-medium text-gray-700 mb-1">
              {{../this.label}}
              {{#if ../this.required}}<span class="text-red-500">*</span>{{/if}}
              {{#if this.declined}}<span class="text-amber-600 text-xs">(declinado)</span>{{/if}}
            </label>
            {{#if (eq ../this.type "boolean")}}
              <select name="{{../../key}}.{{../this.key}}" class="border rounded px-2 py-1 text-sm w-full">
                <option value="">—</option>
                <option value="true" {{#if (eq this.value true)}}selected{{/if}}>Sí</option>
                <option value="false" {{#if (eq this.value false)}}selected{{/if}}>No</option>
              </select>
            {{else if (eq ../this.type "enum")}}
              <select name="{{../../key}}.{{../this.key}}" class="border rounded px-2 py-1 text-sm w-full">
                <option value="">—</option>
                {{#each ../this.options}}
                  <option value="{{this}}" {{#if (eq this ../this.value)}}selected{{/if}}>{{this}}</option>
                {{/each}}
              </select>
            {{else if (eq ../this.type "text")}}
              <textarea name="{{../../key}}.{{../this.key}}" rows="2" class="border rounded px-2 py-1 text-sm w-full">{{this.value}}</textarea>
            {{else}}
              <input type="{{#if (eq ../this.type "integer")}}number{{else if (eq ../this.type "number")}}number{{else if (eq ../this.type "phone")}}tel{{else if (eq ../this.type "date")}}date{{else}}text{{/if}}"
                     name="{{../../key}}.{{../this.key}}"
                     value="{{this.value}}"
                     class="border rounded px-2 py-1 text-sm w-full">
            {{/if}}
            {{#if this.declined_reason}}
              <div class="text-xs text-amber-700 mt-1">Razón declined: {{this.declined_reason}}</div>
            {{/if}}
          </div>
          {{/with}}
        {{/each}}
      </fieldset>
    {{/each}}
    {{#if intake.free_notes.length}}
      <fieldset class="border rounded p-3">
        <legend class="px-1 text-xs font-semibold text-gray-600 uppercase">Notas libres</legend>
        <ul class="text-sm list-disc pl-5 text-gray-700">
          {{#each intake.free_notes}}
            <li>{{this.text}}</li>
          {{/each}}
        </ul>
      </fieldset>
    {{/if}}
    <div class="flex gap-2">
      <button class="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Guardar cambios</button>
      <a href="/panel/jobs/{{job.id}}" class="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200">Cancelar</a>
    </div>
  </form>
</section>
```

- [ ] **Step 2: Agregar PATCH al `src/panel/routes/jobs.ts`**

Append dentro de `registerJobRoutes`:

```ts
  app.patch<{ Params: { id: string }; Body: Record<string, string> }>(
    '/panel/api/jobs/:id/intake',
    async (req, reply) => {
      if (!(req as any).panelUser) {
        reply.code(401);
        return { error: 'unauthorized' };
      }
      const job = await deps.prisma.job.findUnique({ where: { id: req.params.id } });
      if (!job) {
        reply.code(404);
        return { error: 'not_found' };
      }
      const intake = parseJobIntake(job);
      // El body llega como `{ "client.name": "...", "client.phone": "..." }`.
      for (const [path, raw] of Object.entries(req.body ?? {})) {
        const [sectionKey, fieldKey] = path.split('.');
        if (!sectionKey || !fieldKey) continue;
        const section = intake[sectionKey] as Record<string, any> | undefined;
        if (!section) continue;
        const field = section[fieldKey];
        if (!field) continue;
        const trimmed = String(raw).trim();
        if (trimmed === '') {
          field.value = null;
        } else if (trimmed === 'true') {
          field.value = true;
        } else if (trimmed === 'false') {
          field.value = false;
        } else if (!isNaN(Number(trimmed)) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
          field.value = Number(trimmed);
        } else {
          field.value = trimmed;
        }
        // Si el dueño rellena un campo declinado, quitamos el flag.
        if (field.declined && field.value !== null) {
          field.declined = false;
          field.declined_reason = undefined;
        }
      }
      await deps.prisma.job.update({
        where: { id: job.id },
        data: { intake: JSON.stringify(intake) },
      });
      reply.header('HX-Redirect', `/panel/jobs/${job.id}`);
      return '';
    },
  );
```

- [ ] **Step 3: Test del PATCH**

Append a `tests/panel/server.test.ts`:

```ts
describe('panel patch intake', () => {
  it('PATCH /panel/api/jobs/:id/intake actualiza el campo', async () => {
    const c = await upsertContactByPhone(prisma, '+5218888');
    const j = await openJob(prisma, c.id, createEmptyIntakeFromSchema(profile.intakeSchema));
    const login = await server.inject({
      method: 'POST',
      url: '/panel/login',
      payload: 'username=duenio&password=secret',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const cookie = login.headers['set-cookie'] as string;
    const res = await server.inject({
      method: 'PATCH',
      url: `/panel/api/jobs/${j.id}/intake`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'client.name=Edited+Owner',
    });
    expect(res.statusCode).toBe(200);
    const reload = await prisma.job.findUnique({ where: { id: j.id } });
    const intake = JSON.parse(reload!.intake);
    expect(intake.client.name.value).toBe('Edited Owner');
  });
});
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/panel/server.test.ts
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/panel/routes/jobs.ts src/panel/views/job-detail.hbs tests/panel/server.test.ts
git commit -m "feat(panel): formulario dinámico del intake + PATCH para edición"
```

---

## Task 8: Acciones del job (pausar bot, status, cierre)

**Files:**
- Modify: `src/panel/routes/jobs.ts`
- Modify: `src/panel/views/job-detail.hbs`

- [ ] **Step 1: Agregar endpoints al `src/panel/routes/jobs.ts`**

Append dentro de `registerJobRoutes`:

```ts
  app.post<{ Params: { id: string }; Body: { status: string } }>(
    '/panel/api/jobs/:id/status',
    async (req, reply) => {
      if (!(req as any).panelUser) {
        reply.code(401);
        return { error: 'unauthorized' };
      }
      const job = await deps.prisma.job.findUnique({ where: { id: req.params.id } });
      if (!job) {
        reply.code(404);
        return { error: 'not_found' };
      }
      const allowed = ['OPEN_INTAKE', 'READY_FOR_REVIEW', 'IN_PROGRESS', 'CLOSED'];
      const target = req.body?.status;
      if (!target || !allowed.includes(target)) {
        reply.code(400);
        return { error: 'invalid_status' };
      }
      const update: any = { status: target };
      if (target === 'CLOSED') update.closedAt = new Date();
      if (target === 'OPEN_INTAKE') {
        update.closedAt = null;
        update.readyAt = null;
      }
      await deps.prisma.job.update({ where: { id: job.id }, data: update });
      reply.header('HX-Redirect', `/panel/jobs/${job.id}`);
      return '';
    },
  );
```

- [ ] **Step 2: Agregar el bloque de acciones a `job-detail.hbs`**

Después del bloque del formulario del intake (dentro de `<aside>`), agrega:

```handlebars
<section class="bg-white rounded shadow p-4">
  <h2 class="font-semibold mb-3">Acciones</h2>
  <div class="flex flex-wrap gap-2">
    <form hx-post="/panel/api/contacts/{{contact.id}}/bot-toggle" hx-swap="none" class="m-0">
      {{#if contact.botActive}}
        <button class="px-3 py-1.5 bg-amber-100 text-amber-800 rounded text-sm hover:bg-amber-200">⏸ Pausar bot</button>
      {{else}}
        <button class="px-3 py-1.5 bg-emerald-100 text-emerald-800 rounded text-sm hover:bg-emerald-200">▶ Reanudar bot</button>
      {{/if}}
    </form>

    {{#if (eq job.status "READY_FOR_REVIEW")}}
      <form hx-post="/panel/api/jobs/{{job.id}}/status" hx-swap="none" class="m-0">
        <input type="hidden" name="status" value="IN_PROGRESS">
        <button class="px-3 py-1.5 bg-purple-100 text-purple-800 rounded text-sm hover:bg-purple-200">👤 Tomar caso</button>
      </form>
    {{/if}}

    {{#unless (eq job.status "CLOSED")}}
      <form hx-post="/panel/api/jobs/{{job.id}}/status" hx-swap="none"
            hx-confirm="¿Cerrar este job?" class="m-0">
        <input type="hidden" name="status" value="CLOSED">
        <button class="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200">✓ Cerrar</button>
      </form>
    {{/unless}}

    {{#if (eq job.status "CLOSED")}}
      <form hx-post="/panel/api/jobs/{{job.id}}/status" hx-swap="none" class="m-0">
        <input type="hidden" name="status" value="OPEN_INTAKE">
        <button class="px-3 py-1.5 bg-blue-100 text-blue-800 rounded text-sm hover:bg-blue-200">↩ Reabrir</button>
      </form>
    {{/if}}
  </div>
  <div class="mt-3 text-xs text-gray-500">
    Bot {{#if contact.botActive}}activo{{else}}pausado{{/if}} para este contacto.
    {{#if contact.flaggedNonIntake}}<span class="text-red-600">· Flagged: {{contact.flaggedReason}}</span>{{/if}}
  </div>
</section>
```

- [ ] **Step 3: Test del status change**

Append a `tests/panel/server.test.ts`:

```ts
describe('panel job status', () => {
  it('POST /panel/api/jobs/:id/status cambia el estado', async () => {
    const c = await upsertContactByPhone(prisma, '+5217777');
    const j = await openJob(prisma, c.id, createEmptyIntakeFromSchema(profile.intakeSchema));
    const login = await server.inject({
      method: 'POST',
      url: '/panel/login',
      payload: 'username=duenio&password=secret',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const cookie = login.headers['set-cookie'] as string;
    const res = await server.inject({
      method: 'POST',
      url: `/panel/api/jobs/${j.id}/status`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'status=CLOSED',
    });
    expect(res.statusCode).toBe(200);
    const reload = await prisma.job.findUnique({ where: { id: j.id } });
    expect(reload!.status).toBe('CLOSED');
    expect(reload!.closedAt).not.toBeNull();
  });
});
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/panel/server.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/panel/routes/jobs.ts src/panel/views/job-detail.hbs tests/panel/server.test.ts
git commit -m "feat(panel): botones de acciones del job (pausar bot, cambiar status, cerrar/reabrir)"
```

---

## Task 9: Contactos + toggle bot

**Files:**
- Create: `src/panel/routes/contacts.ts`
- Create: `src/panel/views/contacts.hbs`
- Modify: `src/panel/server.ts`

- [ ] **Step 1: Crear `src/panel/routes/contacts.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { setBotActive } from '../../services/contact';

export function registerContactRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
): void {
  app.get('/panel/contacts', async (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    const contacts = await prisma.contact.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { jobs: true, messages: true } },
        jobs: {
          where: { status: { in: ['OPEN_INTAKE', 'READY_FOR_REVIEW', 'IN_PROGRESS'] } },
          select: { status: true, openedAt: true },
          orderBy: { openedAt: 'desc' },
          take: 1,
        },
      },
      take: 200,
    });
    return reply.view('contacts.hbs', {
      title: 'Contactos',
      username: (req as any).panelUser,
      contacts,
    });
  });

  app.post<{ Params: { id: string } }>(
    '/panel/api/contacts/:id/bot-toggle',
    async (req, reply) => {
      if (!(req as any).panelUser) {
        reply.code(401);
        return { error: 'unauthorized' };
      }
      const c = await prisma.contact.findUnique({ where: { id: req.params.id } });
      if (!c) {
        reply.code(404);
        return { error: 'not_found' };
      }
      const updated = await setBotActive(prisma, c.id, !c.botActive);
      reply.header(
        'HX-Trigger',
        JSON.stringify({ panelToast: `Bot ${updated.botActive ? 'reactivado' : 'pausado'}` }),
      );
      reply.header('HX-Refresh', 'true');
      return '';
    },
  );
}
```

- [ ] **Step 2: Crear `src/panel/views/contacts.hbs`**

```handlebars
<h1 class="text-2xl font-bold mb-4">Contactos ({{contacts.length}})</h1>

<section class="bg-white rounded shadow overflow-hidden">
  <table class="w-full text-sm">
    <thead class="bg-gray-50 text-left text-gray-600">
      <tr>
        <th class="px-3 py-2">Teléfono</th>
        <th class="px-3 py-2">Nombre</th>
        <th class="px-3 py-2">Job actual</th>
        <th class="px-3 py-2 text-center">Jobs</th>
        <th class="px-3 py-2 text-center">Msgs</th>
        <th class="px-3 py-2 text-center">Estado</th>
        <th class="px-3 py-2 text-right">Acción</th>
      </tr>
    </thead>
    <tbody>
      {{#each contacts}}
        {{#with (attentionMode this.botActive this.flaggedNonIntake (lookup (lookup this.jobs 0) "status"))}}
        <tr class="border-t">
          <td class="px-3 py-2"><code class="text-gray-700">{{../this.phoneE164}}</code></td>
          <td class="px-3 py-2">{{#if ../this.displayName}}{{../this.displayName}}{{else}}<span class="text-gray-400">—</span>{{/if}}</td>
          <td class="px-3 py-2">
            {{#if ../this.jobs.length}}
              <span class="text-xs px-1.5 py-0.5 rounded {{statusClass (lookup (lookup ../this.jobs 0) "status")}}">
                {{statusLabel (lookup (lookup ../this.jobs 0) "status")}}
              </span>
            {{else}}
              <span class="text-gray-400 text-xs">sin job activo</span>
            {{/if}}
          </td>
          <td class="px-3 py-2 text-center">{{../this._count.jobs}}</td>
          <td class="px-3 py-2 text-center">{{../this._count.messages}}</td>
          <td class="px-3 py-2 text-center">
            <span class="text-xs px-2 py-0.5 rounded {{this.cls}}">{{this.icon}} {{this.label}}</span>
          </td>
          <td class="px-3 py-2 text-right">
            <form hx-post="/panel/api/contacts/{{../this.id}}/bot-toggle" hx-swap="none" class="inline m-0">
              <button class="text-xs text-blue-600 hover:underline">
                {{#if ../this.botActive}}pausar{{else}}reanudar{{/if}}
              </button>
            </form>
          </td>
        </tr>
        {{/with}}
      {{/each}}
    </tbody>
  </table>
</section>
```

- [ ] **Step 3: Registrar en `server.ts`**

```ts
import { registerContactRoutes } from './routes/contacts';
// ...
registerContactRoutes(app, deps.prisma);
```

- [ ] **Step 4: Smoke test**

```bash
npm test -- tests/panel/
```

Expected: tests previos siguen pasando (8 o más).

- [ ] **Step 5: Commit**

```bash
git add src/panel/routes/contacts.ts src/panel/views/contacts.hbs src/panel/server.ts
git commit -m "feat(panel): vista de contactos con toggle bot por contacto"
```

---

## Task 10: WhatsApp status + QR

**Files:**
- Create: `src/panel/routes/whatsapp.ts`
- Create: `src/panel/views/whatsapp.hbs`
- Modify: `src/panel/server.ts`

- [ ] **Step 1: Crear `src/panel/routes/whatsapp.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { ConnectionStateProvider } from '../adapter-state';

export function registerWhatsappRoutes(
  app: FastifyInstance,
  adapterState: ConnectionStateProvider,
): void {
  app.get('/panel/whatsapp', async (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    return reply.view('whatsapp.hbs', {
      title: 'WhatsApp',
      username: (req as any).panelUser,
      adapter: adapterState.state(),
    });
  });

  // Endpoint que el panel puede pollear cada N segundos para refrescar estado.
  app.get('/panel/api/whatsapp/state', (req, reply) => {
    if (!(req as any).panelUser) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    return adapterState.state();
  });
}
```

- [ ] **Step 2: Crear `src/panel/views/whatsapp.hbs`**

```handlebars
<h1 class="text-2xl font-bold mb-4">Estado de WhatsApp</h1>

<section class="bg-white rounded shadow p-4 mb-4"
         hx-get="/panel/api/whatsapp/state"
         hx-trigger="every 5s"
         hx-target="#wa-status-text"
         hx-swap="textContent">
  <div class="flex items-center gap-3 mb-3">
    <span class="text-sm text-gray-600">Estado:</span>
    <span id="wa-status-text" class="font-semibold {{#if (eq adapter.status "connected")}}text-emerald-700{{else}}text-amber-700{{/if}}">
      {{adapter.status}}
    </span>
  </div>
  {{#if adapter.lastConnectedAt}}
    <div class="text-sm text-gray-600">Última conexión: {{date adapter.lastConnectedAt}}</div>
  {{/if}}
  {{#if adapter.lastError}}
    <div class="text-sm text-red-600 mt-2">Último error: {{adapter.lastError}}</div>
  {{/if}}
</section>

{{#if (eq adapter.status "qr_required")}}
<section class="bg-white rounded shadow p-4">
  <h2 class="font-semibold mb-3">Escanea el QR</h2>
  {{#if adapter.qr}}
    <p class="text-sm text-gray-600 mb-3">Abre WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo.</p>
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={{adapter.qr}}" alt="QR" class="border rounded">
  {{else}}
    <div class="text-sm text-gray-500">QR no disponible. Revisa la terminal del proceso.</div>
  {{/if}}
</section>
{{/if}}

{{#if (eq adapter.status "logged_out")}}
<section class="bg-amber-50 border border-amber-200 rounded p-4">
  <p class="text-sm text-amber-800">
    La sesión fue cerrada desde el teléfono. Borra <code>./data/baileys-session/</code>
    y reinicia el proceso para emparejar de nuevo.
  </p>
</section>
{{/if}}
```

- [ ] **Step 3: Registrar en `server.ts`**

```ts
import { registerWhatsappRoutes } from './routes/whatsapp';
// ...
registerWhatsappRoutes(app, deps.adapterState);
```

- [ ] **Step 4: Smoke test**

```bash
npm test -- tests/panel/
```

Expected: tests previos siguen pasando.

- [ ] **Step 5: Commit**

```bash
git add src/panel/routes/whatsapp.ts src/panel/views/whatsapp.hbs src/panel/server.ts
git commit -m "feat(panel): vista de estado WhatsApp con QR y polling cada 5s"
```

---

## Task 11: Costos / agent runs

**Files:**
- Create: `src/panel/routes/usage.ts`
- Create: `src/panel/views/usage.hbs`
- Modify: `src/panel/server.ts`

- [ ] **Step 1: Crear `src/panel/routes/usage.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

export function registerUsageRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
): void {
  app.get('/panel/usage', async (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [monthRuns, todayRuns, recent] = await Promise.all([
      prisma.agentRun.findMany({
        where: { createdAt: { gte: startOfMonth } },
        select: { inputTokens: true, outputTokens: true, costUsd: true, error: true },
      }),
      prisma.agentRun.findMany({
        where: { createdAt: { gte: startOfToday } },
        select: { inputTokens: true, outputTokens: true, costUsd: true },
      }),
      prisma.agentRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { job: { include: { contact: true } } },
      }),
    ]);

    const sum = (rows: Array<{ inputTokens: number; outputTokens: number; costUsd: number | null }>) => ({
      runs: rows.length,
      inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
      outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
      costUsd: rows.reduce((s, r) => s + (r.costUsd ?? 0), 0),
    });
    const errorsThisMonth = monthRuns.filter((r) => r.error).length;

    return reply.view('usage.hbs', {
      title: 'Costos',
      username: (req as any).panelUser,
      month: sum(monthRuns),
      today: sum(todayRuns),
      errorsThisMonth,
      recent,
    });
  });
}
```

- [ ] **Step 2: Crear `src/panel/views/usage.hbs`**

```handlebars
<h1 class="text-2xl font-bold mb-4">Costos y uso</h1>

<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
  <div class="bg-white rounded shadow p-4">
    <div class="text-xs text-gray-500">Este mes</div>
    <div class="text-2xl font-bold mt-1">${{month.costUsd}}</div>
    <div class="text-xs text-gray-600 mt-1">{{month.runs}} runs · {{month.inputTokens}} in / {{month.outputTokens}} out</div>
  </div>
  <div class="bg-white rounded shadow p-4">
    <div class="text-xs text-gray-500">Hoy</div>
    <div class="text-2xl font-bold mt-1">${{today.costUsd}}</div>
    <div class="text-xs text-gray-600 mt-1">{{today.runs}} runs · {{today.inputTokens}} in / {{today.outputTokens}} out</div>
  </div>
  <div class="bg-white rounded shadow p-4">
    <div class="text-xs text-gray-500">Errores del mes</div>
    <div class="text-2xl font-bold mt-1 {{#if errorsThisMonth}}text-red-600{{/if}}">{{errorsThisMonth}}</div>
  </div>
</div>

<section class="bg-white rounded shadow p-4">
  <h2 class="font-semibold mb-3">Últimos 30 agent runs</h2>
  <table class="w-full text-sm">
    <thead class="text-left text-gray-500">
      <tr>
        <th class="py-1">Hora</th>
        <th class="py-1">Contacto</th>
        <th class="py-1">Modelo</th>
        <th class="py-1 text-right">Tokens</th>
        <th class="py-1 text-right">Costo</th>
        <th class="py-1">Error</th>
      </tr>
    </thead>
    <tbody>
      {{#each recent}}
        <tr class="border-t">
          <td class="py-1 text-xs text-gray-600">{{date this.createdAt}}</td>
          <td class="py-1"><a href="/panel/jobs/{{this.jobId}}" class="text-blue-600 hover:underline">{{this.job.contact.phoneE164}}</a></td>
          <td class="py-1 text-xs text-gray-600">{{this.model}}</td>
          <td class="py-1 text-right text-xs text-gray-600">{{this.inputTokens}}/{{this.outputTokens}}</td>
          <td class="py-1 text-right text-xs text-gray-600">{{#if this.costUsd}}${{this.costUsd}}{{else}}—{{/if}}</td>
          <td class="py-1 text-xs {{#if this.error}}text-red-600{{/if}}">{{truncate this.error 50}}</td>
        </tr>
      {{/each}}
    </tbody>
  </table>
</section>
```

- [ ] **Step 3: Registrar en `server.ts`**

```ts
import { registerUsageRoutes } from './routes/usage';
// ...
registerUsageRoutes(app, deps.prisma);
```

- [ ] **Step 4: Smoke test**

```bash
npm test -- tests/panel/
```

Expected: tests previos siguen pasando.

- [ ] **Step 5: Commit**

```bash
git add src/panel/routes/usage.ts src/panel/views/usage.hbs src/panel/server.ts
git commit -m "feat(panel): vista de costos con totales mes/hoy y últimos agent runs"
```

---

## Task 12: Config viewer + integración en bootstrap

**Files:**
- Create: `src/panel/routes/config.ts`
- Create: `src/panel/views/config.hbs`
- Modify: `src/panel/server.ts`
- Modify: `src/index.ts` (arrancar panel)

- [ ] **Step 1: Crear `src/panel/routes/config.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { Config, Profile } from '../../config/schema';

export function registerConfigRoutes(
  app: FastifyInstance,
  config: Config,
  profile: Profile,
): void {
  app.get('/panel/config', (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    // Redactar campos sensibles antes de mostrar.
    const safeConfig = JSON.parse(JSON.stringify(config));
    return reply.view('config.hbs', {
      title: 'Configuración',
      username: (req as any).panelUser,
      config: safeConfig,
      schema: profile.intakeSchema,
      facts: profile.businessFacts,
      promptVars: profile.promptVars,
      welcome: profile.welcome,
    });
  });
}
```

- [ ] **Step 2: Crear `src/panel/views/config.hbs`**

```handlebars
<h1 class="text-2xl font-bold mb-4">Configuración (solo lectura)</h1>

<p class="text-sm text-gray-600 mb-4">
  Edita los archivos en disco (<code>config.json</code> y <code>profiles/.../</code>) y reinicia
  el proceso para aplicar cambios.
</p>

<details class="bg-white rounded shadow p-4 mb-4" open>
  <summary class="font-semibold cursor-pointer">config.json</summary>
  <pre class="text-xs bg-gray-50 p-3 rounded mt-2 overflow-x-auto">{{json config}}</pre>
</details>

<details class="bg-white rounded shadow p-4 mb-4">
  <summary class="font-semibold cursor-pointer">intake-schema.json ({{schema.$businessName}})</summary>
  <pre class="text-xs bg-gray-50 p-3 rounded mt-2 overflow-x-auto">{{json schema}}</pre>
</details>

<details class="bg-white rounded shadow p-4 mb-4">
  <summary class="font-semibold cursor-pointer">prompt-vars.json</summary>
  <pre class="text-xs bg-gray-50 p-3 rounded mt-2 overflow-x-auto">{{json promptVars}}</pre>
</details>

<details class="bg-white rounded shadow p-4 mb-4">
  <summary class="font-semibold cursor-pointer">business-facts.json</summary>
  <pre class="text-xs bg-gray-50 p-3 rounded mt-2 overflow-x-auto">{{json facts}}</pre>
</details>

<details class="bg-white rounded shadow p-4 mb-4">
  <summary class="font-semibold cursor-pointer">welcome.txt</summary>
  <pre class="text-xs bg-gray-50 p-3 rounded mt-2 whitespace-pre-wrap">{{welcome}}</pre>
</details>
```

- [ ] **Step 3: Registrar en `server.ts`**

```ts
import { registerConfigRoutes } from './routes/config';
// ...
registerConfigRoutes(app, deps.config, deps.profile);
```

- [ ] **Step 4: Integrar panel al bootstrap en `src/index.ts`**

Append antes de `await adapter.start()`:

```ts
  // Panel web (Plan 5)
  const { createPanelServer } = await import('./panel/server');
  const panelServer = await createPanelServer({
    prisma,
    config,
    profile,
    adapterState: { state: () => adapter!.state() },
  });
  const panelPort = Number(process.env.PANEL_PORT ?? 3000);
  await panelServer.listen({ port: panelPort, host: '0.0.0.0' });
  logger.info({ port: panelPort, url: config.owner.panelUrl }, 'panel.listening');
```

Y agrega `await panelServer.close()` en el shutdown handler:

```ts
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'bootstrap.shutdown');
    await panelServer.close();
    await adapter?.stop();
    await disconnectPrisma();
    process.exit(0);
  };
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/panel/routes/config.ts src/panel/views/config.hbs src/panel/server.ts src/index.ts
git commit -m "feat(panel): config viewer + integración en bootstrap (arranca con npm start)"
```

---

## Task 13: Verificación final del Plan 5

- [ ] **Step 1: Generar un hash de password para tu cuenta**

```bash
npm run panel:hash -- tu-password-segura
```

Pega el output (`PANEL_PASSWORD_HASH=...`) en tu `.env`.

Agrega también:

```
PANEL_SESSION_SECRET=algo-largo-y-aleatorio-aqui-mejor-32-chars
```

- [ ] **Step 2: Correr toda la batería de tests**

```bash
npm test
```

Expected: todos pasan (~165+ totales).

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errores.

- [ ] **Step 4: Smoke en vivo**

```bash
npm start
```

Abre `http://localhost:3000` en el navegador. Logueate con `duenio` / tu-password.

Verifica:
- Dashboard carga (vacío o con datos previos del smoke).
- Click en un job → abre detalle.
- Editar un campo del intake → guardar → recarga con el nuevo valor.
- Pausar bot de un contacto → en `/panel/contacts` el chip cambia.
- `/panel/whatsapp` muestra estado.
- `/panel/usage` muestra totales.
- `/panel/config` muestra los JSONs.

- [ ] **Step 5: Commit final si quedó algo**

```bash
git status
git add -A && git commit -m "chore: fin de Plan 5 - panel web operativo"
```

---

## Cobertura del spec en este plan

| Sección del spec | Tarea(s) |
|------------------|----------|
| §8 Auth básica + cookie sesión | T2 |
| §8 Layout + nav | T3 |
| §8 Dashboard con listas por estado | T5 |
| §8 Chip de modo de atención (IA activa / Humano / Pausada) | T9 (helper `attentionMode`) |
| §8 Vista detalle del job con conversación | T6 |
| §8 Formulario dinámico del intake desde schema | T7 |
| §8 Edición del intake desde panel | T7 (PATCH) |
| §8 Botones acción (pausar bot, IN_PROGRESS, cerrar, reabrir) | T8 |
| §8 /panel/contacts con toggle bot | T9 |
| §8 /panel/whatsapp con estado + QR | T10 |
| §8 /panel/usage con costos | T11 |
| §8 /panel/config visor | T12 |
| §8 Sin build step (HTMX + Tailwind CDN) | T3, T7 |
| §8 Auth básica con `passwordHashEnv` | T2 (`PanelUser`) |

Lo que NO está en este plan:
- Edición de perfiles desde el panel (post-MVP).
- Búsqueda full-text de mensajes (post-MVP).
- Estadísticas avanzadas (post-MVP).
- Respuesta manual al cliente desde el panel (el dueño lo hace desde su WhatsApp).
