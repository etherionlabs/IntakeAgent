# Superadmin CRUD + aprobación, retiro del operador — Diseño

**Fecha:** 2026-07-06
**Estado:** Aprobado para implementación
**Base:** `origin/master` @ 95dec66 (incluye el panel superadmin inicial).

---

## 1. Objetivo

Consolidar la administración de la plataforma en el **panel superadmin** (`PlatformUser`)
y simplificar el modelo de acceso, resolviendo de paso dos bugs. Concretamente:

1. El superadmin puede **editar y eliminar** tenants y su usuario dueño (hoy solo crea/lista).
2. La **aprobación de cuentas** de negocios pasa del operador al superadmin.
3. **Sin roles dentro del tenant**: cada tenant tiene un **dueño** con acceso total; se elimina la distinción admin/viewer/operator.
4. Se **retira por completo** el panel de operador (`/admin` + rol `operator`), redundante con el superadmin.
5. **Bug 1:** el superadmin creaba `PanelUser` sin email, y el login de tenant es por email → el usuario no podía entrar. Se exige email.
6. **Bug 2:** `scripts/backfill-tenant-settings.ts` no ejecuta en Windows por un guard `import.meta.url` mal comparado.

## 2. Modelo de acceso resultante

| Panel | Quién | Alcance | Funciones |
|---|---|---|---|
| **Dueño** (tenant) | `PanelUser` (dueño) | Su propio negocio | Trabajos/intakes, contactos, configuración del bot, WhatsApp/QR, uso. **Sin cambios.** |
| **Superadmin** (`/platform`) | `PlatformUser` | Toda la plataforma | Crear/listar/editar/eliminar tenants, **aprobar/rechazar**, límite mensual, suspender/reactivar/reconectar bot, gestionar al dueño. |
| ~~Operador (`/admin`)~~ | — | — | **RETIRADO.** |

El rol de `PanelUser` deja de usarse como jerarquía: todo dueño se crea con `role='admin'`
(acceso total en su panel, que es lo que ese panel ya espera). No se crean `viewer` ni `operator`.
No se fuerza un único dueño por tenant, pero no hay UI de roles: todos los usuarios de un tenant son dueños.

## 3. Cambios en la API

### 3.1 Retirar el operador
- **Eliminar** `api/src/routes/admin.ts` completo.
- **Reubicar** el helper `startOfMonthUtc` (hoy exportado por `admin.ts`, lo consume `api/src/routes/usage.ts:4`) a `api/src/lib/dates.ts`; actualizar el import de `usage.ts`.
- En `api/src/server.ts`: quitar el import y `app.register(adminRoutes, …)`; quitar el decorator `requireOperator` (líneas ~182-184); quitar `/admin` de la lista de rutas exentas del 402 (línea ~156).
- En `api/src/types.d.ts`: quitar la declaración `requireOperator`.
- **Eliminar** `api/tests/admin.test.ts` y `api/tests/approval-flow.test.ts` (su cobertura de aprobación se recrea contra el superadmin).
- Actualizar comentarios que dicen "desde /admin" en `api/src/billing/access.ts` y `api/src/env.ts` → "desde el panel superadmin".

### 3.2 Helpers/servicios nuevos (extraídos de la lógica del operador)
- `api/src/lib/worker-client.ts` → `workerCall(doFetch, method, tenantId, path)`: extrae el `workerCall` de `admin.ts` (usa `resolveManagerUrl` + `INTERNAL_API_TOKEN`, best-effort → `null` si el worker no responde). `fetcher` inyectable para tests.
- `api/src/services/tenantApproval.ts`:
  - `approveTenant(prisma, deps, tenantId)`: `approvalStatus='approved'`, `approvedAt`, `active=true`; si `status ∈ {provisioning, active}` → `workerCall POST /internal/tenant/add`; email al dueño (`accountApprovedEmail`); devuelve el tenant o `null` si no existe.
  - `rejectTenant(prisma, deps, tenantId)`: `approvalStatus='rejected'`, `active=false`; `workerCall POST /internal/tenant/suspend`; email (`accountRejectedEmail`).
  - `deps` = `{ fetcher, emailSender }`. Reusa `ownerEmail(prisma, tenantId)` (busca el `PanelUser` dueño del tenant por `createdAt` asc).
- `api/src/services/tenantDeletion.ts` → `hardDeleteTenant(prisma, tenantId)`: transacción que borra en orden FK-seguro y **preserva** `LegalAcceptance` y `OperatorAuditLog` (no tienen FK a `Tenant`). Orden:
  1. `passwordResetToken` de los usuarios del tenant (por `userId ∈ users`)
  2. `notification` (where tenantId)
  3. `agentRun` (where tenantId)
  4. `message` (where tenantId)
  5. `job` (where tenantId)
  6. `contact` (where tenantId)
  7. `panelUser` (where tenantId)
  8. `emailVerification` (where tenantId)
  9. `tenantSettings` (where tenantId)
  10. `subscription` (where tenantId)
  11. `tenant` (delete)
  Devuelve conteos por tabla (para el log/respuesta).

### 3.3 Rutas nuevas en `api/src/routes/platform.ts` (todas con `authenticatePlatform`)
Portadas del operador (misma lógica, ahora bajo `/platform`):
- `GET /platform/tenants` — **ampliar** el actual: incluir `status`, `approvalStatus`, `approvedAt`, `monthlyRunLimit`, `monthUsed` (agrupado de `agentRun` desde `startOfMonthUtc()`), `subscription`, y `defaultMonthlyLimit`.
- `GET /platform/tenants/:id` — detalle con estado del bot (`workerCall GET /internal/wa-status`) + `monthUsed`.
- `POST /platform/tenants/:id/approve` → `approveTenant`; auditoría `operatorUserId = platformUser.id`, action `approve`.
- `POST /platform/tenants/:id/reject` → `rejectTenant`; auditoría `reject`.
- `PATCH /platform/tenants/:id/limit` — `{ monthlyRunLimit: int>=0 | null }`; auditoría `set_limit`.
- `POST /platform/tenants/:id/suspend` — `workerCall /internal/tenant/suspend` + `status='suspended'`; auditoría.
- `POST /platform/tenants/:id/reactivate` — `workerCall /internal/tenant/resume` + `status='active'`; auditoría.
- `POST /platform/tenants/:id/bot/reconnect` — `workerCall /internal/wa-reconnect`; auditoría.

Nuevas (edición/eliminación):
- `PATCH /platform/tenants/:id` — `{ name?, industry? }` (min 1). Slug **inmutable**. 404 si no existe.
- `DELETE /platform/tenants/:id` — body `{ confirmSlug }` debe igualar `tenant.slug` (400 si no) — defensa en profundidad además del modal. Best-effort `workerCall /internal/tenant/suspend`, luego `hardDeleteTenant`. Auditoría `delete` **antes** de borrar el tenant (el `OperatorAuditLog` sobrevive). Devuelve conteos.

### 3.4 Usuario dueño (arregla Bug 1)
- `CreateTenantUserZ` → `{ email: z.string().email(), username: z.string().min(1), password: z.string().min(8) }`. **Sin `role`**: se crea con `role='admin'` (dueño). Guarda `email`. 409 en P2002 (email o `[tenantId,username]` duplicado).
- `PATCH /platform/tenants/:tenantId/users/:userId` — `{ email?, password? }`; si `password` (min 8) → re-hash + `passwordChangedAt=now`. 409 P2002 (email). 404 si el usuario no es del tenant.
- `DELETE /platform/tenants/:tenantId/users/:userId` — transacción: borra `passwordResetToken` del usuario y el `panelUser`. 404 si no pertenece al tenant.
- `GET /platform/tenants/:tenantId/users` — ya existe; añadir `email` al `select`.

## 4. Cambios en la SPA

### 4.1 Retirar el operador
- **Eliminar** `spa/src/pages/Admin.tsx` y `spa/src/pages/Admin.test.tsx`.
- `spa/src/App.tsx`: quitar `import Admin` y la `<Route path="/admin">`.
- `spa/src/components/Layout.tsx`: quitar el `NavLink` a `/admin` (condicionado a `role==='operator'`).
- `spa/src/api/client.ts`: quitar `getAdminTenants`, `adminSuspend`, `adminReactivate`, `adminReconnect`, `adminApprove`, `adminReject`, `adminSetLimit` y la interfaz `AdminTenant`.

### 4.2 Superadmin (`spa/src/pages/PlatformDashboard.tsx` + `spa/src/api/client.ts`)
- Cliente: añadir métodos `platform*`: `platformUpdateTenant`, `platformDeleteTenant`, `platformApprove`, `platformReject`, `platformSetLimit`, `platformSuspend`, `platformReactivate`, `platformReconnect`, `platformCreateUser` (email+password, sin rol), `platformUpdateUser`, `platformDeleteUser`. Tipar la lista ampliada de tenants.
- Dashboard: por tenant — badge de `approvalStatus`, botones **Aprobar/Rechazar** (si `pending`), editar (nombre/industria), límite mensual, suspender/reactivar, reconectar bot, y **Eliminar** (modal que exige escribir el slug). Por dueño — crear/editar (email + contraseña) y eliminar (confirmación).

## 5. Bug 2 — guard de Windows del backfill
- En `scripts/backfill-tenant-settings.ts`, reemplazar `if (import.meta.url === \`file://${process.argv[1]}\`)` por comparación robusta: `import { pathToFileURL } from 'node:url'; if (import.meta.url === pathToFileURL(process.argv[1]).href)`. Mismo patrón en cualquier otro script `.ts` de `scripts/` con el guard (revisar; `create-user.ts`/`create-superadmin.ts` NO lo usan).

## 6. Sin migración
`PanelUser.email` ya existe (`String? @unique`) → se mantiene nullable en BD (los usuarios viejos con email null no rompen); la obligatoriedad se aplica en la capa API. `role` sigue siendo string libre y se fija a `'admin'`. `OperatorAuditLog` se conserva (su nombre queda histórico; guarda el `id` del `PlatformUser` en `operatorUserId`, sin FK).

## 7. Testing
- **`api/tests/platform.test.ts`** (ampliar): login superadmin; crear dueño **con email** → el dueño **puede loguear vía `/auth/login`** (cierra Bug 1); crear sin email → 400; `PATCH` tenant (name/industry) y 404; `PATCH /limit` (validación); `approve`/`reject` (fija estado, audita, no rompe si worker/email no responden — `fetcher`/`emailSender` inyectados); `suspend`/`reactivate`/`reconnect`; `DELETE` tenant (confirmSlug requerido → 400 si no coincide; cascada borra hijos y **preserva `LegalAcceptance`/`OperatorAuditLog`**; 404); `PATCH`/`DELETE` usuario (nuevo password loguea; borrado quita reset tokens).
- **`api/tests/tenantDeletion.test.ts`** (nuevo): `hardDeleteTenant` borra todas las tablas hijas y preserva legal/auditoría; conteos correctos.
- **`api/tests/tenantApproval.test.ts`** (nuevo) o dentro de platform.test: `approveTenant`/`rejectTenant` con `fetcher`/`emailSender` mock.
- Eliminar `api/tests/admin.test.ts` y `api/tests/approval-flow.test.ts`.
- **SPA**: `PlatformDashboard.test.tsx` — acciones nuevas (aprobar, editar, eliminar con slug, crear/editar/eliminar dueño) con cliente mockeado. Eliminar `Admin.test.tsx`.
- Suite completa verde (raíz + api, SPA) + typecheck en ambos.

## 8. Fuera de alcance
- Gestión de otros `PlatformUser` (superadmins) desde la UI — se mantiene por CLI `platform:create-superadmin`.
- Migrar `PanelUser.email` a NOT NULL (se deja nullable por compatibilidad).
- Borrar la carpeta de sesión Baileys del volumen del worker al eliminar un tenant (queda huérfana; follow-up si molesta).
- Editar el `slug` de un tenant (inmutable por identidad).
