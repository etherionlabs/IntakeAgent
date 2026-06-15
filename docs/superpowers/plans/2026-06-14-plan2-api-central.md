# Plan 2 — API Central Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the public REST API (`api/`) that authenticates panel users with JWT and exposes tenant-scoped jobs, contacts, intake editing, usage and a WhatsApp-status proxy — the only public surface of the backend, consumed by the React SPA (Plan 3).

**Architecture:** A new `api/` folder with a Fastify 5 server, sharing the root `prisma/` schema + generated client and reusing the existing tenant-scoped services in `src/services/*`. Auth issues a JWT `{ userId, tenantId, role }` (HS256). Every protected route filters strictly by `request.tenantId` derived from the verified JWT. The API talks to each tenant's worker only through the internal `wa-status` endpoint (server-to-server, with `INTERNAL_API_TOKEN`). Postgres and workers stay internal; only the API publishes a port (3001), fronted by host nginx+TLS.

**Tech Stack:** Fastify 5, `@fastify/jwt`, `@fastify/cors`, `bcryptjs` (already present), `zod` (already present), Prisma 7 + `@prisma/adapter-pg`, vitest (`fileParallelism:false`).

**Reused code (do NOT reimplement):**
- `getPrisma()` from `src/storage/client.ts` (same pg client; each container its own process).
- Job service: `findOpenJobsForContact`, `markReadyForReview`, `closeJob`, `updateJobIntake`, `parseJobIntake`, `JOB_STATUS` from `src/services/job.ts` (all take `(prisma, tenantId, …)`).
- Contact service: `setBotActive` from `src/services/contact.ts` (`(prisma, tenantId, id, active)`).
- Intake service: `bulkUpdate`, `renderIntakeForModel`, `isIntakeComplete` from `src/services/intake.ts`.
- Profile loader: `loadProfile(profileDir)` from `src/config/loader.ts` (returns `{ intakeSchema, … }`).

**Conventions:**
- TypeScript via `tsx` (no build step), ESM.
- Tests live in `api/tests/**` and use a shared helper `api/tests/helpers/app.ts` that builds the Fastify app + seeds a tenant + a panel user, reusing the root `tests/helpers/db.ts` pieces where possible. Run with `DATABASE_URL` inline (Postgres dev on `localhost:5433`).
- Request validation with zod; on failure return `400 { error }`.
- All money/token aggregates come from `AgentRun`.

**Local run:** `DATABASE_URL="postgres://intake:intake@localhost:5433/intake" JWT_SECRET=dev-secret npx tsx api/src/index.ts`

---

### Task 1: API scaffold + health check + test harness

**Files:** `package.json` (deps + scripts), `api/src/db.ts`, `api/src/env.ts`, `api/src/server.ts`, `api/src/index.ts`, `api/tests/helpers/app.ts`, `api/tests/health.test.ts`

- [ ] **Step 1: Install deps**

Run: `npm install @fastify/jwt @fastify/cors`
(Fastify, zod, bcryptjs already present.)

- [ ] **Step 2: Add scripts to `package.json`**

```json
"api:dev": "tsx api/src/index.ts",
"api:create-user": "tsx api/src/cli/create-user.ts",
```

- [ ] **Step 3: `api/src/env.ts`** — typed env access:

```ts
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} no está definida (requerida por la API).`);
  return v;
}
export const PORT = Number(process.env.API_PORT ?? 3001);
export const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';
```

- [ ] **Step 4: `api/src/db.ts`** — reuse the root client:

```ts
export { getPrisma, disconnectPrisma } from '../../src/storage/client';
```

- [ ] **Step 5: `api/src/server.ts`** — app factory (no `.listen` here, so tests can `inject`):

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { CORS_ORIGIN, requireEnv } from './env';

export interface BuildOptions {
  jwtSecret?: string;
}

export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: CORS_ORIGIN, credentials: true });
  await app.register(jwt, { secret: opts.jwtSecret ?? requireEnv('JWT_SECRET') });

  // Decorator: protege rutas y expone request.tenantId / request.authUser.
  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
      request.tenantId = request.user.tenantId;
      request.authUser = request.user;
    } catch {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/health', async () => ({ ok: true }));

  // Las rutas se registran en tasks siguientes:
  // await app.register(authRoutes); await app.register(jobsRoutes); etc.

  return app;
}
```

Add an ambient type augmentation file `api/src/types.d.ts`:
```ts
import '@fastify/jwt';
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
  }
  interface FastifyRequest {
    tenantId: string;
    authUser: { userId: string; tenantId: string; role: string };
  }
}
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string; tenantId: string; role: string };
    user: { userId: string; tenantId: string; role: string };
  }
}
```

- [ ] **Step 6: `api/src/index.ts`** — bootstrap:

```ts
import 'dotenv/config';
import { buildServer } from './server';
import { PORT } from './env';
import { disconnectPrisma } from './db';

async function main() {
  const app = await buildServer();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  const shutdown = async () => { await app.close(); await disconnectPrisma(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 7: `api/tests/helpers/app.ts`** — shared test harness:

```ts
import { buildServer } from '../../src/server';
import { testPrisma, cleanupDb, seedTestTenant, TEST_TENANT_ID } from '../../../tests/helpers/db';
import bcrypt from 'bcryptjs';

export const TEST_JWT_SECRET = 'test-jwt-secret';
export const TEST_USER = { username: 'admin', password: 'pw123456', role: 'admin' };
export { testPrisma, cleanupDb, seedTestTenant, TEST_TENANT_ID };

export async function buildTestApp() {
  return buildServer({ jwtSecret: TEST_JWT_SECRET });
}

/** Limpia, siembra tenant + un PanelUser admin, devuelve el id del user. */
export async function seedTenantAndUser(): Promise<string> {
  await cleanupDb();
  await seedTestTenant();
  const passwordHash = await bcrypt.hash(TEST_USER.password, 8);
  const user = await testPrisma.panelUser.create({
    data: { tenantId: TEST_TENANT_ID, username: TEST_USER.username, passwordHash, role: TEST_USER.role },
  });
  return user.id;
}

/** Devuelve un Bearer token válido para los tests (firmado con el mismo secret). */
export async function authHeader(app: Awaited<ReturnType<typeof buildTestApp>>, userId: string) {
  const token = app.jwt.sign({ userId, tenantId: TEST_TENANT_ID, role: 'admin' });
  return { authorization: `Bearer ${token}` };
}
```

- [ ] **Step 8: `api/tests/health.test.ts`** (write, run, see pass):

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { buildTestApp } from './helpers/app';

describe('health', () => {
  it('GET /health → 200 { ok: true }', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
```

- [ ] **Step 9: Verify**

Run: `DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx vitest run api/tests/health.test.ts` → PASS.
Run: `npm run typecheck` → clean.

- [ ] **Step 10: Commit** `feat(api): scaffold Fastify API with JWT/CORS plugins and test harness` (+ Co-Authored-By trailer).

---

### Task 2: Auth — login + create-user CLI

**Files:** `api/src/routes/auth.ts`, `api/src/cli/create-user.ts`, register in `api/src/server.ts`, `api/tests/auth.test.ts`

- [ ] **Step 1: Failing tests** `api/tests/auth.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTestApp, seedTenantAndUser, TEST_USER, cleanupDb } from './helpers/app';

describe('auth', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  beforeEach(async () => { await seedTenantAndUser(); app = await buildTestApp(); });
  afterAll(async () => { await cleanupDb(); });

  it('login OK devuelve token y user', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: TEST_USER.username, password: TEST_USER.password } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.token).toBe('string');
    expect(body.user.role).toBe('admin');
  });

  it('password incorrecto → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: TEST_USER.username, password: 'wrong' } });
    expect(res.statusCode).toBe(401);
  });

  it('usuario inexistente → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'nope', password: 'x' } });
    expect(res.statusCode).toBe(401);
  });

  it('ruta protegida sin token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/jobs' });
    expect(res.statusCode).toBe(401);
  });
});
```
(The `/jobs` 401 case passes once Task 4 registers it; until then it 404s. Note in the implementer prompt: if `/jobs` isn't registered yet, assert 401-or-404 here and tighten in Task 4. Prefer to keep this test and let Task 4 make it 401.)

- [ ] **Step 2: `api/src/routes/auth.ts`**:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getPrisma } from '../db';

const LoginZ = z.object({ username: z.string().min(1), password: z.string().min(1) });

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (request, reply) => {
    const parse = LoginZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'username y password requeridos' });
    const { username, password } = parse.data;
    const prisma = getPrisma();
    // MVP: username globalmente único (deuda: incluir tenantSlug). findFirst evita ambigüedad determinista.
    const user = await prisma.panelUser.findFirst({ where: { username } });
    if (!user) return reply.code(401).send({ error: 'credenciales inválidas' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'credenciales inválidas' });
    const token = app.jwt.sign({ userId: user.id, tenantId: user.tenantId, role: user.role });
    return { token, user: { id: user.id, username: user.username, role: user.role, tenantId: user.tenantId } };
  });
}
```

- [ ] **Step 3: Register** in `api/src/server.ts` (`await app.register(authRoutes);`).

- [ ] **Step 4: `api/src/cli/create-user.ts`** — operator tool to create a panel user:

```ts
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
```

- [ ] **Step 5: Verify** `DATABASE_URL=... npx vitest run api/tests/auth.test.ts` (the `/jobs` case may 404 until Task 4 — acceptable for now), typecheck clean.

- [ ] **Step 6: Commit** `feat(api): JWT login + create-user CLI`.

---

### Task 3: Profile route (intake schema for the SPA)

**Files:** `api/src/lib/tenant-profile.ts`, `api/src/routes/profile.ts`, register, `api/tests/profile.test.ts`

- [ ] **Step 1: `api/src/lib/tenant-profile.ts`** — load + cache a tenant's profile:

```ts
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
```

- [ ] **Step 2: Failing test** `api/tests/profile.test.ts` — `GET /profile` with auth returns `intakeSchema` with `sections`; without auth → 401.

- [ ] **Step 3: `api/src/routes/profile.ts`**:

```ts
import type { FastifyInstance } from 'fastify';
import { getTenantProfile } from '../lib/tenant-profile';

export async function profileRoutes(app: FastifyInstance) {
  app.get('/profile', { preHandler: app.authenticate }, async (request) => {
    const profile = await getTenantProfile(request.tenantId);
    return { intakeSchema: profile.intakeSchema };
  });
}
```

- [ ] **Step 4: Register, verify, commit** `feat(api): GET /profile exposes tenant intake schema`.

---

### Task 4: Jobs list + detail

**Files:** `api/src/routes/jobs.ts`, register, `api/tests/jobs.test.ts`

- [ ] **Step 1: Failing tests** — seed tenant+user, create a contact + 2 jobs (one OPEN_INTAKE, one CLOSED) with `tenantId`; also create a job under a DIFFERENT tenant and assert it is NEVER returned (isolation). Cases:
  - `GET /jobs` (auth) returns only this tenant's jobs.
  - `GET /jobs?status=OPEN_INTAKE` filters.
  - `GET /jobs/:id` returns `{ job, intake, messages }` (intake parsed object, messages array ordered by createdAt).
  - `GET /jobs/:otherTenantJobId` → 404.

- [ ] **Step 2: `api/src/routes/jobs.ts`** (list + detail):

```ts
import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db';
import { parseJobIntake } from '../../../src/services/job';

export async function jobsRoutes(app: FastifyInstance) {
  app.get('/jobs', { preHandler: app.authenticate }, async (request) => {
    const prisma = getPrisma();
    const status = (request.query as any)?.status as string | undefined;
    const jobs = await prisma.job.findMany({
      where: { tenantId: request.tenantId, ...(status ? { status } : {}) },
      orderBy: { openedAt: 'desc' },
      include: { contact: true },
    });
    return { jobs };
  });

  app.get('/jobs/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const job = await prisma.job.findFirst({ where: { id, tenantId: request.tenantId }, include: { contact: true } });
    if (!job) return reply.code(404).send({ error: 'job no encontrado' });
    const messages = await prisma.message.findMany({
      where: { jobId: job.id, tenantId: request.tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return { job, intake: parseJobIntake(job), messages };
  });
}
```

- [ ] **Step 3: Register, verify (incl. isolation), commit** `feat(api): jobs list + detail (tenant-scoped)`.

---

### Task 5: Job mutations — edit intake + actions

**Files:** extend `api/src/routes/jobs.ts`, `api/tests/job-mutations.test.ts`

- [ ] **Step 1: Failing tests:**
  - `PATCH /jobs/:id/intake` with `{ path: 'client.name', value: 'Ana' }` updates and persists (re-GET shows it).
  - invalid path → 400.
  - `POST /jobs/:id/actions { action: 'close' }` closes (status CLOSED).
  - `POST /jobs/:id/actions { action: 'mark_ready', summary: '...' }` on a job with required fields satisfied → READY_FOR_REVIEW; on incomplete → 400 with a clear error.
  - mutations on another tenant's job → 404.

- [ ] **Step 2: Implementation** — add to `jobsRoutes`:

```ts
import { z } from 'zod';
import { updateJobIntake, markReadyForReview, closeJob } from '../../../src/services/job';
import { bulkUpdate } from '../../../src/services/intake';
import { getTenantProfile } from '../lib/tenant-profile';

const PatchIntakeZ = z.object({
  path: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  declined: z.boolean().optional(),
  declined_reason: z.string().optional(),
});

// inside jobsRoutes(app):
app.patch('/jobs/:id/intake', { preHandler: app.authenticate }, async (request, reply) => {
  const prisma = getPrisma();
  const id = (request.params as any).id as string;
  const parse = PatchIntakeZ.safeParse(request.body);
  if (!parse.success) return reply.code(400).send({ error: parse.error.message });
  const job = await prisma.job.findFirst({ where: { id, tenantId: request.tenantId } });
  if (!job) return reply.code(404).send({ error: 'job no encontrado' });
  const profile = await getTenantProfile(request.tenantId);
  const current = parseJobIntake(job);
  const result = bulkUpdate(profile.intakeSchema, current, [parse.data], { now: new Date().toISOString(), source_message_id: null });
  if (!result.ok) return reply.code(400).send({ error: result.error });
  await updateJobIntake(prisma, request.tenantId, job.id, result.intake);
  return { ok: true, intake: result.intake };
});

const ActionZ = z.object({ action: z.enum(['mark_ready', 'close']), summary: z.string().optional() });

app.post('/jobs/:id/actions', { preHandler: app.authenticate }, async (request, reply) => {
  const prisma = getPrisma();
  const id = (request.params as any).id as string;
  const parse = ActionZ.safeParse(request.body);
  if (!parse.success) return reply.code(400).send({ error: parse.error.message });
  const job = await prisma.job.findFirst({ where: { id, tenantId: request.tenantId } });
  if (!job) return reply.code(404).send({ error: 'job no encontrado' });
  try {
    if (parse.data.action === 'close') {
      const updated = await closeJob(prisma, request.tenantId, job.id);
      return { ok: true, status: updated.status };
    }
    const summary = parse.data.summary ?? job.summary ?? '';
    if (summary.trim().length < 20) return reply.code(400).send({ error: 'mark_ready requiere summary de al menos 20 caracteres' });
    const updated = await markReadyForReview(prisma, request.tenantId, job.id, summary);
    return { ok: true, status: updated.status };
  } catch (e) {
    return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
  }
});
```

- [ ] **Step 3: Verify, commit** `feat(api): edit intake + job actions`.

---

### Task 6: Contacts list + bot toggle

**Files:** `api/src/routes/contacts.ts`, register, `api/tests/contacts.test.ts`

- [ ] **Step 1: Failing tests** — `GET /contacts` returns tenant contacts (and not other tenant's); `PATCH /contacts/:id { botPaused: true }` sets `botActive=false`; `{ botPaused: false }` sets `botActive=true`; other-tenant contact → 404.

- [ ] **Step 2: `api/src/routes/contacts.ts`**:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../db';
import { setBotActive } from '../../../src/services/contact';

const ToggleZ = z.object({ botPaused: z.boolean() });

export async function contactsRoutes(app: FastifyInstance) {
  app.get('/contacts', { preHandler: app.authenticate }, async (request) => {
    const prisma = getPrisma();
    const contacts = await prisma.contact.findMany({ where: { tenantId: request.tenantId }, orderBy: { updatedAt: 'desc' } });
    return { contacts };
  });

  app.patch('/contacts/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const parse = ToggleZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: parse.error.message });
    const existing = await prisma.contact.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!existing) return reply.code(404).send({ error: 'contacto no encontrado' });
    const updated = await setBotActive(prisma, request.tenantId, id, !parse.data.botPaused);
    return { ok: true, contact: updated };
  });
}
```

- [ ] **Step 3: Register, verify, commit** `feat(api): contacts list + bot toggle`.

---

### Task 7: Usage (costs + agent runs)

**Files:** `api/src/routes/usage.ts`, register, `api/tests/usage.test.ts`

- [ ] **Step 1: Failing test** — seed a couple of AgentRun rows (with tenantId, costUsd, tokens) and assert `GET /usage` returns totals (sum cost, sum tokens, run count) and a `recent` array; other tenant's runs excluded.

- [ ] **Step 2: `api/src/routes/usage.ts`**:

```ts
import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db';

export async function usageRoutes(app: FastifyInstance) {
  app.get('/usage', { preHandler: app.authenticate }, async (request) => {
    const prisma = getPrisma();
    const where = { tenantId: request.tenantId };
    const agg = await prisma.agentRun.aggregate({
      where,
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: true,
    });
    const recent = await prisma.agentRun.findMany({ where, orderBy: { createdAt: 'desc' }, take: 30 });
    return {
      totals: {
        runs: agg._count,
        costUsd: agg._sum.costUsd ?? 0,
        inputTokens: agg._sum.inputTokens ?? 0,
        outputTokens: agg._sum.outputTokens ?? 0,
      },
      recent,
    };
  });
}
```

- [ ] **Step 3: Register, verify, commit** `feat(api): usage endpoint`.

---

### Task 8: wa-status proxy → worker internal endpoint

**Files:** `api/src/routes/wa-status.ts`, register, `api/tests/wa-status.test.ts`

The API reaches the tenant's worker by an env-configured URL. MVP single worker: `WORKER_INTERNAL_URL` (e.g. `http://worker-tapiceria:3002`) + `INTERNAL_API_TOKEN`. (Multi-worker resolution by slug is deferred tech debt.)

- [ ] **Step 1: Failing test** — inject a fake fetcher. Make the route use a `fetch`-like dependency that defaults to global `fetch` but is overridable for tests (e.g. read from `app` decorator or module-level injectable). Test: with auth + a stubbed fetcher returning `{ connected:true, qr:null, phone:'' }`, `GET /wa-status` returns that JSON; if `WORKER_INTERNAL_URL` unset → 503 `{ error }`.

- [ ] **Step 2: `api/src/routes/wa-status.ts`**:

```ts
import type { FastifyInstance } from 'fastify';

type Fetcher = typeof fetch;

export async function waStatusRoutes(app: FastifyInstance, opts: { fetcher?: Fetcher } = {}) {
  const doFetch: Fetcher = opts.fetcher ?? fetch;
  app.get('/wa-status', { preHandler: app.authenticate }, async (_request, reply) => {
    const base = process.env.WORKER_INTERNAL_URL;
    const token = process.env.INTERNAL_API_TOKEN;
    if (!base || !token) return reply.code(503).send({ error: 'worker no configurado' });
    try {
      const res = await doFetch(`${base}/internal/wa-status`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) return reply.code(502).send({ error: `worker respondió ${res.status}` });
      return await res.json();
    } catch {
      return reply.code(502).send({ error: 'worker inalcanzable' });
    }
  });
}
```

Register with the injectable fetcher in `buildServer` (allow `BuildOptions.fetcher?`).

- [ ] **Step 3: Verify, commit** `feat(api): wa-status proxy to worker internal endpoint`.

---

### Task 9: Dockerfile.api + compose service

**Files:** `Dockerfile.api`, `docker/api-entrypoint.sh`, edit `docker-compose.yml`, edit `.env.example`

- [ ] **Step 1: `Dockerfile.api`** — mirror `Dockerfile.worker` but start the API:

```dockerfile
FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
COPY docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN chmod +x /usr/local/bin/api-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/api-entrypoint.sh"]
CMD ["npm", "run", "api:dev"]
```

- [ ] **Step 2: `docker/api-entrypoint.sh`** — the API container runs migrations once at deploy (it is the natural place):

```sh
#!/bin/sh
set -e
echo "[api-entrypoint] prisma migrate deploy…"
npx prisma migrate deploy
echo "[api-entrypoint] arrancando API"
exec "$@"
```

- [ ] **Step 3: Add `api` service to `docker-compose.yml`** (the ONLY service with a public port):

```yaml
  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    environment:
      DATABASE_URL: postgres://intake:${POSTGRES_PASSWORD}@postgres:5432/intake
      JWT_SECRET: ${JWT_SECRET}
      INTERNAL_API_TOKEN: ${INTERNAL_API_TOKEN}
      WORKER_INTERNAL_URL: http://worker-tapiceria:3002
      CORS_ORIGIN: ${CORS_ORIGIN}
      API_PORT: 3001
    ports: ["3001:3001"]
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
```
Also, since the API container now runs `migrate deploy`, simplify the worker entrypoint expectation in the runbook (workers still run `migrate deploy` idempotently — that's fine; Prisma advisory-locks).

- [ ] **Step 4: Update `.env.example`** — add `JWT_SECRET=change-me-jwt-secret` and `CORS_ORIGIN=https://<tu-sitio>.netlify.app`.

- [ ] **Step 5: Verify** `docker compose --env-file <temp> config` validates; `docker build -f Dockerfile.api -t intake-api:dev .` succeeds.

- [ ] **Step 6: Commit** `feat(infra): Dockerfile.api + public api service in compose`.

---

### Task 10: Final verification + runbook update

- [ ] **Step 1:** `npm run typecheck` clean; `DATABASE_URL=... npm test` all green (root + api tests).
- [ ] **Step 2: Compose smoke** — `docker compose --env-file <temp> up -d postgres api`, wait, `curl -s localhost:3001/health` → `{"ok":true}`, then create a user via `docker compose run --rm api npm run api:create-user -- tapiceria-demo admin <pw>` and `curl` login → token. Tear down.
- [ ] **Step 3:** Update `docs/runbooks/2026-06-13-plan1-deploy.md` (or add a Plan 2 section): API is the public surface on 3001 behind nginx TLS; how to create the first panel user; CORS origin = Netlify URL; JWT_SECRET rotation note.
- [ ] **Step 4: Commit** `chore(api): final verification + runbook update for API`.

---

## Self-Review

- **Spec §5 coverage:** login+JWT (T2), jobs list/detail (T4), edit intake (T5), actions (T5), contacts+toggle (T6), usage (T7), wa-status proxy (T8), Dockerfile.api (T9), shared `prisma/` schema (T1 db.ts reuse). ✓
- **Isolation:** every protected route filters by `request.tenantId` from the verified JWT; tests assert other-tenant rows are invisible (T4/T5/T6). ✓
- **Tech debt honored:** JWT in localStorage on the SPA (Plan 3); username global-uniqueness for login (documented in T2); single-worker `WORKER_INTERNAL_URL` (T8). ✓
- **Type consistency:** JWT payload `{ userId, tenantId, role }` declared once (T1 types.d.ts) and used identically in auth.ts and authHeader test helper. Service calls use the `(prisma, tenantId, …)` convention throughout.
