# Administración de trabajos y contactos (archivar, borrar, editar) — Diseño

**Fecha:** 2026-06-16
**Estado:** aprobado (alcance delegado al implementador)

## Objetivo

Dar al dueño, desde el panel (SPA + API), la capacidad de **administrar** trabajos y contactos: archivarlos (reversible), borrarlos de verdad (irreversible) y editar los datos del contacto. Hoy solo se pueden leer, editar campos del intake y cambiar estado vía `mark_ready`/`close`.

## Alcance

Incluye:
- **Archivar / restaurar** trabajos y contactos (soft delete reversible).
- **Borrado real** (hard delete) de trabajos y contactos, con cascada a sus datos asociados.
- **Editar contacto:** nombre para mostrar (`displayName`) y des-marcar como spam (`flaggedNonIntake`).

Excluye (YAGNI / decisiones tomadas):
- Editar el teléfono del contacto (es la identidad de WhatsApp, clave única `[tenantId, phoneE164]`).
- Cambios libres de estado del trabajo (reabrir/in-progress manual) y edición del `summary`.
- Reasignar un trabajo a otro contacto.

## Decisiones de diseño

1. **Soft delete por columna:** se agrega `archivedAt DateTime?` (nullable) a `Job` y `Contact`. `null` = activo; con fecha = archivado. Requiere una migración Prisma (se aplica sola en el deploy de Railway vía `migrate deploy`).
2. **Hard delete transaccional:** no se usa `onDelete: Cascade` del schema. Se hace en una función de servicio dentro de `prisma.$transaction`, borrando dependientes y luego la entidad, todo filtrado por `tenantId`. Más explícito y seguro para multi-tenant.
3. **Archivar es por entidad e independiente:** archivar un contacto NO archiva sus trabajos, y viceversa. Modelo mental simple.
4. **Resurgir contacto archivado:** si un contacto archivado vuelve a enviar un mensaje, el pipeline inbound limpia su `archivedAt` (lo "resucita") para que el dueño vea la actividad nueva. (Los trabajos no resurgen automáticamente; caso poco común.)
5. **Listados excluyen archivados por defecto.** Un parámetro `includeArchived=true` los incluye (para el toggle "ver archivados" del panel).
6. **Confirmación:** archivar usa confirmación simple; el borrado real abre un modal fuerte que muestra cuántos trabajos/mensajes se eliminarán y exige confirmación explícita.

## Modelo de datos

`prisma/schema.prisma`:
- `Job`: agregar `archivedAt DateTime?`
- `Contact`: agregar `archivedAt DateTime?`
- Índices opcionales: ninguno nuevo requerido (los listados ya filtran por `tenantId` + orden; el filtro `archivedAt IS NULL` es barato a esta escala).
- Migración nueva: `add_archivedAt_to_job_and_contact` (solo agrega columnas nullable; sin backfill).

## Servicios (`src/services/`)

### `job.ts`
- `archiveJob(prisma, tenantId, jobId): Promise<Job>` → set `archivedAt = now()`. 404 si no existe en el tenant.
- `restoreJob(prisma, tenantId, jobId): Promise<Job>` → set `archivedAt = null`.
- `hardDeleteJob(prisma, tenantId, jobId): Promise<void>` → `$transaction`: borra `notification` (jobId), `agentRun` (jobId), `message` (jobId), luego el `job`; todo con `tenantId`. Lanza `ServiceError('JOB_NOT_FOUND')` si no existe.

### `contact.ts`
- `archiveContact(prisma, tenantId, contactId): Promise<Contact>` → set `archivedAt = now()`.
- `restoreContact(prisma, tenantId, contactId): Promise<Contact>` → set `archivedAt = null`.
- `updateContact(prisma, tenantId, contactId, { displayName?, unflag? }): Promise<Contact>` → si `displayName` viene, lo setea; si `unflag === true`, pone `flaggedNonIntake=false, flaggedReason=null`. Reutiliza/coexiste con `setDisplayName`/`flagNonIntake` existentes.
- `hardDeleteContact(prisma, tenantId, contactId): Promise<void>` → `$transaction`: para todos los `job` del contacto, borra sus `notification`/`agentRun`/`message` y los `job`; borra los `message` del contacto sin job; borra el `contact`. Todo con `tenantId`.

### Listados (excluir archivados)
- Los `findMany` de jobs/contacts en la API aceptan un flag para incluir o no archivados (filtro `archivedAt: null` por defecto).

### Resurgir (pipeline)
- `src/pipeline/resolveContact.ts`: cuando se resuelve un contacto existente que tiene `archivedAt != null` ante un nuevo inbound, se limpia (`archivedAt = null`). Cambio mínimo y aislado.

## API (`api/src/routes/`)

### `jobs.ts`
- `GET /jobs?status=&includeArchived=` → por defecto excluye `archivedAt != null`.
- `POST /jobs/:id/archive` → `{ ok, job }`
- `POST /jobs/:id/restore` → `{ ok, job }`
- `DELETE /jobs/:id` → `{ ok }` (hard delete)

### `contacts.ts`
- `GET /contacts?includeArchived=` → por defecto excluye archivados.
- `PATCH /contacts/:id` → cuerpo ampliado: `{ botPaused?, displayName?, unflag? }` (todos opcionales; al menos uno requerido). Mantiene compatibilidad con el toggle actual.
- `POST /contacts/:id/archive` → `{ ok, contact }`
- `POST /contacts/:id/restore` → `{ ok, contact }`
- `DELETE /contacts/:id` → `{ ok }` (hard delete con cascada)

Todas las rutas: `preHandler: app.authenticate`, filtran por `request.tenantId`, devuelven 404 si la entidad no pertenece al tenant, 400 ante body inválido (Zod).

## SPA (`spa/src/`)

- **Cliente API** (`api/client.ts`): métodos nuevos `archiveJob`, `restoreJob`, `deleteJob`, `archiveContact`, `restoreContact`, `deleteContact`, `updateContact`; y `getJobs`/`getContacts` aceptan `includeArchived`.
- **Dashboard / JobDetail:** acciones Archivar y Eliminar por trabajo. Eliminar abre modal de confirmación con conteo de mensajes. Toggle "Ver archivados" en el listado.
- **Contacts:** edición inline del nombre + botón "Quitar marca de spam" (cuando `flaggedNonIntake`); acciones Archivar/Restaurar y Eliminar (modal con conteo de trabajos+mensajes); toggle "Ver archivados". Conserva el toggle de pausa del bot.
- Componente reutilizable `ConfirmDialog` para confirmaciones (simple y "fuerte" para borrado).

## Manejo de errores

- Borrado real siempre en `$transaction`: si algo falla, no quedan datos huérfanos.
- 404 si la entidad no existe o es de otro tenant (aislamiento).
- La SPA muestra el error del backend si una acción falla y no cambia el estado local hasta confirmar éxito.

## Pruebas

- **Servicios:** archivar/restaurar (job y contact), `hardDeleteJob` (borra mensajes/agentRuns/notifications y el job; no toca otros jobs), `hardDeleteContact` (cascada completa), aislamiento por tenant (otro tenant no puede archivar/borrar → no-op/404), `updateContact` (displayName + unflag).
- **API:** cada endpoint nuevo (200 happy path, 404 cross-tenant, 400 body inválido), `includeArchived` filtra correctamente.
- **Pipeline:** resolveContact resucita un contacto archivado ante nuevo inbound.
- **SPA:** componentes Dashboard/JobDetail/Contacts renderizan acciones; confirmación de borrado llama al cliente; toggle de archivados.

## Migración / despliegue

- Una migración Prisma nueva; `migrate deploy` la aplica en el deploy. Sin pasos manuales contra producción.
