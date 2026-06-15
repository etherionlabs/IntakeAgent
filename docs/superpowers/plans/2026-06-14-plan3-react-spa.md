# Plan 3 — React SPA (Netlify) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A React + Vite + TypeScript single-page dashboard, deployed to Netlify, that authenticates against the Plan 2 API (JWT in `localStorage`) and lets the business owner view/manage jobs, edit intakes, toggle the bot per contact, see usage, and check WhatsApp connection — talking ONLY to the API.

**Architecture:** Self-contained `spa/` folder with its own `package.json` (Vite toolchain, deployed separately to Netlify; Netlify base directory = `spa`). A tiny typed `api` client wraps `fetch` and injects the `Authorization: Bearer <token>` header from an `AuthContext`. React Router v6 with a protected layout. Plain, clean CSS (no Tailwind/runtime CSS deps) to keep the build simple. The API base URL comes from `VITE_API_URL` (build-time env on Netlify).

**Tech Stack:** Vite 5, React 18, TypeScript, `react-router-dom` v6, Vitest + `@testing-library/react` + jsdom for tests. No state library — React context + hooks + the fetch client.

**API contract (from Plan 2 — do not change the API; consume these shapes):**
- `POST /auth/login {username,password}` → `{ token, user: { id, username, role, tenantId } }` (401 on bad creds).
- `GET /profile` → `{ intakeSchema: { $businessName, $businessDomain, sections: [{ key, label, fields: [{ key, label, type, required, options?, hint?, min? }] }] } }`.
- `GET /jobs?status=` → `{ jobs: [{ id, status, summary, openedAt, readyAt, closedAt, intakeComplete, contact: { id, phoneE164, displayName, botActive, flaggedNonIntake } }] }`. Status values: `OPEN_INTAKE | READY_FOR_REVIEW | IN_PROGRESS | CLOSED`.
- `GET /jobs/:id` → `{ job, intake, messages: [{ id, direction, kind, body, createdAt }] }`. **`intake` shape:** `intake[sectionKey][fieldKey] = { value, declined, declined_reason, updated_at, source_message_id }`; plus `intake.media = { photo_count, audio_count }` and `intake.notes = [...]`. A field is "answered" if it has a non-null `value` or `declined === true`.
- `PATCH /jobs/:id/intake { path, value? , declined?, declined_reason? }` → `{ ok, intake }`. `path` is `"sectionKey.fieldKey"`.
- `POST /jobs/:id/actions { action: 'mark_ready'|'close', summary? }` → `{ ok, status }` (400 with `{ error }` on invalid).
- `GET /contacts` → `{ contacts: [{ id, phoneE164, displayName, botActive, flaggedNonIntake, flaggedReason }] }`.
- `PATCH /contacts/:id { botPaused: boolean }` → `{ ok, contact }`.
- `GET /usage` → `{ totals: { runs, costUsd, inputTokens, outputTokens }, recent: [{ id, model, costUsd, inputTokens, outputTokens, createdAt, error }] }`.
- `GET /wa-status` → `{ connected, qr, phone }` (qr is a string or null; 502/503 with `{ error }` if worker unreachable).

**Conventions:** functional components, hooks, async/await. Every API error surfaces a visible message (no silent failures). A 401 from any call clears the token and redirects to `/login`. Tests live in `spa/src/**/*.test.tsx` and run with `npm test` inside `spa/`.

---

### Task 1: Vite SPA scaffold + tooling

**Files:** `spa/package.json`, `spa/vite.config.ts`, `spa/tsconfig.json`, `spa/index.html`, `spa/src/main.tsx`, `spa/src/App.tsx`, `spa/src/styles.css`, `spa/.gitignore`, `spa/.env.example`

- [ ] **Step 1: Scaffold.** Create `spa/` with a Vite React-TS setup. `spa/package.json`:
```json
{
  "name": "intake-spa",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```
Run `cd spa && npm install`.

- [ ] **Step 2:** `spa/vite.config.ts` with the React plugin and vitest config (`environment: 'jsdom'`, `globals: true`, `setupFiles: './src/test-setup.ts'`). Create `spa/src/test-setup.ts` importing `@testing-library/jest-dom`.

- [ ] **Step 3:** `spa/tsconfig.json` (standard Vite React strict config), `spa/index.html` (root div + module script to `/src/main.tsx`), `spa/src/main.tsx` (ReactDOM root rendering `<App/>` inside `<BrowserRouter>`), a minimal `spa/src/App.tsx` (renders `<div>Intake</div>` placeholder for now), `spa/src/styles.css` (clean base styles), `spa/.gitignore` (`node_modules`, `dist`), `spa/.env.example` (`VITE_API_URL=http://localhost:3001`).

- [ ] **Step 4: Smoke test** `spa/src/App.test.tsx` — render `<App/>` (wrapped in MemoryRouter), assert the placeholder text appears.

- [ ] **Step 5: Verify** `cd spa && npm test` → PASS; `npm run typecheck` → clean; `npm run build` → succeeds (produces `dist/`).

- [ ] **Step 6: Commit** `feat(spa): Vite + React + Router scaffold with vitest`.

---

### Task 2: API client + Auth context

**Files:** `spa/src/api/client.ts`, `spa/src/auth/AuthContext.tsx`, tests

- [ ] **Step 1:** `spa/src/api/client.ts` — a typed client:
```ts
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

function getToken(): string | null { return localStorage.getItem('intake_token'); }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { onUnauthorized?.(); throw new ApiError(401, 'no autorizado'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? `error ${res.status}`);
  return data as T;
}

export const api = {
  login: (username: string, password: string) => request<{ token: string; user: any }>('POST', '/auth/login', { username, password }),
  getProfile: () => request<{ intakeSchema: any }>('GET', '/profile'),
  getJobs: (status?: string) => request<{ jobs: any[] }>('GET', `/jobs${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  getJob: (id: string) => request<{ job: any; intake: any; messages: any[] }>('GET', `/jobs/${id}`),
  patchIntake: (id: string, payload: { path: string; value?: unknown; declined?: boolean; declined_reason?: string }) => request<{ ok: boolean; intake: any }>('PATCH', `/jobs/${id}/intake`, payload),
  jobAction: (id: string, action: 'mark_ready' | 'close', summary?: string) => request<{ ok: boolean; status: string }>('POST', `/jobs/${id}/actions`, { action, summary }),
  getContacts: () => request<{ contacts: any[] }>('GET', '/contacts'),
  toggleContact: (id: string, botPaused: boolean) => request<{ ok: boolean; contact: any }>('PATCH', `/contacts/${id}`, { botPaused }),
  getUsage: () => request<{ totals: any; recent: any[] }>('GET', '/usage'),
  getWaStatus: () => request<{ connected: boolean; qr: string | null; phone: string }>('GET', '/wa-status'),
};
```

- [ ] **Step 2:** `spa/src/auth/AuthContext.tsx` — provides `{ user, token, login(username,password), logout() }`, persists token+user in `localStorage` (`intake_token`, `intake_user`), wires `setUnauthorizedHandler(() => logout())`. `useAuth()` hook. On mount, hydrate from localStorage.

- [ ] **Step 3: Tests** `spa/src/api/client.test.ts` — mock global `fetch`: a 401 response triggers the unauthorized handler and throws `ApiError(401)`; a 200 returns parsed body; a 400 with `{error}` throws `ApiError(400, error)`. (Use `vi.stubGlobal('fetch', …)`.)

- [ ] **Step 4: Verify** `cd spa && npm test` PASS, typecheck clean.

- [ ] **Step 5: Commit** `feat(spa): typed API client + auth context with JWT in localStorage`.

---

### Task 3: Login page + protected routing

**Files:** `spa/src/pages/Login.tsx`, `spa/src/components/ProtectedRoute.tsx`, `spa/src/App.tsx` (routes), tests

- [ ] **Step 1:** `spa/src/pages/Login.tsx` — username/password form; on submit calls `auth.login`; on success navigates to `/`; on error shows the message. Disable button while submitting.

- [ ] **Step 2:** `spa/src/components/ProtectedRoute.tsx` — if no `token`, `<Navigate to="/login" />`; else render children (or `<Outlet/>`).

- [ ] **Step 3:** `spa/src/App.tsx` — wrap with `AuthProvider`; routes: `/login` → Login; protected layout (Task 4) wraps `/`, `/jobs/:id`, `/contacts`, `/usage`, `/whatsapp`.

- [ ] **Step 4: Tests** `spa/src/pages/Login.test.tsx` — render Login with a mocked `api.login`; typing creds + submit on success stores token; on failure shows the error text. (Mock the `api` module via `vi.mock`.)

- [ ] **Step 5: Verify + Commit** `feat(spa): login page + protected routing`.

---

### Task 4: App layout + navigation + logout

**Files:** `spa/src/components/Layout.tsx`, styles, test

- [ ] **Step 1:** `spa/src/components/Layout.tsx` — top bar with the business name (optional; can fetch `/profile` once), nav links (Jobs `/`, Contactos `/contacts`, Uso `/usage`, WhatsApp `/whatsapp`), a logout button calling `auth.logout()`. Renders `<Outlet/>`.

- [ ] **Step 2: Test** render Layout (inside MemoryRouter + AuthProvider with a token) → nav links present; clicking logout clears the token.

- [ ] **Step 3: Verify + Commit** `feat(spa): app layout, nav and logout`.

---

### Task 5: Jobs dashboard (grouped by status)

**Files:** `spa/src/pages/Dashboard.tsx`, `spa/src/components/JobCard.tsx`, test

- [ ] **Step 1:** `Dashboard.tsx` — on mount `api.getJobs()`; group jobs into columns/sections by status (`OPEN_INTAKE`, `READY_FOR_REVIEW`, `IN_PROGRESS`, `CLOSED`); each `JobCard` shows contact displayName/phone, status badge, openedAt, summary snippet, and links to `/jobs/:id`. Loading + error + empty states. A refresh button.

- [ ] **Step 2: Test** mock `api.getJobs` to return two jobs in different statuses; assert both render under the right group and the detail link points to `/jobs/:id`.

- [ ] **Step 3: Verify + Commit** `feat(spa): jobs dashboard grouped by status`.

---

### Task 6: Job detail — intake view/edit + messages + actions

**Files:** `spa/src/pages/JobDetail.tsx`, `spa/src/components/IntakeForm.tsx`, `spa/src/components/MessageList.tsx`, test

- [ ] **Step 1:** Load `api.getJob(id)` and `api.getProfile()` in parallel. Render:
  - **IntakeForm**: iterate `intakeSchema.sections` → fields; for each field read the current value from `intake[section.key]?.[field.key]?.value` (and `declined`). Render an input appropriate to `field.type` (`string/text/phone/integer/enum(boolean? → select)`). On blur/change, `api.patchIntake(id, { path: \`${section.key}.${field.key}\`, value })`; show per-field saved/error state. A "declinar" toggle calls patch with `{ path, declined: true, declined_reason }`. Required fields are marked.
  - **MessageList**: messages ordered, inbound vs outbound styled differently, show body + kind + timestamp.
  - **Actions**: "Marcar listo" (prompts for / uses a summary textarea, min 20 chars) → `api.jobAction(id,'mark_ready',summary)`; "Cerrar" → `api.jobAction(id,'close')`. Surface 400 errors (e.g. incomplete intake) visibly. Refresh after an action.

- [ ] **Step 2: Test** mock `api.getJob` + `api.getProfile`; assert a field renders its current value and that editing triggers `api.patchIntake` with the right `path`; assert "Cerrar" calls `api.jobAction(id,'close')`.

- [ ] **Step 3: Verify + Commit** `feat(spa): job detail with intake editing, messages and actions`.

---

### Task 7: Contacts page (bot toggle)

**Files:** `spa/src/pages/Contacts.tsx`, test

- [ ] **Step 1:** List contacts from `api.getContacts()`; each row shows displayName/phone and a status chip (Activo / Pausado / No-intake). A toggle calls `api.toggleContact(id, botPaused)` and updates the row. Loading/error states.

- [ ] **Step 2: Test** mock `api.getContacts` + `api.toggleContact`; toggling an active contact calls `toggleContact(id, true)`.

- [ ] **Step 3: Verify + Commit** `feat(spa): contacts page with bot toggle`.

---

### Task 8: Usage + WhatsApp status pages

**Files:** `spa/src/pages/Usage.tsx`, `spa/src/pages/WhatsApp.tsx`, tests

- [ ] **Step 1: Usage** — cards for totals (runs, costUsd formatted, tokens) + a table of `recent` runs (model, cost, tokens, time, error flag).

- [ ] **Step 2: WhatsApp** — `api.getWaStatus()` on mount + poll every 5s; show connected/disconnected; if `qr` present, render it (the API returns a raw QR string — render it as text/`<pre>` for MVP, with a note that the worker terminal also shows it; a QR-image lib is optional tech debt). Handle 502/503 (worker unreachable) gracefully with a message.

- [ ] **Step 3: Tests** — Usage renders totals from a mocked `getUsage`; WhatsApp shows "conectado" when `getWaStatus` returns `connected:true`.

- [ ] **Step 4: Verify + Commit** `feat(spa): usage and whatsapp-status pages`.

---

### Task 9: Netlify deploy config + production wiring

**Files:** `netlify.toml` (repo root), `spa/public/_redirects`, `.env.example` note, docs

- [ ] **Step 1:** `netlify.toml` at repo root:
```toml
[build]
  base = "spa"
  command = "npm run build"
  publish = "spa/dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```
Also add `spa/public/_redirects` with `/*  /index.html  200` (belt-and-suspenders for SPA routing).

- [ ] **Step 2:** Document Netlify env var `VITE_API_URL=https://api.etherionlabs.com` (set in Netlify UI / `netlify.toml [build.environment]` is fine too but the URL is env-specific — document it; do NOT hardcode the prod URL in code). Confirm the API's `CORS_ORIGIN` must equal the Netlify site URL.

- [ ] **Step 3:** Add a "SPA (Plan 3)" section to `docs/runbooks/2026-06-13-plan1-deploy.md`: connect repo to Netlify, base dir `spa`, build `npm run build`, publish `spa/dist`, set `VITE_API_URL`, set the API `CORS_ORIGIN` to the Netlify URL, JWT-in-localStorage tech-debt reminder.

- [ ] **Step 4: Verify** `cd spa && npm run build` succeeds. Commit `feat(spa): Netlify deploy config + runbook`.

---

### Task 10: Final verification (build + dev-server render)

- [ ] **Step 1:** `cd spa && npm run typecheck && npm test && npm run build` all green.
- [ ] **Step 2:** Start the API locally (`DATABASE_URL=... JWT_SECRET=dev npx tsx api/src/index.ts`) with a seeded tenant+user (dev Postgres on 5433), start `cd spa && npm run dev`, and verify in a browser/preview: the login page renders, logging in with the seeded creds reaches the dashboard, and at least one page loads data from the API. Capture proof (screenshot/console). If full API wiring is impractical in the harness, at minimum verify the login page renders and a deliberately-wrong login shows the error from the API.
- [ ] **Step 3:** Commit `chore(spa): final verification`.

---

## Self-Review

- **Spec §6 coverage:** login (T3), dashboard by status (T5), job detail + intake edit + actions (T6), contacts toggle (T7), usage (T8), wa-status/QR (T8), Netlify deploy (T9). ✓
- **API-only:** the SPA never talks to Postgres/worker directly — only the `api` client (T2), which targets `VITE_API_URL`. ✓
- **Auth/security:** JWT in `localStorage` (MVP, documented tech debt to HttpOnly cookie); 401 → logout+redirect (T2). CORS origin must match Netlify URL (T9). ✓
- **Intake shape consistency:** `intake[section][field].value` used identically in JobDetail (T6) and documented in the contract. PATCH `path` is `"section.field"` everywhere.
- **Type/name consistency:** the `api` object methods (T2) are the single source of truth used by every page; status enum values match the backend (`OPEN_INTAKE|READY_FOR_REVIEW|IN_PROGRESS|CLOSED`).
