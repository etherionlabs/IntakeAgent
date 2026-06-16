# Administración de trabajos y contactos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir al dueño archivar/restaurar, borrar definitivamente y editar trabajos y contactos desde el panel (API + SPA).

**Architecture:** Soft delete vía columna `archivedAt` en `Job` y `Contact`; hard delete vía funciones de servicio transaccionales filtradas por tenant; listados excluyen archivados por defecto; SPA con confirmaciones. Resurgir contacto archivado al recibir nuevo inbound.

**Tech Stack:** Prisma 7 (adapter-pg), Fastify 5 + @fastify/jwt, React 18 + Vite + react-router 6, vitest.

**Spec:** `docs/superpowers/specs/2026-06-16-job-contact-admin-design.md`

**Convención de tests con DB:** vitest y el Prisma CLI NO auto-cargan `.env`. Prefijar SIEMPRE:
`DATABASE_URL="postgres://intake:intake@localhost:5433/intake"`

---

## File Structure

- `prisma/schema.prisma` — + `archivedAt DateTime?` en `Job` y `Contact` (Tarea 1).
- `prisma/migrations/<ts>_add_archivedat/migration.sql` — migración (Tarea 1).
- `src/services/job.ts` — `archiveJob`, `restoreJob`, `hardDeleteJob` (Tarea 2).
- `src/services/contact.ts` — `archiveContact`, `restoreContact`, `updateContact`, `hardDeleteContact` (Tarea 3).
- `src/pipeline/resolveContact.ts` — resurgir contacto archivado (Tarea 4).
- `api/src/routes/jobs.ts` — archive/restore/delete + `includeArchived` (Tarea 5).
- `api/src/routes/contacts.ts` — archive/restore/delete + PATCH ampliado + `includeArchived` (Tarea 6).
- `spa/src/api/client.ts` — métodos nuevos (Tarea 7).
- `spa/src/components/ConfirmDialog.tsx` — diálogo reutilizable (Tarea 8).
- `spa/src/pages/JobDetail.tsx` — archivar + eliminar (Tarea 9).
- `spa/src/pages/Contacts.tsx` — editar/archivar/restaurar/eliminar + toggle archivados (Tarea 10).

Tests: `tests/services/job.test.ts`, `tests/services/contact.test.ts`, `tests/pipeline/resolveContact.test.ts`, `api/tests/jobs.test.ts`, `api/tests/contacts.test.ts`, `spa/src/pages/Contacts.test.tsx`, `spa/src/pages/JobDetail.test.tsx`.

---

### Task 1: Migración — `archivedAt` en Job y Contact

**Files:**
- Modify: `prisma/schema.prisma` (modelos `Job` y `Contact`)
- Create: `prisma/migrations/<timestamp>_add_archivedat_to_job_and_contact/migration.sql`

- [ ] **Step 1: Agregar la columna en el schema**

En `model Job { ... }` agregar junto a los demás campos de fecha (ej. tras `closedAt`):
```prisma
  archivedAt      DateTime?
```
En `model Contact { ... }` agregar (ej. tras `flaggedReason`):
```prisma
  archivedAt       DateTime?
```

- [ ] **Step 2: Generar la migración y el cliente**

Run:
```
DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx prisma migrate dev --name add_archivedat_to_job_and_contact
```
Expected: crea `prisma/migrations/<ts>_add_archivedat_to_job_and_contact/migration.sql` con dos `ALTER TABLE ... ADD COLUMN "archivedAt"`, aplica y regenera el cliente. Si el comando pide confirmación interactiva, abortar y crear el SQL a mano (Step 2b).

- [ ] **Step 2b (solo si migrate dev no es viable): SQL manual**

Crear `prisma/migrations/20260616010000_add_archivedat_to_job_and_contact/migration.sql`:
```sql
ALTER TABLE "Job" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN "archivedAt" TIMESTAMP(3);
```
Luego:
```
DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx prisma migrate deploy
DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx prisma generate
```

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores (el cliente conoce `archivedAt`).

- [ ] **Step 4: Commit**
```
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): columna archivedAt en Job y Contact (soft delete)"
```

---

### Task 2: Servicios de Job — archive / restore / hardDelete

**Files:**
- Modify: `src/services/job.ts`
- Test: `tests/services/job.test.ts`

- [ ] **Step 1: Escribir tests que fallan**

Agregar al final del archivo, ANTES del cierre del último `describe` o como nuevo `describe` (usa el patrón existente con `cleanup`/`seedTestTenant`). Añadir imports `archiveJob, restoreJob, hardDeleteJob` a la lista importada desde `../../src/services/job`.

```ts
describe('archivado y borrado de job', () => {
  beforeEach(async () => { await cleanup(); await seedTestTenant(); });

  it('archiveJob setea archivedAt y restoreJob lo limpia', async () => {
    const contact = await createContact('+5215550000010');
    const job = await openJob(prisma, T, contact.id, createEmptyIntakeFromSchema(schema));
    const archived = await archiveJob(prisma, T, job.id);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    const restored = await restoreJob(prisma, T, job.id);
    expect(restored.archivedAt).toBeNull();
  });

  it('hardDeleteJob borra el job y sus mensajes/agentRuns/notifications', async () => {
    const contact = await createContact('+5215550000011');
    const job = await openJob(prisma, T, contact.id, createEmptyIntakeFromSchema(schema));
    await prisma.message.create({ data: { tenantId: T, contactId: contact.id, jobId: job.id, direction: 'inbound', kind: 'text', body: 'hola' } });
    await prisma.agentRun.create({ data: { tenantId: T, jobId: job.id, triggerMessageIds: '[]', model: 'm', toolCalls: '[]' } });
    await prisma.notification.create({ data: { tenantId: T, jobId: job.id, kind: 'owner_ready', sentVia: 'panel_only' } });

    await hardDeleteJob(prisma, T, job.id);

    expect(await prisma.job.findFirst({ where: { id: job.id } })).toBeNull();
    expect(await prisma.message.count({ where: { jobId: job.id } })).toBe(0);
    expect(await prisma.agentRun.count({ where: { jobId: job.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { jobId: job.id } })).toBe(0);
  });

  it('hardDeleteJob de otro tenant lanza JOB_NOT_FOUND', async () => {
    const contact = await createContact('+5215550000012');
    const job = await openJob(prisma, T, contact.id, createEmptyIntakeFromSchema(schema));
    await expect(hardDeleteJob(prisma, 'tenant-ajeno', job.id)).rejects.toThrow(/no existe/i);
    expect(await prisma.job.findFirst({ where: { id: job.id } })).not.toBeNull();
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx vitest run tests/services/job.test.ts`
Expected: FAIL (archiveJob/restoreJob/hardDeleteJob no existen).

- [ ] **Step 3: Implementar en `src/services/job.ts`**

Agregar al final del archivo:
```ts
export async function archiveJob(prisma: PrismaClient, tenantId: string, jobId: string): Promise<Job> {
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId } });
  if (!job) throw new ServiceError(`job ${jobId} no existe`, 'JOB_NOT_FOUND');
  return prisma.job.update({ where: { id: jobId, tenantId }, data: { archivedAt: new Date() } });
}

export async function restoreJob(prisma: PrismaClient, tenantId: string, jobId: string): Promise<Job> {
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId } });
  if (!job) throw new ServiceError(`job ${jobId} no existe`, 'JOB_NOT_FOUND');
  return prisma.job.update({ where: { id: jobId, tenantId }, data: { archivedAt: null } });
}

export async function hardDeleteJob(prisma: PrismaClient, tenantId: string, jobId: string): Promise<void> {
  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId } });
  if (!job) throw new ServiceError(`job ${jobId} no existe`, 'JOB_NOT_FOUND');
  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { tenantId, jobId } }),
    prisma.agentRun.deleteMany({ where: { tenantId, jobId } }),
    prisma.message.deleteMany({ where: { tenantId, jobId } }),
    prisma.job.deleteMany({ where: { tenantId, id: jobId } }),
  ]);
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx vitest run tests/services/job.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```
git add src/services/job.ts tests/services/job.test.ts
git commit -m "feat(services): archiveJob/restoreJob/hardDeleteJob"
```

---

### Task 3: Servicios de Contact — archive / restore / updateContact / hardDelete

**Files:**
- Modify: `src/services/contact.ts`
- Test: `tests/services/contact.test.ts`

- [ ] **Step 1: Escribir tests que fallan**

En `tests/services/contact.test.ts` añadir imports `archiveContact, restoreContact, updateContact, hardDeleteContact` desde `../../src/services/contact` y un nuevo `describe`. Usa el patrón de `cleanup`/`seedTestTenant`/`TEST_TENANT_ID` ya presente en el archivo. (`T = TEST_TENANT_ID`.)

```ts
describe('archivado, edición y borrado de contacto', () => {
  beforeEach(async () => { await cleanup(); await seedTestTenant(); });

  it('archiveContact/restoreContact alternan archivedAt', async () => {
    const c = await prisma.contact.create({ data: { tenantId: T, phoneE164: '+5215550000020' } });
    const a = await archiveContact(prisma, T, c.id);
    expect(a.archivedAt).toBeInstanceOf(Date);
    const r = await restoreContact(prisma, T, c.id);
    expect(r.archivedAt).toBeNull();
  });

  it('updateContact cambia displayName y des-marca spam', async () => {
    const c = await prisma.contact.create({ data: { tenantId: T, phoneE164: '+5215550000021', flaggedNonIntake: true, flaggedReason: 'spam' } });
    const u = await updateContact(prisma, T, c.id, { displayName: 'Doña Tere', unflag: true });
    expect(u.displayName).toBe('Doña Tere');
    expect(u.flaggedNonIntake).toBe(false);
    expect(u.flaggedReason).toBeNull();
  });

  it('hardDeleteContact borra el contacto, sus jobs y todo lo asociado', async () => {
    const c = await prisma.contact.create({ data: { tenantId: T, phoneE164: '+5215550000022' } });
    const job = await prisma.job.create({ data: { tenantId: T, contactId: c.id, status: 'OPEN_INTAKE', intake: '{}' } });
    await prisma.message.create({ data: { tenantId: T, contactId: c.id, jobId: job.id, direction: 'inbound', kind: 'text', body: 'x' } });
    await prisma.agentRun.create({ data: { tenantId: T, jobId: job.id, triggerMessageIds: '[]', model: 'm', toolCalls: '[]' } });

    await hardDeleteContact(prisma, T, c.id);

    expect(await prisma.contact.findFirst({ where: { id: c.id } })).toBeNull();
    expect(await prisma.job.count({ where: { contactId: c.id } })).toBe(0);
    expect(await prisma.message.count({ where: { contactId: c.id } })).toBe(0);
    expect(await prisma.agentRun.count({ where: { jobId: job.id } })).toBe(0);
  });

  it('hardDeleteContact de otro tenant lanza error y no borra', async () => {
    const c = await prisma.contact.create({ data: { tenantId: T, phoneE164: '+5215550000023' } });
    await expect(hardDeleteContact(prisma, 'tenant-ajeno', c.id)).rejects.toThrow(/no existe/i);
    expect(await prisma.contact.findFirst({ where: { id: c.id } })).not.toBeNull();
  });
});
```

Nota: si `tests/services/contact.test.ts` aún no importa `ServiceError`/`cleanup`, revisa los imports existentes del archivo y reúsalos; añade solo lo que falte.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx vitest run tests/services/contact.test.ts`
Expected: FAIL (funciones no existen).

- [ ] **Step 3: Implementar en `src/services/contact.ts`**

Agregar import al inicio si no está: `import { ServiceError } from './errors';`. Luego al final:
```ts
export async function archiveContact(prisma: PrismaClient, tenantId: string, contactId: string): Promise<Contact> {
  const c = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!c) throw new ServiceError(`contacto ${contactId} no existe`, 'CONTACT_NOT_FOUND');
  return prisma.contact.update({ where: { id: contactId, tenantId }, data: { archivedAt: new Date() } });
}

export async function restoreContact(prisma: PrismaClient, tenantId: string, contactId: string): Promise<Contact> {
  const c = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!c) throw new ServiceError(`contacto ${contactId} no existe`, 'CONTACT_NOT_FOUND');
  return prisma.contact.update({ where: { id: contactId, tenantId }, data: { archivedAt: null } });
}

export async function updateContact(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
  opts: { displayName?: string; unflag?: boolean },
): Promise<Contact> {
  const c = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!c) throw new ServiceError(`contacto ${contactId} no existe`, 'CONTACT_NOT_FOUND');
  const data: { displayName?: string; flaggedNonIntake?: boolean; flaggedReason?: null } = {};
  if (opts.displayName !== undefined) data.displayName = opts.displayName;
  if (opts.unflag) { data.flaggedNonIntake = false; data.flaggedReason = null; }
  return prisma.contact.update({ where: { id: contactId, tenantId }, data });
}

export async function hardDeleteContact(prisma: PrismaClient, tenantId: string, contactId: string): Promise<void> {
  const c = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!c) throw new ServiceError(`contacto ${contactId} no existe`, 'CONTACT_NOT_FOUND');
  const jobs = await prisma.job.findMany({ where: { tenantId, contactId }, select: { id: true } });
  const jobIds = jobs.map((j) => j.id);
  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { tenantId, jobId: { in: jobIds } } }),
    prisma.agentRun.deleteMany({ where: { tenantId, jobId: { in: jobIds } } }),
    prisma.message.deleteMany({ where: { tenantId, contactId } }),
    prisma.job.deleteMany({ where: { tenantId, contactId } }),
    prisma.contact.deleteMany({ where: { tenantId, id: contactId } }),
  ]);
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx vitest run tests/services/contact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```
git add src/services/contact.ts tests/services/contact.test.ts
git commit -m "feat(services): archive/restore/update/hardDelete de contacto"
```

---

### Task 4: Pipeline — resurgir contacto archivado en nuevo inbound

**Files:**
- Modify: `src/pipeline/resolveContact.ts`
- Test: `tests/pipeline/resolveContact.test.ts`

- [ ] **Step 1: Escribir test que falla**

Agregar al `describe` existente de `resolveContact`:
```ts
it('resucita (archivedAt=null) un contacto archivado al recibir inbound', async () => {
  const created = await prisma.contact.create({
    data: { tenantId: TEST_TENANT_ID, phoneE164: '+5215550000030', archivedAt: new Date(), botActive: true },
  });
  const res = await resolveContact(prisma, TEST_TENANT_ID, '+5215550000030');
  expect(res.contact.id).toBe(created.id);
  expect(res.contact.archivedAt).toBeNull();
  const reloaded = await prisma.contact.findFirst({ where: { id: created.id } });
  expect(reloaded?.archivedAt).toBeNull();
});
```
(Usa los imports/helpers ya presentes en el archivo: `prisma`/`testPrisma`, `TEST_TENANT_ID`, `resolveContact`.)

- [ ] **Step 2: Correr y verificar que falla**

Run: `DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx vitest run tests/pipeline/resolveContact.test.ts`
Expected: FAIL (archivedAt sigue con fecha).

- [ ] **Step 3: Implementar resurgir en `src/pipeline/resolveContact.ts`**

Reemplazar el cuerpo desde la línea del upsert:
```ts
  let contact = await upsertContactByPhone(prisma, tenantId, fromPhoneE164);
  // Si estaba archivado, resucítalo: hay actividad nueva que el dueño debe ver.
  if (contact.archivedAt) {
    contact = await prisma.contact.update({
      where: { id: contact.id, tenantId },
      data: { archivedAt: null },
    });
  }
  if (!contact.botActive) {
    return { shouldRespond: false, contact, reason: 'bot_paused' };
  }
  if (contact.flaggedNonIntake) {
    return { shouldRespond: false, contact, reason: 'flagged_non_intake' };
  }
  return { shouldRespond: true, contact };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx vitest run tests/pipeline/resolveContact.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```
git add src/pipeline/resolveContact.ts tests/pipeline/resolveContact.test.ts
git commit -m "feat(pipeline): resucitar contacto archivado al recibir inbound"
```

---

### Task 5: API de Jobs — archive / restore / delete + includeArchived

**Files:**
- Modify: `api/src/routes/jobs.ts`
- Test: `api/tests/jobs.test.ts`

- [ ] **Step 1: Escribir tests que fallan**

En `api/tests/jobs.test.ts`, dentro del `describe` existente (reusa `buildTestApp`, `seedTenantAndUser`, `authHeader`, `testPrisma`, `TEST_TENANT_ID`). Crea un job de prueba en `beforeEach` si no existe ya; añade:
```ts
it('POST /jobs/:id/archive marca archivedAt y lo saca del listado por defecto', async () => {
  const job = await testPrisma.job.create({ data: { tenantId: TEST_TENANT_ID, contactId, status: 'OPEN_INTAKE', intake: '{}' } });
  const arch = await app.inject({ method: 'POST', url: `/jobs/${job.id}/archive`, headers: await authHeader(app, userId) });
  expect(arch.statusCode).toBe(200);
  expect(arch.json().job.archivedAt).not.toBeNull();

  const list = await app.inject({ method: 'GET', url: '/jobs', headers: await authHeader(app, userId) });
  expect(list.json().jobs.map((j: any) => j.id)).not.toContain(job.id);

  const listArch = await app.inject({ method: 'GET', url: '/jobs?includeArchived=true', headers: await authHeader(app, userId) });
  expect(listArch.json().jobs.map((j: any) => j.id)).toContain(job.id);
});

it('POST /jobs/:id/restore limpia archivedAt', async () => {
  const job = await testPrisma.job.create({ data: { tenantId: TEST_TENANT_ID, contactId, status: 'OPEN_INTAKE', intake: '{}', archivedAt: new Date() } });
  const res = await app.inject({ method: 'POST', url: `/jobs/${job.id}/restore`, headers: await authHeader(app, userId) });
  expect(res.statusCode).toBe(200);
  expect(res.json().job.archivedAt).toBeNull();
});

it('DELETE /jobs/:id borra el job', async () => {
  const job = await testPrisma.job.create({ data: { tenantId: TEST_TENANT_ID, contactId, status: 'OPEN_INTAKE', intake: '{}' } });
  const res = await app.inject({ method: 'DELETE', url: `/jobs/${job.id}`, headers: await authHeader(app, userId) });
  expect(res.statusCode).toBe(200);
  expect(res.json().ok).toBe(true);
  expect(await testPrisma.job.findFirst({ where: { id: job.id } })).toBeNull();
});

it('DELETE /jobs/:id de otro tenant → 404', async () => {
  const res = await app.inject({ method: 'DELETE', url: `/jobs/00000000-0000-0000-0000-0000000000ff`, headers: await authHeader(app, userId) });
  expect(res.statusCode).toBe(404);
});
```
Asegúrate de que `contactId` y `userId` existan en el `beforeEach` (sigue el patrón de `api/tests/contacts.test.ts`: crear un contacto del tenant y guardar su id).

- [ ] **Step 2: Correr y verificar que fallan**

Run: `DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx vitest run api/tests/jobs.test.ts`
Expected: FAIL (rutas no existen).

- [ ] **Step 3: Implementar en `api/src/routes/jobs.ts`**

Añadir imports:
```ts
import { parseJobIntake, updateJobIntake, markReadyForReview, closeJob, archiveJob, restoreJob, hardDeleteJob } from '../../../src/services/job';
```
Modificar `GET /jobs` para excluir archivados por defecto:
```ts
  app.get('/jobs', { preHandler: app.authenticate }, async (request) => {
    const prisma = getPrisma();
    const q = request.query as any;
    const status = q?.status as string | undefined;
    const includeArchived = q?.includeArchived === 'true';
    const jobs = await prisma.job.findMany({
      where: {
        tenantId: request.tenantId,
        ...(status ? { status } : {}),
        ...(includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: { openedAt: 'desc' },
      include: { contact: true },
    });
    return { jobs };
  });
```
Agregar las rutas nuevas dentro de `jobsRoutes`:
```ts
  app.post('/jobs/:id/archive', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const job = await prisma.job.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!job) return reply.code(404).send({ error: 'job no encontrado' });
    const updated = await archiveJob(prisma, request.tenantId, id);
    return { ok: true, job: updated };
  });

  app.post('/jobs/:id/restore', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const job = await prisma.job.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!job) return reply.code(404).send({ error: 'job no encontrado' });
    const updated = await restoreJob(prisma, request.tenantId, id);
    return { ok: true, job: updated };
  });

  app.delete('/jobs/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const job = await prisma.job.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!job) return reply.code(404).send({ error: 'job no encontrado' });
    await hardDeleteJob(prisma, request.tenantId, id);
    return { ok: true };
  });
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx vitest run api/tests/jobs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```
git add api/src/routes/jobs.ts api/tests/jobs.test.ts
git commit -m "feat(api): jobs archive/restore/delete + includeArchived"
```

---

### Task 6: API de Contacts — archive / restore / delete + PATCH ampliado + includeArchived

**Files:**
- Modify: `api/src/routes/contacts.ts`
- Test: `api/tests/contacts.test.ts`

- [ ] **Step 1: Escribir tests que fallan**

Añadir al `describe` de `api/tests/contacts.test.ts`:
```ts
it('PATCH /contacts/:id { displayName, unflag } edita y des-marca', async () => {
  await testPrisma.contact.update({ where: { id: contactId }, data: { flaggedNonIntake: true, flaggedReason: 'x' } });
  const res = await app.inject({ method: 'PATCH', url: `/contacts/${contactId}`, headers: await authHeader(app, userId), payload: { displayName: 'Nuevo Nombre', unflag: true } });
  expect(res.statusCode).toBe(200);
  expect(res.json().contact.displayName).toBe('Nuevo Nombre');
  expect(res.json().contact.flaggedNonIntake).toBe(false);
});

it('POST /contacts/:id/archive y restore alternan archivedAt y filtran el listado', async () => {
  const arch = await app.inject({ method: 'POST', url: `/contacts/${contactId}/archive`, headers: await authHeader(app, userId) });
  expect(arch.statusCode).toBe(200);
  const list = await app.inject({ method: 'GET', url: '/contacts', headers: await authHeader(app, userId) });
  expect(list.json().contacts.map((c: any) => c.id)).not.toContain(contactId);
  const listArch = await app.inject({ method: 'GET', url: '/contacts?includeArchived=true', headers: await authHeader(app, userId) });
  expect(listArch.json().contacts.map((c: any) => c.id)).toContain(contactId);
  const res = await app.inject({ method: 'POST', url: `/contacts/${contactId}/restore`, headers: await authHeader(app, userId) });
  expect(res.json().contact.archivedAt).toBeNull();
});

it('DELETE /contacts/:id borra el contacto', async () => {
  const res = await app.inject({ method: 'DELETE', url: `/contacts/${contactId}`, headers: await authHeader(app, userId) });
  expect(res.statusCode).toBe(200);
  expect(await testPrisma.contact.findFirst({ where: { id: contactId } })).toBeNull();
});

it('DELETE /contacts/:otherTenant → 404', async () => {
  const res = await app.inject({ method: 'DELETE', url: `/contacts/${otherContactId}`, headers: await authHeader(app, userId) });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx vitest run api/tests/contacts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar en `api/src/routes/contacts.ts`**

Reemplazar el contenido por:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../db';
import { setBotActive, updateContact, archiveContact, restoreContact, hardDeleteContact } from '../../../src/services/contact';

const PatchZ = z.object({
  botPaused: z.boolean().optional(),
  displayName: z.string().min(1).optional(),
  unflag: z.boolean().optional(),
}).refine((d) => d.botPaused !== undefined || d.displayName !== undefined || d.unflag !== undefined, {
  message: 'se requiere al menos un campo: botPaused, displayName o unflag',
});

export async function contactsRoutes(app: FastifyInstance) {
  app.get('/contacts', { preHandler: app.authenticate }, async (request) => {
    const prisma = getPrisma();
    const includeArchived = (request.query as any)?.includeArchived === 'true';
    const contacts = await prisma.contact.findMany({
      where: { tenantId: request.tenantId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: { updatedAt: 'desc' },
    });
    return { contacts };
  });

  app.patch('/contacts/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const parse = PatchZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: parse.error.message });
    const existing = await prisma.contact.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!existing) return reply.code(404).send({ error: 'contacto no encontrado' });
    if (parse.data.botPaused !== undefined) {
      await setBotActive(prisma, request.tenantId, id, !parse.data.botPaused);
    }
    if (parse.data.displayName !== undefined || parse.data.unflag !== undefined) {
      await updateContact(prisma, request.tenantId, id, { displayName: parse.data.displayName, unflag: parse.data.unflag });
    }
    const updated = await prisma.contact.findFirst({ where: { id, tenantId: request.tenantId } });
    return { ok: true, contact: updated };
  });

  app.post('/contacts/:id/archive', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const existing = await prisma.contact.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!existing) return reply.code(404).send({ error: 'contacto no encontrado' });
    const contact = await archiveContact(prisma, request.tenantId, id);
    return { ok: true, contact };
  });

  app.post('/contacts/:id/restore', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const existing = await prisma.contact.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!existing) return reply.code(404).send({ error: 'contacto no encontrado' });
    const contact = await restoreContact(prisma, request.tenantId, id);
    return { ok: true, contact };
  });

  app.delete('/contacts/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const existing = await prisma.contact.findFirst({ where: { id, tenantId: request.tenantId } });
    if (!existing) return reply.code(404).send({ error: 'contacto no encontrado' });
    await hardDeleteContact(prisma, request.tenantId, id);
    return { ok: true };
  });
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx vitest run api/tests/contacts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```
git add api/src/routes/contacts.ts api/tests/contacts.test.ts
git commit -m "feat(api): contacts archive/restore/delete + PATCH ampliado"
```

---

### Task 7: Cliente API de la SPA

**Files:**
- Modify: `spa/src/api/client.ts`

- [ ] **Step 1: Ampliar `getJobs`/`getContacts` y agregar métodos**

Reemplazar las líneas de `getJobs` y `getContacts`/`toggleContact` y agregar los métodos nuevos dentro del objeto `api`:
```ts
  getJobs: (status?: string, includeArchived = false) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (includeArchived) params.set('includeArchived', 'true');
    const qs = params.toString();
    return request<{ jobs: any[] }>('GET', `/jobs${qs ? `?${qs}` : ''}`);
  },
  archiveJob: (id: string) => request<{ ok: boolean; job: any }>('POST', `/jobs/${id}/archive`),
  restoreJob: (id: string) => request<{ ok: boolean; job: any }>('POST', `/jobs/${id}/restore`),
  deleteJob: (id: string) => request<{ ok: boolean }>('DELETE', `/jobs/${id}`),
  getContacts: (includeArchived = false) =>
    request<{ contacts: any[] }>('GET', `/contacts${includeArchived ? '?includeArchived=true' : ''}`),
  toggleContact: (id: string, botPaused: boolean) => request<{ ok: boolean; contact: any }>('PATCH', `/contacts/${id}`, { botPaused }),
  updateContact: (id: string, payload: { displayName?: string; unflag?: boolean }) =>
    request<{ ok: boolean; contact: any }>('PATCH', `/contacts/${id}`, payload),
  archiveContact: (id: string) => request<{ ok: boolean; contact: any }>('POST', `/contacts/${id}/archive`),
  restoreContact: (id: string) => request<{ ok: boolean; contact: any }>('POST', `/contacts/${id}/restore`),
  deleteContact: (id: string) => request<{ ok: boolean }>('DELETE', `/contacts/${id}`),
```
(Eliminar las definiciones viejas de `getJobs`, `getContacts` y `toggleContact` para no duplicarlas.)

- [ ] **Step 2: Verificar typecheck de la SPA**

Run: `cd spa && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**
```
git add spa/src/api/client.ts
git commit -m "feat(spa): métodos de cliente para archivar/borrar/editar"
```

---

### Task 8: Componente ConfirmDialog

**Files:**
- Create: `spa/src/components/ConfirmDialog.tsx`
- Test: `spa/src/components/ConfirmDialog.test.tsx`

- [ ] **Step 1: Escribir test que falla**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('muestra el mensaje y llama onConfirm al confirmar', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Eliminar" message="¿Seguro?" confirmLabel="Eliminar" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText('¿Seguro?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('no renderiza nada si open=false', () => {
    const { container } = render(<ConfirmDialog open={false} title="x" message="y" confirmLabel="z" onConfirm={() => {}} onCancel={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd spa && npx vitest run src/components/ConfirmDialog.test.tsx`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `spa/src/components/ConfirmDialog.tsx`**

```tsx
type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({ open, title, message, confirmLabel, danger, onConfirm, onCancel }: Props) {
  if (!open) return null;
  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true">
      <div className="confirm-box">
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="confirm-actions">
          <button type="button" onClick={onCancel}>Cancelar</button>
          <button type="button" className={danger ? 'btn-danger' : ''} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd spa && npx vitest run src/components/ConfirmDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```
git add spa/src/components/ConfirmDialog.tsx spa/src/components/ConfirmDialog.test.tsx
git commit -m "feat(spa): componente ConfirmDialog"
```

---

### Task 9: JobDetail — archivar y eliminar

**Files:**
- Modify: `spa/src/pages/JobDetail.tsx`
- Test: `spa/src/pages/JobDetail.test.tsx`

- [ ] **Step 1: Escribir test que falla**

Añadir a `spa/src/pages/JobDetail.test.tsx` (sigue el patrón de mock de `api` del archivo existente; si no existe, replica el mock de `Contacts.test.tsx`). Mock de `api.getJob`, `api.getProfile`, `api.archiveJob`, `api.deleteJob` y `react-router-dom` (`useParams` → `{ id: 'j1' }`, `useNavigate`).
```tsx
it('archiva el trabajo al confirmar', async () => {
  const archiveJob = vi.fn().mockResolvedValue({ ok: true, job: {} });
  // ...configurar api mock con getJob/getProfile resolviendo un job OPEN_INTAKE y archiveJob
  // render(<JobDetail/>) dentro de MemoryRouter
  // click en "Archivar" → aparece ConfirmDialog → click "Archivar" → expect(archiveJob).toHaveBeenCalledWith('j1')
});
```
(Implementa el test completo replicando el patrón de mocks ya usado en los demás `*.test.tsx` de `spa/src/pages`.)

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd spa && npx vitest run src/pages/JobDetail.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar en `spa/src/pages/JobDetail.tsx`**

- Importar: `import { Link, useParams, useNavigate } from 'react-router-dom';`, `import ConfirmDialog from '../components/ConfirmDialog';`.
- Dentro del componente: `const navigate = useNavigate();` y estado `const [confirm, setConfirm] = useState<null | 'archive' | 'delete'>(null);`.
- Agregar handlers:
```tsx
  async function doArchive() {
    if (!id) return;
    setActionBusy(true); setActionError(null);
    try { await api.archiveJob(id); navigate('/'); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'error al archivar'); }
    finally { setActionBusy(false); setConfirm(null); }
  }
  async function doDelete() {
    if (!id) return;
    setActionBusy(true); setActionError(null);
    try { await api.deleteJob(id); navigate('/'); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'error al eliminar'); }
    finally { setActionBusy(false); setConfirm(null); }
  }
```
- En el bloque `actions-buttons`, añadir junto a los botones existentes:
```tsx
              <button type="button" onClick={() => setConfirm('archive')} disabled={actionBusy}>Archivar</button>
              <button type="button" className="btn-danger" onClick={() => setConfirm('delete')} disabled={actionBusy}>Eliminar</button>
```
- Antes del cierre del `return` (último `</div>`), añadir:
```tsx
      <ConfirmDialog
        open={confirm === 'archive'}
        title="Archivar trabajo"
        message="El trabajo se ocultará del listado pero conservará su historial. Podrás restaurarlo."
        confirmLabel="Archivar"
        onConfirm={() => void doArchive()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Eliminar trabajo definitivamente"
        message={`Se borrarán el trabajo y sus ${messages.length} mensaje(s) de forma permanente. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar definitivamente"
        danger
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirm(null)}
      />
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd spa && npx vitest run src/pages/JobDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```
git add spa/src/pages/JobDetail.tsx spa/src/pages/JobDetail.test.tsx
git commit -m "feat(spa): archivar/eliminar trabajo en JobDetail"
```

---

### Task 10: Contacts — editar, archivar/restaurar, eliminar, ver archivados

**Files:**
- Modify: `spa/src/pages/Contacts.tsx`
- Test: `spa/src/pages/Contacts.test.tsx`

- [ ] **Step 1: Escribir tests que fallan**

Añadir a `spa/src/pages/Contacts.test.tsx` (reusa el patrón de mock de `api` del archivo):
```tsx
it('elimina un contacto al confirmar', async () => {
  // mock api.getContacts → [{ id:'c1', phoneE164:'+52...', botActive:true }]
  // mock api.deleteContact resolviendo { ok:true }
  // render(<Contacts/>), esperar fila, click "Eliminar" → ConfirmDialog → "Eliminar definitivamente"
  // expect(api.deleteContact).toHaveBeenCalledWith('c1')
});

it('guarda el nuevo nombre con updateContact', async () => {
  // click "Editar" → input → cambiar valor → "Guardar"
  // expect(api.updateContact).toHaveBeenCalledWith('c1', { displayName: 'Nuevo' })
});
```
(Implementa los tests completos replicando el patrón de mocks del archivo.)

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd spa && npx vitest run src/pages/Contacts.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Reemplazar `spa/src/pages/Contacts.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';

export type Contact = {
  id: string;
  phoneE164: string;
  displayName?: string | null;
  botActive?: boolean;
  flaggedNonIntake?: boolean;
  flaggedReason?: string | null;
  archivedAt?: string | null;
};

function chip(contact: Contact): { label: string; cls: string } {
  if (contact.flaggedNonIntake) return { label: 'No-intake', cls: 'chip-nointake' };
  if (contact.botActive) return { label: 'Activo', cls: 'chip-active' };
  return { label: 'Pausado', cls: 'chip-paused' };
}

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Contact | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getContacts(showArchived);
      setContacts(data.contacts as Contact[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al cargar contactos');
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { void load(); }, [load]);

  const patchLocal = (updated: Contact) =>
    setContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

  const toggle = useCallback(async (contact: Contact) => {
    setBusy(contact.id); setError(null);
    try {
      const data = await api.toggleContact(contact.id, !!contact.botActive);
      patchLocal(data.contact as Contact);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al actualizar contacto');
    } finally { setBusy(null); }
  }, []);

  async function saveName(contact: Contact) {
    setBusy(contact.id); setError(null);
    try {
      const data = await api.updateContact(contact.id, { displayName: editName });
      patchLocal(data.contact as Contact);
      setEditId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al guardar nombre');
    } finally { setBusy(null); }
  }

  async function unflag(contact: Contact) {
    setBusy(contact.id); setError(null);
    try {
      const data = await api.updateContact(contact.id, { unflag: true });
      patchLocal(data.contact as Contact);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al quitar marca');
    } finally { setBusy(null); }
  }

  async function archiveOrRestore(contact: Contact) {
    setBusy(contact.id); setError(null);
    try {
      if (contact.archivedAt) await api.restoreContact(contact.id);
      else await api.archiveContact(contact.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al archivar');
    } finally { setBusy(null); }
  }

  async function doDelete(contact: Contact) {
    setBusy(contact.id); setError(null);
    try {
      await api.deleteContact(contact.id);
      setContacts((prev) => prev.filter((c) => c.id !== contact.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al eliminar');
    } finally { setBusy(null); setConfirmDelete(null); }
  }

  return (
    <div className="contacts">
      <div className="contacts-head">
        <h1>Contactos</h1>
        <label>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Ver archivados
        </label>
        <button type="button" onClick={() => void load()} disabled={loading}>Refrescar</button>
      </div>

      {loading && <p>Cargando…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!loading && !error && contacts.length === 0 && <p>No hay contactos todavía.</p>}

      {!loading && !error && contacts.length > 0 && (
        <table className="contacts-table">
          <thead>
            <tr><th>Nombre</th><th>Teléfono</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {contacts.map((contact) => {
              const c = chip(contact);
              const isEditing = editId === contact.id;
              return (
                <tr key={contact.id}>
                  <td>
                    {isEditing ? (
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="Nombre" />
                    ) : (
                      contact.displayName ?? contact.phoneE164
                    )}
                  </td>
                  <td>{contact.phoneE164}</td>
                  <td>
                    <span className={`chip ${c.cls}`}>{c.label}</span>
                    {contact.archivedAt && <span className="chip chip-paused">Archivado</span>}
                  </td>
                  <td className="contacts-actions">
                    {isEditing ? (
                      <>
                        <button type="button" onClick={() => void saveName(contact)} disabled={busy === contact.id}>Guardar</button>
                        <button type="button" onClick={() => setEditId(null)}>Cancelar</button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => { setEditId(contact.id); setEditName(contact.displayName ?? ''); }}>Editar</button>
                        {contact.flaggedNonIntake && (
                          <button type="button" onClick={() => void unflag(contact)} disabled={busy === contact.id}>Quitar spam</button>
                        )}
                        {!contact.flaggedNonIntake && (
                          <button type="button" onClick={() => void toggle(contact)} disabled={busy === contact.id}>
                            {contact.botActive ? 'Pausar' : 'Reanudar'}
                          </button>
                        )}
                        <button type="button" onClick={() => void archiveOrRestore(contact)} disabled={busy === contact.id}>
                          {contact.archivedAt ? 'Restaurar' : 'Archivar'}
                        </button>
                        <button type="button" className="btn-danger" onClick={() => setConfirmDelete(contact)} disabled={busy === contact.id}>Eliminar</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Eliminar contacto definitivamente"
        message="Se borrarán el contacto y TODOS sus trabajos y mensajes de forma permanente. Esta acción no se puede deshacer."
        confirmLabel="Eliminar definitivamente"
        danger
        onConfirm={() => confirmDelete && void doDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd spa && npx vitest run src/pages/Contacts.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```
git add spa/src/pages/Contacts.tsx spa/src/pages/Contacts.test.tsx
git commit -m "feat(spa): administración de contactos (editar/archivar/eliminar)"
```

---

### Task 11: Verificación final completa

- [ ] **Step 1: Typecheck raíz + SPA**

Run: `npx tsc --noEmit` y `cd spa && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 2: Suite completa raíz**

Run: `DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx vitest run`
Expected: todos los tests verdes.

- [ ] **Step 3: Suite SPA**

Run: `cd spa && npx vitest run`
Expected: todos los tests verdes.

- [ ] **Step 4: Commit final si quedó algo suelto**
```
git add -A
git commit -m "test: verificación final administración de trabajos y contactos" || echo "nada que commitear"
```

---

## Self-Review (cobertura del spec)

- Soft delete (`archivedAt`) Job + Contact → Tareas 1, 2, 3.
- Hard delete transaccional con cascada → Tareas 2 (job), 3 (contact).
- Editar contacto (displayName + unflag, sin teléfono) → Tareas 3, 6, 10.
- Resurgir contacto archivado → Tarea 4.
- Listados excluyen archivados + `includeArchived` → Tareas 5, 6, 7.
- API endpoints (archive/restore/delete jobs y contacts, PATCH ampliado) → Tareas 5, 6.
- SPA (ConfirmDialog, JobDetail, Contacts, toggle archivados) → Tareas 8, 9, 10.
- Aislamiento por tenant (404 cross-tenant) → Tareas 2, 3, 5, 6.
- Migración aplicable en deploy → Tarea 1.
