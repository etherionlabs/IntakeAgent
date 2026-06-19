# Plan Fase 1 — Hardening de seguridad y confiabilidad — Plan de implementación

> **Para workers agénticos:** SUB-SKILL REQUERIDA: usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan paso a paso. Los pasos usan sintaxis de checkbox (`- [ ]`) para seguimiento.

**Objetivo:** Que un cliente pueda confiar sus datos —y los de sus clientes finales— al producto. Cierra las brechas #1 (auth en `localStorage`) y #2 (login sin tenant) del roadmap y endurece la operación (API, WhatsApp/Baileys, backups) a un nivel "vendible". Esta fase **no depende** de billing/onboarding y puede arrancar de inmediato.

**Arquitectura:** El JWT deja de viajar en el body y de vivir en `localStorage`; pasa a una cookie `HttpOnly`+`Secure`+`SameSite=None` emitida por la API, con protección CSRF por **double-submit cookie** (`intake_csrf` legible reflejada en el header `x-csrf-token`). La identidad de login pasa a **email único global** (búsqueda determinista, un email → un usuario → un tenant). Se añaden recuperación/cambio de contraseña con token de un solo uso, política mínima de contraseñas y rate-limit. La API se endurece con `@fastify/helmet`, `@fastify/rate-limit`, `bodyLimit` y CORS estricto, más un **test de aislamiento entre tenants**. La conexión Baileys gana backoff exponencial con jitter y alertas de desconexión; OpenRouter gana clasificación de errores (429/saldo) con degradación sin perder mensajes. Por último, `pg_dump` con retención + un **restore drill ejecutado y documentado** en staging.

**Tech Stack:** Node 20+, TypeScript via `tsx`, Fastify 5 (`@fastify/cookie`, `@fastify/jwt`, `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`), Prisma 7.8 + `@prisma/adapter-pg` + PostgreSQL 16, bcryptjs, zod, vitest 4 (`fileParallelism: false`), React + Vite (SPA), Baileys, `@openrouter/sdk`, Docker + Docker Compose.

**Decisiones asumidas por este plan (confirmar antes de ejecutar — ver spec §"Decisiones abiertas"):**
- **Identidad de login = email único global** (spec §1.2, recomendado). Si el negocio elige `tenantSlug + username`, el Grupo 1 cambia: la búsqueda es `findUnique({ where: { tenantId_username } })` con el slug resuelto en el formulario; el resto del plan no se altera.
- **Cookie `SameSite=None` + `Secure`** porque SPA (Netlify) y API están en dominios distintos (cross-site). Si se sirviera la SPA bajo el mismo dominio/subdominio que la API, se usaría `Lax`.
- **Email de recuperación = stub/log en Fase 1** (proveedor formal en Fase 6). Una interfaz `EmailSender` con una implementación `LogEmailSender` deja el cambio de proveedor aislado.
- **Invalidación de sesiones tras cambio de contraseña = `passwordChangedAt` en `PanelUser`** comparado contra el `iat` del JWT en `authenticate`.
- **Umbral de alerta de bot desconectado = 5 min** (configurable).

**Disciplina incremental:** El cambio de auth (Grupo 1) toca el contrato API↔SPA de forma atómica: se hace en una sola tanda de tareas con sus tests, evitando un estado intermedio donde ni cookie ni header funcionen. Cada tarea termina con la suite verde (`api/`, `spa/` y raíz según aplique) y con `npm run typecheck` limpio. Las migraciones Prisma se añaden primero **nullable**/con backfill para no romper los 2 tenants del piloto, y se tightenean en un paso posterior.

**Prerrequisito para correr tests/migraciones localmente:** un PostgreSQL local (ver Plan 1 — Infra). Levanta uno desechable antes de empezar:
```bash
docker run -d --name intake-pg-dev -e POSTGRES_DB=intake -e POSTGRES_USER=intake -e POSTGRES_PASSWORD=intake -p 5432:5432 postgres:16
export DATABASE_URL="postgres://intake:intake@localhost:5432/intake"
```

---

## Orden recomendado de ejecución

```
Grupo 1  Auth cookie HttpOnly + CSRF + login por email      ◄── primero (cierra brechas #1 y #2)
Grupo 2  Recuperación/cambio de contraseña + rate-limit      (depende de G1: email + passwordChangedAt)
Grupo 3  Endurecimiento API (helmet/rate-limit/payload/CORS/aislamiento)
Grupo 4  Resiliencia Baileys + manejo OpenRouter             (independiente, puede solaparse con G1–G3)
Grupo 5  Backups + restore drill                             (último; documental/operacional)
```

- **Grupo 1 va primero**: cierra las dos brechas que bloquean la venta y define el contrato de cookie/CSRF que el Grupo 2 reutiliza.
- **Grupo 2 depende de Grupo 1**: necesita `email` en `PanelUser` (para enviar el enlace) y `passwordChangedAt` (para invalidar sesiones). El rate-limit estricto de `/auth/login` reaprovecha `@fastify/rate-limit` registrado en el Grupo 3, así que si se ejecuta antes, registrar `@fastify/rate-limit` aquí.
- **Grupo 3 es mayormente independiente** de G1/G2 salvo CORS: la revisión de CORS (T3.4) **debe** alinearse con la decisión de cookie cross-site del Grupo 1 (`credentials: true` + origin concreto). Hacer G3.4 después de G1.
- **Grupo 4 es independiente** del resto (vive en el worker `src/`, no en `api/`); puede correr en paralelo desde el inicio por otra persona.
- **Grupo 5 va al final**: valida que todo lo anterior es recuperable.

> Nota de dependencia técnica: este plan asume que **Plan 1 (Infra + Worker)** y **Plan 2 (API central)** ya están aplicados (Postgres, `tenantId` threaded, rutas `api/`). Si `@fastify/rate-limit` se registra en G2 y G3, hacerlo **una sola vez** en `server.ts` con override por ruta.

---

# GRUPO 1 — Auth: cookie `HttpOnly` + CSRF + login por email

Cierra brecha #1 (token en `localStorage`/body) y brecha #2 (login sin tenant). Estas tareas forman un cambio atómico del contrato API↔SPA; ejecutarlas en orden y no desplegar a medias.

---

### Tarea 1.1: `email` único global en `PanelUser` (schema + migración con backfill)

**Objetivo:** Reemplazar la identidad de login `username` global por `email` único global, de forma determinista, sin romper a los 2 tenants del piloto.

**Archivos:**
- Modificar: `prisma/schema.prisma` (`model PanelUser`, líneas ~25–36)
- Crear: `prisma/migrations/<timestamp>_paneluser_email/` (generada)
- Modificar: el seed/script de creación de usuarios si existe (`api:create-user`)

**Cambios:**
- Añadir `email String?` (nullable primero) y `passwordChangedAt DateTime?` a `PanelUser`. (El campo `passwordChangedAt` lo consume el Grupo 2; se añade aquí para una sola migración de schema de auth.)
- Conservar `username` como display name opcional; mantener `@@unique([tenantId, username])` solo como restricción de display, **no** como clave de login.
- Generar migración nullable: `npx prisma migrate dev --name paneluser_email`.
- **Backfill**: poblar `email` para los usuarios existentes (script o `UPDATE` manual de los 2 tenants del piloto), luego una segunda migración que ponga `email String @unique` (`NOT NULL` + `@unique`).

**Dependencias:** ninguna (primera del grupo).

**Verificación:** Test nuevo `api/tests/auth-email.test.ts` (o ampliar el de auth): crear 2 `PanelUser` en tenants distintos con el mismo `email` debe fallar por la constraint `@unique`; crear con emails distintos pasa. Correr `npm test` en `api/` y `npm run typecheck`.

---

### Tarea 1.2: Login determinista por email + emisión de cookies en `auth.ts`

**Objetivo:** `/auth/login` busca por email (un email → un tenant), fija la cookie de sesión `HttpOnly` y la cookie CSRF, y deja de devolver el token en el body.

**Archivos:**
- Modificar: `api/src/routes/auth.ts` (todo el handler de `/auth/login`, líneas 6, 15, 19–20)
- Modificar: `api/src/server.ts` (registro de `@fastify/cookie` y de `@fastify/jwt` con lectura desde cookie)
- Modificar: `api/package.json` (dependencia `@fastify/cookie`)

**Cambios:**
- `LoginZ`: `{ email: z.string().email(), password: z.string().min(1) }` (reemplaza `username`).
- Reemplazar `prisma.panelUser.findFirst({ where: { username } })` (`auth.ts:15`) por `prisma.panelUser.findUnique({ where: { email } })`. El JWT sigue llevando `{ userId, tenantId, role }`.
- En lugar de `return { token, user }`: `reply.setCookie('intake_session', token, { httpOnly: true, secure: true, sameSite: 'none', path: '/', maxAge: <alineado al exp del JWT> })`; emitir `reply.setCookie('intake_csrf', <random>, { httpOnly: false, secure: true, sameSite: 'none', path: '/' })`; devolver solo `{ user: {...} }` (sin token).
- En `server.ts`: registrar `@fastify/cookie`; registrar `@fastify/jwt` con `cookie: { cookieName: 'intake_session', signed: false }` para que `jwtVerify()` lea de la cookie.

**Dependencias:** Tarea 1.1 (email en schema).

**Verificación:** Test `api/tests/auth-cookie.test.ts`: `POST /auth/login` con email/password válidos responde 200, **sin** `token` en el body, con `Set-Cookie: intake_session` (`HttpOnly`) y `Set-Cookie: intake_csrf` (sin `HttpOnly`). Credenciales inválidas → 401. Correr `npm test` en `api/`.

---

### Tarea 1.3: `authenticate` lee JWT de la cookie; `/auth/me` y `/auth/logout`

**Objetivo:** El decorator `authenticate` valida la sesión desde la cookie; la SPA puede rehidratar (`/auth/me`) y cerrar sesión (`/auth/logout`) sin acceso al token.

**Archivos:**
- Modificar: `api/src/server.ts` (decorator `authenticate`, líneas 34–42)
- Modificar: `api/src/routes/auth.ts` (nuevos handlers `GET /auth/me`, `POST /auth/logout`)

**Cambios:**
- `authenticate`: `request.jwtVerify()` ahora toma el JWT de la cookie (gracias al registro de 1.2); mantener `request.tenantId`/`request.authUser`. (La comparación contra `passwordChangedAt` se añade en el Grupo 2, Tarea 2.4.)
- `GET /auth/me` (con `preHandler: authenticate`): devuelve el `user` actual desde la cookie válida; 401 si no hay sesión.
- `POST /auth/logout`: `reply.clearCookie('intake_session', ...)` y `reply.clearCookie('intake_csrf', ...)`; devuelve `{ ok: true }`.

**Dependencias:** Tarea 1.2.

**Verificación:** Test `api/tests/auth-me-logout.test.ts`: login → usar la cookie devuelta en `GET /auth/me` → 200 con `user`; tras `POST /auth/logout`, `GET /auth/me` → 401. Una petición sin cookie a `/auth/me` → 401. Correr `npm test` en `api/`.

---

### Tarea 1.4: Hook global de validación CSRF (double-submit)

**Objetivo:** Toda petición mutadora (POST/PUT/PATCH/DELETE) exige que el header `x-csrf-token` coincida con la cookie `intake_csrf`; se exceptúan `/auth/login` y `/health`.

**Archivos:**
- Modificar: `api/src/server.ts` (hook `preHandler`/plugin global de CSRF)
- Modificar: `api/package.json` (opcional `@fastify/csrf-protection`, o implementación manual ~30 líneas)

**Cambios:**
- Hook global que, en métodos mutadores y rutas distintas de `/auth/login` y `/health`, compara cookie `intake_csrf` vs header `x-csrf-token`; si no coinciden → 403.
- Documentar las rutas exentas en un único lugar.

**Dependencias:** Tarea 1.2 (cookie CSRF emitida).

**Verificación:** Test `api/tests/csrf.test.ts`: una mutación (p.ej. `PATCH /contacts/:id`) **sin** `x-csrf-token` válido → 403; **con** cookie + header coincidentes → pasa. Un `GET` no requiere CSRF. Actualizar tests existentes que hacían mutaciones para que envíen el header. Correr `npm test` en `api/`.

---

### Tarea 1.5: SPA — `client.ts` usa cookies + CSRF, sin `localStorage`

**Objetivo:** El cliente HTTP de la SPA envía/recibe cookies cross-site, refleja el CSRF en mutaciones y deja de leer/escribir token.

**Archivos:**
- Modificar: `spa/src/api/client.ts` (líneas 10, 17–18, 20, 28; `api.login`, nuevos `api.logout`, `api.me`)

**Cambios:**
- En `request()`: añadir `credentials: 'include'` al `fetch` (`client.ts:20`).
- Eliminar `getToken()` (`client.ts:10`) y el header `authorization` (`client.ts:17–18`).
- Leer la cookie legible `intake_csrf` (helper `document.cookie`) y, en métodos mutadores, añadir `headers['x-csrf-token']`.
- `api.login(email, password)` (firma cambia de `username` a `email`); devuelve `{ user }` (sin token).
- Añadir `api.logout()` → `POST /auth/logout`; `api.me()` → `GET /auth/me`.

**Dependencias:** Tareas 1.2–1.4 (contrato del servidor).

**Verificación:** Tests de la SPA (`spa/src/api/*.test.ts` si existen, o añadir uno): `request` incluye `credentials: 'include'`; una mutación añade `x-csrf-token`; ya no se lee `localStorage`. Correr `npm test` en `spa/`.

---

### Tarea 1.6: SPA — `AuthContext.tsx` en memoria, rehidratación por `/auth/me`

**Objetivo:** El estado de auth vive solo en memoria; al montar se rehidrata desde la cookie vía `/auth/me`; login/logout usan el nuevo contrato.

**Archivos:**
- Modificar: `spa/src/auth/AuthContext.tsx` (líneas 5–8 firma, 13–17, 20–21, 23–36, 38–40)
- Modificar: pantalla de login (campo email en vez de username)

**Cambios:**
- Quitar todo uso de `localStorage` (`AuthContext.tsx:14`, `20`, `24–27`, `31–33`) y el campo `token` del contexto.
- `login(email, password)`: llama `api.login()`, puebla `user` en estado en memoria (usa el `user` devuelto o `api.me()`).
- `useEffect` al montar: `api.me()` → si 200 puebla `user`, si 401 queda deslogueado.
- `logout()`: `api.logout()` + limpia el estado en memoria.
- Cambiar la firma de `login` y el formulario para pedir **email**.

**Dependencias:** Tarea 1.5.

**Verificación:** Tests de `AuthContext`/login: al montar con cookie válida (mock `api.me`) se puebla `user`; `logout` llama `api.logout` y limpia estado; el formulario envía `email`. Correr `npm test` en `spa/`. Manual: login → recargar → sigue logueado; logout → 401 en `/auth/me`.

---

# GRUPO 2 — Recuperación/cambio de contraseña + rate-limit

Depende del Grupo 1 (email en `PanelUser`, `passwordChangedAt`, cookie auth). Añade el flujo de password y endurece `/auth/login` contra fuerza bruta.

---

### Tarea 2.1: Política de contraseñas + abstracción de email

**Objetivo:** Un validador único de contraseñas reutilizable y un `EmailSender` con stub para Fase 1.

**Archivos:**
- Crear: `api/src/lib/password-policy.ts`
- Crear: `api/src/lib/email.ts` (interfaz `EmailSender` + `LogEmailSender`)
- Crear: `api/tests/password-policy.test.ts`

**Cambios:**
- `password-policy.ts`: validador zod (mín. 10 chars configurable, rechaza blacklist corta de comunes) exportado para reuso en reset/change y (Fase 4) signup.
- `email.ts`: `interface EmailSender { send(to, subject, body): Promise<void> }` + `LogEmailSender` que loguea (sin secretos). Documentar como deuda → proveedor formal en Fase 6.

**Dependencias:** ninguna interna (puede ir primero del grupo).

**Verificación:** `password-policy.test.ts`: contraseñas < 10 chars o en blacklist → inválidas; válidas pasan. Correr `npm test` en `api/`.

---

### Tarea 2.2: Modelo `PasswordResetToken` + `forgot-password`

**Objetivo:** Generar un token de un solo uso (se guarda su **hash**), expirable, y enviar el enlace de reset; respuesta siempre 200 (anti-enumeración).

**Archivos:**
- Modificar: `prisma/schema.prisma` (nuevo `model PasswordResetToken { id, userId, tokenHash, expiresAt, usedAt }`)
- Crear: `prisma/migrations/<timestamp>_password_reset/` (generada)
- Modificar: `api/src/routes/auth.ts` (handler `POST /auth/forgot-password`)
- Crear: `api/tests/forgot-password.test.ts`

**Cambios:**
- Migración del nuevo modelo (`npx prisma migrate dev --name password_reset`).
- `POST /auth/forgot-password { email }`: si el usuario existe, genera token aleatorio, guarda `tokenHash` (no el token en claro), `expiresAt` ~30–60 min; envía email con `https://<spa>/reset?token=...` vía `EmailSender`. **Siempre 200**, exista o no el email.

**Dependencias:** Tarea 2.1 (EmailSender), Grupo 1 Tarea 1.1 (email en `PanelUser`).

**Verificación:** `forgot-password.test.ts`: email existente → 200 + se persiste un `PasswordResetToken` con `tokenHash` (no el token en claro) y `expiresAt` futuro; email inexistente → 200 sin crear token. El `EmailSender` (mock) recibe un enlace con token. Correr `npm test` en `api/`.

---

### Tarea 2.3: `reset-password` (token de un solo uso)

**Objetivo:** Canjear el token: validar hash + no expirado + no usado, aplicar política, actualizar `passwordHash`, marcar `usedAt` y `passwordChangedAt`.

**Archivos:**
- Modificar: `api/src/routes/auth.ts` (handler `POST /auth/reset-password`)
- Crear: `api/tests/reset-password.test.ts`

**Cambios:**
- `POST /auth/reset-password { token, newPassword }`: hashea el token recibido y busca por `tokenHash`; valida no expirado y `usedAt == null`; aplica `password-policy`; actualiza `passwordHash` con bcrypt (cost ≥ 10); set `usedAt = now()` y `PanelUser.passwordChangedAt = now()` (invalida sesiones; ver 2.4).

**Dependencias:** Tareas 2.1, 2.2.

**Verificación:** `reset-password.test.ts`: token válido → 200 y la contraseña nueva funciona en login; token expirado/ya usado/inexistente → 4xx; contraseña que viola política → 400; reusar el mismo token dos veces → falla la segunda. Correr `npm test` en `api/`.

---

### Tarea 2.4: `change-password` (autenticado) + invalidación de sesiones

**Objetivo:** Cambio de contraseña desde el panel verificando la actual; rechazar JWT emitidos antes de `passwordChangedAt`.

**Archivos:**
- Modificar: `api/src/routes/auth.ts` (handler `POST /auth/change-password`, `preHandler: authenticate`)
- Modificar: `api/src/server.ts` (decorator `authenticate`: comparar `iat` del JWT vs `passwordChangedAt`)
- Modificar: `spa/src/api/client.ts` y `spa/src/...` (UI de perfil/configuración)
- Crear: `api/tests/change-password.test.ts`

**Cambios:**
- `POST /auth/change-password { currentPassword, newPassword }`: verifica `currentPassword` con bcrypt; aplica política; actualiza hash; set `passwordChangedAt = now()`.
- En `authenticate` (`server.ts:34–42`): tras `jwtVerify()`, cargar `passwordChangedAt` del usuario y, si `jwt.iat < passwordChangedAt`, responder 401 (sesión invalidada).
- SPA: `api.changePassword(...)` + formulario en perfil/configuración.

**Dependencias:** Grupo 1 (cookie auth, `passwordChangedAt` en schema), Tarea 2.1.

**Verificación:** `change-password.test.ts`: con `currentPassword` correcta → 200 y la nueva funciona; incorrecta → 401/403; tras cambiar, un JWT/cookie viejo (emitido antes) → 401 en cualquier ruta protegida. Correr `npm test` en `api/`.

---

### Tarea 2.5: Rate-limit estricto en `/auth/login`

**Objetivo:** Anti fuerza bruta: 5 intentos / 15 min por IP (y opcionalmente por email), 429 con `Retry-After`, sin loguear contraseñas.

**Archivos:**
- Modificar: `api/src/server.ts` (registro de `@fastify/rate-limit` si no se hizo en G3; override por ruta)
- Modificar: `api/src/routes/auth.ts` (`config.rateLimit` en `/auth/login`)
- Modificar: `api/package.json` (`@fastify/rate-limit`)
- Crear: `api/tests/login-ratelimit.test.ts`

**Cambios:**
- Registrar `@fastify/rate-limit` (una sola vez; si el Grupo 3 ya lo registró, solo añadir el override).
- En `/auth/login`: `config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }`. Respuesta 429 con `Retry-After`. Logs de intentos fallidos **sin** la contraseña ni el body de `/auth/*` (coordinar con G3 Tarea 3.5).

**Dependencias:** Grupo 1 (login por email). Comparte el plugin con G3.1.

**Verificación:** `login-ratelimit.test.ts`: 6 logins fallidos seguidos desde la misma IP → el 6º responde 429 con `Retry-After`. Correr `npm test` en `api/`.

---

# GRUPO 3 — Endurecimiento de la API

Mayormente independiente de G1/G2, salvo CORS (Tarea 3.4) que debe alinearse con la cookie cross-site del Grupo 1.

---

### Tarea 3.1: Rate limiting global (`@fastify/rate-limit`)

**Objetivo:** Límite global por IP en la API, con override estricto en `/auth/login` (compartido con G2.5).

**Archivos:**
- Modificar: `api/src/server.ts` (registro del plugin)
- Modificar: `api/package.json` (`@fastify/rate-limit`)
- Crear: `api/tests/ratelimit.test.ts`

**Cambios:**
- Registrar `@fastify/rate-limit` con global ~100 req/min por IP. Store en memoria (suficiente para 1 proceso). Documentar como deuda: con réplicas hará falta Redis.

**Dependencias:** ninguna (registrar el plugin una sola vez; G2.5 añade el override).

**Verificación:** `ratelimit.test.ts`: superar el umbral global → 429. Asegurar que el umbral global no rompe los tests existentes (ajustar/saltar en entorno de test si es necesario). Correr `npm test` en `api/`.

---

### Tarea 3.2: Headers de seguridad (`@fastify/helmet`)

**Objetivo:** Headers de seguridad presentes en todas las respuestas (API sirve solo JSON).

**Archivos:**
- Modificar: `api/src/server.ts` (registro de helmet)
- Modificar: `api/package.json` (`@fastify/helmet`)
- Crear/ampliar: `api/tests/helmet.test.ts`

**Cambios:**
- Registrar `@fastify/helmet`: `hsts`, `noSniff`, `frameguard`; CSP restrictiva (no HTML). Verificar que no rompa el preflight CORS (ver 3.4).

**Dependencias:** ninguna (coordinar con 3.4 por el preflight).

**Verificación:** `helmet.test.ts`: una respuesta cualquiera incluye `x-content-type-options: nosniff`, `strict-transport-security`, `x-frame-options`. El preflight `OPTIONS` sigue funcionando. Correr `npm test` en `api/`.

---

### Tarea 3.3: Límite de tamaño de payload

**Objetivo:** Acotar el tamaño de los bodies JSON (la media va por el worker, no por la API).

**Archivos:**
- Modificar: `api/src/server.ts` (`Fastify({ bodyLimit })`, línea 19)

**Cambios:**
- `Fastify({ logger: false, bodyLimit: 256 * 1024 })` (256 KB, ajustable).

**Dependencias:** ninguna.

**Verificación:** Test: un body por encima del límite → 413. Bodies normales pasan. Correr `npm test` en `api/`.

---

### Tarea 3.4: Revisión de CORS (origin concreto + credentials)

**Objetivo:** Con cookies cross-site, exigir un origin concreto y `credentials: true`; fallar en producción si `CORS_ORIGIN` es `*`.

**Archivos:**
- Modificar: `api/src/env.ts` (default y validación de `CORS_ORIGIN`, línea ~9)
- Modificar: `api/src/server.ts` (CORS, líneas 25–30: quitar `allowCredentials` condicional)
- Modificar: `api/tests/cors.test.ts` (nuevo contrato)

**Cambios:**
- `env.ts`: en `NODE_ENV==='production'`, **fallar** si `CORS_ORIGIN` es `*` o falta. Permitir lista separada por comas (staging + prod).
- `server.ts`: `credentials: true` siempre (no condicional al origin); `origin` concreto (de la lista). Quitar `const allowCredentials = CORS_ORIGIN !== '*'`.
- Actualizar `cors.test.ts` al nuevo contrato (origin concreto + `Access-Control-Allow-Credentials: true`).

**Dependencias:** Grupo 1 (cookie cross-site define este requisito).

**Verificación:** `cors.test.ts`: preflight con origin permitido → headers correctos + `credentials: true`; en producción con `CORS_ORIGIN='*'` el arranque falla. Correr `npm test` en `api/`.

---

### Tarea 3.5: Auditoría de secretos en logs

**Objetivo:** Ningún secreto (`OPENROUTER_API_KEY`, `INTERNAL_API_TOKEN`, `JWT_SECRET`, `POSTGRES_PASSWORD`) ni credencial aparece en logs.

**Archivos:**
- Modificar: `api/src/env.ts` (confirmar lectura solo por `requireEnv`)
- Modificar: config del logger de la API y del worker (regla de redacción)
- Revisar: `src/adapters/whatsapp/connection.ts` (confirmar que no loguea secretos)

**Cambios:**
- Confirmar que los secretos se leen solo por env (`requireEnv`, `env.ts:1–5`).
- Configurar el logger para **nunca** serializar `headers.authorization`, cookies de sesión ni el body de `/auth/*` (redact paths de pino).

**Dependencias:** ninguna.

**Verificación:** Test que captura la salida del logger al hacer login y verifica que la contraseña/cookie no aparecen. Grep manual de los módulos de log. Correr `npm test` en `api/`.

---

### Tarea 3.6: Test de aislamiento entre tenants *(el que da confianza para vender)*

**Objetivo:** Un usuario del tenant A no puede leer ni mutar datos del tenant B (vacío / 403 / 404), y todas las rutas filtran por `request.tenantId`.

**Archivos:**
- Crear: `api/tests/tenant-isolation.test.ts`
- Modificar (si la auditoría encuentra fugas): cualquier `api/src/routes/*.ts` que reciba un id sin re-filtrar por tenant

**Cambios:**
- Sembrar 2 tenants (A, B) con sus `PanelUser` y datos (jobs, contacts).
- Loguearse como A (obtiene cookie de A).
- Intentar por id directo: `GET /jobs/:idDeB`, `GET /contacts/:idDeB`, `PATCH /jobs/:idDeB/intake`, `PATCH /contacts/:idDeB`, `POST /jobs/:idDeB/actions`, `DELETE /...` → esperar lista vacía donde aplique y 403/404 (nunca datos de B).
- Auditar que **todas** las queries de `routes/*` filtran por `request.tenantId` (poblado en `server.ts:37`); corregir cualquier ruta que reciba un id sin re-filtrar.

**Dependencias:** Grupo 1 (login por cookie, para autenticarse como A en el test).

**Verificación:** `tenant-isolation.test.ts` en verde: A no obtiene datos de B en ningún endpoint por id ni en listas. Correr `npm test` en `api/` y `npm run typecheck`.

---

# GRUPO 4 — Resiliencia de WhatsApp (Baileys) + manejo de OpenRouter

Vive en el worker (`src/`), independiente de la API; puede correr en paralelo desde el inicio.

---

### Tarea 4.1: Reconexión con backoff exponencial + jitter

**Objetivo:** Sustituir el delay fijo de 3000 ms por backoff exponencial con jitter y tope, reseteando el contador al reconectar.

**Archivos:**
- Modificar: `src/adapters/whatsapp/connection.ts` (líneas 40–41 estado, 109–116 open, 122–136 close)
- Crear/ampliar: `tests/adapters/whatsapp/connection.test.ts`

**Cambios:**
- Añadir `private reconnectAttempts = 0;`.
- Reemplazar `setTimeout(..., 3000)` (`connection.ts:129`) por `delay = min(30_000, 1000 * 2 ** attempt) ± jitter`.
- En `connection === 'open'` (`connection.ts:109`): `this.reconnectAttempts = 0`.
- Mantener los guards `this.reconnecting`/`this.stopped` (`connection.ts:126–127`) para no solapar reintentos.

**Dependencias:** ninguna.

**Verificación:** `connection.test.ts` con timers falsos (vitest fake timers): tras N caídas consecutivas el delay crece exponencialmente y se topa en 30 s; al reconectar (`open`) el contador vuelve a 0; no se solapan reintentos. Correr `npm test` en la raíz.

---

### Tarea 4.2: Distinguir `loggedOut` vs caída temporal (robustecer)

**Objetivo:** `loggedOut` no reintenta y marca un estado accionable (re-vincular QR); el resto de códigos reintenta con backoff.

**Archivos:**
- Modificar: `src/adapters/whatsapp/connection.ts` (rama `connection === 'close'`, líneas 117–137)
- Modificar: `tests/adapters/whatsapp/connection.test.ts`

**Cambios:**
- Mantener `DisconnectReason.loggedOut` → `logged_out` sin reintentar (ya existe, `connection.ts:122–124`).
- Tratar `restartRequired`, `connectionLost`, `timedOut`, `503` como transitorios → reintentar con backoff (4.1).
- Registrar `code` y `reason` (ya en `connection.ts:118–121`) para alimentar la alerta de 4.3.

**Dependencias:** Tarea 4.1.

**Verificación:** Tests por código: `loggedOut` → estado `logged_out`, **cero** reintentos; un código transitorio → reintenta con backoff. Correr `npm test` en la raíz.

---

### Tarea 4.3: Alerta por bot desconectado > N min

**Objetivo:** Si el estado permanece `disconnected`/`logged_out` más de N min (config, def. 5), alertar al operador (persistente) y al dueño si el canal sigue vivo.

**Archivos:**
- Modificar: `src/internal/server.ts` o el bootstrap del worker (watcher de transiciones de `state()`)
- Modificar: `src/adapters/whatsapp/notifier.ts` (alerta al dueño)
- Modificar: `prisma/schema.prisma` (uso del modelo `Notification` para la alerta al operador)
- Crear: tests del watcher en `tests/adapters/whatsapp/`

**Cambios:**
- Watcher que observa transiciones de `state()` (`connection.ts:57–65`) y arma un timer de N min; al recuperar `connected`, cancela la alerta pendiente.
- Al disparar: notificación al **operador** persistida en `Notification` (canal fiable cuando WhatsApp está caído) y, si el canal vive, al **dueño** vía `WhatsAppNotifier` (`notifier.ts`), respetando `owner.notifyOnDisconnect` (`client.ts:90`).
- `loggedOut` genera una alerta distinta (acción humana: re-escanear QR).
- **Nota de diseño:** no asumir un único worker (brecha #3, se resuelve en Fase 2); la alerta debe llevar el `tenantId`.

**Dependencias:** Tareas 4.1–4.2.

**Verificación:** Test con fake timers: estado `disconnected` durante > N min → se crea una `Notification` para el operador (y se invoca el notifier del dueño); recuperar `connected` antes de N min → no se dispara. Correr `npm test` en la raíz.

---

### Tarea 4.4: Manejo de límites de OpenRouter (429 / saldo agotado)

**Objetivo:** Clasificar errores del LLM y degradar sin perder mensajes; alertar al dueño/operador ante saldo agotado.

**Archivos:**
- Modificar: `src/agent/sdk-factory.ts` (captura y clasificación de errores del LLM)
- Modificar: `src/agent/tools.ts` o el pipeline del turno (degradación: respuesta neutral + encolar/marcar el turno)
- Modificar: `src/adapters/whatsapp/notifier.ts` (reutiliza el canal de alerta de 4.3)
- Crear/ampliar: tests en `tests/agent/`

**Cambios:**
- Clasificar: `429` (rate limit → reintento con backoff acotado), `402`/insufficient credits (saldo → **no** reintentar), errores transitorios de red.
- **Degradación sin perder mensajes:** ante saldo agotado o 429 persistente, responder al cliente final un mensaje neutral ("estamos procesando, te respondemos enseguida") y **encolar/marcar** el turno para reintento (no descartar el mensaje entrante).
- **Notificar** al dueño y al operador (saldo agotado es accionable) reutilizando el canal de 4.3.
- Usar `limits.monthlyCostUsd` / `alertOnCostUsd` / `maxConsecutiveErrors` (`client.ts:93–96`) como umbrales de alerta proactiva.

**Dependencias:** Tarea 4.3 (canal de alerta).

**Verificación:** Tests del agente con un SDK mock que lanza 429 y 402: en 429 reintenta con backoff acotado; en 402 no reintenta, responde mensaje neutral, marca el turno para reintento y dispara alerta; el mensaje entrante nunca se pierde. Correr `npm test` en la raíz.

---

# GRUPO 5 — Backups probados (no solo configurados)

Va al final: valida que todo lo anterior es recuperable. Mayormente documental/operacional.

---

### Tarea 5.1: `pg_dump` diario + retención

**Objetivo:** Backup diario comprimido, con retención y almacenado fuera del volumen de la DB.

**Archivos:**
- Crear: `docs/runbooks/backup.md` (o script en `docs/runbooks/`/`scripts/`)
- Modificar: `docker-compose.yml` / cron del host (entrada de cron)

**Cambios:**
- Script: `docker exec postgres pg_dump -U intake intake | gzip > backup-$(date +%F).sql.gz`.
- Retención: 7 diarios + 4 semanales; script de limpieza.
- Almacenar **fuera del volumen de la DB** (idealmente off-host: bucket/objeto) para sobrevivir a la pérdida del VPS.

**Dependencias:** ninguna.

**Verificación:** Ejecutar el script manualmente en staging → se genera `backup-YYYY-MM-DD.sql.gz` no vacío; correr la limpieza con backups simulados de >7 días y confirmar que respeta la retención.

---

### Tarea 5.2: Restore drill documentado y **ejecutado** en staging

**Objetivo:** Probar que el backup es restaurable de punta a punta y documentar RTO/RPO.

**Archivos:**
- Crear: `docs/runbooks/restore-drill.md`

**Cambios (procedimiento a ejecutar y documentar):**
1. Levantar un Postgres limpio en staging.
2. `gunzip -c backup-YYYY-MM-DD.sql.gz | docker exec -i postgres-staging psql -U intake intake`.
3. Apuntar una API/worker de staging a la DB restaurada.
4. Verificar: login funciona, jobs/contacts del tenant presentes, conteos coinciden con el día del backup.
5. Documentar tiempo de restore (RTO) y pérdida máxima tolerada (RPO = 24 h con backup diario).

**Dependencias:** Tarea 5.1 (existe un backup que restaurar).

**Verificación:** El drill se completa con éxito en staging (login OK, conteos coinciden) y queda escrito en `docs/runbooks/restore-drill.md` con RTO/RPO reales.

---

### Tarea 5.3: Política de sesión WhatsApp / media

**Objetivo:** Decidir explícitamente respaldo vs re-vinculación para la sesión Baileys y media.

**Archivos:**
- Modificar: `docs/runbooks/restore-drill.md` (o un runbook de WhatsApp)
- Modificar: `docker-compose.yml` (si se decide respaldar el volumen `media-<tenant>`)

**Cambios:**
- Recomendado Fase 1: **documentar el flujo de re-vinculación por QR** como recuperación aceptada para la sesión Baileys (volumen `baileys-<tenant>`), y **respaldar** `media-<tenant>` (irrecuperable).
- Dejar registrada la decisión y el procedimiento de re-vinculación.

**Dependencias:** ninguna.

**Verificación:** Procedimiento de re-vinculación documentado y probado (forzar `logout` → re-escanear QR → bot vuelve a operar) en staging; el respaldo de `media-<tenant>` incluido en el script de 5.1 o documentado.

---

## Riesgos

- **Despliegue parcial del Grupo 1 rompe el login.** El cambio API↔SPA (cookie/CSRF/email) es atómico: si la API exige CSRF pero la SPA aún manda `Bearer`, todo falla. Desplegar API y SPA juntas; tener listo un rollback.
- **`SameSite=None` requiere `Secure` y HTTPS real.** En local sin HTTPS las cookies cross-site no se envían; usar el entorno de staging con TLS o un proxy. Confirmar antes de invertir en G1.
- **Migración de `email` con datos existentes.** Si el backfill no cubre a todos los `PanelUser`, la migración a `NOT NULL @unique` falla. Backfillear y verificar conteos antes de tightenar (Tarea 1.1).
- **Invalidación de sesiones vs reloj.** Comparar `iat` (segundos) con `passwordChangedAt` (ms) requiere normalizar unidades, o un usuario legítimo podría quedar deslogueado/no invalidado. Cubrir con test (Tarea 2.4).
- **Rate-limit global puede romper la suite de tests.** Umbral bajo + muchos requests en tests → 429 espurios. Configurar el límite alto o desactivado en entorno de test (Tarea 3.1).
- **Helmet vs preflight CORS.** Un CSP/policy agresivo puede interferir con `OPTIONS`. Verificar el preflight tras registrar helmet (Tarea 3.2/3.4).
- **Rate-limit y backoff en memoria = deuda con réplicas.** Con varios procesos API/worker, el store en memoria no comparte estado (hace falta Redis). Aceptable mientras sea 1 proceso; documentado.
- **El test de aislamiento puede destapar fugas reales.** Si alguna ruta no filtra por `tenantId`, la Tarea 3.6 fallará y exigirá corregir `routes/*`: presupuestar tiempo extra.
- **Alertas asumen 1 worker (brecha #3).** Diseñar la alerta con `tenantId` para no reescribirla en Fase 2.
- **Backup off-host pendiente de decisión.** Si los dumps quedan en el VPS, una pérdida del host se lleva los backups; confirmar si se adelanta el off-host a Fase 1 (recomendado).

---

## Checklist de tareas

**Grupo 1 — Auth cookie HttpOnly + CSRF + login por email**
- [ ] 1.1 `email` (nullable → backfill → `@unique`) + `passwordChangedAt` en `PanelUser`; migración aplicada
- [ ] 1.2 Login por email + emisión de cookies `intake_session`/`intake_csrf`; `@fastify/cookie` + jwt desde cookie
- [ ] 1.3 `authenticate` lee la cookie; `GET /auth/me` y `POST /auth/logout`
- [ ] 1.4 Hook global CSRF double-submit (exime `/auth/login`, `/health`)
- [ ] 1.5 SPA `client.ts`: `credentials: 'include'`, `x-csrf-token`, sin `localStorage`, `api.me`/`api.logout`
- [ ] 1.6 SPA `AuthContext.tsx` en memoria + rehidratación por `/auth/me`; formulario por email

**Grupo 2 — Recuperación/cambio de contraseña + rate-limit**
- [ ] 2.1 `password-policy.ts` + `EmailSender`/`LogEmailSender`
- [ ] 2.2 Modelo `PasswordResetToken` + `POST /auth/forgot-password` (200 anti-enumeración)
- [ ] 2.3 `POST /auth/reset-password` (token de un solo uso, expirable)
- [ ] 2.4 `POST /auth/change-password` + invalidación por `passwordChangedAt` en `authenticate`
- [ ] 2.5 Rate-limit estricto en `/auth/login` (5/15 min, 429 + `Retry-After`)

**Grupo 3 — Endurecimiento API**
- [ ] 3.1 `@fastify/rate-limit` global por IP
- [ ] 3.2 `@fastify/helmet` (hsts/noSniff/frameguard)
- [ ] 3.3 `bodyLimit` (256 KB)
- [ ] 3.4 CORS: origin concreto + `credentials: true`; falla si `*` en producción; `cors.test.ts` actualizado
- [ ] 3.5 Auditoría de secretos en logs (redacción de auth/cookies)
- [ ] 3.6 `tenant-isolation.test.ts` en verde; rutas auditadas por `tenantId`

**Grupo 4 — Resiliencia Baileys + OpenRouter**
- [ ] 4.1 Backoff exponencial + jitter; reset de intentos al reconectar
- [ ] 4.2 `loggedOut` no reintenta (alerta de re-vinculación); transitorios reintentan
- [ ] 4.3 Alerta por bot desconectado > N min (operador persistente + dueño si el canal vive)
- [ ] 4.4 OpenRouter 429/402: degradación con mensaje neutral, sin perder el mensaje, + alerta

**Grupo 5 — Backups + restore drill**
- [ ] 5.1 `pg_dump` diario + retención (7 diarios + 4 semanales), off-host
- [ ] 5.2 Restore drill **ejecutado** en staging y documentado con RTO/RPO
- [ ] 5.3 Política de sesión WhatsApp/media (re-vinculación documentada + respaldo de media)

**Cierre de fase**
- [ ] `npm test` verde en raíz, `api/` y `spa/`; `npm run typecheck` limpio en los tres
- [ ] Todos los criterios de aceptación del spec §"Criterios de aceptación" cumplidos
