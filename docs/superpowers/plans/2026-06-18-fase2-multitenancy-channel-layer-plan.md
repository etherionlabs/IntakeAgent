# Plan Fase 2 — Multi-tenancy real (`TenantManager` + ruteo dinámico) y capa de canal

> **Para workers agénticos:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea-por-tarea. Los pasos usan sintaxis de checkbox (`- [ ]`) para seguimiento.

**Fecha:** 2026-06-18
**Spec de diseño:** `docs/superpowers/specs/2026-06-18-fase2-multitenancy-channel-layer-design.md`
**Roadmap:** `docs/ROADMAP-PRODUCCION.md` (§Fase 2)

**Objetivo:** Que **agregar un tenant no requiera tocar `docker-compose.yml`, `.env` ni reiniciar el proceso**. Hoy el worker es "un proceso = un tenant" (lee `TENANT_ID` del entorno, `src/index.ts:38`) y la API cablea **un solo** worker (`WORKER_INTERNAL_URL: http://worker-tapiceria:3002`, `docker-compose.yml:44`, consumido en `api/src/routes/wa-status.ts:8`). Este plan introduce un `TenantManager` que mantiene N conexiones Baileys en un único proceso, creadas/destruidas en caliente; rutea `wa-status`/logout/reconnect por el `tenantId` del JWT hacia una única URL interna; persiste la config del bot por tenant en una tabla `TenantSettings`; y formaliza la frontera de canal del worker (interfaces `InboundSource` / `ChannelOutboundSender` / `ChannelNotifier`, con WhatsApp como **una** implementación). **No** se construye SMS ni voz aquí.

**Arquitectura (Enfoque A del spec, §2):** Un proceso worker mantiene `Map<tenantId, TenantRuntime>`. Cada `TenantRuntime` encapsula lo que hoy arma `main()` para un solo tenant (`src/index.ts:84-130`): adapter Baileys con `sessionDir = ./data/baileys-session/<tenantId>`, sender, notifier y `InboundCoordinator`, parametrizado por la config del tenant cargada de `TenantSettings`. El `InboundCoordinator` **no cambia su lógica**: ya recibe `tenantId` por deps (`src/pipeline/types.ts:23`) y filtra por él; lo que cambia es **quién lo construye y posee** (antes `main()`, ahora cada `TenantRuntime`). La supervisión es **por-tenant**: cada runtime vive en su propio try/catch con reinicio aislado, de forma que el fallo de la conexión de un tenant no derribe las demás ni el proceso. La API deja de "elegir worker": pasa el `tenantId` del JWT a una **única** URL interna del `TenantManager`, que despacha.

**Tech Stack:** Node 20+, TypeScript via `tsx`, Prisma 7.8 + `@prisma/adapter-pg` + `pg`, PostgreSQL 16, vitest 4 (`fileParallelism: false`), Fastify 5 (API central + endpoint interno del worker), Docker + Docker Compose, Baileys (WhatsApp).

**Línea base verificada en código (no se rehace):**
- Schema multi-tenant con `tenantId` NOT NULL en todas las tablas operativas y uniques compuestos `@@unique([tenantId, phoneE164])` / `@@unique([tenantId, whatsappMsgId])` (`prisma/schema.prisma`).
- `InboundCoordinator` ya threadea `tenantId` por deps (`src/pipeline/coordinator.ts:49,61`).
- Endpoint interno protegido con `INTERNAL_API_TOKEN` (`src/internal/server.ts`), ya con `actions.logout/reconnect` cableados a un único adapter (`src/index.ts:126-130`).
- Núcleo agnóstico al canal: `OutboundSender.sendText` (`src/services/outbound.ts:6`) y `Notifier` (`src/services/notification.ts:13`) son interfaces; el agente no conoce WhatsApp. Lo acoplado es solo el borde (`src/adapters/whatsapp/`).
- API central Fastify + JWT con `wa-status` y acciones logout/reconnect (`api/src/routes/wa-status.ts`), con `app.authenticate` exponiendo el tenant del JWT.

**Convención de migraciones (toda tarea Prisma):** `prisma migrate dev --name <x>` en desarrollo con un Postgres local; `prisma migrate deploy` en producción (nunca `migrate dev` en prod — regla del spec maestro). Prerequisito local idéntico al Plan 1:
```bash
docker run -d --name intake-pg-dev -e POSTGRES_DB=intake -e POSTGRES_USER=intake -e POSTGRES_PASSWORD=intake -p 5432:5432 postgres:16
export DATABASE_URL="postgres://intake:intake@localhost:5432/intake"
```

**Disciplina incremental:** Las tareas están agrupadas en cinco bloques (A migraciones Prisma, B `TenantManager`, C refactor `src/index.ts`, D ruteo dinámico en la API, E capa de canal). El orden recomendado intercala los bloques para que cada tarea termine con la suite completa en verde:

> **Orden recomendado:** E1 (rename `externalMsgId` + `channel` en types, refactor de tipos puro) → A (todas las migraciones + backfill) → B (`TenantManager` sobre el schema nuevo) → E2 (interfaces de canal, WhatsApp como implementación) → C (refactor `src/index.ts` usando `TenantManager` + interfaces de canal) → D (ruteo dinámico API + Compose). Razón: el rename de tipos (E1) es la base que tocan A (columna) y B/C (construcción de runtimes); las migraciones (A) deben existir antes de que `TenantManager` (B) cargue `active`/`TenantSettings`; las interfaces de canal (E2) deben existir antes de que `TenantRuntime` (C) dependa de ellas; el ruteo (D) cierra al final cuando ya hay un único proceso que despachar.

---

## Bloque A — Migraciones Prisma

### Tarea A1: `TenantSettings` + `Tenant.active`

**Objetivo:** Persistir la config operativa del bot por tenant (hoy en `config.json` + `profileDir` estático) y habilitar la columna `Tenant.active` que `TenantManager.start()` filtra. Cierra la deuda técnica #3 del spec maestro.

**Archivos:**
- Modificar: `prisma/schema.prisma`
- Crear: `tests/services/tenantSettings.test.ts`
- Modificar: `tests/helpers/db.ts` (cleanup + seed de settings)
- Migración: generada

**Dependencias:** Ninguna (puede ir primero del bloque A). El backfill (A4) depende de esta.

**Cambios:**
- En `prisma/schema.prisma`, añadir el modelo `TenantSettings` (1:1 con `Tenant` por `tenantId @id`): `industry`, `businessName`, `businessDomain`, `ownerPhoneE164`, `welcomeTemplate`, `intakeSchema Json`, `debounceMs Int @default(8000)`, `transcribeAudio Boolean @default(false)`, `describeImages Boolean @default(false)`, `whisperModel String?`, `visionModel String?`, `panelUrl String?`, `updatedAt DateTime @updatedAt`, relación `tenant Tenant @relation(...)`. Forma exacta en spec §6.2.
- En `Tenant`: añadir `active Boolean @default(true)` y la relación inversa `settings TenantSettings?`.
- `tests/helpers/db.ts`: añadir `tenantSettings.deleteMany()` al `cleanupDb` (antes de borrar `tenant`) y un helper `seedTestTenantSettings(tenantId)` que crea una fila mínima válida.

**Verificación:**
- `npx prisma migrate dev --name tenant_settings` aplica sin error; `prisma.tenantSettings` existe.
- Test nuevo: crear `TenantSettings` para el tenant de pruebas, leerla y aserción de defaults (`debounceMs === 8000`, flags `false`). Crear un `Tenant` y aserción `active === true` por default.
- `npm test` verde (las filas existentes de `Tenant` reciben `active=true` por default; sin backfill manual para esa columna).

---

### Tarea A2: Columna `channel` en `Message` y `Contact`

**Objetivo:** Que cada mensaje y cada contacto registren su canal, sin alterar la identidad del contacto (sigue siendo el teléfono E.164). Habilitador de la capa de canal (E).

**Archivos:**
- Modificar: `prisma/schema.prisma`
- Modificar: `tests/pipeline/normalize.test.ts` (aserción de `channel` por default)
- Migración: generada

**Dependencias:** Independiente de A1; puede agruparse con A3 en la misma migración (recomendado: una sola migración para A2+A3, ver A3).

**Cambios:**
- `Message`: añadir `channel String @default("whatsapp")`.
- `Contact`: añadir `channel String @default("whatsapp")`.
- **Conservar** `@@unique([tenantId, phoneE164])` en `Contact` (`prisma/schema.prisma:55`): el canal NO entra en la identidad. El canal es atributo del mensaje y atributo "último/origen" del contacto.
- El `default("whatsapp")` clasifica correctamente las filas existentes **sin backfill manual**.

**Verificación:**
- Migración aplica; las filas previas quedan con `channel='whatsapp'`.
- En `normalize.test.ts`, aserción de que un mensaje persistido nuevo tiene `channel === 'whatsapp'`.
- `npm test` verde.

---

### Tarea A3: Rename `whatsappMsgId` → `externalMsgId` (columna + unique)

**Objetivo:** Renombrar la columna que sostiene la idempotencia para que sea agnóstica al canal, **preservando los IDs ya persistidos** (rename, no drop+add).

**Archivos:**
- Modificar: `prisma/schema.prisma`
- Migración: generada (revisar el SQL a mano, ver abajo)
- Consumidores del nombre de columna en queries crudas (grep de cierre, ver A3/Step verificación)

**Dependencias:** El rename de **tipo** TS (`RawInboundMessage.whatsappMsgId → externalMsgId`) vive en E1 y debe ir **antes** para que el código que escribe `Message.externalMsgId` compile. Esta tarea es solo la **columna** de DB. Recomendado: A2 y A3 en la **misma** migración Prisma.

**Cambios:**
- En `Message`: renombrar `whatsappMsgId String?` → `externalMsgId String?` y `@@unique([tenantId, whatsappMsgId])` → `@@unique([tenantId, externalMsgId])` (`prisma/schema.prisma:90,100`).
- **Riesgo de migración:** Prisma, al ver un campo renombrado, por defecto genera `DROP COLUMN` + `ADD COLUMN`, lo que **borra los IDs existentes** y rompe la idempotencia (los mensajes ya vistos volverían a procesarse). **Mitigación obligatoria:** editar a mano el `migration.sql` generado para que use `ALTER TABLE "Message" RENAME COLUMN "whatsappMsgId" TO "externalMsgId";` y renombrar el índice unique en vez de recrearlo. Verificar el SQL antes de aplicar en cualquier entorno con datos.

**Verificación:**
- Grep de cierre previo a migrar: `whatsappMsgId` no debe aparecer en queries crudas/índices fuera de `src/`, `api/`, `spa/` ya cubiertos (decisión abierta #6 del spec). Buscar en todo el repo.
- Tras la migración en una DB **con** una fila `Message` previa: el valor del ID se conserva (no `NULL`).
- `tests/pipeline/idempotency.test.ts` sigue verde con el nombre nuevo (el rename de tipo lo trae E1).
- `npm test` + `npm run typecheck` verdes.

---

### Tarea A4: Script de backfill de `TenantSettings`

**Objetivo:** Crear la fila `TenantSettings` de cada `Tenant` existente leyendo su `config.json`/`profileDir` actual, para que `addTenant` (B) tenga de dónde cargar config. Sin esto, los tenants existentes no levantan.

**Archivos:**
- Crear: `scripts/backfill-tenant-settings.ts` (script de un solo uso)
- Crear: `tests/scripts/backfill-tenant-settings.test.ts`

**Dependencias:** A1 (necesita la tabla). Debe ejecutarse en cada entorno **después** de aplicar A1 y **antes** de que `TenantManager` (B) arranque en ese entorno.

**Cambios:**
- Script que: por cada `Tenant`, lee `profileDir`/`config.json` (vía `loadConfig`/`loadProfile`, `src/config/loader.ts`), mapea a las columnas de `TenantSettings` (`profile.welcome → welcomeTemplate`, `profile.intakeSchema → intakeSchema`, `config.owner.phoneE164 → ownerPhoneE164`, `config.debounceMs → debounceMs`, `config.media.* → transcribeAudio/describeImages/whisperModel/visionModel`, `tenant.industry → industry`, `tenant.name → businessName`) y hace `upsert` idempotente por `tenantId`.
- Marcar `Tenant.profileDir` como **deprecado** en comentario del schema (la columna se conserva durante la ventana de migración; se elimina en una fase posterior). Ningún código nuevo lo lee.

**Verificación:**
- Test: sembrar un `Tenant` + perfil de prueba, correr el backfill, aserción de que `TenantSettings` quedó con los valores esperados. Re-correr y aserción de idempotencia (no duplica, actualiza).
- Manual: tras correr el script en staging, `SELECT count(*)` de `Tenant` sin `TenantSettings` debe ser 0.

---

## Bloque B — `TenantManager`

### Tarea B1: Interfaz `TenantManager` + `TenantRuntime` + `TenantStatus`

**Objetivo:** Declarar los contratos (sin construir Baileys todavía) para poder testear el ciclo de vida con un runtime falso.

**Archivos:**
- Crear: `src/tenant/types.ts` (interfaces `TenantStatus`, `TenantManager`, `TenantRuntime`)
- Crear: `tests/tenant/manager.test.ts` (con runtime falso, primero falla)

**Dependencias:** A1 (la forma de la config que `addTenant` carga viene de `TenantSettings`).

**Cambios:**
- `TenantStatus`: `{ tenantId, connected, qr, phone, status: 'starting'|'connected'|'disconnected'|'logged_out'|'error', lastConnectedAt, lastError }` (spec §3.2).
- `TenantManager`: `start()`, `addTenant(tenantId)`, `removeTenant(tenantId)`, `getStatus(tenantId): TenantStatus | null`, `logout(tenantId)`, `reconnect(tenantId)`, `stop()` (spec §3.2).
- `TenantRuntime`: contrato interno con `start()`, `stop()`, `getStatus()`, `logout()`, `reconnect()` — encapsula adapter + sender + notifier + coordinator de un tenant.

**Verificación:**
- Test escrito contra la interfaz (con un `TenantRuntime` falso inyectado) que aún no compila/pasa → confirma forma de los contratos.

---

### Tarea B2: Implementación `TenantManager` con `Map<tenantId, TenantRuntime>`

**Objetivo:** Ciclo de vida en caliente: `addTenant`/`removeTenant`/`getStatus`/`logout`/`reconnect`/`stop`, con un factory de `TenantRuntime` inyectable (para test sin Baileys real).

**Archivos:**
- Crear: `src/tenant/manager.ts`
- Modificar: `tests/tenant/manager.test.ts`

**Dependencias:** B1.

**Cambios:**
- `TenantManager` recibe `{ prisma, runtimeFactory }` por constructor (inyección del factory → tests usan un runtime falso que registra start/stop sin red).
- `addTenant(tenantId)`: idempotente (si ya hay runtime, no-op); construye el runtime vía factory, lo arranca, lo registra en el `Map`. Envuelve el arranque en try/catch: si falla, deja el runtime/entrada en `status: 'error'` consultable por `getStatus` (no lanza hacia arriba).
- `removeTenant(tenantId)`: idempotente; llama `runtime.stop()` (limpia timers — ver `disconnectTimer`, `src/adapters/whatsapp/adapter.ts:16`), elimina del `Map`. No borra la sesión persistida salvo `logout` explícito.
- `getStatus(tenantId)`: devuelve `null` si no hay runtime (clave para el 404/409 de la API en D).
- `logout`/`reconnect`: delegan al runtime correspondiente; no-op seguro si no existe.
- `stop()`: `Promise.allSettled` sobre `removeTenant` de todos.

**Verificación:**
- Tests con runtime falso: `addTenant` dos veces es idempotente; `removeTenant` de un id inexistente no lanza; `getStatus` de id desconocido es `null`; un factory que lanza deja `status:'error'` y **no** tumba `addTenant` de otros; `stop()` para todos.
- `npm test` + `npm run typecheck` verdes.

---

### Tarea B3: `start()` cargando tenants `active` desde Postgres con aislamiento de fallos

**Objetivo:** Que el arranque levante **todos** los tenants `active` y que el fallo de uno no impida los demás.

**Archivos:**
- Modificar: `src/tenant/manager.ts`
- Modificar: `tests/tenant/manager.test.ts`

**Dependencias:** B2, A1 (columna `active`).

**Cambios:**
- `start()`: `prisma.tenant.findMany({ where: { active: true }, select: { id: true } })` y `Promise.allSettled(tenants.map(t => this.addTenant(t.id)))` (spec §3.3). `allSettled`, no `all`: un fallo de arranque no aborta el resto; cada fallo se registra y deja ese tenant en `status:'error'`.

**Verificación:**
- Test: sembrar 2 tenants `active` + 1 `active:false`; con un factory que falla **solo** para uno, `start()` resuelve, el sano queda `connected` y el inactivo no se levanta. Aserción de que el inactivo no está en el `Map`.
- `npm test` verde.

---

### Tarea B4: `TenantRuntime` real (Baileys + coordinator por tenant) + supervisión

**Objetivo:** El runtime que arma, para **un** tenant, lo que hoy hace `main()` (`src/index.ts:84-106`), parametrizado por `tenantId` y por la config de `TenantSettings`, con `sessionDir = ./data/baileys-session/<tenantId>`, y reinicio aislado ante fallo catastrófico de la conexión.

**Archivos:**
- Crear: `src/tenant/runtime.ts`
- Crear: `tests/tenant/runtime.test.ts`

**Dependencias:** B1, A1 (config), E2 (interfaces de canal — el runtime depende de `InboundSource`/`ChannelOutboundSender`/`ChannelNotifier`, no de Baileys directamente). **Por eso E2 va antes que B4 en el orden recomendado.**

**Cambios:**
- `createTenantRuntime(tenantId, { prisma, settings })`: carga config del tenant de `TenantSettings`; construye `mediaStore`, `transcriber`/`describer` (según `OPENROUTER_API_KEY` y flags del tenant), `ChannelOutboundSender` + `ChannelNotifier` (WhatsApp), `InboundCoordinator` (deps con `tenantId` + config del tenant) y la `InboundSource` (BaileysAdapter) con `sessionDir = ./data/baileys-session/<tenantId>` (spec §3.4).
- Supervisión: el ciclo de vida de la `InboundSource` se envuelve en try/catch; ante fallo catastrófico se reintenta el arranque de **este** runtime con backoff, sin tocar los demás (spec §3.1, §3.4-paso 5).
- `media`: directorio por tenant `./media/<tenantId>` (particionado dentro del volumen, spec §5.4).

**Verificación:**
- Test que inyecta una `InboundSource` falsa que lanza al arrancar y verifica que el runtime queda `status:'error'` y reintenta (con un reloj/backoff falso), sin propagar excepción.
- Test de que `sessionDir` y `mediaDir` se derivan del `tenantId`.
- `npm test` + `npm run typecheck` verdes.

---

## Bloque C — Refactor `src/index.ts`

### Tarea C1: `main()` instancia `TenantManager`, sin `TENANT_ID` único

**Objetivo:** El proceso deja de ser "un tenant". `main()` crea el `TenantManager`, llama `start()` (carga tenants `active`), y el shutdown apaga todos los runtimes.

**Archivos:**
- Modificar: `src/index.ts`

**Dependencias:** B (TenantManager completo) y D1 (forma del endpoint interno por dispatcher — ver nota). El cambio del endpoint interno (de "estado del proceso" a "estado del tenant pedido") se coordina con D.

**Cambios (descritos, sin código completo):**
- **Eliminar** la exigencia de `process.env.TENANT_ID` (`src/index.ts:38-44`) y la construcción de la cadena única sender→notifier→coordinator→adapter (`:84-106`).
- `main()`: `const manager = new TenantManager({ prisma, runtimeFactory: createTenantRuntime }); await manager.start();`.
- `startInternalServer` se inyecta con un **dispatcher** que resuelve `tenantId` por request (querystring/body) y consulta `manager.getStatus/logout/reconnect`, en vez de un único `adapterState`/`actions` cableado a un solo adapter (`:112-130`). La forma del endpoint deja de ser "el estado del proceso" y pasa a ser "el estado del tenant pedido".
- Shutdown (`:132-143`): `await manager.stop()` en vez de `adapter.stop()`.
- **Compatibilidad dev (opcional):** si se define `TENANT_ID`, `main()` puede hacer `await manager.addTenant(process.env.TENANT_ID)` como atajo de desarrollo local. No es el camino de producción.

**Verificación:**
- Test de arranque (con `prisma` de test sembrado con 1 tenant `active` y un `runtimeFactory` falso) que confirma que `manager.start()` levantó el tenant y que `SIGTERM` llama `manager.stop()`.
- `npm run typecheck` verde.

---

## Bloque D — Ruteo dinámico en la API

### Tarea D1: Endpoint interno del `TenantManager` despacha por `tenantId`

**Objetivo:** El endpoint interno deja de ser "el estado del proceso" y pasa a recibir `tenantId` y despachar a la conexión correcta.

**Archivos:**
- Modificar: `src/internal/server.ts`
- Modificar: `tests/internal/server.test.ts`

**Dependencias:** B (manager), C1 (quién inyecta el dispatcher).

**Cambios:**
- `GET /internal/wa-status?tenantId=<id>` → `manager.getStatus(tenantId)`; si `null`, responde 404/409 ("tenant sin conexión activa"), **no** el estado de otro tenant (spec §5.2).
- `POST /internal/wa-logout { tenantId }` → `manager.logout(tenantId)`.
- `POST /internal/wa-reconnect { tenantId }` → `manager.reconnect(tenantId)`.
- `Authorization: Bearer ${INTERNAL_API_TOKEN}` se conserva sin cambios (defensa en profundidad).

**Verificación:**
- Tests: 401 sin token (sin cambios); 200 + estado del tenant pedido con token correcto; 404/409 para un `tenantId` sin runtime; logout/reconnect despachan al `tenantId` correcto (con manager falso).
- `npm test` verde.

---

### Tarea D2: `wa-status.ts` resuelve `tenantId` del JWT y lo pasa a la URL única

**Objetivo:** Que `wa-status` devuelva el estado **del tenant del usuario** (resuelto del JWT), no de uno fijo, y que la API nunca confíe en un `tenantId` del cliente.

**Archivos:**
- Modificar: `api/src/routes/wa-status.ts`
- Modificar: tests de la ruta (crear si no existen: `api/tests/routes/wa-status.test.ts`)

**Dependencias:** D1.

**Cambios:**
- El `GET /wa-status` y `proxyAction` dejan de ignorar el request (hoy `_request`, `:7,33,36`): leen `request.user.tenantId`/`request.tenant` que expone `app.authenticate`.
- Inyectan el `tenantId` resuelto hacia la **única** URL interna del `TenantManager`: querystring para el GET, body para los POST.
- **Aislamiento:** el `tenantId` SIEMPRE es el del JWT, nunca uno que venga del cliente (defensa contra un usuario que intente consultar el estado de otro tenant, spec §5.3).
- El `INTERNAL_API_TOKEN` y el manejo de errores 502/503 se conservan tal cual.

**Verificación:**
- Tests con un `fetcher` falso: el GET reenvía `?tenantId=<jwt>`; los POST reenvían `{ tenantId: <jwt> }`; un `tenantId` enviado por el cliente se ignora; 503 si falta config, 502 si el worker responde mal/inalcanzable (paridad con el comportamiento actual).
- `npm test` verde.

---

### Tarea D3: Compose — un solo servicio `worker`, una sola URL interna

**Objetivo:** Que agregar un tenant **no** toque `docker-compose.yml`. Un único servicio worker (`TenantManager`) y una única URL interna estable.

**Archivos:**
- Modificar: `docker-compose.yml`
- Modificar: `.env.example`
- Modificar: `docs/runbooks/` (nota de "agregar tenant" pasa a ser `manager.addTenant`/alta por API)

**Dependencias:** C1, D2.

**Cambios:**
- Reemplazar el servicio `worker-tapiceria` (`docker-compose.yml:17-34`) por **un** servicio `worker` (el `TenantManager`); quitar `TENANT_ID` de su `environment`.
- Volúmenes: en vez de `baileys-tapiceria`/`media-tapiceria` por tenant, un volumen de sesiones y uno de media particionados **dentro** por `tenantId` (`./data/baileys-session/<id>`, `./media/<id>`, spec §5.4).
- API: `WORKER_INTERNAL_URL: http://worker:3002` (decisión abierta #1: renombrar a `TENANT_MANAGER_URL` o conservar el nombre — recomendado renombrar, es un cambio semántico real; si se renombra, actualizar `wa-status.ts` y `.env.example`).
- `.env.example`: quitar `TENANT_TAPICERIA_ID`.

**Verificación:**
- `docker compose config` valida sin error.
- Smoke manual en staging: `docker compose up -d` levanta postgres + worker + api; con 2 tenants `active` sembrados, ambos bots conectan con sesiones Baileys aisladas (criterio de aceptación del spec §8).

---

## Bloque E — Capa de canal

### Tarea E1: Rename de tipo `RawInboundMessage.whatsappMsgId` → `externalMsgId` + `channel`

**Objetivo:** Hacer el tipo de mensaje entrante agnóstico al canal. Es la **base** del resto (va primero del orden recomendado). Refactor de tipos puro, sin cambio de comportamiento.

**Archivos:**
- Modificar: `src/pipeline/types.ts`
- Modificar: `src/pipeline/coordinator.ts` (`:31,43,49,50,61`)
- Modificar: `src/adapters/whatsapp/mapMessage.ts` (`:39,86`)
- Modificar: tests que construyen `RawInboundMessage` (`tests/pipeline/*`, `tests/adapters/*`)

**Dependencias:** Ninguna. Va antes que A3 (columna) para que el código que escribe `Message.externalMsgId` compile contra el tipo nuevo. **Nota:** entre E1 (tipo `externalMsgId`) y A3 (columna `externalMsgId`) el código que persiste el mensaje quedaría desalineado con la DB; por eso A3 va inmediatamente después de E1 en el orden recomendado, y `normalize.ts`/`coordinator.ts` se actualizan para escribir `externalMsgId` como parte de A3.

**Cambios:**
- En `src/pipeline/types.ts:10-20`: `export type Channel = 'whatsapp' | 'sms' | 'voice';`. `RawInboundMessage`: `whatsappMsgId` → `externalMsgId: string`; añadir `channel: Channel`.
- `mapMessage.ts`: produce `externalMsgId` (`:39,86`) y setea `channel: 'whatsapp'`.
- `coordinator.ts`: propagar el rename en logging e idempotencia (`alreadySeen(..., raw.externalMsgId)`).

**Verificación:**
- `npm run typecheck` verde (el rename compila end-to-end).
- `npm test` verde (sin cambio de comportamiento; idempotencia intacta).

---

### Tarea E2: Interfaces de canal — `InboundSource` / `ChannelOutboundSender` / `ChannelNotifier`

**Objetivo:** Formalizar la frontera del worker en tres contratos parametrizados por canal, con WhatsApp como **una** implementación. Abstracción lista para Fase 8, **sin** construir SMS ni voz.

**Archivos:**
- Crear: `src/channels/types.ts` (las tres interfaces)
- Modificar: `src/adapters/whatsapp/adapter.ts` (implementa `InboundSource`, `channel='whatsapp'`)
- Modificar: `src/adapters/whatsapp/sender.ts`, `src/adapters/whatsapp/notifier.ts` (declaran su `channel`)
- Modificar: tests de los adapters

**Dependencias:** E1 (necesita `Channel`). Debe ir **antes** de B4/C1 (el `TenantRuntime` depende de estas interfaces, no de Baileys).

**Cambios (spec §7.3):**
- `InboundSource`: `{ readonly channel: Channel; start(): Promise<void>; stop(): Promise<void> }` — empuja `RawInboundMessage` (con `channel` ya seteado) al `InboundCoordinator`.
- `ChannelOutboundSender extends OutboundSender { readonly channel: Channel }`.
- `ChannelNotifier extends Notifier { readonly channel: Channel }`.
- `BaileysAdapter` implementa `InboundSource` con `channel='whatsapp'`; `WhatsAppSender`/`WhatsAppNotifier` declaran `channel='whatsapp'`.
- El `TenantRuntime` (B4) habla de estas interfaces en su firma, no de "Baileys".

**Verificación:**
- `npm run typecheck` verde; `BaileysAdapter` satisface `InboundSource`.
- `npm test` verde (WhatsApp sigue siendo la única implementación; sin SMS/voz).

---

## Riesgos y mitigaciones

1. **Aislamiento de fallos (Enfoque A):** un crash del proceso afecta a varios tenants. **Mitigación:** supervisión por-tenant (B4) — cada `TenantRuntime` en su try/catch con reinicio aislado y backoff; `start()` usa `Promise.allSettled` (B3); un tenant en `status:'error'` no tumba a los demás ni al proceso. Verificado por tests con factory/source que falla solo para un tenant.
2. **Migración de datos: rename `whatsappMsgId` (A3):** el `migration.sql` por defecto haría drop+add y **borraría la idempotencia**. **Mitigación obligatoria:** editar el SQL a `ALTER ... RENAME COLUMN` + renombrar el índice; verificar el SQL y probar en una DB con datos antes de prod.
3. **Backfill de `TenantSettings` (A4):** sin él, los tenants existentes no tienen config y `addTenant` no levanta. **Mitigación:** script idempotente con test; en cada entorno correr A1 → A4 **antes** de arrancar el `TenantManager`. Validar `Tenant` sin `settings = 0` post-backfill.
4. **Límite de tenants por proceso:** N conexiones Baileys en un proceso tiene un techo de memoria/CPU (decisión abierta #4). **Mitigación:** observar memoria/CPU en staging con 2 tenants; definir umbral y estrategia de sharding del `TenantManager` antes de crecer no linealmente. Fuera de alcance de esta fase, pero registrado.
5. **Sesiones Baileys particionadas por carpeta vs N volúmenes (decisión abierta #3):** particionar `./data/baileys-session/<id>` simplifica el alta pero complica backup/borrado granular (relevante para Fase 6, derecho de borrado). **Mitigación:** aceptable en Fase 2; se refina en Fase 6.
6. **Coordinación E1↔A3 y E2↔C/B4:** el rename de tipo y de columna deben quedar alineados en la misma ventana; las interfaces de canal deben existir antes de que el runtime dependa de ellas. **Mitigación:** seguir el orden recomendado (E1 → A → B(+E2 antes de B4) → C → D); cada tarea cierra con `typecheck` + `npm test` verdes.
7. **`Tenant.active` vs estado de suscripción (decisión abierta #2):** hasta Fase 3 (billing), `active` es la fuente de verdad independiente; se reconciliará con `Subscription` en Fase 3. Sin acción aquí, registrado.

---

## Checklist final (criterios de aceptación, spec §8)

- [ ] Alta de un tenant desde código/API (`manager.addTenant(id)`) crea su conexión Baileys **sin reiniciar** el proceso ni tocar `docker-compose.yml`/`.env`. *(B2, C1, D3)*
- [ ] `TenantManager.start()` levanta todos los tenants `active` desde Postgres; el fallo de uno no impide los demás. *(B3)*
- [ ] `wa-status` devuelve el estado **del tenant del usuario** (JWT); un tenant sin runtime responde 404/409, no el estado de otro. *(D1, D2)*
- [ ] `WORKER_INTERNAL_URL` deja de ser una URL por worker: una sola URL interna del `TenantManager`, ruteo por `tenantId`. *(D2, D3)*
- [ ] Dos tenants con bots simultáneos, mensajes y sesiones Baileys aislados, verificado en staging. *(B4, D3)*
- [ ] Existe `TenantSettings`; la config del bot (welcome, intakeSchema, flags de media, owner phone, debounce) es editable por tenant **sin tocar JSON en disco**. *(A1; edición por panel en `api/src/routes/settings.ts`, fuera del alcance estricto de este plan pero habilitada)*
- [ ] Backfill de `TenantSettings` ejecutado para los tenants existentes; ningún código nuevo lee `Tenant.profileDir`. *(A4)*
- [ ] `Message` y `Contact` tienen columna `channel` (default `'whatsapp'`); `RawInboundMessage` usa `externalMsgId` + `channel`; la migración **renombró** (no recreó) `whatsappMsgId` preservando la idempotencia. *(A2, A3, E1)*
- [ ] WhatsApp es **una** implementación de `InboundSource` / `ChannelOutboundSender` / `ChannelNotifier`; el `TenantRuntime` depende de las interfaces, no de Baileys. Sin SMS/voz construidos. *(E2, B4)*
- [ ] La supervisión por-tenant reinicia la conexión de un tenant caído sin derribar las demás ni el proceso. *(B4)*
- [ ] `npm test` + `npm run typecheck` verdes tras cada bloque.

---

## Self-Review

**Cobertura del spec (§3–§7):**
- `TenantManager` (interfaz, `start` cargando `active`, `addTenant`/`removeTenant`/`getStatus`/`logout`/`reconnect`/`stop`, supervisión por-tenant): Bloque B (B1–B4). ✓
- Refactor `src/index.ts` sin `TENANT_ID` único: C1. ✓
- Ruteo dinámico `wa-status`/logout/reconnect por `tenantId` del JWT + URL única + Compose: Bloque D (D1–D3). ✓
- `TenantSettings` + `Tenant.active` + backfill: A1, A4. ✓
- `channel` en `Message`/`Contact` + rename `whatsappMsgId→externalMsgId` (rename, no drop+add): A2, A3, E1. ✓
- Capa de canal (`InboundSource`/`ChannelOutboundSender`/`ChannelNotifier`, WhatsApp como una implementación): E1, E2. ✓

**Orden y dependencias:** explicitadas por tarea y resumidas en el bloque "Orden recomendado". Las dos coordinaciones delicadas (E1↔A3 de rename; E2 antes de B4/C1) están señaladas como riesgo #6.

**Decisiones abiertas del spec referenciadas:** #1 (nombre de la URL interna, D3), #2 (`active` vs suscripción, riesgo #7), #3 (sesiones particionadas, riesgo #5), #4 (límite por proceso, riesgo #4), #6 (grep de cierre del rename, A3). #5 (`intakeSchema` jsonb vs columnas) queda como `Json` validado en la capa de aplicación (A1), consistente con el spec.

**Alcance:** No se construye SMS ni voz (E2 deja solo la abstracción). No se rehace el threading de `tenantId` del Plan 1 (ya en código). `Tenant.profileDir` se deprecia, no se elimina (ventana de migración).
