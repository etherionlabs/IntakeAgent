# Plan 1 — Infra + Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the worker from SQLite to PostgreSQL, introduce explicit `tenantId` isolation across every table and service, retire the SSR panel from the worker bootstrap, expose a token-protected internal status endpoint, and ship Docker Compose + migration + backup so the bot runs online on a VPS with per-tenant data isolation.

**Architecture:** The existing `src/` code stays the worker. Prisma swaps its driver adapter from `@prisma/adapter-better-sqlite3` to `@prisma/adapter-pg`. Every service/pipeline/agent function gains a mandatory `tenantId: string` parameter (threaded `prisma, tenantId, ...rest`) that filters reads and stamps writes. The worker reads `process.env.TENANT_ID` once at bootstrap and propagates it through `PipelineDeps`/`AgentDeps`. Postgres and the worker never expose public ports; only a future `api/` service (Plan 2) will. `prisma migrate deploy` runs at deploy time; a host cron `pg_dump` provides daily backups.

**Tech Stack:** Node 20+, TypeScript via `tsx`, Prisma 7.8 + `@prisma/adapter-pg` + `pg`, PostgreSQL 16, vitest 4 (`fileParallelism: false`), Fastify 5 (internal status endpoint only), Docker + Docker Compose.

**Reconciliation note (spec §3 vs. real schema):** The spec's data-model section references `CostEntry` and `WaSession` tables that do **not** exist. The real schema has `Contact`, `Job`, `Message`, `AgentRun`, `Notification`, `Setting`. This plan adds `tenantId` to `Contact`, `Job`, `Message`, `AgentRun`, `Notification`. `Setting` stays **global** (it is panel-only config keyed by string; per-tenant settings are deferred tech debt — see spec §9). Cost lives in `AgentRun.costUsd`; the Baileys session lives in a per-worker Docker volume, not a DB table.

**Tenancy threading convention (used by every task):**
- Signature: `tenantId` is the parameter immediately after `prisma`, e.g. `fn(prisma, tenantId, ...rest)`. It is required — never optional, never defaulted.
- Reads: `findUnique({ where: { id } })` → `findFirst({ where: { id, tenantId } })`. `findMany`/`count` add `tenantId` to `where`.
- Writes: `create` adds `tenantId` to `data`. `update({ where: { id } })` → `update({ where: { id, tenantId } })` (Prisma's filtered-unique `where` — GA since Prisma 4.6).
- Upserts/dedup by natural key use `findFirst({ ..., tenantId })`-then-`create` instead of relying on a global unique.

**Incremental discipline:** `tenantId` columns are added **nullable** first (Task 2) so the suite stays green while services are threaded one module at a time (Tasks 3–8). A final migration (Task 9) tightens them to `NOT NULL` and adds per-tenant composite uniques. Every task ends with the full suite green.

**Prerequisite for running tests/migrations locally:** a local PostgreSQL. Start a throwaway one before Task 1:
```bash
docker run -d --name intake-pg-dev -e POSTGRES_DB=intake -e POSTGRES_USER=intake -e POSTGRES_PASSWORD=intake -p 5432:5432 postgres:16
export DATABASE_URL="postgres://intake:intake@localhost:5432/intake"
```
(Windows PowerShell: `$env:DATABASE_URL = "postgres://intake:intake@localhost:5432/intake"`.)

---

### Task 1: Swap DB engine to PostgreSQL + centralize the test DB

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `prisma/schema.prisma:1-7` (datasource provider)
- Modify: `prisma.config.ts:18` (default url)
- Modify: `src/storage/client.ts` (adapter)
- Create: `tests/helpers/db.ts`
- Modify (11 test files): `tests/services/contact.test.ts`, `tests/services/job.test.ts`, `tests/agent/audit.test.ts`, `tests/agent/runner.test.ts`, `tests/agent/tools.test.ts`, `tests/pipeline/idempotency.test.ts`, `tests/pipeline/normalize.test.ts`, `tests/pipeline/resolveContact.test.ts`, `tests/pipeline/resolveJob.test.ts`, `tests/pipeline/coordinator.test.ts`, `tests/panel/server.test.ts`
- Create: `prisma/migrations/` (baseline, generated)

- [ ] **Step 1: Install the Postgres driver + adapter, drop nothing yet**

Run:
```bash
npm install pg @prisma/adapter-pg
npm install -D @types/pg
```
Expected: `package.json` gains `pg` and `@prisma/adapter-pg` under dependencies and `@types/pg` under devDependencies. Leave `better-sqlite3` / `@prisma/adapter-better-sqlite3` installed for now (removed in Task 16 cleanup).

- [ ] **Step 2: Switch the Prisma datasource to postgresql**

In `prisma/schema.prisma`, change the datasource block:
```prisma
datasource db {
  provider = "postgresql"
}
```

- [ ] **Step 3: Point the Prisma CLI config at Postgres**

In `prisma.config.ts`, change line 18:
```ts
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgres://intake:intake@localhost:5432/intake',
  },
```

- [ ] **Step 4: Rewrite the runtime client to use PrismaPg**

Replace the entire contents of `src/storage/client.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

let _client: PrismaClient | null = null;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL no está definida. El worker requiere una conexión PostgreSQL ' +
        '(ej. postgres://intake:***@postgres:5432/intake).',
    );
  }
  return url;
}

export function getPrisma(): PrismaClient {
  if (!_client) {
    const adapter = new PrismaPg({ connectionString: getDatabaseUrl() });
    _client = new PrismaClient({ adapter });
  }
  return _client;
}

export async function disconnectPrisma(): Promise<void> {
  if (_client) {
    await _client.$disconnect();
    _client = null;
  }
}
```

- [ ] **Step 5: Create the central test DB helper**

Create `tests/helpers/db.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const url =
  process.env.DATABASE_URL ?? 'postgres://intake:intake@localhost:5432/intake';

const adapter = new PrismaPg({ connectionString: url });

/** Cliente Prisma compartido por TODOS los tests (vitest corre con fileParallelism:false). */
export const testPrisma = new PrismaClient({ adapter });

/** Borra todas las filas respetando el orden de FKs. Tenant se siembra en Task 2. */
export async function cleanupDb(): Promise<void> {
  await testPrisma.message.deleteMany();
  await testPrisma.agentRun.deleteMany();
  await testPrisma.notification.deleteMany();
  await testPrisma.job.deleteMany();
  await testPrisma.contact.deleteMany();
}
```

- [ ] **Step 6: Migrate the 11 Prisma-using test files to the helper**

In each of the 11 files listed under **Files**, delete the inline adapter/client/cleanup boilerplate (the `import { PrismaClient } ...`, `import { PrismaBetterSqlite3 } ...`, the `const adapter = new PrismaBetterSqlite3(...)`, `const prisma = new PrismaClient({ adapter })`, and any local `async function cleanup() { ... }`) and replace it with a single import. Canonical transformation (example: `tests/services/contact.test.ts`):

Remove:
```ts
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
// ...
const adapter = new PrismaBetterSqlite3({ url: 'file:./data/intake.db' });
const prisma = new PrismaClient({ adapter });

async function cleanup() {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
}
```
Add (all 11 files are at depth 2 under `tests/`, so the relative path is identical):
```ts
import { testPrisma as prisma, cleanupDb as cleanup } from '../helpers/db';
```
Keep every test body, `beforeEach(cleanup)`, and `afterAll` unchanged. If a file's `afterAll` calls `prisma.$disconnect()`, leave it — disconnecting the shared client at the end of a file is harmless because vitest runs files serially and re-imports per file.

- [ ] **Step 7: Generate the Prisma client + baseline migration against Postgres**

Run (with a local Postgres up and `DATABASE_URL` exported per the prerequisite):
```bash
npx prisma migrate dev --name init_postgres
```
Expected: a new `prisma/migrations/<timestamp>_init_postgres/migration.sql` is created with `CREATE TABLE` statements for the current schema, applied to the local DB, and the client is regenerated. No errors.

- [ ] **Step 8: Run the full suite on Postgres**

Run: `npm test`
Expected: all existing tests PASS (same count as before, 243) now backed by PostgreSQL. If a test fails with `relation "..." does not exist`, the migration didn't apply — re-run Step 7.

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json prisma/schema.prisma prisma.config.ts src/storage/client.ts tests/helpers/db.ts tests/services tests/agent tests/pipeline tests/panel prisma/migrations
git commit -m "feat(infra): migrate worker from SQLite to PostgreSQL with shared test DB helper"
```

---

### Task 2: Add Tenant + PanelUser models and nullable tenantId columns

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `tests/helpers/db.ts`
- Create: `tests/services/tenant.test.ts`
- Migration: generated

- [ ] **Step 1: Write a failing test for the seeded tenant**

Create `tests/services/tenant.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma as prisma, cleanupDb, seedTestTenant, TEST_TENANT_ID } from '../helpers/db';

describe('tenant seeding', () => {
  beforeEach(async () => {
    await cleanupDb();
    await seedTestTenant();
  });
  afterAll(() => prisma.$disconnect());

  it('seedTestTenant inserta el tenant de pruebas', async () => {
    const t = await prisma.tenant.findUnique({ where: { id: TEST_TENANT_ID } });
    expect(t).not.toBeNull();
    expect(t?.slug).toBe('test-tenant');
  });

  it('un contacto puede crearse con tenantId', async () => {
    const c = await prisma.contact.create({
      data: { phoneE164: '+5215550000000', tenantId: TEST_TENANT_ID },
    });
    expect(c.tenantId).toBe(TEST_TENANT_ID);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/services/tenant.test.ts`
Expected: FAIL — `prisma.tenant` is undefined / `seedTestTenant` is not exported.

- [ ] **Step 3: Add the models + nullable tenantId columns to the schema**

In `prisma/schema.prisma`, add the two new models and add a nullable `tenantId` + optional relation to the five existing tenant-scoped models. Final relevant content:
```prisma
model Tenant {
  id          String   @id @default(uuid())
  slug        String   @unique
  name        String
  industry    String
  profileDir  String
  createdAt   DateTime @default(now())

  panelUsers    PanelUser[]
  contacts      Contact[]
  jobs          Job[]
  messages      Message[]
  agentRuns     AgentRun[]
  notifications Notification[]
}

model PanelUser {
  id           String   @id @default(uuid())
  tenantId     String
  username     String
  passwordHash String
  role         String   // 'admin' | 'viewer'
  createdAt    DateTime @default(now())

  tenant       Tenant   @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, username])
}
```
Then add to `Contact`, `Job`, `Message`, `AgentRun`, `Notification` (keep all existing fields/indexes):
```prisma
  tenantId  String?
  tenant    Tenant?  @relation(fields: [tenantId], references: [id])
```
Leave `Setting` unchanged (global). Leave existing `@unique`/`@@index`/`@@unique` declarations as they are for now.

- [ ] **Step 4: Generate the migration**

Run: `npx prisma migrate dev --name add_tenancy_nullable`
Expected: migration created and applied; client regenerated; `prisma.tenant` and `prisma.panelUser` now exist.

- [ ] **Step 5: Extend the test helper with tenant seeding**

In `tests/helpers/db.ts`, add (above `cleanupDb`):
```ts
/** Tenant fijo usado por todos los tests que necesitan aislamiento. */
export const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export async function seedTestTenant(): Promise<void> {
  await testPrisma.tenant.upsert({
    where: { id: TEST_TENANT_ID },
    update: {},
    create: {
      id: TEST_TENANT_ID,
      slug: 'test-tenant',
      name: 'Test Tenant',
      industry: 'test',
      profileDir: './profiles/tapiceria',
    },
  });
}
```
And update `cleanupDb` to also clear tenant-scoped auth rows but **keep** the seeded tenant intact between tests by re-seeding (callers do `cleanupDb()` then `seedTestTenant()`). Change `cleanupDb` to:
```ts
export async function cleanupDb(): Promise<void> {
  await testPrisma.message.deleteMany();
  await testPrisma.agentRun.deleteMany();
  await testPrisma.notification.deleteMany();
  await testPrisma.job.deleteMany();
  await testPrisma.contact.deleteMany();
  await testPrisma.panelUser.deleteMany();
  await testPrisma.tenant.deleteMany();
}
```

- [ ] **Step 6: Run the new test**

Run: `npx vitest run tests/services/tenant.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all PASS. Existing tests still insert contacts/jobs without `tenantId` (column is nullable), so they remain green.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/helpers/db.ts tests/services/tenant.test.ts
git commit -m "feat(db): add Tenant + PanelUser models and nullable tenantId columns"
```

---

### Task 3: Thread tenantId through the Contact service

**Files:**
- Modify: `src/services/contact.ts`
- Modify: `tests/services/contact.test.ts`

- [ ] **Step 1: Update the test to require tenantId and assert isolation**

Replace the body of `tests/services/contact.test.ts` (keep the helper import line from Task 1):
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma as prisma, cleanupDb as cleanup, seedTestTenant, TEST_TENANT_ID } from '../helpers/db';
import { upsertContactByPhone, setBotActive, flagNonIntake } from '../../src/services/contact';

const T = TEST_TENANT_ID;

describe('contact service', () => {
  beforeEach(async () => {
    await cleanup();
    await seedTestTenant();
  });
  afterAll(() => prisma.$disconnect());

  it('upsertContactByPhone crea contacto con tenantId y defaults', async () => {
    const c = await upsertContactByPhone(prisma, T, '+5215555555555');
    expect(c.phoneE164).toBe('+5215555555555');
    expect(c.tenantId).toBe(T);
    expect(c.botActive).toBe(true);
    expect(c.flaggedNonIntake).toBe(false);
  });

  it('upsertContactByPhone es idempotente por tenant', async () => {
    const a = await upsertContactByPhone(prisma, T, '+5215555555555');
    const b = await upsertContactByPhone(prisma, T, '+5215555555555');
    expect(a.id).toBe(b.id);
  });

  it('setBotActive cambia el flag', async () => {
    const c = await upsertContactByPhone(prisma, T, '+5215555555555');
    const updated = await setBotActive(prisma, T, c.id, false);
    expect(updated.botActive).toBe(false);
  });

  it('flagNonIntake marca con razón', async () => {
    const c = await upsertContactByPhone(prisma, T, '+5215555555555');
    const updated = await flagNonIntake(prisma, T, c.id, 'spam recurrente');
    expect(updated.flaggedNonIntake).toBe(true);
    expect(updated.flaggedReason).toBe('spam recurrente');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/services/contact.test.ts`
Expected: FAIL — type/arg mismatch (`upsertContactByPhone` takes 2 args, not 3).

- [ ] **Step 3: Rewrite the contact service**

Replace the entire contents of `src/services/contact.ts`:
```ts
import type { PrismaClient, Contact } from '@prisma/client';

export async function upsertContactByPhone(
  prisma: PrismaClient,
  tenantId: string,
  phoneE164: string,
): Promise<Contact> {
  const existing = await prisma.contact.findFirst({ where: { tenantId, phoneE164 } });
  if (existing) return existing;
  return prisma.contact.create({ data: { tenantId, phoneE164 } });
}

export async function setBotActive(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
  active: boolean,
): Promise<Contact> {
  return prisma.contact.update({
    where: { id: contactId, tenantId },
    data: { botActive: active },
  });
}

export async function flagNonIntake(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
  reason: string,
): Promise<Contact> {
  return prisma.contact.update({
    where: { id: contactId, tenantId },
    data: { flaggedNonIntake: true, flaggedReason: reason },
  });
}

export async function setDisplayName(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
  name: string,
): Promise<Contact> {
  return prisma.contact.update({
    where: { id: contactId, tenantId },
    data: { displayName: name },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/services/contact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/contact.ts tests/services/contact.test.ts
git commit -m "feat(tenancy): require tenantId in contact service"
```

---

### Task 4: Thread tenantId through the Job service

**Files:**
- Modify: `src/services/job.ts`
- Modify: `tests/services/job.test.ts`

- [ ] **Step 1: Update the test to pass tenantId**

In `tests/services/job.test.ts`, add the seed in `beforeEach` and `TEST_TENANT_ID`, and update every call. At the top ensure the import includes the seed helpers:
```ts
import { testPrisma as prisma, cleanupDb as cleanup, seedTestTenant, TEST_TENANT_ID } from '../helpers/db';
const T = TEST_TENANT_ID;
```
Change `beforeEach(cleanup)` to:
```ts
beforeEach(async () => {
  await cleanup();
  await seedTestTenant();
});
```
Then update every service call and contact-creation to carry `T`. Contacts created inline must include `tenantId: T`; e.g. a helper that creates a contact becomes:
```ts
const contact = await prisma.contact.create({ data: { phoneE164: '+5215550000001', tenantId: T } });
```
And every job-service call gains `T` as the second argument: `openJob(prisma, T, contact.id, intake)`, `markReadyForReview(prisma, T, job.id, summary)`, `markInProgress(prisma, T, job.id)`, `closeJob(prisma, T, job.id)`, `reopenJob(prisma, T, job.id)`, `findOpenJobsForContact(prisma, T, contact.id)`, `updateJobIntake(prisma, T, job.id, intake)`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/services/job.test.ts`
Expected: FAIL — arg/type mismatch.

- [ ] **Step 3: Rewrite the job service**

Replace the entire contents of `src/services/job.ts`:
```ts
import type { PrismaClient, Job } from '@prisma/client';
import { ServiceError } from './errors';
import type { IntakeState } from './intake';

export const JOB_STATUS = {
  OPEN: 'OPEN_INTAKE',
  READY: 'READY_FOR_REVIEW',
  IN_PROGRESS: 'IN_PROGRESS',
  CLOSED: 'CLOSED',
} as const;

export async function openJob(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
  initialIntake: IntakeState,
): Promise<Job> {
  return prisma.job.create({
    data: {
      tenantId,
      contactId,
      status: JOB_STATUS.OPEN,
      intake: JSON.stringify(initialIntake),
    },
  });
}

export async function markReadyForReview(
  prisma: PrismaClient,
  tenantId: string,
  jobId: string,
  summary: string,
): Promise<Job> {
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId } });
  if (!job) throw new ServiceError(`job ${jobId} no existe`, 'JOB_NOT_FOUND');
  if (job.status !== JOB_STATUS.OPEN) {
    throw new ServiceError(
      `markReadyForReview requiere status=${JOB_STATUS.OPEN}, actual=${job.status}`,
      'INVALID_TRANSITION',
    );
  }
  return prisma.job.update({
    where: { id: jobId, tenantId },
    data: {
      status: JOB_STATUS.READY,
      summary,
      readyAt: new Date(),
      intakeComplete: true,
    },
  });
}

export async function markInProgress(
  prisma: PrismaClient,
  tenantId: string,
  jobId: string,
): Promise<Job> {
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId } });
  if (!job) throw new ServiceError(`job ${jobId} no existe`, 'JOB_NOT_FOUND');
  if (job.status !== JOB_STATUS.READY) {
    throw new ServiceError(
      `markInProgress requiere status=${JOB_STATUS.READY}, actual=${job.status}`,
      'INVALID_TRANSITION',
    );
  }
  return prisma.job.update({
    where: { id: jobId, tenantId },
    data: { status: JOB_STATUS.IN_PROGRESS },
  });
}

export async function closeJob(
  prisma: PrismaClient,
  tenantId: string,
  jobId: string,
): Promise<Job> {
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId } });
  if (!job) throw new ServiceError(`job ${jobId} no existe`, 'JOB_NOT_FOUND');
  if (job.status !== JOB_STATUS.OPEN && job.status !== JOB_STATUS.READY) {
    throw new ServiceError(
      `closeJob requiere status OPEN_INTAKE o READY_FOR_REVIEW, actual=${job.status}`,
      'INVALID_TRANSITION',
    );
  }
  return prisma.job.update({
    where: { id: jobId, tenantId },
    data: { status: JOB_STATUS.CLOSED, closedAt: new Date() },
  });
}

export async function reopenJob(
  prisma: PrismaClient,
  tenantId: string,
  jobId: string,
): Promise<Job> {
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId } });
  if (!job) throw new ServiceError(`job ${jobId} no existe`, 'JOB_NOT_FOUND');
  if (job.status !== JOB_STATUS.CLOSED && job.status !== JOB_STATUS.IN_PROGRESS) {
    throw new ServiceError(
      `reopenJob requiere status CLOSED o IN_PROGRESS, actual=${job.status}`,
      'INVALID_TRANSITION',
    );
  }
  return prisma.job.update({
    where: { id: jobId, tenantId },
    data: { status: JOB_STATUS.OPEN, closedAt: null, readyAt: null },
  });
}

export async function findOpenJobsForContact(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
): Promise<Job[]> {
  return prisma.job.findMany({
    where: {
      tenantId,
      contactId,
      status: { in: [JOB_STATUS.OPEN, JOB_STATUS.READY] },
    },
    orderBy: { openedAt: 'asc' },
  });
}

export async function updateJobIntake(
  prisma: PrismaClient,
  tenantId: string,
  jobId: string,
  intake: IntakeState,
): Promise<Job> {
  return prisma.job.update({
    where: { id: jobId, tenantId },
    data: { intake: JSON.stringify(intake) },
  });
}

export function parseJobIntake(job: Job): IntakeState {
  return JSON.parse(job.intake) as IntakeState;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/services/job.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/job.ts tests/services/job.test.ts
git commit -m "feat(tenancy): require tenantId in job service"
```

---

### Task 5: Thread tenantId through the AgentRun audit

**Files:**
- Modify: `src/agent/audit.ts`
- Modify: `tests/agent/audit.test.ts`

- [ ] **Step 1: Update the test**

In `tests/agent/audit.test.ts`, add the seed + `TEST_TENANT_ID` (as in Task 4 Step 1) and change every `recordAgentRun(prisma, input)` call to `recordAgentRun(prisma, TEST_TENANT_ID, input)`. Any inline `prisma.job.create`/`prisma.contact.create` the test does must include `tenantId: TEST_TENANT_ID`. Add an assertion:
```ts
const run = await recordAgentRun(prisma, TEST_TENANT_ID, input);
expect(run.tenantId).toBe(TEST_TENANT_ID);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/agent/audit.test.ts`
Expected: FAIL — arg/type mismatch.

- [ ] **Step 3: Update the audit function**

In `src/agent/audit.ts`, change the signature and create-data:
```ts
export async function recordAgentRun(
  prisma: PrismaClient,
  tenantId: string,
  input: AgentRunInput,
): Promise<AgentRun> {
  return prisma.agentRun.create({
    data: {
      tenantId,
      jobId: input.jobId,
      triggerMessageIds: JSON.stringify(input.triggerMessageIds),
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costUsd: input.costUsd ?? null,
      toolCalls: JSON.stringify(input.toolCalls),
      responseText: input.responseText,
      configHash: input.configHash,
      error: input.error,
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/agent/audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/audit.ts tests/agent/audit.test.ts
git commit -m "feat(tenancy): require tenantId in agent run audit"
```

---

### Task 6: Thread tenantId through normalize + idempotency

**Files:**
- Modify: `src/pipeline/normalize.ts`
- Modify: `src/pipeline/idempotency.ts`
- Modify: `tests/pipeline/normalize.test.ts`
- Modify: `tests/pipeline/idempotency.test.ts`

- [ ] **Step 1: Update both tests**

In `tests/pipeline/idempotency.test.ts` and `tests/pipeline/normalize.test.ts`: add seed + `TEST_TENANT_ID`; create contacts with `tenantId: TEST_TENANT_ID`; pass `TEST_TENANT_ID` to the functions. New call shapes:
- `alreadySeen(prisma, TEST_TENANT_ID, whatsappMsgId)`
- `normalizeAndPersistMessage(prisma, TEST_TENANT_ID, mediaStore, transcriber, raw, contactId)`

Add an isolation assertion in idempotency:
```ts
// un mensaje de OTRO tenant con el mismo whatsappMsgId no cuenta como visto
await prisma.tenant.create({ data: { id: '00000000-0000-0000-0000-0000000000ff', slug: 'other', name: 'Other', industry: 'test', profileDir: './x' } });
await prisma.contact.create({ data: { id: 'c-other', phoneE164: '+1999', tenantId: '00000000-0000-0000-0000-0000000000ff' } });
await prisma.message.create({ data: { tenantId: '00000000-0000-0000-0000-0000000000ff', contactId: 'c-other', direction: 'inbound', kind: 'text', body: 'x', whatsappMsgId: 'WID-SHARED' } });
expect(await alreadySeen(prisma, TEST_TENANT_ID, 'WID-SHARED')).toBe(false);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/pipeline/idempotency.test.ts tests/pipeline/normalize.test.ts`
Expected: FAIL — arg/type mismatch.

- [ ] **Step 3: Update idempotency**

In `src/pipeline/idempotency.ts`, change `alreadySeen` (leave `prefilter` untouched):
```ts
export async function alreadySeen(
  prisma: PrismaClient,
  tenantId: string,
  whatsappMsgId: string,
): Promise<boolean> {
  const existing = await prisma.message.findFirst({
    where: { tenantId, whatsappMsgId },
    select: { id: true },
  });
  return existing !== null;
}
```

- [ ] **Step 4: Update normalize**

In `src/pipeline/normalize.ts`, change the signature and stamp `tenantId` on create:
```ts
export async function normalizeAndPersistMessage(
  prisma: PrismaClient,
  tenantId: string,
  mediaStore: MediaStore,
  transcriber: Transcriber,
  raw: RawInboundMessage,
  contactId: string,
): Promise<Message> {
  const message = await prisma.message.create({
    data: {
      tenantId,
      contactId,
      direction: 'inbound',
      kind: raw.kind,
      body: raw.text,
      whatsappMsgId: raw.whatsappMsgId,
      raw: JSON.stringify(raw.raw ?? {}),
    },
  });

  if (!raw.media) return message;

  const mediaPath = await mediaStore.save({
    buffer: raw.media.buffer,
    mimetype: raw.media.mimetype,
    contactId,
    jobId: 'unassigned',
    messageId: message.id,
  });

  let body: string | null = raw.text;
  if (raw.kind === 'audio') {
    const transcription = await transcriber.transcribe(raw.media.buffer, raw.media.mimetype);
    if (transcription && transcription.length > 0) {
      body = transcription;
    }
  }

  return prisma.message.update({
    where: { id: message.id, tenantId },
    data: { mediaPath, body },
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/pipeline/idempotency.test.ts tests/pipeline/normalize.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/normalize.ts src/pipeline/idempotency.ts tests/pipeline/normalize.test.ts tests/pipeline/idempotency.test.ts
git commit -m "feat(tenancy): require tenantId in normalize + idempotency"
```

---

### Task 7: Thread tenantId through resolveContact + resolveJob

**Files:**
- Modify: `src/pipeline/resolveContact.ts`
- Modify: `src/pipeline/resolveJob.ts`
- Modify: `tests/pipeline/resolveContact.test.ts`
- Modify: `tests/pipeline/resolveJob.test.ts`

- [ ] **Step 1: Update both tests**

Add seed + `TEST_TENANT_ID`; create contacts with `tenantId`; call:
- `resolveContact(prisma, TEST_TENANT_ID, fromPhoneE164)`
- `resolveJobForMessage(prisma, TEST_TENANT_ID, schema, contactId, messageId)`

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/pipeline/resolveContact.test.ts tests/pipeline/resolveJob.test.ts`
Expected: FAIL — arg/type mismatch.

- [ ] **Step 3: Update resolveContact**

Replace the contents of `src/pipeline/resolveContact.ts`:
```ts
import type { PrismaClient, Contact } from '@prisma/client';
import { upsertContactByPhone } from '../services/contact';

export type ContactResolution =
  | { shouldRespond: true; contact: Contact }
  | { shouldRespond: false; contact: Contact; reason: 'bot_paused' | 'flagged_non_intake' };

export async function resolveContact(
  prisma: PrismaClient,
  tenantId: string,
  fromPhoneE164: string,
): Promise<ContactResolution> {
  const contact = await upsertContactByPhone(prisma, tenantId, fromPhoneE164);
  if (!contact.botActive) {
    return { shouldRespond: false, contact, reason: 'bot_paused' };
  }
  if (contact.flaggedNonIntake) {
    return { shouldRespond: false, contact, reason: 'flagged_non_intake' };
  }
  return { shouldRespond: true, contact };
}
```

- [ ] **Step 4: Update resolveJob**

Replace the contents of `src/pipeline/resolveJob.ts`:
```ts
import type { PrismaClient, Job } from '@prisma/client';
import type { IntakeSchema } from '../config/intake-schema';
import { findOpenJobsForContact, openJob } from '../services/job';
import { createEmptyIntakeFromSchema } from '../services/intake';
import type { OpenJobSummary } from '../agent/types';

export interface JobResolution {
  job: Job;
  isFirstMessage: boolean;
  otherOpenJobs: OpenJobSummary[];
}

export async function resolveJobForMessage(
  prisma: PrismaClient,
  tenantId: string,
  schema: IntakeSchema,
  contactId: string,
  _messageId: string,
): Promise<JobResolution> {
  const open = await findOpenJobsForContact(prisma, tenantId, contactId);

  if (open.length === 0) {
    const totalJobs = await prisma.job.count({ where: { tenantId, contactId } });
    const isFirstMessage = totalJobs === 0;
    const job = await openJob(prisma, tenantId, contactId, createEmptyIntakeFromSchema(schema));
    return { job, isFirstMessage, otherOpenJobs: [] };
  }

  if (open.length === 1) {
    return { job: open[0], isFirstMessage: false, otherOpenJobs: [] };
  }

  const sorted = [...open].sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  const [primary, ...rest] = sorted;
  return {
    job: primary,
    isFirstMessage: false,
    otherOpenJobs: rest.map((j) => ({
      id: j.id,
      summary: j.summary,
      openedAt: j.openedAt,
    })),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/pipeline/resolveContact.test.ts tests/pipeline/resolveJob.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/resolveContact.ts src/pipeline/resolveJob.ts tests/pipeline/resolveContact.test.ts tests/pipeline/resolveJob.test.ts
git commit -m "feat(tenancy): require tenantId in resolveContact + resolveJob"
```

---

### Task 8: Thread tenantId through the agent (runner/tools) and coordinator

**Files:**
- Modify: `src/agent/types.ts` (add `tenantId` to `AgentDeps`)
- Modify: `src/pipeline/types.ts` (add `tenantId` to `PipelineDeps`)
- Modify: `src/agent/runner.ts`
- Modify: `src/agent/tools.ts`
- Modify: `src/pipeline/coordinator.ts`
- Modify: `tests/agent/runner.test.ts`, `tests/agent/tools.test.ts`, `tests/pipeline/coordinator.test.ts`

- [ ] **Step 1: Update the three tests to provide tenantId in deps**

In each test, add the seed + `TEST_TENANT_ID`, create all contacts/jobs with `tenantId: TEST_TENANT_ID`, and add `tenantId: TEST_TENANT_ID` to the deps object passed to `runAgentTurn` (AgentDeps), `buildTools`/tool builders (AgentDeps), and `new InboundCoordinator({...})` (PipelineDeps). For `tools.test.ts`, the tool-builder deps objects (e.g. `{ prisma, profile }`, `{ prisma, profile, notifier, config }`, `{ prisma }`) must each also include `tenantId: TEST_TENANT_ID`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/agent/runner.test.ts tests/agent/tools.test.ts tests/pipeline/coordinator.test.ts`
Expected: FAIL — `tenantId` missing on deps types / arg mismatch in service calls.

- [ ] **Step 3: Add tenantId to the deps interfaces**

In `src/agent/types.ts`, add to `AgentDeps`:
```ts
export interface AgentDeps {
  prisma: PrismaClient;
  tenantId: string;
  config: Config;
  profile: Profile;
  notifier: import('../services/notification').Notifier;
  createAgent: AgentFactory;
}
```
In `src/pipeline/types.ts`, add to `PipelineDeps`:
```ts
export interface PipelineDeps {
  prisma: PrismaClient;
  tenantId: string;
  config: Config;
  profile: Profile;
  notifier: Notifier;
  sender: OutboundSender;
  transcriber: Transcriber;
  mediaStore: MediaStore;
  agentFactory: AgentFactory;
  now: () => Date;
}
```

- [ ] **Step 4: Update the runner to pass tenantId to audit**

In `src/agent/runner.ts`, change the `recordAgentRun` call (line ~72):
```ts
  await recordAgentRun(deps.prisma, deps.tenantId, {
    jobId: ctx.job.id,
    triggerMessageIds,
    model: deps.config.model,
    inputTokens,
    outputTokens,
    costUsd,
    toolCalls,
    responseText,
    configHash: deps.profile.hash,
    error,
  });
```

- [ ] **Step 5: Update the tools to pass tenantId to services**

In `src/agent/tools.ts`:
- Change the `buildUpdateIntakeTool` deps type to `Pick<AgentDeps, 'prisma' | 'tenantId' | 'profile'>` and its call to `await updateJobIntake(deps.prisma, deps.tenantId, ctx.job.id, nextIntake);`
- Change `MarkReadyDeps` to add `tenantId: string;` and its call to `await markReadyForReview(deps.prisma, deps.tenantId, ctx.job.id, summary);`
- Change `buildCloseJobTool` deps type to `Pick<AgentDeps, 'prisma' | 'tenantId'>` and its call to `await closeJob(deps.prisma, deps.tenantId, ctx.job.id);`
- Change `buildFlagNonIntakeTool` deps type to `Pick<AgentDeps, 'prisma' | 'tenantId'>` and its call to `await flagNonIntake(deps.prisma, deps.tenantId, ctx.contact.id, parse.data.reason);`

The `buildTools(ctx, deps)` factory already receives the full `AgentDeps`, so it forwards `deps` (now carrying `tenantId`) to each builder unchanged.

- [ ] **Step 6: Update the coordinator's direct prisma calls + runAgentTurn deps**

In `src/pipeline/coordinator.ts`, introduce a local `tenantId` and thread it. Concretely:
- At the top of `handleInbound`, after the prefilter, add `const tenantId = this.deps.tenantId;`
- `alreadySeen(this.deps.prisma, raw.whatsappMsgId)` → `alreadySeen(this.deps.prisma, tenantId, raw.whatsappMsgId)`
- `resolveContact(this.deps.prisma, raw.fromPhoneE164)` → `resolveContact(this.deps.prisma, tenantId, raw.fromPhoneE164)`
- `resolveJobForMessage(this.deps.prisma, this.deps.profile.intakeSchema, contactRes.contact.id, raw.whatsappMsgId)` → `resolveJobForMessage(this.deps.prisma, tenantId, this.deps.profile.intakeSchema, contactRes.contact.id, raw.whatsappMsgId)`
- `normalizeAndPersistMessage(this.deps.prisma, this.deps.mediaStore, this.deps.transcriber, raw, contactRes.contact.id)` → `normalizeAndPersistMessage(this.deps.prisma, tenantId, this.deps.mediaStore, this.deps.transcriber, raw, contactRes.contact.id)`
- `prisma.message.update({ where: { id: messageWithoutJob.id }, data: { jobId: jobRes.job.id } })` → add `tenantId` to the where: `where: { id: messageWithoutJob.id, tenantId }`
- The image/audio counter `prisma.job.update({ where: { id: jobRes.job.id }, data: ... })` → `where: { id: jobRes.job.id, tenantId }`
- The welcome `prisma.message.create({ data: { jobId, contactId, direction: 'outbound', kind: 'text', body: welcome } })` → add `tenantId` to `data`

In `flushBatch`, add `const tenantId = this.deps.tenantId;` at the top, then:
- `prisma.contact.findUnique({ where: { id: contactId } })` → `prisma.contact.findFirst({ where: { id: contactId, tenantId } })`
- `prisma.message.findMany({ where: { id: { in: messageIds } }, ... })` → add `tenantId` to the where
- `prisma.job.findUnique({ where: { id: jobId } })` → `prisma.job.findFirst({ where: { id: jobId, tenantId } })`
- `prisma.job.findMany({ where: { contactId, status: {...}, NOT: { id: jobId } } })` → add `tenantId` to the where
- the history `prisma.message.findMany({ where: { jobId, id: { notIn: messageIds } }, ... })` → add `tenantId` to the where
- the `runAgentTurn(ctx, { prisma, config, profile, notifier, createAgent })` deps object → add `tenantId,`:
```ts
      {
        prisma: this.deps.prisma,
        tenantId,
        config: this.deps.config,
        profile: this.deps.profile,
        notifier: this.deps.notifier,
        createAgent: this.deps.agentFactory,
      },
```
- the outbound `prisma.message.create({ data: { jobId, contactId, direction: 'outbound', kind: 'text', body: result.responseText } })` → add `tenantId` to `data`

- [ ] **Step 7: Run the three tests to verify they pass**

Run: `npx vitest run tests/agent/runner.test.ts tests/agent/tools.test.ts tests/pipeline/coordinator.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, no type errors. (This proves the whole tenancy thread compiles end-to-end.)

- [ ] **Step 9: Commit**

```bash
git add src/agent/types.ts src/pipeline/types.ts src/agent/runner.ts src/agent/tools.ts src/pipeline/coordinator.ts tests/agent/runner.test.ts tests/agent/tools.test.ts tests/pipeline/coordinator.test.ts
git commit -m "feat(tenancy): thread tenantId through agent runner, tools and coordinator"
```

---

### Task 9: Tighten tenantId to NOT NULL + add per-tenant composite uniques

**Files:**
- Modify: `prisma/schema.prisma`
- Migration: generated
- Modify: `tests/pipeline/idempotency.test.ts` (re-confirm isolation under the new constraint)

- [ ] **Step 1: Make tenantId required and swap the uniques in the schema**

In `prisma/schema.prisma`, for `Contact`, `Job`, `Message`, `AgentRun`, `Notification`, change:
```prisma
  tenantId  String?
  tenant    Tenant?  @relation(fields: [tenantId], references: [id])
```
to:
```prisma
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
```
On `Contact`: remove `@unique` from `phoneE164` (becomes `phoneE164 String`) and add at the model level:
```prisma
  @@unique([tenantId, phoneE164])
```
On `Message`: remove `@unique` from `whatsappMsgId` (becomes `whatsappMsgId String?`) and add at the model level:
```prisma
  @@unique([tenantId, whatsappMsgId])
```

- [ ] **Step 2: Reset the dev DB and generate the tightening migration**

Because the existing nullable rows would violate `NOT NULL`, reset the dev database first (dev only — destroys local data):
```bash
npx prisma migrate reset --force
npx prisma migrate dev --name tighten_tenancy
```
Expected: a clean migration history applies; the new migration adds `NOT NULL`, drops the old global uniques, and creates `Contact_tenantId_phoneE164_key` and `Message_tenantId_whatsappMsgId_key`.

> **Production note (for the runbook):** on a fresh prod DB there are no rows, so `migrate deploy` applies all migrations cleanly. If a non-empty DB ever needs this, backfill `tenantId` before applying (`UPDATE "Contact" SET "tenantId" = '<id>' WHERE "tenantId" IS NULL;` etc.).

- [ ] **Step 3: Confirm idempotency isolation still holds under the composite unique**

The Task 6 isolation assertion (same `whatsappMsgId` across two tenants returns `false`) now also exercises the `@@unique([tenantId, whatsappMsgId])` path. Run:
```bash
npx vitest run tests/pipeline/idempotency.test.ts
```
Expected: PASS.

- [ ] **Step 4: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/pipeline/idempotency.test.ts
git commit -m "feat(db): enforce NOT NULL tenantId and per-tenant composite uniques"
```

---

### Task 10: Bootstrap reads TENANT_ID and stops starting the SSR panel

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Require TENANT_ID, wire it into deps, remove the panel server**

Replace the contents of `src/index.ts`:
```ts
#!/usr/bin/env tsx
import 'dotenv/config';
/**
 * Punto de entrada del worker Intake (un proceso por tenant).
 *
 * Lee TENANT_ID del entorno (obligatorio), carga config + perfil, conecta
 * WhatsApp vía Baileys e instancia el coordinator con el tenantId propagado.
 * El panel SSR ya NO se arranca aquí: la única superficie de lectura/escritura
 * para el dashboard es la API central (Plan 2). Este proceso solo expone, en la
 * red interna de Docker, un endpoint de status protegido (Plan 1, Task 11).
 *
 * Arranque: TENANT_ID=<uuid> DATABASE_URL=postgres://... npm start
 */
import { loadConfig, loadProfile } from './config/loader';
import { getPrisma, disconnectPrisma } from './storage/client';
import { FilesystemMediaStore } from './media/store';
import {
  NoopTranscriber,
  WhisperTranscriber,
  type Transcriber,
} from './media/transcriber';
import { InboundCoordinator } from './pipeline/coordinator';
import { WhatsAppSender } from './adapters/whatsapp/sender';
import { WhatsAppNotifier } from './adapters/whatsapp/notifier';
import { BaileysAdapter } from './adapters/whatsapp/adapter';
import { defaultAgentFactory } from './agent/sdk-factory';
import { startInternalServer } from './internal/server';
import { logger } from './lib/logger';

async function main() {
  const tenantId = process.env.TENANT_ID;
  if (!tenantId) {
    throw new Error(
      'TENANT_ID no está definido. Cada worker atiende exactamente un tenant; ' +
        'define TENANT_ID=<uuid del Tenant> en el entorno del contenedor.',
    );
  }

  const config = await loadConfig('./config.json');
  const profile = await loadProfile(config.profile);
  const prisma = getPrisma();

  logger.info({ tenantId, profile: config.profile }, 'bootstrap.config_loaded');

  const mediaStore = new FilesystemMediaStore(config.media.storeDir);

  const apiKey = process.env.OPENROUTER_API_KEY ?? '';
  const transcriber: Transcriber =
    config.media.transcribeAudio && apiKey
      ? new WhisperTranscriber(apiKey, config.media.whisperModel)
      : new NoopTranscriber();
  if (config.media.transcribeAudio && !apiKey) {
    logger.warn(
      'transcribeAudio=true pero OPENROUTER_API_KEY no está configurada. ' +
        'Los audios no se transcribirán.',
    );
  }

  let adapter: BaileysAdapter | null = null;
  const sender = new WhatsAppSender(() => adapter?.asSocket() ?? null);
  const notifier = new WhatsAppNotifier(sender, config.owner.phoneE164);

  const coordinator = new InboundCoordinator({
    prisma,
    tenantId,
    config,
    profile,
    notifier,
    sender,
    transcriber,
    mediaStore,
    agentFactory: defaultAgentFactory,
    now: () => new Date(),
  });

  adapter = new BaileysAdapter({
    sessionDir: './data/baileys-session',
    coordinator,
    notifier,
  });

  // Endpoint interno de status (solo red Docker, protegido con INTERNAL_API_TOKEN).
  const internalServer = await startInternalServer({
    adapterState: { state: () => adapter!.state() },
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'bootstrap.shutdown');
    await internalServer.close();
    await adapter?.stop();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('bootstrap.starting_baileys');
  await adapter.start();

  await new Promise(() => {});
}

main().catch((e) => {
  logger.error(
    { err: e instanceof Error ? e.stack : String(e) },
    'bootstrap.failed',
  );
  process.exit(1);
});
```
(`startInternalServer` is created in Task 11. The panel code under `src/panel/` is left in the repo for reuse by Plan 2/3 but is no longer imported by the worker.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: FAIL with `Cannot find module './internal/server'` — expected, the module arrives in Task 11.

- [ ] **Step 3: Commit (after Task 11 compiles)**

Defer the commit; bundle `src/index.ts` with Task 11's `src/internal/server.ts` so the tree compiles. Proceed directly to Task 11.

---

### Task 11: Internal status endpoint protected by INTERNAL_API_TOKEN

**Files:**
- Create: `src/internal/server.ts`
- Create: `tests/internal/server.test.ts`

The Baileys adapter exposes `adapter.state()` (used previously by the panel). The internal server returns `{ connected, qr, phone }` for the API's `wa-status` proxy (Plan 2). It binds `INTERNAL_PORT` (default 3002) and requires `Authorization: Bearer ${INTERNAL_API_TOKEN}` even though it lives on the internal network (defense in depth).

- [ ] **Step 1: Write the failing test**

Create `tests/internal/server.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startInternalServer, type InternalServer } from '../../src/internal/server';

const TOKEN = 'test-internal-token';
let server: InternalServer;

const fakeState = () => ({ connected: true, qr: null as string | null, phone: '+5215551234567' });

describe('internal status server', () => {
  beforeAll(async () => {
    process.env.INTERNAL_API_TOKEN = TOKEN;
    process.env.INTERNAL_PORT = '0'; // puerto efímero
    server = await startInternalServer({ adapterState: { state: fakeState } });
  });
  afterAll(() => server.close());

  it('401 sin token', async () => {
    const res = await server.app.inject({ method: 'GET', url: '/internal/wa-status' });
    expect(res.statusCode).toBe(401);
  });

  it('401 con token incorrecto', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/internal/wa-status',
      headers: { authorization: 'Bearer wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('200 + estado con token correcto', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/internal/wa-status',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ connected: true, qr: null, phone: '+5215551234567' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/internal/server.test.ts`
Expected: FAIL — `Cannot find module '../../src/internal/server'`.

- [ ] **Step 3: Implement the internal server**

Create `src/internal/server.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { logger } from '../lib/logger';

/** Forma mínima del estado que expone el BaileysAdapter. */
export interface AdapterStatus {
  connected: boolean;
  qr: string | null;
  phone: string;
}

export interface InternalServerDeps {
  adapterState: { state: () => AdapterStatus };
}

export interface InternalServer {
  app: FastifyInstance;
  close: () => Promise<void>;
}

export async function startInternalServer(deps: InternalServerDeps): Promise<InternalServer> {
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) {
    throw new Error(
      'INTERNAL_API_TOKEN no está definido. El endpoint interno de status exige ' +
        'autenticación por bearer token aunque viva en la red interna de Docker.',
    );
  }

  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (request, reply) => {
    const header = request.headers.authorization ?? '';
    const expected = `Bearer ${token}`;
    if (header !== expected) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/internal/wa-status', async () => {
    return deps.adapterState.state();
  });

  const port = Number(process.env.INTERNAL_PORT ?? 3002);
  await app.listen({ port, host: '0.0.0.0' });
  const addr = app.server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : port;
  logger.info({ port: boundPort }, 'internal.listening');

  return {
    app,
    close: () => app.close(),
  };
}
```

> **Note on `adapter.state()` shape:** confirm `BaileysAdapter.state()` returns `{ connected, qr, phone }`. If its current return type differs, adapt the `AdapterStatus` interface and map the fields inside the `/internal/wa-status` handler — do not change the adapter.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/internal/server.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Typecheck the worker bootstrap + internal server together**

Run: `npm run typecheck`
Expected: no errors (resolves Task 10's deferred `./internal/server` import).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 7: Commit (bundling Task 10 + Task 11)**

```bash
git add src/index.ts src/internal/server.ts tests/internal/server.test.ts
git commit -m "feat(worker): read TENANT_ID, retire SSR panel, add token-protected internal status endpoint"
```

---

### Task 12: Dockerfile.worker + migrate-deploy entrypoint

**Files:**
- Create: `Dockerfile.worker`
- Create: `docker/worker-entrypoint.sh`
- Modify: `.dockerignore` (create if absent)

- [ ] **Step 1: Create the worker image**

Create `Dockerfile.worker`:
```dockerfile
FROM node:20-bookworm-slim

WORKDIR /app

# Dependencias del sistema para Baileys (libssl) y healthchecks.
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Genera el cliente Prisma dentro de la imagen.
RUN npx prisma generate

# Carpetas persistidas por volúmenes en compose.
RUN mkdir -p /app/data/baileys-session /app/media

COPY docker/worker-entrypoint.sh /usr/local/bin/worker-entrypoint.sh
RUN chmod +x /usr/local/bin/worker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/worker-entrypoint.sh"]
CMD ["npm", "start"]
```

- [ ] **Step 2: Create the entrypoint (migrate deploy before start)**

Create `docker/worker-entrypoint.sh`:
```sh
#!/bin/sh
set -e

echo "[entrypoint] aplicando migraciones (prisma migrate deploy)…"
npx prisma migrate deploy

echo "[entrypoint] arrancando worker para TENANT_ID=${TENANT_ID}"
exec "$@"
```

> `migrate deploy` is idempotent: the first worker to boot applies pending migrations; subsequent boots find none. For multiple workers sharing one DB this is safe (advisory-locked by Prisma). A dedicated one-shot `migrate` service is an acceptable alternative documented in the runbook (Task 15).

- [ ] **Step 3: Create .dockerignore**

Create `.dockerignore`:
```
node_modules
.git
data
media
*.zip
docs
tests
.env
```

- [ ] **Step 4: Build the image to verify it compiles**

Run: `docker build -f Dockerfile.worker -t intake-worker:dev .`
Expected: build succeeds through `npx prisma generate` and image is tagged.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile.worker docker/worker-entrypoint.sh .dockerignore
git commit -m "feat(infra): worker Dockerfile with migrate-deploy entrypoint"
```

---

### Task 13: Docker Compose (postgres + worker, no public ports)

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example` (compose variables)

- [ ] **Step 1: Author the compose file**

Create `docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: intake
      POSTGRES_USER: intake
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U intake -d intake"]
      interval: 5s
      timeout: 5s
      retries: 10
    # sin `ports:` — solo accesible en la red interna de Docker

  worker-tapiceria:
    build:
      context: .
      dockerfile: Dockerfile.worker
    environment:
      DATABASE_URL: postgres://intake:${POSTGRES_PASSWORD}@postgres:5432/intake
      TENANT_ID: ${TENANT_TAPICERIA_ID}
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY}
      INTERNAL_PORT: 3002
      INTERNAL_API_TOKEN: ${INTERNAL_API_TOKEN}
    volumes:
      - baileys-tapiceria:/app/data/baileys-session
      - media-tapiceria:/app/media
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    # sin `ports:` — la API (Plan 2) lo alcanza por nombre de servicio en la red interna

volumes:
  pgdata:
  baileys-tapiceria:
  media-tapiceria:
```

> **Adding a second tenant** = create a `Tenant` row, copy the `worker-tapiceria` block to `worker-paqueteria` with its own `TENANT_ID`, profile and volumes, and add `TENANT_PAQUETERIA_ID` to `.env`. No code changes. The public API container (Plan 2) is the only service that will declare `ports:`.

- [ ] **Step 2: Author the env template**

Create `.env.example`:
```
# PostgreSQL (solo red interna Docker — nunca expuesto)
POSTGRES_PASSWORD=change-me-strong

# Token del endpoint interno worker↔api (defensa en profundidad)
INTERNAL_API_TOKEN=change-me-internal-token

# OpenRouter (LLM + Whisper)
OPENROUTER_API_KEY=sk-or-v1-...

# IDs de Tenant (uuid de la tabla Tenant; uno por worker)
TENANT_TAPICERIA_ID=00000000-0000-0000-0000-000000000001
# TENANT_PAQUETERIA_ID=...
```

- [ ] **Step 3: Validate the compose file**

Run: `docker compose config`
Expected: prints the resolved configuration with no errors (use a throwaway `.env` copied from `.env.example` for interpolation).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "feat(infra): docker-compose with internal-only postgres and worker"
```

---

### Task 14: Basic PostgreSQL backup (from day one)

**Files:**
- Create: `scripts/backup-postgres.sh`

- [ ] **Step 1: Write the backup script**

Create `scripts/backup-postgres.sh`:
```sh
#!/bin/sh
# Backup diario de PostgreSQL del stack Intake.
# Uso (cron en el host):
#   0 3 * * * /opt/intake/scripts/backup-postgres.sh >> /var/log/intake-backup.log 2>&1
set -e

BACKUP_DIR="${BACKUP_DIR:-/opt/intake/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-postgres}"
STAMP="$(date +%F_%H%M)"

mkdir -p "$BACKUP_DIR"

echo "[backup] volcando base intake → $BACKUP_DIR/backup-$STAMP.sql.gz"
docker compose exec -T "$COMPOSE_SERVICE" pg_dump -U intake intake | gzip > "$BACKUP_DIR/backup-$STAMP.sql.gz"

echo "[backup] eliminando backups con más de $RETENTION_DAYS días"
find "$BACKUP_DIR" -name 'backup-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "[backup] OK"
```

- [ ] **Step 2: Make it executable + smoke-check syntax**

Run:
```bash
chmod +x scripts/backup-postgres.sh
sh -n scripts/backup-postgres.sh
```
Expected: `sh -n` (syntax check) prints nothing and exits 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/backup-postgres.sh
git commit -m "feat(ops): daily pg_dump backup script with retention"
```

---

### Task 15: Deployment runbook + public-surface documentation

**Files:**
- Create: `docs/runbooks/2026-06-13-plan1-deploy.md`

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/2026-06-13-plan1-deploy.md`:
```markdown
# Runbook — Plan 1: Despliegue Infra + Worker (VPS + Docker)

## Superficies públicas (regla de oro)
- **PostgreSQL:** nunca expone puerto. Solo red interna Docker.
- **Worker:** nunca expone puerto. Endpoint interno `:3002/internal/wa-status` solo en la red Docker, protegido con `INTERNAL_API_TOKEN`.
- **API (Plan 2):** única superficie pública del backend (`api.etherionlabs.com`), detrás de nginx con TLS en el host.
- **SPA (Plan 3):** Netlify, habla solo con la API.

## Variables de entorno (host `.env`, copiar de `.env.example`)
- `POSTGRES_PASSWORD`, `INTERNAL_API_TOKEN`, `OPENROUTER_API_KEY`, `TENANT_<NEGOCIO>_ID`.

## Primer despliegue
1. Clonar el repo en el VPS (ej. `/opt/intake`).
2. `cp .env.example .env` y rellenar valores reales.
3. `docker compose build`
4. `docker compose up -d postgres` y esperar healthy.
5. Sembrar el primer tenant (operador, manual por ahora — onboarding self-service es deuda técnica):
   ```bash
   docker compose run --rm worker-tapiceria \
     node -e "import('@prisma/client').then(async ({PrismaClient})=>{const {PrismaPg}=await import('@prisma/adapter-pg');const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});const t=await p.tenant.create({data:{slug:'tapiceria-demo',name:'Tapicería Demo',industry:'tapiceria',profileDir:'./profiles/tapiceria'}});console.log('TENANT_ID=',t.id);process.exit(0)})"
   ```
   Copiar el `TENANT_ID` impreso a `TENANT_TAPICERIA_ID` en `.env`.
6. `docker compose up -d worker-tapiceria`. El entrypoint corre `prisma migrate deploy` antes de arrancar.
7. Ver el QR de Baileys: `docker compose logs -f worker-tapiceria` (primera vez) o vía el endpoint interno cuando la API esté lista (Plan 2). Escanear desde WhatsApp.

## Migraciones
- `prisma migrate deploy` corre automáticamente en el entrypoint del worker. Nunca usar `migrate dev` en producción.
- Alternativa: un servicio `migrate` de un solo uso en compose que corre `prisma migrate deploy` y termina, con los workers en `depends_on`.

## Backups
- Configurar cron en el host: `0 3 * * * /opt/intake/scripts/backup-postgres.sh`.
- Verificar restore en staging: `gunzip -c backup-XXXX.sql.gz | docker compose exec -T postgres psql -U intake intake`.

## Agregar un tenant nuevo
1. Crear la fila `Tenant` (paso 5).
2. Duplicar el bloque `worker-<slug>` en `docker-compose.yml` con su `TENANT_ID`, `profileDir` y volúmenes propios.
3. Añadir `TENANT_<SLUG>_ID` al `.env`.
4. `docker compose up -d worker-<slug>`. Sin cambios de código.

## Deuda técnica registrada (spec §9)
Auth en localStorage → cookie HttpOnly; un worker por tenant → TenantManager; config en profileDir → tabla TenantSettings; onboarding manual → self-service; sin billing → Stripe.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/2026-06-13-plan1-deploy.md
git commit -m "docs(ops): Plan 1 deployment runbook"
```

---

### Task 16: Final verification + cleanup

**Files:**
- Modify: `package.json` (scripts + remove sqlite deps)

- [ ] **Step 1: Remove the now-unused SQLite adapter + fix the studio script**

Run:
```bash
npm uninstall better-sqlite3 @prisma/adapter-better-sqlite3
```
In `package.json`, update the `prisma:studio` script (the hardcoded SQLite url no longer applies):
```json
    "prisma:studio": "prisma studio",
```

- [ ] **Step 2: Confirm no lingering SQLite references**

Run: `npx grep -r "better-sqlite3" src tests` (or use the editor search).
Expected: no matches in `src/` or `tests/` (the dependency is gone and all tests use the pg helper).

- [ ] **Step 3: Full suite + typecheck on a clean DB**

Run:
```bash
npx prisma migrate reset --force
npm test
npm run typecheck
```
Expected: migrations apply cleanly; all tests PASS; no type errors.

- [ ] **Step 4: End-to-end compose smoke test**

Run:
```bash
cp .env.example .env   # rellena POSTGRES_PASSWORD / INTERNAL_API_TOKEN / OPENROUTER_API_KEY / TENANT_TAPICERIA_ID con valores de prueba
docker compose build
docker compose up -d postgres
docker compose run --rm worker-tapiceria npx prisma migrate deploy
```
Expected: `migrate deploy` reports migrations applied (or "No pending migrations"). Tear down with `docker compose down`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(infra): drop SQLite deps and finalize Plan 1 verification"
```

---

## Self-Review

**Spec coverage (spec §3, §4, §7, §8):**
- SQLite → PostgreSQL: Task 1. ✓
- `Tenant` + `PanelUser` tables: Task 2. ✓
- `tenantId` on existing tables (Contact, Job, Message, AgentRun, Notification): Tasks 2 (nullable) + 9 (NOT NULL). `Setting` deliberately excluded and documented. ✓
- "Ningún servicio escribe/lee sin tenantId explícito": Tasks 3–8 thread a mandatory `tenantId` param through every service/pipeline/agent function. ✓
- Worker reads `TENANT_ID` from env: Task 10. ✓
- SSR panel removed from worker bootstrap: Task 10. ✓
- Internal status endpoint protected by `INTERNAL_API_TOKEN`: Task 11. ✓
- Docker Compose (postgres + worker, no public ports): Tasks 12–13. ✓
- `migrate deploy` at deploy time: Task 12 entrypoint + Task 15 runbook. ✓
- Basic `pg_dump` backup from day one: Task 14. ✓
- Public-surface documentation: Task 15. ✓

**Placeholder scan:** No "TBD"/"implement later". Every code step shows full content; mechanical bulk edits (Task 1 Step 6, Task 8) give the exact transformation and enumerate every file. Two flagged assumptions to verify at implementation time: (a) `adapter.state()` returns `{ connected, qr, phone }` (Task 11 note), (b) `PrismaPg` constructor is `{ connectionString }` (current `@prisma/adapter-pg` API).

**Type consistency:** `tenantId: string` is the convention everywhere; it is the parameter right after `prisma` in services and a field on `AgentDeps`/`PipelineDeps`. `recordAgentRun(prisma, tenantId, input)`, `normalizeAndPersistMessage(prisma, tenantId, ...)`, `resolveJobForMessage(prisma, tenantId, schema, ...)` are used identically in their definitions, callers (coordinator), and tests. Composite uniques `Contact_tenantId_phoneE164_key` / `Message_tenantId_whatsappMsgId_key` are referenced consistently between schema (Task 9) and the isolation tests (Tasks 6/9).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-13-plan1-infra-worker.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
