# Completar página de WhatsApp — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development o superpowers:executing-plans. Steps usan checkbox (`- [ ]`).

**Goal:** Mostrar número conectado + estado detallado y permitir reconectar/desvincular WhatsApp desde el panel.

**Architecture:** SPA → API (proxy JWT) → internal server del worker (bearer INTERNAL_API_TOKEN) → BaileysAdapter/Connection. Acciones mutantes vía POST internos.

**Tech Stack:** Fastify, Baileys, React + Vite, vitest.

**Spec:** `docs/superpowers/specs/2026-06-18-whatsapp-config-page-design.md`

**Tests con DB raíz:** prefijar `DATABASE_URL="postgres://intake:intake@localhost:5433/intake"`.

---

### Task 1: Helper `extractPhoneFromJid`

**Files:** Create `src/adapters/whatsapp/jid.ts`; Test `tests/adapters/whatsapp/jid.test.ts`.

- [ ] **Step 1: Test que falla**
```ts
import { describe, it, expect } from 'vitest';
import { extractPhoneFromJid } from '../../../src/adapters/whatsapp/jid';

describe('extractPhoneFromJid', () => {
  it('con sufijo de dispositivo :n', () => {
    expect(extractPhoneFromJid('5215551234567:12@s.whatsapp.net')).toBe('+5215551234567');
  });
  it('sin sufijo', () => {
    expect(extractPhoneFromJid('5215551234567@s.whatsapp.net')).toBe('+5215551234567');
  });
  it('jid vacío o sin dígitos → null', () => {
    expect(extractPhoneFromJid('')).toBeNull();
    expect(extractPhoneFromJid('@s.whatsapp.net')).toBeNull();
  });
});
```
- [ ] **Step 2: Falla** — `DATABASE_URL=... npx vitest run tests/adapters/whatsapp/jid.test.ts` → FAIL.
- [ ] **Step 3: Implementar `src/adapters/whatsapp/jid.ts`**
```ts
/** Deriva el teléfono E.164 de un JID de Baileys ("549...:12@s.whatsapp.net"). */
export function extractPhoneFromJid(jid: string): string | null {
  const m = jid.match(/^(\d+)/);
  return m ? `+${m[1]}` : null;
}
```
- [ ] **Step 4: Pasa** — re-run → PASS.
- [ ] **Step 5: Commit** — `git add src/adapters/whatsapp/jid.ts tests/adapters/whatsapp/jid.test.ts && git commit -m "feat(whatsapp): extractPhoneFromJid"`

---

### Task 2: Connection/Adapter — capturar teléfono + logout + reconnect

**Files:** Modify `src/adapters/whatsapp/types.ts`, `src/adapters/whatsapp/connection.ts`, `src/adapters/whatsapp/adapter.ts`. (Sin unit test: frontera Baileys; cubierto por typecheck.)

- [ ] **Step 1: `types.ts` — agregar `phone` a `AdapterStateSnapshot`**
```ts
export interface AdapterStateSnapshot {
  status: ConnectionStatus;
  qr: string | null;
  phone: string | null;
  lastError: string | null;
  lastConnectedAt: string | null;
}
```

- [ ] **Step 2: `connection.ts` — imports + estado + captura + acciones**

Cambiar import de fs:
```ts
import { mkdir, rm } from 'node:fs/promises';
```
Agregar import:
```ts
import { extractPhoneFromJid } from './jid';
```
Agregar campo junto a los otros privados:
```ts
  private phone: string | null = null;
```
En `state()`:
```ts
  state(): AdapterStateSnapshot {
    return {
      status: this.status,
      qr: this.lastQr,
      phone: this.phone,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt,
    };
  }
```
En el handler `connection === 'open'`, agregar captura del teléfono:
```ts
      if (connection === 'open') {
        this.lastQr = null;
        this.lastError = null;
        this.lastConnectedAt = new Date().toISOString();
        this.phone = extractPhoneFromJid(this.socket?.user?.id ?? '');
        this.setStatus('connected');
        logger.info('whatsapp.connected');
      }
```
En el handler de `connection === 'close'` cuando `code === DisconnectReason.loggedOut`, limpiar teléfono:
```ts
        if (code === DisconnectReason.loggedOut) {
          this.phone = null;
          this.setStatus('logged_out');
        } else {
```
Agregar métodos públicos (antes de `private setStatus`):
```ts
  /** Cierra sesión, borra la sesión persistida y reconecta para generar un QR nuevo. */
  async logout(): Promise<void> {
    try {
      if (this.socket?.logout) await this.socket.logout();
    } catch {
      // best-effort: si el socket ya no responde, igual borramos la sesión local.
    }
    this.reconnecting = false;
    this.socket = null;
    await rm(resolve(this.opts.sessionDir), { recursive: true, force: true });
    this.phone = null;
    this.lastQr = null;
    this.stopped = false;
    await this.connect();
  }

  /** Reintenta la conexión SIN borrar la sesión (re-vincula la misma cuenta). */
  async reconnect(): Promise<void> {
    if (this.socket?.end) {
      try { this.socket.end(undefined); } catch {}
    }
    this.reconnecting = false;
    this.socket = null;
    this.stopped = false;
    await this.connect();
  }
```
Nota: `this.socket` es `any`, así que `this.socket?.user?.id` y `this.socket?.logout` compilan.

- [ ] **Step 3: `adapter.ts` — delegar**

Agregar tras `state()`:
```ts
  async logout(): Promise<void> {
    await this.conn.logout();
  }

  async reconnect(): Promise<void> {
    await this.conn.reconnect();
  }
```

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` → OK. (El bootstrap se ajusta en Task 4; si tsc se queja del `state()` del bootstrap por el nuevo `phone`, se arregla allí.)

- [ ] **Step 5: Commit** — `git add src/adapters/whatsapp/{types,connection,adapter}.ts && git commit -m "feat(whatsapp): captura de teléfono + logout/reconnect en adapter"`

---

### Task 3: Internal server — estado enriquecido + acciones POST

**Files:** Modify `src/internal/server.ts`; Test `tests/internal/server.test.ts`.

- [ ] **Step 1: Tests que fallan** — agregar al describe (con un server que tenga `actions` stub). Reemplazar el `beforeAll` para incluir acciones y crear un segundo server sin acciones:
```ts
const calls: string[] = [];
const actions = {
  logout: async () => { calls.push('logout'); },
  reconnect: async () => { calls.push('reconnect'); },
};
// en beforeAll, crear el server con actions:
//   server = await startInternalServer({ adapterState: { state: fakeState }, actions });
```
Agregar tests:
```ts
it('POST /internal/wa-logout con token ejecuta la acción', async () => {
  const res = await server.app.inject({ method: 'POST', url: '/internal/wa-logout', headers: { authorization: `Bearer ${TOKEN}` } });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
  expect(calls).toContain('logout');
});

it('POST /internal/wa-reconnect con token ejecuta la acción', async () => {
  const res = await server.app.inject({ method: 'POST', url: '/internal/wa-reconnect', headers: { authorization: `Bearer ${TOKEN}` } });
  expect(res.statusCode).toBe(200);
  expect(calls).toContain('reconnect');
});

it('POST /internal/wa-logout sin token → 401', async () => {
  const res = await server.app.inject({ method: 'POST', url: '/internal/wa-logout' });
  expect(res.statusCode).toBe(401);
});

it('503 si el server no tiene actions', async () => {
  process.env.INTERNAL_PORT = '0';
  const noActions = await startInternalServer({ adapterState: { state: fakeState } });
  const res = await noActions.app.inject({ method: 'POST', url: '/internal/wa-logout', headers: { authorization: `Bearer ${TOKEN}` } });
  expect(res.statusCode).toBe(503);
  await noActions.close();
});
```
También actualizar `fakeState` para incluir los campos nuevos (el GET es passthrough; el test de GET existente compara `toEqual` con lo que devuelva `fakeState`, así que basta con dejar `fakeState` devolviendo `{ connected, qr, phone }` o ampliarlo — mantén el assert coherente con lo que devuelvas).

- [ ] **Step 2: Falla** — `DATABASE_URL=... npx vitest run tests/internal/server.test.ts` → FAIL.

- [ ] **Step 3: Implementar `src/internal/server.ts`**

Ampliar `AdapterStatus`:
```ts
export interface AdapterStatus {
  connected: boolean;
  qr: string | null;
  phone: string;
  status?: string;
  lastConnectedAt?: string | null;
  lastError?: string | null;
}
```
Ampliar `InternalServerDeps`:
```ts
export interface InternalServerDeps {
  adapterState: { state: () => AdapterStatus };
  actions?: { logout: () => Promise<void>; reconnect: () => Promise<void> };
}
```
Tras la ruta `GET /internal/wa-status`, agregar:
```ts
  app.post('/internal/wa-logout', async (_request, reply) => {
    if (!deps.actions) return reply.code(503).send({ ok: false, error: 'sin acciones' });
    try {
      await deps.actions.logout();
      return { ok: true };
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/internal/wa-reconnect', async (_request, reply) => {
    if (!deps.actions) return reply.code(503).send({ ok: false, error: 'sin acciones' });
    try {
      await deps.actions.reconnect();
      return { ok: true };
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
```
(El hook `onRequest` existente ya exige el bearer en TODAS las rutas, así que los POST quedan protegidos automáticamente.)

- [ ] **Step 4: Pasa** — re-run → PASS.

- [ ] **Step 5: Commit** — `git add src/internal/server.ts tests/internal/server.test.ts && git commit -m "feat(internal): POST wa-logout/wa-reconnect + estado enriquecido"`

---

### Task 4: Bootstrap — mapear estado enriquecido + cablear acciones

**Files:** Modify `src/index.ts`. (Typecheck; sin test unitario del bootstrap.)

- [ ] **Step 1: Reemplazar el bloque `startInternalServer`**
```ts
  const internalServer = await startInternalServer({
    adapterState: {
      state: () => {
        const snap = adapter!.state();
        return {
          connected: snap.status === 'connected',
          qr: snap.qr,
          phone: snap.phone ?? '',
          status: snap.status,
          lastConnectedAt: snap.lastConnectedAt,
          lastError: snap.lastError,
        };
      },
    },
    actions: {
      logout: () => adapter!.logout(),
      reconnect: () => adapter!.reconnect(),
    },
  });
```
- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → OK.
- [ ] **Step 3: Commit** — `git add src/index.ts && git commit -m "feat(worker): expone teléfono/estado y acciones logout/reconnect"`

---

### Task 5: API — POST /wa-status/logout y /reconnect

**Files:** Modify `api/src/routes/wa-status.ts`; Test `api/tests/wa-status.test.ts`.

- [ ] **Step 1: Tests que fallan** — agregar:
```ts
it('POST /wa-status/reconnect proxied → 200', async () => {
  process.env.WORKER_INTERNAL_URL = 'http://worker-x:3002';
  process.env.INTERNAL_API_TOKEN = 't';
  const res = await app.inject({ method: 'POST', url: '/wa-status/reconnect', headers: { authorization: `Bearer ${tokenFor(app, userId)}` } });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true });
});

it('POST /wa-status/logout sin envs → 503', async () => {
  delete process.env.WORKER_INTERNAL_URL;
  delete process.env.INTERNAL_API_TOKEN;
  const res = await app.inject({ method: 'POST', url: '/wa-status/logout', headers: { authorization: `Bearer ${tokenFor(app, userId)}` } });
  expect(res.statusCode).toBe(503);
});

it('POST /wa-status/logout sin token → 401', async () => {
  const res = await app.inject({ method: 'POST', url: '/wa-status/logout' });
  expect(res.statusCode).toBe(401);
});
```
Y cambiar el `WORKER_JSON`/stub para que también sirva a los POST: el `stubFetcher` ya devuelve `{ connected, qr, phone }` con 200 para cualquier llamada; ajustarlo para devolver `{ ok: true }` está bien para los POST, pero rompería el GET. Solución: el stub devuelve un objeto que sirve a ambos — cambia `stubFetcher` para devolver `{ ok: true, connected: true, qr: null, phone: '' }` y actualiza el assert del GET existente a `expect(res.json()).toMatchObject({ connected: true })`. (Mantén compatibilidad con el test GET.)

- [ ] **Step 2: Falla** — `DATABASE_URL=... npx vitest run api/tests/wa-status.test.ts` → FAIL.

- [ ] **Step 3: Implementar en `api/src/routes/wa-status.ts`** — agregar dentro de `waStatusRoutes`, tras el GET:
```ts
  async function proxyAction(path: string, reply: import('fastify').FastifyReply) {
    const base = process.env.WORKER_INTERNAL_URL;
    const token = process.env.INTERNAL_API_TOKEN;
    if (!base || !token) return reply.code(503).send({ error: 'worker no configurado' });
    try {
      const res = await doFetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) return reply.code(502).send({ error: `worker respondió ${res.status}` });
      return await res.json();
    } catch {
      return reply.code(502).send({ error: 'worker inalcanzable' });
    }
  }

  app.post('/wa-status/logout', { preHandler: app.authenticate }, async (_request, reply) =>
    proxyAction('/internal/wa-logout', reply),
  );
  app.post('/wa-status/reconnect', { preHandler: app.authenticate }, async (_request, reply) =>
    proxyAction('/internal/wa-reconnect', reply),
  );
```

- [ ] **Step 4: Pasa** — re-run → PASS.

- [ ] **Step 5: Commit** — `git add api/src/routes/wa-status.ts api/tests/wa-status.test.ts && git commit -m "feat(api): POST /wa-status/logout y /reconnect"`

---

### Task 6: SPA — cliente + página

**Files:** Modify `spa/src/api/client.ts`, `spa/src/pages/WhatsApp.tsx`, `spa/src/pages/WhatsApp.test.tsx`.

- [ ] **Step 1: Cliente** — en `client.ts`, reemplazar `getWaStatus` y agregar acciones:
```ts
  getWaStatus: () => request<{ connected: boolean; qr: string | null; phone: string; status?: string; lastConnectedAt?: string | null; lastError?: string | null }>('GET', '/wa-status'),
  waLogout: () => request<{ ok: boolean }>('POST', '/wa-status/logout'),
  waReconnect: () => request<{ ok: boolean }>('POST', '/wa-status/reconnect'),
```

- [ ] **Step 2: Tests que fallan** — agregar a `WhatsApp.test.tsx` (mock incluye `getWaStatus`, `waLogout`, `waReconnect`):
```tsx
test('muestra el número y el estado conectado', async () => {
  mockGetWaStatus.mockResolvedValue({ connected: true, qr: null, phone: '+5215551234567', status: 'connected', lastConnectedAt: '2026-06-18T10:00:00.000Z', lastError: null });
  renderPage();
  expect(await screen.findByText(/\+5215551234567/)).toBeInTheDocument();
});

test('Reconectar llama waReconnect', async () => {
  mockGetWaStatus.mockResolvedValue({ connected: true, qr: null, phone: '+52', status: 'connected' });
  mockWaReconnect.mockResolvedValue({ ok: true });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Reconectar' }));
  expect(mockWaReconnect).toHaveBeenCalled();
});

test('Desvincular pide confirmación y llama waLogout', async () => {
  mockGetWaStatus.mockResolvedValue({ connected: true, qr: null, phone: '+52', status: 'connected' });
  mockWaLogout.mockResolvedValue({ ok: true });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Desvincular' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Desvincular definitivamente' }));
  expect(mockWaLogout).toHaveBeenCalled();
});
```
(Define `renderPage`, mocks `mockGetWaStatus/mockWaLogout/mockWaReconnect` siguiendo el patrón del archivo; mockea `qrcode` si hace falta como ya esté en el test existente.)

- [ ] **Step 3: Falla** — `cd spa && npx vitest run src/pages/WhatsApp.test.tsx` → FAIL.

- [ ] **Step 4: Implementar `WhatsApp.tsx`** — agregar tipos/estado/handlers y UI:
  - Tipo `WaStatus` gana `status?`, `lastConnectedAt?`, `lastError?`.
  - Mapa de etiquetas:
```tsx
const STATUS_LABELS: Record<string, string> = {
  connecting: 'Conectando…',
  qr_required: 'Esperando escaneo de QR',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  logged_out: 'Sesión cerrada',
};
```
  - Estado `const [confirmLogout, setConfirmLogout] = useState(false);` y `const [actionBusy, setActionBusy] = useState(false);` `const [actionError, setActionError] = useState<string | null>(null);`
  - Handlers:
```tsx
  async function reconnect() {
    setActionBusy(true); setActionError(null);
    try { await api.waReconnect(); await load(); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'error al reconectar'); }
    finally { setActionBusy(false); }
  }
  async function logout() {
    setActionBusy(true); setActionError(null);
    try { await api.waLogout(); await load(); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'error al desvincular'); }
    finally { setActionBusy(false); setConfirmLogout(false); }
  }
```
  - En el bloque `{status && (...)}` mostrar etiqueta de estado, teléfono, última conexión y último error, y los botones:
```tsx
            <p className="wa-status">
              <span className={status.connected ? 'wa-connected' : 'wa-disconnected'}>
                {STATUS_LABELS[status.status ?? ''] ?? (status.connected ? 'Conectado' : 'Desconectado')}
              </span>
              {status.phone && <span className="wa-phone"> — {status.phone}</span>}
            </p>
            {status.lastConnectedAt && (
              <p className="wa-meta">Última conexión: {new Date(status.lastConnectedAt).toLocaleString()}</p>
            )}
            {status.lastError && <p className="wa-meta wa-meta-error">Último error: {status.lastError}</p>}
            {actionError && <p className="error" role="alert">{actionError}</p>}
            <div className="wa-actions">
              <button type="button" onClick={() => void reconnect()} disabled={actionBusy}>Reconectar</button>
              <button type="button" className="btn-danger" onClick={() => setConfirmLogout(true)} disabled={actionBusy}>Desvincular</button>
            </div>
```
  - Importar `ConfirmDialog` y agregarlo al final del componente:
```tsx
      <ConfirmDialog
        open={confirmLogout}
        title="Desvincular WhatsApp"
        message="Se cerrará la sesión actual y deberás escanear un QR nuevo para volver a vincular un teléfono. ¿Continuar?"
        confirmLabel="Desvincular definitivamente"
        danger
        onConfirm={() => void logout()}
        onCancel={() => setConfirmLogout(false)}
      />
```

- [ ] **Step 5: Pasa** — re-run → PASS.

- [ ] **Step 6: Commit** — `git add spa/src/api/client.ts spa/src/pages/WhatsApp.tsx spa/src/pages/WhatsApp.test.tsx && git commit -m "feat(spa): página de WhatsApp completa (número, estado, reconectar, desvincular)"`

---

### Task 7: Verificación final

- [ ] **Step 1:** `npx tsc --noEmit` (raíz) → OK
- [ ] **Step 2:** `cd spa && npx tsc --noEmit` → OK
- [ ] **Step 3:** `DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npx vitest run` → todo verde
- [ ] **Step 4:** `cd spa && npx vitest run` → todo verde

---

## Self-Review (cobertura del spec)

- Número conectado → Tareas 1, 2, 4, 6.
- Estado detallado + última conexión + error → Tareas 2, 4, 6.
- Reconectar → Tareas 2, 3, 4, 5, 6.
- Desvincular (re-vincular) → Tareas 2, 3, 4, 5, 6.
- Endpoints internos protegidos → Tarea 3 (hook bearer existente cubre los POST).
- Aislamiento/errores (401/503/502) → Tareas 3, 5.
