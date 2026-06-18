# Página de configuración de WhatsApp (completar) — Diseño

**Fecha:** 2026-06-18
**Estado:** aprobado (alcance delegado al implementador)

## Objetivo

Completar la página de WhatsApp del panel: mostrar el número conectado y un estado detallado, y permitir **reconectar** y **desvincular** (re-vincular) la cuenta desde la SPA, vía endpoints internos protegidos del worker.

## Alcance

- Mostrar el **número** de la cuenta vinculada (hoy va vacío — deuda).
- **Estado detallado**: `connecting | qr_required | connected | logged_out | disconnected`, con **última conexión** y **último error**.
- Acción **Reconectar**: reintenta la conexión sin borrar la sesión.
- Acción **Desvincular**: cierra sesión, borra la sesión del worker y genera un **QR nuevo** para vincular otro teléfono (con confirmación en la SPA).

Excluido (YAGNI): cuenta regresiva del QR, doble confirmación, historial de conexiones.

## Arquitectura (4 capas)

```
SPA WhatsApp ─JWT─> API (GET /wa-status, POST /wa-status/logout, /reconnect)
                     └─proxy con INTERNAL_API_TOKEN─> Worker internal server
                       (GET /internal/wa-status, POST /internal/wa-logout, /reconnect)
                         └─> BaileysAdapter ─> BaileysConnection
```

## 1. Worker

**`src/adapters/whatsapp/jid.ts` (nuevo, función pura):**
- `extractPhoneFromJid(jid: string): string | null` — `"5215551234567:12@s.whatsapp.net"` → `"+5215551234567"`; `"5215551234567@s.whatsapp.net"` → `"+5215551234567"`; sin dígitos → `null`.

**`src/adapters/whatsapp/types.ts`:**
- `AdapterStateSnapshot` gana `phone: string | null`.

**`src/adapters/whatsapp/connection.ts`:**
- Campo `private phone: string | null = null`.
- En `connection === 'open'`: `this.phone = extractPhoneFromJid(this.socket?.user?.id ?? '')`.
- En `logged_out` (y al desvincular): `this.phone = null`.
- `state()` incluye `phone`.
- `async logout()`: `await this.socket?.logout?.()` (best-effort, try/catch) → `rm(resolve(sessionDir), { recursive: true, force: true })` → `this.phone = null; this.lastQr = null` → `this.stopped = false; await this.connect()` (genera QR nuevo).
- `async reconnect()`: cierra el socket (`this.socket?.end?.()`), `this.socket = null`, `this.stopped = false`, `await this.connect()` (sin borrar sesión).

**`src/adapters/whatsapp/adapter.ts`:**
- `async logout(): Promise<void> { await this.conn.logout(); }`
- `async reconnect(): Promise<void> { await this.conn.reconnect(); }`

## 2. Internal server (`src/internal/server.ts`)

- `AdapterStatus` se amplía a `{ connected, qr, phone, status, lastConnectedAt, lastError }` (el `GET` sigue siendo passthrough de `deps.adapterState.state()`; el mapeo enriquecido se hace en el bootstrap).
- `InternalServerDeps` gana `actions?: { logout: () => Promise<void>; reconnect: () => Promise<void> }`.
- `POST /internal/wa-logout` y `POST /internal/wa-reconnect`: mismo bearer `INTERNAL_API_TOKEN`. Si `deps.actions` no está → 503. Si está → ejecuta y devuelve `{ ok: true }`. Errores → 500 `{ ok:false, error }`.

## 3. Bootstrap (`src/index.ts`)

- El `state()` que se inyecta mapea `adapter.state()` (`AdapterStateSnapshot`) a:
  `{ connected: snap.status === 'connected', qr: snap.qr, phone: snap.phone ?? '', status: snap.status, lastConnectedAt: snap.lastConnectedAt, lastError: snap.lastError }`.
- Se pasan `actions: { logout: () => adapter!.logout(), reconnect: () => adapter!.reconnect() }`.

## 4. API central (`api/src/routes/wa-status.ts`)

- `GET /wa-status`: sin cambios (passthrough — los campos nuevos fluyen solos).
- `POST /wa-status/logout` y `POST /wa-status/reconnect` (JWT `app.authenticate`): hacen `POST` al endpoint interno correspondiente con `WORKER_INTERNAL_URL` + `INTERNAL_API_TOKEN`. Si faltan envs → 503. Si el worker responde no-ok → 502. Devuelven el JSON del worker.
- Usan el `fetcher` inyectable que ya recibe `waStatusRoutes` (para tests).

## 5. SPA

**`spa/src/api/client.ts`:**
- `getWaStatus` tipa el objeto enriquecido `{ connected, qr, phone, status?, lastConnectedAt?, lastError? }`.
- `waLogout: () => request<{ ok: boolean }>('POST', '/wa-status/logout')`
- `waReconnect: () => request<{ ok: boolean }>('POST', '/wa-status/reconnect')`

**`spa/src/pages/WhatsApp.tsx`:**
- Muestra número (`phone`), estado legible (mapa de etiquetas en español), última conexión (formateada) y último error si lo hay.
- Botones **Reconectar** (siempre disponible salvo mientras conecta) y **Desvincular** (abre `ConfirmDialog` `danger`; al confirmar llama `waLogout` y refresca).
- Mantiene el polling de 5s y el render del QR existente.

## Errores y pruebas

- Acciones best-effort en el worker: no tumban el proceso; la API refleja 502/503/500 y la SPA muestra el mensaje.
- Tests:
  - `tests/adapters/whatsapp/jid.test.ts`: `extractPhoneFromJid` (con sufijo `:n`, sin sufijo, jid vacío → null).
  - `tests/internal/server.test.ts`: nuevos `POST /internal/wa-logout|wa-reconnect` (200 con actions stub que registran la llamada; 401 sin token; 503 sin actions).
  - `api/tests/wa-status.test.ts`: `POST /wa-status/logout|reconnect` (200 proxied, 401 sin JWT, 503 sin envs).
  - `spa/src/pages/WhatsApp.test.tsx`: render de número/estado; botón Reconectar llama `waReconnect`; Desvincular confirma y llama `waLogout`.
- `connection.ts` es la frontera de integración con Baileys (sin unit test, como hoy) — cubierto por typecheck.
