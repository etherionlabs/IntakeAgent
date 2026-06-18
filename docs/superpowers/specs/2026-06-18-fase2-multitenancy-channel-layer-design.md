# Fase 2 — Multi-tenancy real (`TenantManager` + ruteo) y capa de canal — Diseño

**Fecha:** 2026-06-18
**Estado:** Propuesta para implementación
**Enfoque elegido:** A (worker multi-tenant con `TenantManager`), capa de canal en versión mínima (abstracción lista, sin nuevos canales)

---

## 1. Objetivo

Que **agregar un tenant no requiera tocar `docker-compose.yml`, `.env` ni
reiniciar el proceso**. Es el prerequisito técnico del self-service (Fase 4) y
cierra las brechas 3 y 4 del roadmap (`docs/ROADMAP-PRODUCCION.md`):

- Brecha 3: la API cablea **un solo** worker
  (`WORKER_INTERNAL_URL: http://worker-tapiceria:3002`, `docker-compose.yml:44`,
  consumido en `api/src/routes/wa-status.ts:8`). Con N tenants `wa-status`
  apunta siempre al mismo worker.
- Brecha 4: un worker por tenant editado a mano = editar Compose + `.env` +
  reiniciar. Incompatible con self-service.

En paralelo, se hace un **refactor ligero de capa de canal** que deja el borde
del worker agnóstico al canal (habilitador de SMS/voz de la Fase 8), **sin
construir SMS ni voz aquí**.

La pregunta que guía cada decisión es la misma del spec maestro
(`docs/superpowers/specs/2026-06-13-saas-deployment-design.md`): "qué nos deja
listos para self-service sin cerrar el camino", no "qué arquitectura es más
elegante".

**Línea base (verificada en código, no se rehace):**
- Schema PostgreSQL multi-tenant con `tenantId` en todas las tablas
  (`prisma/schema.prisma`).
- Worker dockerizado que hoy lee `TENANT_ID` por env (`src/index.ts:38`) y
  escribe a Postgres aislado por tenant.
- Endpoint interno protegido con `INTERNAL_API_TOKEN`
  (`src/internal/server.ts`).
- API central Fastify + JWT con `wa-status` y acciones logout/reconnect
  (`api/src/routes/wa-status.ts`).
- El núcleo del pipeline ya es agnóstico al canal: `OutboundSender`
  (`src/services/outbound.ts`) y `Notifier` (`src/services/notification.ts`) son
  interfaces; el agente no sabe de WhatsApp. Lo acoplado es solo el borde
  (`src/adapters/whatsapp/`).

---

## 2. Decisión de arquitectura (requiere aprobación)

Para soportar N tenants dinámicos hay dos caminos.

### Enfoque A — Worker multi-tenant (`TenantManager`) *(recomendado)*

Un solo proceso worker mantiene **N conexiones Baileys, una por tenant**,
creadas/destruidas en caliente al alta/baja. La API rutea `wa-status` por
`tenantId` hacia un **único endpoint interno** del `TenantManager`, que despacha
a la conexión correcta.

- ✔ **Self-service trivial**: alta de tenant = crear una conexión en memoria, no
  un contenedor.
- ✔ **Menos infra**: un proceso, un endpoint interno, un volumen de sesiones
  particionado por `tenantId`. La API deja de necesitar una URL por worker.
- ✔ **Ya previsto como destino** en el spec maestro (deuda técnica #2,
  `2026-06-13-saas-deployment-design.md:299`).
- ✗ **Aislamiento de fallos más débil**: un crash del proceso afecta a varios
  tenants. **Mitigación**: supervisión por-tenant (cada conexión vive en su
  propio `TenantRuntime` con try/catch y reinicio aislado), de forma que un fallo
  de la conexión de un tenant **no derribe** las demás ni el proceso.

### Enfoque B — Un contenedor worker por tenant, orquestado por código

La API lanza/para contenedores vía Docker API u orquestador.

- ✔ Mejor aislamiento de fallos (un contenedor por tenant).
- ✗ Mucha más complejidad operativa: orquestación, ciclo de vida de contenedores,
  límites de recursos, descubrimiento de red dinámico, más superficie de fallo.
  Desproporcionado para el tamaño actual (2 tenants → crecimiento no lineal).

### Recomendación

**Enfoque A.** El resto de este diseño lo asume. El aislamiento de fallos se
resuelve con supervisión por-tenant, no con un contenedor por tenant.

---

## 3. `TenantManager` — diseño

El `TenantManager` reemplaza el "un proceso = un tenant" de `src/index.ts`. Es el
dueño del ciclo de vida de las conexiones Baileys y la única pieza que el
endpoint interno consulta para despachar por `tenantId`.

### 3.1 Modelo mental

```
TenantManager
  ├─ Map<tenantId, TenantRuntime>
  │
  TenantRuntime (uno por tenant, aislado)
  ├─ BaileysAdapter            (sessionDir = ./data/baileys-session/<tenantId>)
  ├─ InboundCoordinator        (deps con tenantId + config del tenant)
  ├─ WhatsAppSender / WhatsAppNotifier
  └─ supervisión: try/catch + reinicio aislado de ESTA conexión
```

Cada `TenantRuntime` encapsula exactamente lo que hoy arma `main()` en
`src/index.ts:37-150` para un solo tenant, pero parametrizado por `tenantId` y
por la **config del tenant** (sección 6, tabla `TenantSettings`) en lugar de un
`config.json` + `profileDir` estáticos.

### 3.2 Interfaz

```ts
export interface TenantStatus {
  tenantId: string;
  connected: boolean;
  qr: string | null;
  phone: string;
  status: 'starting' | 'connected' | 'disconnected' | 'logged_out' | 'error';
  lastConnectedAt: string | null;
  lastError: string | null;
}

export interface TenantManager {
  /** Arranque: carga todos los tenants activos desde Postgres y levanta su runtime. */
  start(): Promise<void>;

  /** Alta en caliente: crea el runtime + conexión Baileys de un tenant. Idempotente. */
  addTenant(tenantId: string): Promise<void>;

  /** Baja en caliente: detiene la conexión, libera recursos. Idempotente. */
  removeTenant(tenantId: string): Promise<void>;

  /** Estado de un tenant para el proxy wa-status. */
  getStatus(tenantId: string): TenantStatus | null;

  /** Acciones por tenant (despachadas por el endpoint interno). */
  logout(tenantId: string): Promise<void>;
  reconnect(tenantId: string): Promise<void>;

  /** Apagado ordenado de todos los runtimes. */
  stop(): Promise<void>;
}
```

### 3.3 Arranque cargando tenants activos desde Postgres

En lugar de leer `process.env.TENANT_ID`, `start()` consulta los tenants activos:

```ts
const tenants = await prisma.tenant.findMany({
  where: { active: true },        // ver columna `active` en §6
  select: { id: true },
});
await Promise.allSettled(tenants.map((t) => this.addTenant(t.id)));
```

`Promise.allSettled` (no `all`) garantiza que el fallo de arranque de **un**
tenant no impida levantar el resto. Cada fallo se registra y deja al
`TenantRuntime` en `status: 'error'` (consultable por `getStatus`).

### 3.4 `addTenant(tenantId)` — qué hace en caliente

1. Si ya existe runtime para `tenantId`, no-op (idempotente).
2. Carga la config del tenant desde `TenantSettings` (§6) y la plantilla de
   perfil de intake por industria.
3. Construye `mediaStore`, `transcriber`/`describer` (según `OPENROUTER_API_KEY`
   y flags del tenant), `WhatsAppSender`, `WhatsAppNotifier`, `InboundCoordinator`
   y `BaileysAdapter` con `sessionDir = ./data/baileys-session/<tenantId>`.
4. Inicia el adapter; registra el runtime en el `Map`.
5. Envuelve el ciclo de vida en supervisión: si el adapter falla
   catastróficamente, se reintenta el arranque de **ese** runtime con backoff,
   sin tocar los demás.

### 3.5 `removeTenant(tenantId)`

Detiene el `BaileysAdapter` (`adapter.stop()`), limpia timers (ver
`disconnectTimer` en `src/adapters/whatsapp/adapter.ts:16`), elimina el runtime
del `Map`. No borra la sesión persistida salvo que la baja sea un `logout`
explícito.

---

## 4. Refactor de `src/index.ts` (no asumir un único `TENANT_ID`)

Hoy `main()` (`src/index.ts:37-150`):

1. Exige `process.env.TENANT_ID` y aborta si falta (`:38-44`).
2. Carga `config.json` + `profileDir` estáticos (`:46-47`).
3. Arma **una** cadena sender → notifier → coordinator → adapter (`:84-106`).
4. Levanta **un** `startInternalServer` con `adapterState`/`actions` cableados a
   ese único adapter (`:112-130`).

El refactor:

- **Eliminar** la dependencia de `TENANT_ID`. El proceso ya no es "un tenant".
- `main()` instancia el `TenantManager`, llama `await manager.start()` (carga
  tenants activos desde Postgres, §3.3).
- `startInternalServer` se inyecta con un **dispatcher** que resuelve `tenantId`
  por request (§5.2) en vez de un único `adapterState`/`actions`. La forma del
  endpoint interno deja de ser "el estado del proceso" y pasa a ser "el estado
  del tenant pedido".
- Shutdown (`:132-143`) llama `await manager.stop()` (apaga todos los runtimes)
  en vez de un solo `adapter.stop()`.
- **Compatibilidad**: si se quiere conservar el modo "un tenant por proceso" para
  desarrollo local, `TENANT_ID` puede seguir soportándose como atajo opcional que
  hace `manager.addTenant(process.env.TENANT_ID)` y nada más. No es el camino de
  producción.

`InboundCoordinator` **no cambia**: ya recibe `tenantId` por deps
(`src/pipeline/types.ts:24`, `src/pipeline/coordinator.ts:47`) y filtra todas las
queries por él. El cambio es de **quién construye y posee** los coordinadores
(antes `main()`, ahora cada `TenantRuntime`).

---

## 5. Ruteo dinámico en la API

### 5.1 El problema actual

`api/src/routes/wa-status.ts` lee `process.env.WORKER_INTERNAL_URL` (fijo,
`docker-compose.yml:44`) y golpea `${base}/internal/wa-status`. Con N tenants
**siempre** consulta el mismo worker, sin importar el `tenantId` del JWT. Lo
mismo para `/wa-status/logout` y `/wa-status/reconnect` (`:33-38`).

### 5.2 Cambio: resolver `tenantId` del JWT y despachar por tenant

Con el Enfoque A hay **un** `TenantManager` detrás de **una** URL interna. La
API ya no necesita "elegir worker"; necesita **pasar el `tenantId`** para que el
`TenantManager` despache a la conexión correcta.

- `WORKER_INTERNAL_URL` deja de ser "la URL del worker de tapicería" y pasa a ser
  `TENANT_MANAGER_URL` (o se conserva el nombre): **una sola** URL interna,
  estable, que apunta al proceso `TenantManager`. **Ya no hay una URL por
  tenant**, ni hay que regenerarla al alta de un tenant.
- Las rutas obtienen `tenantId` del JWT. El middleware `app.authenticate` ya
  expone el tenant del usuario (claims `{ userId, tenantId, role }` del spec
  maestro). `wa-status.ts` debe leer `request.tenant`/`request.user.tenantId` en
  vez de ignorar el request (hoy usa `_request`, `:7`).
- El endpoint interno del `TenantManager` recibe el `tenantId` y despacha:

```
GET  /internal/wa-status?tenantId=<id>     → manager.getStatus(tenantId)
POST /internal/wa-logout    { tenantId }   → manager.logout(tenantId)
POST /internal/wa-reconnect { tenantId }   → manager.reconnect(tenantId)
  Authorization: Bearer ${INTERNAL_API_TOKEN}   (sin cambios, defensa en profundidad)
```

`getStatus(tenantId)` devuelve `null` si el tenant no tiene runtime → la API
responde `404`/`409` ("tenant sin conexión activa") en vez de `200` con el estado
de otro tenant. Esto es exactamente lo que pide el criterio de aceptación
"`wa-status` devuelve el estado **del tenant del usuario**".

### 5.3 Forma del cambio en `wa-status.ts`

- `proxyAction` y el `GET` pasan a inyectar el `tenantId` resuelto del JWT
  (querystring para GET, body para POST) hacia la URL única del `TenantManager`.
- El `INTERNAL_API_TOKEN` y el manejo de errores 502/503 se conservan tal cual.
- Aislamiento: la API **nunca** confía en un `tenantId` que venga del cliente;
  siempre el del JWT. Defensa contra un usuario que intente consultar el estado
  de otro tenant.

### 5.4 Compose

`docker-compose.yml` deja de tener un servicio `worker-tapiceria` por tenant.
Pasa a tener **un** servicio `worker` (el `TenantManager`) y la API apunta su
`WORKER_INTERNAL_URL`/`TENANT_MANAGER_URL` a ese único servicio. Los volúmenes de
sesión Baileys y media dejan de ser por-tenant a nivel Compose; el particionado
por `tenantId` pasa a ser **dentro** del volumen (`./data/baileys-session/<id>`,
`./media/<id>`). Agregar un tenant ya no toca este archivo.

---

## 6. Tabla `TenantSettings` (config del bot por tenant, editable por UI)

Reemplaza el `profileDir` JSON estático (`Tenant.profileDir`,
`prisma/schema.prisma:13`) como **fuente de la config operativa del bot**. Cierra
la deuda técnica #3 del spec maestro
(`2026-06-13-saas-deployment-design.md:300`). El `TenantManager` carga esta config
en `addTenant` (§3.4) en lugar de leer `config.json` del disco.

### 6.1 Columnas

```
TenantSettings
  tenantId          uuid PK / FK → Tenant     -- 1:1 con Tenant
  industry          text                       -- 'tapiceria' | 'paqueteria' | 'generico' (plantilla base)
  businessName      text                       -- nombre mostrado al cliente final
  businessDomain    text                       -- giro/dominio (alimenta el prompt del agente)
  ownerPhoneE164    text                       -- destino de notificaciones al dueño (hoy config.owner.phoneE164)
  welcomeTemplate   text                       -- mensaje de bienvenida (hoy profile.welcome)
  intakeSchema      jsonb                      -- schema de intake del tenant (hoy profile.intakeSchema)
  debounceMs        int   default 8000         -- ventana de debounce (hoy config.debounceMs)
  transcribeAudio   bool  default false        -- flags de media (hoy config.media.*)
  describeImages    bool  default false
  whisperModel      text  nullable
  visionModel       text  nullable
  panelUrl          text  nullable             -- URL del panel para enlaces en notificaciones
  updatedAt         timestamptz
```

Notas:
- `intakeSchema` se guarda como `jsonb` (editable por UI por campo, validado
  contra el schema de `src/config/intake-schema.ts`). Al alta se **precarga** la
  plantilla de la `industry` elegida (tapicería / paquetería / genérico), como
  pide la tarea de "carga de perfiles de intake por industria".
- `Tenant.profileDir` queda **deprecado**; se mantiene la columna durante una
  ventana de migración y luego se elimina. Ningún código nuevo lo lee.
- También habilita la columna `Tenant.active` que `TenantManager.start()` filtra
  (§3.3): si no existe ya, se añade `Tenant.active boolean default true`.

### 6.2 Migración Prisma

Modelo a añadir en `prisma/schema.prisma`:

```prisma
model TenantSettings {
  tenantId         String   @id
  industry         String
  businessName     String
  businessDomain   String
  ownerPhoneE164   String
  welcomeTemplate  String
  intakeSchema     Json
  debounceMs       Int      @default(8000)
  transcribeAudio  Boolean  @default(false)
  describeImages   Boolean  @default(false)
  whisperModel     String?
  visionModel      String?
  panelUrl         String?
  updatedAt        DateTime @updatedAt

  tenant           Tenant   @relation(fields: [tenantId], references: [id])
}
```

Y en `Tenant`: `active Boolean @default(true)` + relación inversa
`settings TenantSettings?`.

Pasos de la migración (`prisma migrate`):
1. `migrate dev --name tenant_settings` en desarrollo; `migrate deploy` en
   producción (parte del proceso de deploy, nunca `migrate dev` en prod — regla
   del spec maestro `2026-06-13:277`).
2. **Backfill**: por cada `Tenant` existente, crear su fila `TenantSettings`
   leyendo el `config.json`/`profileDir` actual (script de un solo uso). Sin
   esto, `addTenant` no tiene de dónde cargar config.
3. Una vez confirmado el backfill, marcar `profileDir` como deprecado.

La SPA (ruta `settings`, ya existente, `api/src/routes/settings.ts`) pasa a editar
estas columnas en vez de un JSON en disco — cierra el criterio "config del bot
editable por tenant desde el panel (sin tocar JSON en disco)".

---

## 7. Capa de canal (refactor ligero, habilitador de SMS/voz)

El núcleo ya es agnóstico: `OutboundSender.sendText` (`src/services/outbound.ts:6`)
y `Notifier` (`src/services/notification.ts:13`) son contratos; el agente no
conoce WhatsApp. Lo acoplado es el **borde** (`src/adapters/whatsapp/`). Este
refactor formaliza esa frontera. **No** se construye SMS ni voz aquí: solo se deja
la abstracción lista para la Fase 8.

### 7.1 `RawInboundMessage.whatsappMsgId` → `externalMsgId` + `channel`

En `src/pipeline/types.ts:10-20`:

```ts
export type Channel = 'whatsapp' | 'sms' | 'voice';

export interface RawInboundMessage {
  externalMsgId: string;          // antes: whatsappMsgId
  channel: Channel;               // nuevo
  fromPhoneE164: string;
  // ...resto sin cambios
}
```

Propagar el rename en los consumidores: `src/pipeline/coordinator.ts` lo usa en
`handleInbound` (`:31,43,49,61`, logging + idempotencia `alreadySeen`) y en
`src/adapters/whatsapp/mapMessage.ts` (lo produce). El adapter de WhatsApp setea
`channel: 'whatsapp'`.

### 7.2 Columna `channel` en `Message` y `Contact`

Un contacto puede existir en varios canales; la **clave de identidad sigue siendo
el teléfono E.164** (`Contact @@unique([tenantId, phoneE164])`,
`prisma/schema.prisma:55` — se conserva). El canal es un atributo del mensaje y un
atributo "último/origen" del contacto, no parte de su identidad.

```prisma
model Message {
  // ...
  channel        String   @default("whatsapp")   // 'whatsapp' | 'sms' | 'voice'
  externalMsgId  String?                          // renombrado desde whatsappMsgId
  @@unique([tenantId, externalMsgId])            // antes whatsappMsgId
}

model Contact {
  // ...
  channel        String   @default("whatsapp")
}
```

Migración Prisma con **default `'whatsapp'`** para que las filas existentes queden
correctamente clasificadas sin backfill manual. El rename de columna
`whatsappMsgId → externalMsgId` se hace en la misma migración (rename, no
drop+add, para no perder los IDs ya persistidos que sostienen la idempotencia).

### 7.3 Interfaces por canal (WhatsApp como UNA implementación)

Formalizar tres contratos en el borde, parametrizados por canal:

```ts
// Entrada: una fuente de mensajes entrantes de un canal.
export interface InboundSource {
  readonly channel: Channel;
  start(): Promise<void>;
  stop(): Promise<void>;
  // empuja RawInboundMessage (channel ya seteado) al InboundCoordinator
}

// Salida: ya existe OutboundSender.sendText — se le asocia el canal.
export interface ChannelOutboundSender extends OutboundSender {
  readonly channel: Channel;
}

// Notificaciones al dueño: ya existe Notifier — idem.
export interface ChannelNotifier extends Notifier {
  readonly channel: Channel;
}
```

- **WhatsApp pasa a ser UNA implementación**: `BaileysAdapter`
  (`src/adapters/whatsapp/adapter.ts`) implementa `InboundSource` con
  `channel = 'whatsapp'`; `WhatsAppSender`/`WhatsAppNotifier` declaran su canal.
- El `TenantRuntime` (§3.1) deja de hablar de "Baileys" en su firma y habla de
  `InboundSource` + `ChannelOutboundSender` + `ChannelNotifier`. Hoy solo hay una
  implementación (WhatsApp); en Fase 8 se añaden las de Twilio SMS/voz **sin tocar
  el pipeline**.
- **No** se implementa SMS ni voz aquí. El criterio es: "WhatsApp es una
  implementación de `InboundSource`/`OutboundSender`; abstracción lista, sin
  nuevos canales".

### 7.4 Alcance explícito

Este refactor es de **días, no semanas**, y se hace junto con la Fase 2 porque
ambos tocan la frontera del worker (el `TenantManager` ya reescribe cómo se
construyen sender/notifier/adapter). SMS y voz reales viven en la Fase 8.

---

## 8. Criterios de aceptación

- [ ] Alta de un tenant nuevo desde código/API (`manager.addTenant(id)`) crea su
      conexión Baileys **sin reiniciar** el proceso ni tocar `docker-compose.yml`
      ni `.env`.
- [ ] `TenantManager.start()` levanta todos los tenants `active` desde Postgres;
      el fallo de uno no impide arrancar los demás.
- [ ] `wa-status` devuelve el estado **del tenant del usuario** (resuelto del
      JWT), no de uno fijo; un tenant sin runtime responde 404/409, no el estado
      de otro tenant.
- [ ] `WORKER_INTERNAL_URL` deja de ser una URL por worker: hay **una** URL
      interna del `TenantManager` y el ruteo se hace por `tenantId`.
- [ ] Dos tenants con bots simultáneos, con mensajes y sesiones Baileys aislados,
      verificado en staging.
- [ ] Existe tabla `TenantSettings`; la config del bot (welcome, intakeSchema,
      flags de media, owner phone, debounce) es editable por tenant desde el panel
      **sin tocar JSON en disco**.
- [ ] Backfill de `TenantSettings` ejecutado para los tenants existentes; ningún
      código nuevo lee `Tenant.profileDir`.
- [ ] `Message` y `Contact` tienen columna `channel` (default `'whatsapp'`);
      `RawInboundMessage` usa `externalMsgId` + `channel`; la migración renombró
      (no recreó) `whatsappMsgId` preservando la idempotencia.
- [ ] WhatsApp es **una** implementación de `InboundSource` /
      `ChannelOutboundSender` / `ChannelNotifier`; el `TenantRuntime` depende de
      las interfaces, no de Baileys directamente. Sin SMS/voz construidos.
- [ ] La supervisión por-tenant reinicia la conexión de un tenant caído sin
      derribar las demás ni el proceso.

---

## 9. Decisiones abiertas

1. **Nombre de la URL interna** — ¿renombrar `WORKER_INTERNAL_URL` →
   `TENANT_MANAGER_URL` (más claro) o conservar el nombre para minimizar el
   diff? (recomendado: renombrar, es un cambio semántico real).
2. **`active` en `Tenant` vs derivar de suscripción** — ¿la columna `Tenant.active`
   es la fuente de verdad para "levantar este tenant", o se deriva del estado de
   `Subscription` (Fase 3)? Hasta que exista billing, `active` es independiente;
   habrá que reconciliarlas en Fase 3.
3. **Sesiones Baileys por tenant: un volumen particionado vs N volúmenes** —
   particionar por `./data/baileys-session/<tenantId>` dentro de un volumen es lo
   más simple para self-service, pero complica el backup granular y el borrado por
   tenant (Fase 6, derecho de borrado). ¿Aceptable para Fase 2 y se refina en
   Fase 6?
4. **Límite de tenants por proceso** — ¿cuántas conexiones Baileys concurrentes
   aguanta un proceso antes de necesitar sharding del `TenantManager`? Definir un
   umbral observado (memoria/CPU) y una estrategia de partición horizontal antes
   de crecer "no linealmente".
5. **`intakeSchema` en `jsonb` vs columnas tipadas** — guardar el schema completo
   como JSON es flexible pero pierde validación a nivel DB. ¿Validación solo en la
   capa de aplicación (contra `src/config/intake-schema.ts`) es suficiente?
6. **Reuso del rename `externalMsgId`** — confirmar que ningún índice/consulta
   fuera de los archivos revisados (`api/`, `spa/`) dependa del nombre
   `whatsappMsgId` antes de migrar (grep de cierre previo a la migración).
```