# Superadmin CRUD + retiro del operador — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidar la administración de plataforma en el panel superadmin (crear/editar/eliminar/aprobar tenants + gestionar al dueño), retirar el panel operador `/admin`, y corregir dos bugs (email obligatorio del dueño; guard de Windows del backfill).

**Architecture:** Se extrae la lógica del operador (`admin.ts`) a servicios reutilizables (`worker-client`, `tenantApproval`, `tenantDeletion`), se montan bajo `/platform` con `authenticatePlatform`, y luego se elimina `admin.ts` y su superficie SPA. Sin migración de BD (el email ya existe como columna nullable; se exige en la capa API).

**Tech Stack:** Fastify + Prisma (api/), React + Vitest (spa/), vitest raíz+api unificado, Postgres.

**Spec:** `docs/superpowers/specs/2026-07-06-superadmin-crud-retire-operator-design.md`

---

## Entorno de tests (una vez por sesión)

Postgres de dev en Docker (contenedor `intake-pg-dev`, puerto host **5433**). En PowerShell, antes de cualquier test:

```powershell
$env:DATABASE_URL='postgres://intake:intake@localhost:5433/intake'; $env:NODE_ENV='test'; $env:JWT_SECRET='test-jwt-secret'
```

`npx vitest run <archivo>` corre un archivo; `npm test` corre raíz+api. SPA: `cd spa; npx vitest run <archivo>`. Los tests hacen `cleanupDb()` en `beforeEach` y corren secuencialmente (`fileParallelism:false`). Si un archivo falla por timing al correr con otros, reejecutarlo solo.

## Helper de auth de plataforma (se usa en varias tareas)

En `api/tests/platform.test.ts` ya existen `seedPlatformUser()` y el login. Añadir (una vez, en Task 4) este helper arriba del `describe`, y reutilizarlo:

```typescript
async function platformHeader(app: Awaited<ReturnType<typeof buildTestApp>>): Promise<{ authorization: string }> {
  await seedPlatformUser();
  const res = await app.inject({
    method: 'POST', url: '/platform/auth/login',
    payload: { username: 'owner@example.com', password: 'supersecret' },
  });
  return { authorization: `Bearer ${res.json().token}` };
}
```

---

## FASE A — Servicios y helpers compartidos

### Task 1: Extraer `worker-client` y `startOfMonthUtc`

Prep sin cambio de comportamiento: mover código reutilizable fuera de `admin.ts` para poder borrarlo luego.

**Files:**
- Create: `api/src/lib/worker-client.ts`
- Create: `api/src/lib/dates.ts`
- Modify: `api/src/routes/usage.ts:4`
- Modify: `api/src/routes/admin.ts` (usar los helpers extraídos)

- [ ] **Step 1: Crear `api/src/lib/dates.ts`**

```typescript
/** Inicio del mes calendario en curso (UTC) para el conteo del plan gratuito. */
export function startOfMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
```

- [ ] **Step 2: Crear `api/src/lib/worker-client.ts`**

```typescript
import { resolveManagerUrl } from './manager-url';

/**
 * Llama al TenantManager interno (worker) que posee al tenant. Best-effort:
 * devuelve el JSON de respuesta o `null` si no hay URL/token o el worker no responde.
 * `doFetch` inyectable para tests.
 */
export async function workerCall(
  doFetch: typeof fetch,
  method: 'GET' | 'POST',
  tenantId: string,
  path: string,
): Promise<any | null> {
  const base = resolveManagerUrl(tenantId);
  const token = process.env.INTERNAL_API_TOKEN;
  if (!base || !token) return null;
  try {
    const url = method === 'GET' ? `${base}${path}?tenantId=${encodeURIComponent(tenantId)}` : `${base}${path}`;
    const res = await doFetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify({ tenantId }) } : {}),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
```

- [ ] **Step 3: Actualizar `api/src/routes/usage.ts`**

Cambiar la línea 4 de `import { startOfMonthUtc } from './admin';` a:

```typescript
import { startOfMonthUtc } from '../lib/dates';
```

- [ ] **Step 4: Actualizar `api/src/routes/admin.ts` para usar los helpers**

En `admin.ts`: quitar la definición local de `startOfMonthUtc` (líneas 13-16) y la función interna `workerCall` (líneas 39-53). Añadir imports:

```typescript
import { startOfMonthUtc } from '../lib/dates';
import { workerCall as callWorker } from '../lib/worker-client';
```

Reemplazar las llamadas `workerCall('POST', id, '/x')` por `callWorker(doFetch, 'POST', id, '/x')` (y las `'GET'`). Mantener `const doFetch = opts.fetcher ?? fetch;`.

- [ ] **Step 5: Verificar que nada se rompió**

Run: `npx vitest run api/tests/admin.test.ts api/tests/usage.test.ts api/tests/approval-flow.test.ts`
Expected: PASS (comportamiento idéntico; solo se reubicó código). `npm run typecheck` limpio.

- [ ] **Step 6: Commit**

```bash
git add api/src/lib/worker-client.ts api/src/lib/dates.ts api/src/routes/usage.ts api/src/routes/admin.ts
git commit -m "refactor(api): extraer worker-client y startOfMonthUtc de admin.ts"
```

---

### Task 2: Servicio `tenantApproval`

**Files:**
- Create: `api/src/services/tenantApproval.ts`
- Create: `api/tests/tenantApproval.test.ts`

- [ ] **Step 1: Escribir el test**

`api/tests/tenantApproval.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanupDb, testPrisma } from './helpers/app';
import { approveTenant, rejectTenant } from '../src/services/tenantApproval';

async function seedTenant(status = 'provisioning') {
  const tenant = await testPrisma.tenant.create({
    data: { slug: `s-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, name: 'Negocio', industry: 'tapiceria', profileDir: './profiles/tapiceria', status },
  });
  await testPrisma.panelUser.create({
    data: { tenantId: tenant.id, username: 'dueno', email: `d-${Date.now()}@x.com`, passwordHash: 'x', role: 'admin' },
  });
  return tenant;
}

describe('tenantApproval', () => {
  beforeEach(async () => { await cleanupDb(); });

  it('approveTenant aprueba, activa, llama al worker y avisa por email', async () => {
    const tenant = await seedTenant('provisioning');
    const doFetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }) as any);
    const emailSender = { send: vi.fn(async () => {}) };
    const res = await approveTenant(testPrisma, { doFetch, emailSender }, tenant.id);
    expect(res).not.toBeNull();
    const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(after!.approvalStatus).toBe('approved');
    expect(after!.active).toBe(true);
    expect(after!.approvedAt).not.toBeNull();
    expect(doFetch).toHaveBeenCalledTimes(1); // add
    expect(emailSender.send).toHaveBeenCalledTimes(1);
  });

  it('approveTenant devuelve null si el tenant no existe', async () => {
    const res = await approveTenant(testPrisma, { doFetch: vi.fn(), emailSender: { send: vi.fn() } }, 'no-existe');
    expect(res).toBeNull();
  });

  it('rejectTenant rechaza, desactiva y suspende en el worker', async () => {
    const tenant = await seedTenant('active');
    const doFetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }) as any);
    const emailSender = { send: vi.fn(async () => {}) };
    await rejectTenant(testPrisma, { doFetch, emailSender }, tenant.id);
    const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(after!.approvalStatus).toBe('rejected');
    expect(after!.active).toBe(false);
    expect(doFetch).toHaveBeenCalledTimes(1); // suspend
  });

  it('no lanza si el email falla', async () => {
    const tenant = await seedTenant('provisioning');
    const doFetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as any);
    const emailSender = { send: vi.fn(async () => { throw new Error('smtp down'); }) };
    await expect(approveTenant(testPrisma, { doFetch, emailSender }, tenant.id)).resolves.not.toBeNull();
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run api/tests/tenantApproval.test.ts`
Expected: FAIL (módulo `tenantApproval` no existe).

- [ ] **Step 3: Implementar el servicio**

`api/src/services/tenantApproval.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';
import { workerCall } from '../lib/worker-client';
import type { EmailSender } from '../lib/email';
import { accountApprovedEmail, accountRejectedEmail } from '../email/templates';

export interface ApprovalDeps {
  doFetch: typeof fetch;
  emailSender: Pick<EmailSender, 'send'>;
}

/** Email del dueño del tenant (primer PanelUser admin por antigüedad). */
export async function ownerEmail(prisma: PrismaClient, tenantId: string): Promise<string | null> {
  const u = await prisma.panelUser.findFirst({
    where: { tenantId, role: 'admin' },
    orderBy: { createdAt: 'asc' },
    select: { email: true },
  });
  return u?.email ?? null;
}

export async function approveTenant(prisma: PrismaClient, deps: ApprovalDeps, tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return null;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { approvalStatus: 'approved', approvedAt: new Date(), active: true },
  });
  if (tenant.status === 'provisioning' || tenant.status === 'active') {
    await workerCall(deps.doFetch, 'POST', tenantId, '/internal/tenant/add');
  }
  const email = await ownerEmail(prisma, tenantId);
  if (email) {
    const { subject, body } = accountApprovedEmail(tenant.name);
    await deps.emailSender.send(email, subject, body).catch(() => {});
  }
  return tenant;
}

export async function rejectTenant(prisma: PrismaClient, deps: ApprovalDeps, tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return null;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { approvalStatus: 'rejected', active: false },
  });
  await workerCall(deps.doFetch, 'POST', tenantId, '/internal/tenant/suspend');
  const email = await ownerEmail(prisma, tenantId);
  if (email) {
    const { subject, body } = accountRejectedEmail(tenant.name);
    await deps.emailSender.send(email, subject, body).catch(() => {});
  }
  return tenant;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run api/tests/tenantApproval.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/services/tenantApproval.ts api/tests/tenantApproval.test.ts
git commit -m "feat(api): servicio tenantApproval (approve/reject) reutilizable"
```

---

### Task 3: Servicio `tenantDeletion` (hard delete en cascada)

**Files:**
- Create: `api/src/services/tenantDeletion.ts`
- Create: `api/tests/tenantDeletion.test.ts`

- [ ] **Step 1: Escribir el test**

`api/tests/tenantDeletion.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDb, testPrisma } from './helpers/app';
import { hardDeleteTenant } from '../src/services/tenantDeletion';

async function seedFullTenant() {
  const tenant = await testPrisma.tenant.create({
    data: { slug: `s-${Date.now()}`, name: 'Negocio', industry: 'tapiceria', profileDir: './profiles/tapiceria' },
  });
  const user = await testPrisma.panelUser.create({
    data: { tenantId: tenant.id, username: 'dueno', email: `d-${Date.now()}@x.com`, passwordHash: 'x', role: 'admin' },
  });
  await testPrisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: `h-${Date.now()}`, expiresAt: new Date(Date.now() + 1e6) },
  });
  const contact = await testPrisma.contact.create({ data: { tenantId: tenant.id, phoneE164: '+5215555', displayName: 'C' } });
  const job = await testPrisma.job.create({ data: { tenantId: tenant.id, contactId: contact.id, status: 'OPEN_INTAKE', intake: '{}' } });
  await testPrisma.message.create({ data: { tenantId: tenant.id, contactId: contact.id, jobId: job.id, direction: 'inbound', kind: 'text', body: 'hola', externalMsgId: `m-${Date.now()}`, channel: 'whatsapp', raw: '{}' } });
  await testPrisma.agentRun.create({ data: { tenantId: tenant.id, jobId: job.id, model: 'x', inputTokens: 1, outputTokens: 1, costUsd: 0, responseText: 'r' } });
  await testPrisma.notification.create({ data: { tenantId: tenant.id, jobId: job.id, kind: 'ready', channel: 'whatsapp' } });
  await testPrisma.tenantSettings.create({ data: { tenantId: tenant.id, industry: 'tapiceria', businessName: 'N', businessDomain: 'd', ownerPhoneE164: '', welcomeTemplate: 'h', intakeSchema: {} } });
  await testPrisma.emailVerification.create({ data: { tenantId: tenant.id, email: 'v@x.com', token: `t-${Date.now()}`, expiresAt: new Date(Date.now() + 1e6) } });
  // Sobreviven (sin FK a Tenant):
  await testPrisma.legalAcceptance.create({ data: { tenantId: tenant.id, userId: user.id, document: 'terms', version: '1' } });
  await testPrisma.operatorAuditLog.create({ data: { operatorUserId: 'op', tenantId: tenant.id, action: 'approve' } });
  return tenant.id;
}

describe('hardDeleteTenant', () => {
  beforeEach(async () => { await cleanupDb(); });

  it('borra el tenant y todos sus hijos, preservando legal y auditoría', async () => {
    const tenantId = await seedFullTenant();
    const counts = await hardDeleteTenant(testPrisma, tenantId);
    expect(counts.tenant).toBe(1);

    expect(await testPrisma.tenant.count({ where: { id: tenantId } })).toBe(0);
    expect(await testPrisma.message.count({ where: { tenantId } })).toBe(0);
    expect(await testPrisma.job.count({ where: { tenantId } })).toBe(0);
    expect(await testPrisma.contact.count({ where: { tenantId } })).toBe(0);
    expect(await testPrisma.agentRun.count({ where: { tenantId } })).toBe(0);
    expect(await testPrisma.notification.count({ where: { tenantId } })).toBe(0);
    expect(await testPrisma.panelUser.count({ where: { tenantId } })).toBe(0);
    expect(await testPrisma.tenantSettings.count({ where: { tenantId } })).toBe(0);
    expect(await testPrisma.emailVerification.count({ where: { tenantId } })).toBe(0);

    // Preservados:
    expect(await testPrisma.legalAcceptance.count({ where: { tenantId } })).toBe(1);
    expect(await testPrisma.operatorAuditLog.count({ where: { tenantId } })).toBe(1);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run api/tests/tenantDeletion.test.ts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar el servicio**

`api/src/services/tenantDeletion.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';

export interface DeletionCounts {
  passwordResetTokens: number; notifications: number; agentRuns: number;
  messages: number; jobs: number; contacts: number; panelUsers: number;
  emailVerifications: number; tenantSettings: number; subscriptions: number; tenant: number;
}

/**
 * Borra un tenant y TODOS sus datos en orden FK-seguro, dentro de una transacción.
 * PRESERVA LegalAcceptance y OperatorAuditLog (sin FK a Tenant → defensa legal/auditoría).
 */
export async function hardDeleteTenant(prisma: PrismaClient, tenantId: string): Promise<DeletionCounts> {
  const users = await prisma.panelUser.findMany({ where: { tenantId }, select: { id: true } });
  const userIds = users.map((u) => u.id);

  return prisma.$transaction(async (tx) => {
    const passwordResetTokens = userIds.length
      ? (await tx.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } })).count : 0;
    const notifications = (await tx.notification.deleteMany({ where: { tenantId } })).count;
    const agentRuns = (await tx.agentRun.deleteMany({ where: { tenantId } })).count;
    const messages = (await tx.message.deleteMany({ where: { tenantId } })).count;
    const jobs = (await tx.job.deleteMany({ where: { tenantId } })).count;
    const contacts = (await tx.contact.deleteMany({ where: { tenantId } })).count;
    const panelUsers = (await tx.panelUser.deleteMany({ where: { tenantId } })).count;
    const emailVerifications = (await tx.emailVerification.deleteMany({ where: { tenantId } })).count;
    const tenantSettings = (await tx.tenantSettings.deleteMany({ where: { tenantId } })).count;
    const subscriptions = (await tx.subscription.deleteMany({ where: { tenantId } })).count;
    await tx.tenant.delete({ where: { id: tenantId } });
    return { passwordResetTokens, notifications, agentRuns, messages, jobs, contacts, panelUsers, emailVerifications, tenantSettings, subscriptions, tenant: 1 };
  });
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run api/tests/tenantDeletion.test.ts`
Expected: PASS. Si algún `create` de test falla por un campo requerido faltante del schema, ajustar el seed leyendo `prisma/schema.prisma` del modelo correspondiente (no cambiar el servicio).

- [ ] **Step 5: Commit**

```bash
git add api/src/services/tenantDeletion.ts api/tests/tenantDeletion.test.ts
git commit -m "feat(api): servicio hardDeleteTenant (cascada, preserva legal/auditoría)"
```

---

## FASE B — Rutas del superadmin

### Task 4: Fix del dueño (email obligatorio) + editar/eliminar usuario

**Files:**
- Modify: `api/src/routes/platform.ts`
- Modify: `api/tests/platform.test.ts`

- [ ] **Step 1: Escribir los tests**

En `api/tests/platform.test.ts`, añadir el helper `platformHeader` (mostrado arriba en "Helper de auth de plataforma") y estos tests dentro del `describe`:

```typescript
async function seedTenantRow() {
  return testPrisma.tenant.create({
    data: { slug: `s-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, name: 'N', industry: 'tapiceria', profileDir: './profiles/tapiceria' },
  });
}

it('crear dueño exige email y el dueño puede loguear (Bug 1)', async () => {
  const app = await buildTestApp();
  const headers = await platformHeader(app);
  const tenant = await seedTenantRow();
  const res = await app.inject({
    method: 'POST', url: `/platform/tenants/${tenant.id}/users`, headers,
    payload: { username: 'dueno', email: 'dueno@negocio.com', password: 'clave1234' },
  });
  expect(res.statusCode).toBe(201);
  expect(res.json().user).toMatchObject({ username: 'dueno', email: 'dueno@negocio.com', role: 'admin' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'dueno@negocio.com', password: 'clave1234' } });
  expect(login.statusCode).toBe(200);
}, 20000);

it('crear dueño sin email → 400', async () => {
  const app = await buildTestApp();
  const headers = await platformHeader(app);
  const tenant = await seedTenantRow();
  const res = await app.inject({
    method: 'POST', url: `/platform/tenants/${tenant.id}/users`, headers,
    payload: { username: 'dueno', password: 'clave1234' },
  });
  expect(res.statusCode).toBe(400);
}, 20000);

it('editar dueño: nuevo password permite loguear', async () => {
  const app = await buildTestApp();
  const headers = await platformHeader(app);
  const tenant = await seedTenantRow();
  const created = (await app.inject({ method: 'POST', url: `/platform/tenants/${tenant.id}/users`, headers, payload: { username: 'd', email: 'd@x.com', password: 'viejo1234' } })).json().user;
  const res = await app.inject({ method: 'PATCH', url: `/platform/tenants/${tenant.id}/users/${created.id}`, headers, payload: { password: 'nuevo1234' } });
  expect(res.statusCode).toBe(200);
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'd@x.com', password: 'nuevo1234' } });
  expect(login.statusCode).toBe(200);
}, 20000);

it('eliminar dueño lo quita', async () => {
  const app = await buildTestApp();
  const headers = await platformHeader(app);
  const tenant = await seedTenantRow();
  const created = (await app.inject({ method: 'POST', url: `/platform/tenants/${tenant.id}/users`, headers, payload: { username: 'd', email: 'd2@x.com', password: 'viejo1234' } })).json().user;
  const res = await app.inject({ method: 'DELETE', url: `/platform/tenants/${tenant.id}/users/${created.id}`, headers });
  expect(res.statusCode).toBe(200);
  expect(await testPrisma.panelUser.count({ where: { id: created.id } })).toBe(0);
}, 20000);
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run api/tests/platform.test.ts`
Expected: FAIL los nuevos (create sin email hoy pasa; PATCH/DELETE user no existen).

- [ ] **Step 3: Implementar en `platform.ts`**

Cambiar `CreateTenantUserZ` (arriba del archivo):

```typescript
const CreateTenantUserZ = z.object({
  username: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});
const UpdateTenantUserZ = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
});
```

En el handler `POST /platform/tenants/:tenantId/users`, cambiar el `data` de `panelUser.create` a incluir email y rol fijo `admin`, y el `select` a incluir email:

```typescript
      const user = await prisma.panelUser.create({
        data: { tenantId, username: parse.data.username, email: parse.data.email, passwordHash, role: 'admin' },
        select: { id: true, username: true, email: true, role: true, createdAt: true },
      });
```

Añadir el import de bcrypt ya existe. Añadir dos rutas nuevas al final de `platformRoutes` (antes del cierre `}`):

```typescript
  app.patch('/platform/tenants/:tenantId/users/:userId', { preHandler: app.authenticatePlatform }, async (request, reply) => {
    const { tenantId, userId } = request.params as { tenantId: string; userId: string };
    const parse = UpdateTenantUserZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'datos invalidos' });
    const prisma = getPrisma();
    const existing = await prisma.panelUser.findFirst({ where: { id: userId, tenantId } });
    if (!existing) return reply.code(404).send({ error: 'usuario no encontrado' });
    const data: Record<string, unknown> = {};
    if (parse.data.email !== undefined) data.email = parse.data.email;
    if (parse.data.password !== undefined) {
      data.passwordHash = await bcrypt.hash(parse.data.password, 10);
      data.passwordChangedAt = new Date();
    }
    try {
      const user = await prisma.panelUser.update({
        where: { id: userId }, data,
        select: { id: true, username: true, email: true, role: true, createdAt: true },
      });
      return { ok: true, user };
    } catch (err: any) {
      if (err?.code === 'P2002') return reply.code(409).send({ error: 'email ya existe' });
      throw err;
    }
  });

  app.delete('/platform/tenants/:tenantId/users/:userId', { preHandler: app.authenticatePlatform }, async (request, reply) => {
    const { tenantId, userId } = request.params as { tenantId: string; userId: string };
    const prisma = getPrisma();
    const existing = await prisma.panelUser.findFirst({ where: { id: userId, tenantId } });
    if (!existing) return reply.code(404).send({ error: 'usuario no encontrado' });
    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { userId } }),
      prisma.panelUser.delete({ where: { id: userId } }),
    ]);
    return { ok: true };
  });
```

También en `GET /platform/tenants/:tenantId/users`, añadir `email: true` al `select`.

- [ ] **Step 4: Verificar que pasan**

Run: `npx vitest run api/tests/platform.test.ts`
Expected: PASS (incluye los existentes; el test viejo de "crear usuario" que enviaba `role` o sin email debe actualizarse: si hay un test previo de creación de usuario sin email, añadirle `email`).
`npm run typecheck` limpio.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/platform.ts api/tests/platform.test.ts
git commit -m "feat(api): dueño con email obligatorio + editar/eliminar usuario (fix login)"
```

---

### Task 5: Portar aprobación/límite/estado del operador al superadmin

**Files:**
- Modify: `api/src/routes/platform.ts`
- Modify: `api/tests/platform.test.ts`

- [ ] **Step 1: Escribir los tests**

Añadir a `platform.test.ts` (usan `fetcher` inyectado; `buildTestApp` acepta `{ fetcher, emailSender }` — confirmarlo en `api/tests/helpers/app.ts`; si no, ver Step 3 nota):

```typescript
async function seedPendingTenant() {
  const tenant = await testPrisma.tenant.create({
    data: { slug: `s-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, name: 'N', industry: 'tapiceria', profileDir: './profiles/tapiceria', status: 'provisioning', approvalStatus: 'pending', active: false },
  });
  await testPrisma.panelUser.create({ data: { tenantId: tenant.id, username: 'd', email: `d-${Date.now()}@x.com`, passwordHash: 'x', role: 'admin' } });
  return tenant;
}

it('aprobar cuenta desde el superadmin', async () => {
  const fetcher = async () => ({ ok: true, json: async () => ({ ok: true }) }) as any;
  const app = await buildTestApp({ fetcher });
  const headers = await platformHeader(app);
  const tenant = await seedPendingTenant();
  const res = await app.inject({ method: 'POST', url: `/platform/tenants/${tenant.id}/approve`, headers });
  expect(res.statusCode).toBe(200);
  expect(res.json().approvalStatus).toBe('approved');
  const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
  expect(after!.active).toBe(true);
  expect(await testPrisma.operatorAuditLog.count({ where: { tenantId: tenant.id, action: 'approve' } })).toBe(1);
}, 20000);

it('rechazar cuenta', async () => {
  const fetcher = async () => ({ ok: true, json: async () => ({}) }) as any;
  const app = await buildTestApp({ fetcher });
  const headers = await platformHeader(app);
  const tenant = await seedPendingTenant();
  const res = await app.inject({ method: 'POST', url: `/platform/tenants/${tenant.id}/reject`, headers });
  expect(res.statusCode).toBe(200);
  expect((await testPrisma.tenant.findUnique({ where: { id: tenant.id } }))!.approvalStatus).toBe('rejected');
}, 20000);

it('editar límite mensual', async () => {
  const app = await buildTestApp();
  const headers = await platformHeader(app);
  const tenant = await seedPendingTenant();
  const res = await app.inject({ method: 'PATCH', url: `/platform/tenants/${tenant.id}/limit`, headers, payload: { monthlyRunLimit: 500 } });
  expect(res.statusCode).toBe(200);
  expect((await testPrisma.tenant.findUnique({ where: { id: tenant.id } }))!.monthlyRunLimit).toBe(500);
}, 20000);

it('GET /platform/tenants incluye approvalStatus y monthUsed', async () => {
  const app = await buildTestApp();
  const headers = await platformHeader(app);
  await seedPendingTenant();
  const res = await app.inject({ method: 'GET', url: '/platform/tenants', headers });
  expect(res.statusCode).toBe(200);
  expect(res.json().tenants[0]).toHaveProperty('approvalStatus');
  expect(res.json().tenants[0]).toHaveProperty('monthUsed');
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run api/tests/platform.test.ts`
Expected: FAIL los nuevos.

- [ ] **Step 3: Implementar en `platform.ts`**

Añadir imports arriba:

```typescript
import { startOfMonthUtc } from '../lib/dates';
import { workerCall } from '../lib/worker-client';
import { approveTenant, rejectTenant } from '../services/tenantApproval';
import { getEmailSender } from '../lib/email';
import { freeMonthlyRunLimit } from '../env';
```

Cambiar la firma para aceptar opciones (fetcher/emailSender), igual que `adminRoutes`:

```typescript
export async function platformRoutes(app: FastifyInstance, opts: { fetcher?: typeof fetch; emailSender?: import('../lib/email').EmailSender } = {}) {
  const doFetch = opts.fetcher ?? fetch;
  const emailSender = opts.emailSender ?? getEmailSender();
```

Nota: si `buildTestApp` no propaga `fetcher`/`emailSender` a `platformRoutes`, actualizar `api/tests/helpers/app.ts` y `api/src/server.ts` (registro de `platformRoutes`) para pasarlos — ver Task 7 Step donde se ajusta el registro; hazlo aquí si el test lo requiere.

Reemplazar el handler existente `GET /platform/tenants` por la versión ampliada:

```typescript
  app.get('/platform/tenants', { preHandler: app.authenticatePlatform }, async () => {
    const prisma = getPrisma();
    const [tenants, usage] = await Promise.all([
      prisma.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          subscription: { select: { status: true, currentPeriodEnd: true } },
          _count: { select: { panelUsers: true, contacts: true, jobs: true } },
        },
      }),
      prisma.agentRun.groupBy({ by: ['tenantId'], where: { createdAt: { gte: startOfMonthUtc() } }, _count: { _all: true } }),
    ]);
    const used = new Map(usage.map((u) => [u.tenantId, u._count._all]));
    return {
      defaultMonthlyLimit: freeMonthlyRunLimit(),
      tenants: tenants.map((t) => ({
        id: t.id, slug: t.slug, name: t.name, industry: t.industry, profileDir: t.profileDir,
        status: t.status, createdAt: t.createdAt, approvalStatus: t.approvalStatus, approvedAt: t.approvedAt,
        monthlyRunLimit: t.monthlyRunLimit, monthUsed: used.get(t.id) ?? 0,
        subscription: t.subscription?.status ?? null, currentPeriodEnd: t.subscription?.currentPeriodEnd ?? null,
        _count: t._count,
      })),
    };
  });
```

Añadir estas rutas al final:

```typescript
  async function audit(platformUserId: string, tenantId: string, action: string) {
    await getPrisma().operatorAuditLog.create({ data: { operatorUserId: platformUserId, tenantId, action } });
  }

  app.post('/platform/tenants/:id/approve', { preHandler: app.authenticatePlatform }, async (request: any, reply) => {
    const t = await approveTenant(getPrisma(), { doFetch, emailSender }, request.params.id);
    if (!t) return reply.code(404).send({ error: 'tenant no encontrado' });
    await audit(request.platformUser.userId, request.params.id, 'approve');
    return { ok: true, approvalStatus: 'approved' };
  });

  app.post('/platform/tenants/:id/reject', { preHandler: app.authenticatePlatform }, async (request: any, reply) => {
    const t = await rejectTenant(getPrisma(), { doFetch, emailSender }, request.params.id);
    if (!t) return reply.code(404).send({ error: 'tenant no encontrado' });
    await audit(request.platformUser.userId, request.params.id, 'reject');
    return { ok: true, approvalStatus: 'rejected' };
  });

  app.patch('/platform/tenants/:id/limit', { preHandler: app.authenticatePlatform }, async (request: any, reply) => {
    const raw = request.body?.monthlyRunLimit;
    const monthlyRunLimit = raw === null ? null : Number(raw);
    if (monthlyRunLimit !== null && (!Number.isInteger(monthlyRunLimit) || monthlyRunLimit < 0)) {
      return reply.code(400).send({ error: 'monthlyRunLimit debe ser entero >= 0 o null' });
    }
    const prisma = getPrisma();
    const tenant = await prisma.tenant.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!tenant) return reply.code(404).send({ error: 'tenant no encontrado' });
    await prisma.tenant.update({ where: { id: request.params.id }, data: { monthlyRunLimit } });
    await audit(request.platformUser.userId, request.params.id, 'set_limit');
    return { ok: true, monthlyRunLimit };
  });

  app.post('/platform/tenants/:id/suspend', { preHandler: app.authenticatePlatform }, async (request: any) => {
    await workerCall(doFetch, 'POST', request.params.id, '/internal/tenant/suspend');
    await getPrisma().tenant.update({ where: { id: request.params.id }, data: { status: 'suspended' } });
    await audit(request.platformUser.userId, request.params.id, 'suspend');
    return { ok: true };
  });

  app.post('/platform/tenants/:id/reactivate', { preHandler: app.authenticatePlatform }, async (request: any) => {
    await workerCall(doFetch, 'POST', request.params.id, '/internal/tenant/resume');
    await getPrisma().tenant.update({ where: { id: request.params.id }, data: { status: 'active' } });
    await audit(request.platformUser.userId, request.params.id, 'reactivate');
    return { ok: true };
  });

  app.post('/platform/tenants/:id/bot/reconnect', { preHandler: app.authenticatePlatform }, async (request: any) => {
    await workerCall(doFetch, 'POST', request.params.id, '/internal/wa-reconnect');
    await audit(request.platformUser.userId, request.params.id, 'bot_reconnect');
    return { ok: true };
  });
```

- [ ] **Step 4: Verificar que pasan**

Run: `npx vitest run api/tests/platform.test.ts`
Expected: PASS. `npm run typecheck` limpio.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/platform.ts api/tests/platform.test.ts api/tests/helpers/app.ts api/src/server.ts
git commit -m "feat(api): aprobación, límite y estado del bot en el panel superadmin"
```

---

### Task 6: Editar y eliminar tenant

**Files:**
- Modify: `api/src/routes/platform.ts`
- Modify: `api/tests/platform.test.ts`

- [ ] **Step 1: Escribir los tests**

```typescript
it('editar nombre/industria del tenant', async () => {
  const app = await buildTestApp();
  const headers = await platformHeader(app);
  const tenant = await seedTenantRow();
  const res = await app.inject({ method: 'PATCH', url: `/platform/tenants/${tenant.id}`, headers, payload: { name: 'Nuevo Nombre', industry: 'paqueteria' } });
  expect(res.statusCode).toBe(200);
  const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
  expect(after!.name).toBe('Nuevo Nombre');
  expect(after!.industry).toBe('paqueteria');
});

it('eliminar tenant exige confirmSlug correcto', async () => {
  const app = await buildTestApp();
  const headers = await platformHeader(app);
  const tenant = await seedTenantRow();
  const bad = await app.inject({ method: 'DELETE', url: `/platform/tenants/${tenant.id}`, headers, payload: { confirmSlug: 'otro' } });
  expect(bad.statusCode).toBe(400);
  const ok = await app.inject({ method: 'DELETE', url: `/platform/tenants/${tenant.id}`, headers, payload: { confirmSlug: tenant.slug } });
  expect(ok.statusCode).toBe(200);
  expect(await testPrisma.tenant.count({ where: { id: tenant.id } })).toBe(0);
});

it('eliminar tenant inexistente → 404', async () => {
  const app = await buildTestApp();
  const headers = await platformHeader(app);
  const res = await app.inject({ method: 'DELETE', url: `/platform/tenants/no-existe`, headers, payload: { confirmSlug: 'x' } });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run api/tests/platform.test.ts`
Expected: FAIL los nuevos.

- [ ] **Step 3: Implementar en `platform.ts`**

Añadir import: `import { hardDeleteTenant } from '../services/tenantDeletion';`. Añadir schema y rutas:

```typescript
const UpdateTenantZ = z.object({
  name: z.string().min(1).optional(),
  industry: z.string().min(1).optional(),
});

  app.patch('/platform/tenants/:id', { preHandler: app.authenticatePlatform }, async (request: any, reply) => {
    const parse = UpdateTenantZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: 'datos invalidos' });
    const prisma = getPrisma();
    const tenant = await prisma.tenant.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!tenant) return reply.code(404).send({ error: 'tenant no encontrado' });
    const updated = await prisma.tenant.update({ where: { id: request.params.id }, data: parse.data });
    return { ok: true, tenant: { id: updated.id, slug: updated.slug, name: updated.name, industry: updated.industry } };
  });

  app.delete('/platform/tenants/:id', { preHandler: app.authenticatePlatform }, async (request: any, reply) => {
    const prisma = getPrisma();
    const tenant = await prisma.tenant.findUnique({ where: { id: request.params.id } });
    if (!tenant) return reply.code(404).send({ error: 'tenant no encontrado' });
    if ((request.body?.confirmSlug ?? '') !== tenant.slug) {
      return reply.code(400).send({ error: 'confirmSlug no coincide con el slug del tenant' });
    }
    await audit(request.platformUser.userId, tenant.id, 'delete'); // antes de borrar; OperatorAuditLog sobrevive
    await workerCall(doFetch, 'POST', tenant.id, '/internal/tenant/suspend');
    const counts = await hardDeleteTenant(prisma, tenant.id);
    return { ok: true, counts };
  });
```

- [ ] **Step 4: Verificar que pasan**

Run: `npx vitest run api/tests/platform.test.ts`
Expected: PASS. `npm run typecheck` limpio.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/platform.ts api/tests/platform.test.ts
git commit -m "feat(api): editar y eliminar tenant desde el superadmin"
```

---

## FASE C — Retirar el operador (backend)

### Task 7: Eliminar `admin.ts`, `requireOperator` y su registro

**Files:**
- Delete: `api/src/routes/admin.ts`, `api/tests/admin.test.ts`, `api/tests/approval-flow.test.ts`
- Modify: `api/src/server.ts`, `api/src/types.d.ts`, `api/src/billing/access.ts`, `api/src/env.ts`

- [ ] **Step 1: Borrar archivos**

```bash
git rm api/src/routes/admin.ts api/tests/admin.test.ts api/tests/approval-flow.test.ts
```

- [ ] **Step 2: Limpiar `api/src/server.ts`**

- Quitar `import { adminRoutes } from './routes/admin';` (línea ~20).
- Quitar la línea `await app.register(adminRoutes, { fetcher: opts.fetcher, emailSender: opts.emailSender });` (~246).
- Quitar el decorator `requireOperator` (bloque ~182-186, incluido su comentario).
- En la lista de exención del enforcement (~156), quitar `&& !url.startsWith('/admin')`. NO añadir `/platform`: ese enforcement vive en el camino de `app.authenticate` (usa `request.tenantId`), y las rutas `/platform` usan `authenticatePlatform`, por lo que nunca lo tocan (los tests de platform de `master` ya pasan sin exención). Solo se elimina la exención de `/admin` porque `/admin` desaparece.

- [ ] **Step 3: Limpiar `api/src/types.d.ts`**

Quitar la línea `requireOperator: (request: any, reply: any) => Promise<void>;`.

- [ ] **Step 4: Actualizar comentarios**

En `api/src/billing/access.ts` y `api/src/env.ts`, cambiar las menciones "desde /admin" / "el operador la aprobó desde /admin" por "desde el panel superadmin". (Solo comentarios.)

- [ ] **Step 5: Verificar toda la suite api**

Run: `npm test`
Expected: PASS. Si algún test residual importaba de `./admin`, actualizar su import a `../lib/dates` o eliminarlo si era del operador. `npm run typecheck` limpio.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(api): retirar el panel operador /admin y requireOperator"
```

---

## FASE D — SPA

### Task 8: Cliente API — quitar admin*, añadir platform*

**Files:**
- Modify: `spa/src/api/client.ts`

- [ ] **Step 1: Quitar métodos e interfaz del operador**

Borrar de `client.ts` los métodos `getAdminTenants`, `adminSuspend`, `adminReactivate`, `adminReconnect`, `adminApprove`, `adminReject`, `adminSetLimit` (líneas ~114-121) y la interfaz `AdminTenant`.

- [ ] **Step 2: Ampliar interfaces y métodos platform**

En `PlatformTenant` añadir: `status: string; approvalStatus: 'pending'|'approved'|'rejected'; approvedAt: string|null; monthlyRunLimit: number|null; monthUsed: number; subscription: string|null;`. En `PlatformTenantUser` cambiar `role: 'admin'|'viewer'` por `role: string` y añadir `email: string|null`. En el tipo de creación de usuario, reemplazar `{ username; password; role }` por `{ username: string; email: string; password: string }`.

Añadir a `platformApi`:

```typescript
  updateTenant: (id: string, payload: { name?: string; industry?: string }) =>
    platformRequest<{ ok: boolean; tenant: PlatformTenant }>('PATCH', `/platform/tenants/${id}`, payload),
  deleteTenant: (id: string, confirmSlug: string) =>
    platformRequest<{ ok: boolean }>('DELETE', `/platform/tenants/${id}`, { confirmSlug }),
  approveTenant: (id: string) => platformRequest<{ ok: boolean; approvalStatus: string }>('POST', `/platform/tenants/${id}/approve`),
  rejectTenant: (id: string) => platformRequest<{ ok: boolean; approvalStatus: string }>('POST', `/platform/tenants/${id}/reject`),
  setLimit: (id: string, monthlyRunLimit: number | null) =>
    platformRequest<{ ok: boolean; monthlyRunLimit: number | null }>('PATCH', `/platform/tenants/${id}/limit`, { monthlyRunLimit }),
  suspendTenant: (id: string) => platformRequest<{ ok: boolean }>('POST', `/platform/tenants/${id}/suspend`),
  reactivateTenant: (id: string) => platformRequest<{ ok: boolean }>('POST', `/platform/tenants/${id}/reactivate`),
  reconnectBot: (id: string) => platformRequest<{ ok: boolean }>('POST', `/platform/tenants/${id}/bot/reconnect`),
  updateTenantUser: (tenantId: string, userId: string, payload: { email?: string; password?: string }) =>
    platformRequest<{ ok: boolean; user: PlatformTenantUser }>('PATCH', `/platform/tenants/${tenantId}/users/${userId}`, payload),
  deleteTenantUser: (tenantId: string, userId: string) =>
    platformRequest<{ ok: boolean }>('DELETE', `/platform/tenants/${tenantId}/users/${userId}`),
```

- [ ] **Step 3: Typecheck**

Run: `cd spa; npx tsc --noEmit`
Expected: puede fallar en `Admin.tsx`/`PlatformDashboard.tsx` que usan lo viejo — se arregla en Tasks 9-10. Confirmar que `client.ts` en sí no tiene errores propios (los errores deben ser solo en consumidores). Continuar.

- [ ] **Step 4: Commit**

```bash
git add spa/src/api/client.ts
git commit -m "feat(spa): cliente platform ampliado; quitar cliente admin"
```

---

### Task 9: Quitar la página y rutas del operador en la SPA

**Files:**
- Delete: `spa/src/pages/Admin.tsx`, `spa/src/pages/Admin.test.tsx`
- Modify: `spa/src/App.tsx`, `spa/src/components/Layout.tsx`

- [ ] **Step 1: Borrar y limpiar**

```bash
git rm spa/src/pages/Admin.tsx spa/src/pages/Admin.test.tsx
```

En `spa/src/App.tsx`: quitar `import Admin from './pages/Admin';` (línea ~16) y `<Route path="/admin" element={<Admin />} />` (~54).
En `spa/src/components/Layout.tsx`: quitar la línea `{user?.role === 'operator' && <NavLink to="/admin">Operador</NavLink>}` (~33).

- [ ] **Step 2: Typecheck + tests SPA**

Run: `cd spa; npx tsc --noEmit; npx vitest run`
Expected: sin errores por Admin (PlatformDashboard aún puede fallar hasta Task 10). Si `PlatformDashboard.tsx` rompe el typecheck por los tipos nuevos, seguir a Task 10 y verificar al final.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(spa): quitar la página y rutas del operador"
```

---

### Task 10: PlatformDashboard — aprobar/editar/eliminar tenant y dueño

**Files:**
- Modify: `spa/src/pages/PlatformDashboard.tsx`
- Create: `spa/src/pages/PlatformDashboard.test.tsx`

- [ ] **Step 1: Escribir el test**

`spa/src/pages/PlatformDashboard.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeEach, test, expect } from 'vitest';
import PlatformDashboard from './PlatformDashboard';

vi.mock('../api/client', () => ({
  platformApi: {
    getTenants: vi.fn(),
    getTenantUsers: vi.fn(),
    createTenant: vi.fn(),
    createTenantUser: vi.fn(),
    updateTenant: vi.fn(),
    deleteTenant: vi.fn(),
    approveTenant: vi.fn(),
    rejectTenant: vi.fn(),
    setLimit: vi.fn(),
    suspendTenant: vi.fn(),
    reactivateTenant: vi.fn(),
    reconnectBot: vi.fn(),
    updateTenantUser: vi.fn(),
    deleteTenantUser: vi.fn(),
  },
}));
import { platformApi } from '../api/client';

const TENANT = { id: 't1', slug: 'demo', name: 'Demo', industry: 'tapiceria', status: 'provisioning', approvalStatus: 'pending', approvedAt: null, monthlyRunLimit: null, monthUsed: 0, subscription: null, createdAt: '2026-07-01' };

beforeEach(() => {
  (platformApi.getTenants as any).mockResolvedValue({ tenants: [TENANT], defaultMonthlyLimit: 300 });
  (platformApi.getTenantUsers as any).mockResolvedValue({ users: [] });
  (platformApi.approveTenant as any).mockResolvedValue({ ok: true, approvalStatus: 'approved' });
  (platformApi.deleteTenant as any).mockResolvedValue({ ok: true });
});

test('muestra el tenant pendiente y permite aprobar', async () => {
  render(<PlatformDashboard />);
  await screen.findByText('Demo');
  fireEvent.click(screen.getByRole('button', { name: /Aprobar/i }));
  await waitFor(() => expect(platformApi.approveTenant).toHaveBeenCalledWith('t1'));
});

test('eliminar exige escribir el slug', async () => {
  render(<PlatformDashboard />);
  await screen.findByText('Demo');
  fireEvent.click(screen.getByRole('button', { name: /Eliminar/i }));
  const input = await screen.findByPlaceholderText(/slug/i);
  fireEvent.change(input, { target: { value: 'demo' } });
  fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
  await waitFor(() => expect(platformApi.deleteTenant).toHaveBeenCalledWith('t1', 'demo'));
});
```

- [ ] **Step 2: Verificar que falla**

Run: `cd spa; npx vitest run src/pages/PlatformDashboard.test.tsx`
Expected: FAIL (no existen los botones Aprobar/Eliminar).

- [ ] **Step 3: Implementar la UI**

En `spa/src/pages/PlatformDashboard.tsx`, en el bloque que renderiza cada tenant de la lista (donde hoy hay `<button onClick={() => setSelectedTenantId(tenant.id)}>`), añadir por tenant:
- Badge con `tenant.approvalStatus`.
- Si `approvalStatus === 'pending'`: botones **Aprobar** (`onClick={() => act(() => platformApi.approveTenant(tenant.id))}`) y **Rechazar** (`platformApi.rejectTenant`).
- Botón **Eliminar** que abre un modal con `<input placeholder="escribe el slug (demo)">` y botón **Confirmar** que llama `platformApi.deleteTenant(tenant.id, typed)` solo si `typed === tenant.slug`.
- (Opcional visible) editar nombre/industria (inputs + guardar → `platformApi.updateTenant`), límite (input → `setLimit`), suspender/reactivar/reconectar.

Definir un helper `act` que ejecuta la promesa, muestra error/mensaje y recarga `loadTenants()`:

```tsx
async function act(fn: () => Promise<unknown>) {
  setError(null); setMessage(null);
  try { await fn(); setMessage('Listo.'); await loadTenants(); }
  catch (e) { setError(e instanceof Error ? e.message : 'error'); }
}
```

Para el dueño (en la sección de usuarios del tenant seleccionado): el form de crear usuario ahora tiene **email** (input requerido) + username + password, sin selección de rol; y por cada usuario listado, botones **Editar** (email/reset password → `updateTenantUser`) y **Eliminar** (`deleteTenantUser`).

- [ ] **Step 4: Verificar que pasa**

Run: `cd spa; npx vitest run src/pages/PlatformDashboard.test.tsx; npx tsc --noEmit`
Expected: PASS + typecheck limpio.

- [ ] **Step 5: Commit**

```bash
git add spa/src/pages/PlatformDashboard.tsx spa/src/pages/PlatformDashboard.test.tsx
git commit -m "feat(spa): aprobar/editar/eliminar tenant y dueño en el superadmin"
```

---

## FASE E — Bug 2 y verificación

### Task 11: Guard de Windows del backfill

**Files:**
- Modify: `scripts/backfill-tenant-settings.ts`

- [ ] **Step 1: Corregir el guard**

En `scripts/backfill-tenant-settings.ts`, añadir el import y reemplazar el guard final:

```typescript
import { pathToFileURL } from 'node:url';
// ...
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 2: Verificar que ejecuta en Windows**

Run (PowerShell, contra la BD de dev):
```powershell
$env:DATABASE_URL='postgres://intake:intake@localhost:5433/intake'; npx tsx scripts/backfill-tenant-settings.ts
```
Expected: imprime `[backfill] TenantSettings actualizado para N tenant(s).` (N ≥ 0). Antes no imprimía nada.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-tenant-settings.ts
git commit -m "fix(scripts): guard de ejecución directa compatible con Windows (pathToFileURL)"
```

---

### Task 12: Verificación completa

- [ ] **Step 1: Suite raíz + api**

Run: `npm test`
Expected: PASS (sin los tests del operador; con los nuevos de platform/tenantApproval/tenantDeletion).

- [ ] **Step 2: Typecheck raíz**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 3: SPA**

Run: `cd spa; npx vitest run; npx tsc --noEmit`
Expected: PASS + sin errores (sin `Admin.test.tsx`; con `PlatformDashboard.test.tsx`).

- [ ] **Step 4: Grep de residuos del operador**

Run: `git grep -nE "requireOperator|routes/admin|adminApprove|/admin/tenants|role === 'operator'"`
Expected: sin coincidencias en código (solo, a lo sumo, en specs/planes/docs históricos).

---

## Notas para el ejecutor

- **Auth de plataforma es por Bearer token** (no cookie): los tests obtienen el token de `POST /platform/auth/login` y lo pasan en `authorization`.
- Si `buildTestApp`/`server.ts` no propagan `fetcher`/`emailSender` a `platformRoutes`, ajústalo en Task 5 (el registro `app.register(platformRoutes, { fetcher, emailSender })` y la firma de `buildTestApp`).
- `OperatorAuditLog` conserva su nombre; guarda el `id` del `PlatformUser` en `operatorUserId` (sin FK).
- Al terminar: `superpowers:finishing-a-development-branch` (push a `master` → Railway redeploya API+worker; la migración de platform ya está aplicada, no hay nuevas).
```
