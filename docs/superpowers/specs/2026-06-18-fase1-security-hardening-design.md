# Fase 1 — Hardening de seguridad y confiabilidad — Diseño

**Fecha:** 2026-06-18
**Estado:** Propuesta para implementación
**Objetivo:** Que un cliente pueda confiar sus datos —y los de sus clientes
finales— al producto. Cierra las brechas #1 (auth en `localStorage`) y #2 (login
sin tenant) del roadmap, y endurece la operación (API, WhatsApp/Baileys,
backups) hasta un nivel "vendible". Esta fase **no depende** de las decisiones de
billing/onboarding y puede arrancar de inmediato.

**Prerequisito de roadmap:** prioridad #1. Va antes de Fase 2 (multi-tenancy
real), Fase 3 (billing) y Fase 4 (self-service).

**Esfuerzo estimado:** 2–3 semanas (1 dev full-time).

---

## 1. Autenticación robusta

### 1.0 Estado actual (verificado en código)

| Pieza | Hoy | Archivo |
| --- | --- | --- |
| Login | `findFirst({ where: { username } })`, `username` global | `api/src/routes/auth.ts:15` |
| Respuesta de login | `{ token, user }` en el body JSON | `api/src/routes/auth.ts:19-20` |
| Verificación JWT | `request.jwtVerify()` lee `Authorization: Bearer` | `api/src/server.ts:34-42` |
| SPA — guarda token | `localStorage.setItem('intake_token', ...)` | `spa/src/auth/AuthContext.tsx:31-33` |
| SPA — envía token | `headers.authorization = 'Bearer ' + token` | `spa/src/api/client.ts:17-18` |
| Modelo | `PanelUser` con `@@unique([tenantId, username])`, sin `email` | `prisma/schema.prisma:25-36` |

Problemas: el token es legible desde JS (riesgo XSS → robo de sesión), el
`username` es global (colisiones con self-service) y no hay rate-limit ni
recuperación de contraseña.

### 1.1 JWT en cookie `HttpOnly` + protección CSRF

**Propuesta:** dejar de devolver el token en el body. En su lugar, `/auth/login`
fija una cookie de sesión y un token CSRF.

- Cookie de sesión: `intake_session`, atributos `HttpOnly`, `Secure`,
  `SameSite=None` (la SPA en Netlify y la API en otro dominio son cross-site;
  `None` + `Secure` es obligatorio para que el navegador la envíe), `Path=/`,
  `Max-Age` alineado al `exp` del JWT. Contiene el JWT firmado.
- Token CSRF: patrón **double-submit cookie**. Se emite una cookie legible
  `intake_csrf` (NO `HttpOnly`) con un valor aleatorio; el cliente lo refleja en
  el header `x-csrf-token` en toda petición mutadora (POST/PUT/PATCH/DELETE). El
  server compara cookie vs header. `SameSite=None` por sí solo no basta como
  única defensa cross-site, por eso el double-submit.

**Dependencias:** `@fastify/cookie`, `@fastify/csrf-protection` (o
implementación manual de double-submit, ~30 líneas).

**Cambios concretos:**

`api/src/server.ts`
- Registrar `@fastify/cookie`.
- En `@fastify/cors` (`server.ts:26-30`), `credentials: true` deja de ser
  condicional al origin: con cookies cross-site **siempre** se requiere
  `credentials: true` y un `origin` concreto (no `*`). Reforzar la validación de
  `CORS_ORIGIN` en `env.ts` para que falle si es `*` en producción (ver §2.4).
- En el decorator `authenticate` (`server.ts:34-42`): hoy `request.jwtVerify()`
  lee el header. Cambiar a leer el JWT desde la cookie. `@fastify/jwt` soporta
  `cookie: { cookieName: 'intake_session', signed: false }` en el registro, así
  `jwtVerify()` toma el token de la cookie sin más cambios en las rutas.
- Hook global `preHandler` (o plugin) que valida el token CSRF en métodos
  mutadores, exceptuando `/auth/login` y `/health`.

`api/src/routes/auth.ts`
- En vez de `return { token, user }`, hacer
  `reply.setCookie('intake_session', token, { httpOnly: true, secure: true, sameSite: 'none', path: '/', maxAge: ... })`,
  emitir `intake_csrf` y devolver solo `{ user }`.
- Añadir `POST /auth/logout` que limpia ambas cookies (`reply.clearCookie`).
- Añadir `GET /auth/me` que, con la cookie válida, devuelve el `user` actual
  (la SPA ya no puede leer el token, necesita un endpoint para rehidratar sesión
  al recargar).

`spa/src/api/client.ts`
- En `request()` (`client.ts:12-25`): añadir `credentials: 'include'` al `fetch`
  para que el navegador envíe/reciba cookies cross-site.
- Eliminar `getToken()` y el header `authorization` (`client.ts:10`, `17-18`).
- Leer la cookie `intake_csrf` (legible) y añadir `x-csrf-token` en métodos
  mutadores.
- Añadir `api.logout()` (`POST /auth/logout`) y `api.me()` (`GET /auth/me`).

`spa/src/auth/AuthContext.tsx`
- Quitar todo uso de `localStorage` para token/usuario (`AuthContext.tsx:20`,
  `26-27`, `31-33`). El token ya no es accesible desde JS — ese es el objetivo.
- `login()` llama a `api.login()` y luego a `api.me()` (o usa el `user` que
  devuelve login) para poblar el estado en memoria.
- Al montar (`useEffect`), llamar `api.me()` para rehidratar la sesión desde la
  cookie; si responde 401, queda deslogueado.
- `logout()` llama `api.logout()` y limpia el estado en memoria.

**Archivos afectados:** `api/src/server.ts`, `api/src/routes/auth.ts`,
`api/src/env.ts`, `spa/src/api/client.ts`, `spa/src/auth/AuthContext.tsx`,
nuevos tests en `api/tests/`.

### 1.2 Identidad de login por email global único *(recomendado, pendiente de confirmar)*

**Decisión recomendada:** la identidad de login es el **email**, único a nivel
global (no por tenant). Encaja mejor con signup self-service (Fase 4) y con la
recuperación de contraseña por email (§1.3). Reemplaza la búsqueda actual por
`username`.

**Cambios concretos:**

`prisma/schema.prisma` (`model PanelUser`, líneas 25-36)
- Añadir `email String @unique` (único global).
- Mantener `username` como display name opcional, o eliminarlo. La constraint
  `@@unique([tenantId, username])` (`schema.prisma:35`) deja de ser la clave de
  login; conservarla solo si `username` sigue existiendo como display.
- Migración Prisma: poblar `email` para los usuarios existentes (los 2 tenants
  del piloto) antes de aplicar `NOT NULL`/`@unique`.

`api/src/routes/auth.ts`
- `LoginZ` (`auth.ts:6`): `{ email: z.string().email(), password: z.string().min(1) }`.
- Reemplazar `prisma.panelUser.findFirst({ where: { username } })` (`auth.ts:15`)
  por `prisma.panelUser.findUnique({ where: { email } })`. Esto es **determinista**
  y resuelve la brecha #2: un email → exactamente un usuario → un tenant. El JWT
  sigue llevando `{ userId, tenantId, role }`.

`spa/src/api/client.ts` y `spa/src/auth/AuthContext.tsx`
- `api.login(email, password)` y la pantalla de login pasan a pedir email.

> **Nota:** si el negocio prefiere `tenantSlug + username`, la alternativa es
> `findUnique({ where: { tenantId_username: { tenantId, username } } })` con el
> slug resuelto en el formulario. Esto complica el login (el usuario debe conocer
> su slug) y la recuperación de contraseña. Por eso se recomienda email.

### 1.3 Recuperación y cambio de contraseña

**Recuperación (olvidé mi contraseña):**
- Nuevo modelo `PasswordResetToken` en `prisma/schema.prisma`:
  `{ id, userId, tokenHash, expiresAt, usedAt }`. Se guarda el **hash** del
  token (no el token en claro), `expiresAt` ~30–60 min, **un solo uso**
  (`usedAt`).
- `POST /auth/forgot-password` `{ email }`: si existe el usuario, genera token
  aleatorio, guarda su hash, envía email con enlace
  `https://<spa>/reset?token=...`. **Respuesta siempre 200** (no revelar si el
  email existe — anti enumeración).
- `POST /auth/reset-password` `{ token, newPassword }`: valida hash, no expirado,
  no usado; aplica política (§1.5); actualiza `passwordHash` con bcrypt; marca
  `usedAt`; **invalida sesiones activas** del usuario (ver nota de invalidación).
- Email: en Fase 1 puede ser un stub/log o un proveedor mínimo (Resend/Postmark);
  el proveedor formal es Fase 6. Documentar el `Notification` o un servicio de
  email como pendiente.

**Cambio de contraseña desde el panel:**
- `POST /auth/change-password` `{ currentPassword, newPassword }` (autenticado):
  verifica `currentPassword` con bcrypt, aplica política, actualiza el hash.
- UI en la SPA (sección de perfil/configuración).

> **Invalidación de sesiones:** como el JWT es stateless, "invalidar sesiones"
> requiere o bien rotar un `tokenVersion`/`passwordChangedAt` en `PanelUser` que
> el decorator `authenticate` compara contra el `iat` del JWT, o reducir la vida
> del token. Recomendado: añadir `passwordChangedAt` a `PanelUser` y rechazar
> JWT emitidos antes de ese instante en `server.ts` (`authenticate`).

### 1.4 Rate-limit en `/auth/login` (anti fuerza bruta)

- Rate-limit específico en `/auth/login` (más estricto que el global de §2.1):
  p.ej. **5 intentos / 15 min por IP** y, si se quiere, por email.
  `@fastify/rate-limit` permite override por ruta con `config.rateLimit`.
- Respuesta `429` con `Retry-After`. Logs de intentos fallidos **sin** loguear
  la contraseña (ver §2.5).

### 1.5 Política mínima de contraseñas

- Mínimo 10 caracteres (configurable), no en una blacklist corta de comunes.
- Aplicada en un único validador zod reutilizado por `reset-password`,
  `change-password` y (Fase 4) `signup`.
- bcrypt ya se usa (`auth.ts:3,17`); mantener cost factor >= 10.

**Archivos afectados (§1.3–1.5):** `prisma/schema.prisma` (modelos
`PasswordResetToken`, campos `email`/`passwordChangedAt`), `api/src/routes/auth.ts`,
`api/src/server.ts` (registro de rate-limit y CSRF), un nuevo
`api/src/lib/password-policy.ts`, tests en `api/tests/`.

---

## 2. Endurecimiento de la API

### 2.1 Rate limiting global (`@fastify/rate-limit`)

- Registrar `@fastify/rate-limit` en `api/src/server.ts` con un límite global por
  IP (p.ej. 100 req/min) y el override estricto en `/auth/login` (§1.4).
- Store en memoria es suficiente para un solo proceso API; documentar que con
  réplicas hará falta Redis (deuda técnica).

### 2.2 Headers de seguridad (`@fastify/helmet`)

- Registrar `@fastify/helmet` en `server.ts`. Como la API sirve **solo JSON**
  (no HTML), CSP puede ser restrictiva; activar `hsts`, `noSniff`,
  `frameguard`, etc. Verificar que no rompa el preflight CORS existente.

### 2.3 Límite de tamaño de payload

- Fastify acepta `bodyLimit` global en la construcción (`Fastify({ bodyLimit })`
  en `server.ts:19`). Fijar un límite razonable (p.ej. 256 KB) para los
  endpoints JSON. Los endpoints que reciben media van por el worker, no por la
  API, así que la API no necesita payloads grandes.

### 2.4 Revisión de CORS

- Hoy `CORS_ORIGIN` cae a `'*'` por default (`api/src/env.ts:9`) y
  `credentials` se desactiva cuando el origin es `*` (`server.ts:25`). Con cookies
  cross-site (§1.1) eso ya **no es válido**: hay que fijar un origin concreto y
  `credentials: true`.
- Cambio en `env.ts`: en producción (`NODE_ENV==='production'`) **fallar** si
  `CORS_ORIGIN` es `*` o no está definido. Permitir lista separada por comas para
  staging + prod.
- Existe `api/tests/cors.test.ts`; actualizarlo para el nuevo contrato
  (credentials + origin concreto).

### 2.5 Manejo de secretos

- Auditar que `OPENROUTER_API_KEY`, `INTERNAL_API_TOKEN`, `JWT_SECRET` y
  `POSTGRES_PASSWORD` se leen **solo** por env (`requireEnv`, `env.ts:1-5`) y
  nunca aparecen en logs. Revisar logs de `connection.ts` (no loguea secretos) y
  añadir una regla: el logger nunca serializa `headers.authorization` ni el body
  de `/auth/*`.

### 2.6 Test de aislamiento entre tenants

**El test que da confianza para vender.** Crear `api/tests/tenant-isolation.test.ts`:

- Sembrar 2 tenants (A y B) con sus `PanelUser` y datos (jobs, contacts).
- Loguearse como usuario de A (obtiene cookie de sesión de A).
- Intentar leer/mutar recursos de B por id directo:
  `GET /jobs/:idDeB`, `GET /contacts/:idDeB`, `PATCH /jobs/:idDeB/intake`, etc.
- **Esperado:** lista vacía donde aplique, y `403`/`404` (nunca datos de B) en
  acceso por id.
- Auditar de paso que **todas** las queries de `routes/*` filtran por
  `request.tenantId` (poblado en `server.ts:37`). Cualquier ruta que reciba un
  id sin re-filtrar por tenant es un bug y se corrige aquí.

**Archivos afectados (§2):** `api/src/server.ts`, `api/src/env.ts`,
`api/tests/cors.test.ts`, nuevo `api/tests/tenant-isolation.test.ts`,
`api/package.json` (dependencias `@fastify/rate-limit`, `@fastify/helmet`,
`@fastify/cookie`).

---

## 3. Confiabilidad de WhatsApp (Baileys)

### 3.0 Estado actual (verificado en código)

`src/adapters/whatsapp/connection.ts` (`BaileysConnection`):
- Reconecta con un **delay fijo de 3000 ms** (`connection.ts:129-134`).
- Distingue `loggedOut` (`DisconnectReason.loggedOut` → estado `logged_out`, no
  reintenta) de caída temporal (`else` → `disconnected` + reintento)
  (`connection.ts:122-136`). Esta distinción **ya existe**; falta robustecerla.
- Expone `state()` (`connection.ts:57-65`) con `status`, `lastError`,
  `lastConnectedAt`, que el endpoint interno (`src/internal/server.ts:50`)
  publica a la API.
- Hay un `WhatsAppNotifier` (`notifyOwnerReady`) y config
  `owner.notifyOnDisconnect` (`spa/src/api/client.ts:88-92`), pero **no** se
  dispara una alerta cuando el bot queda desconectado > N minutos.

### 3.1 Reconexión con backoff exponencial

- Reemplazar el `setTimeout(..., 3000)` fijo (`connection.ts:129`) por backoff
  exponencial con jitter: p.ej. `min(30s, 1s * 2^intento) ± jitter`, con tope de
  reintentos antes de pasar a un estado degradado.
- Resetear el contador de intentos cuando `connection === 'open'`
  (`connection.ts:109-116`).
- Mantener el guard `this.reconnecting`/`this.stopped` (`connection.ts:126-127`)
  para no solapar reintentos.

### 3.2 Distinguir `loggedOut` vs caída temporal (robustecer)

- `loggedOut` (`connection.ts:122`): sesión inválida → requiere re-vinculación
  por QR. **No** reintentar; emitir alerta accionable distinta (necesita acción
  humana: re-escanear QR).
- Otros códigos (`restartRequired`, `connectionLost`, `timedOut`, `503`):
  transitorios → reintentar con backoff (§3.1).
- Registrar el `code` y `reason` (ya se hace, `connection.ts:118-121`) para
  alimentar la alerta.

### 3.3 Alerta al dueño/operador por bot desconectado

- Nuevo: si el estado permanece `disconnected`/`logged_out` durante > N minutos
  (configurable, p.ej. 5), disparar una notificación:
  - Al **dueño** del negocio vía `WhatsAppNotifier` solo si el canal sigue vivo
    (si el bot está caído, WhatsApp no es fiable como canal de alerta → usar un
    fallback).
  - Al **operador** del SaaS: persistir en el modelo `Notification`
    (`prisma/schema.prisma`) y/o un webhook/email. La alerta al operador es la
    que importa cuando el propio WhatsApp está caído.
- Respeta `owner.notifyOnDisconnect` (`client.ts:90`).
- Implementación: un watcher en el worker que observa transiciones de `state()`
  y arma un timer; al recuperar `connected`, cancela la alerta pendiente.

### 3.4 Manejo de límites de OpenRouter (429 / saldo agotado)

`src/agent/sdk-factory.ts` envuelve `@openrouter/sdk`. Hoy no hay manejo
específico de 429 ni de saldo.

- Capturar errores del LLM y clasificar: `429` (rate limit → reintento con
  backoff acotado), `402`/insufficient credits (saldo agotado → **no** reintentar)
  y errores transitorios de red.
- **Degradación clara, sin perder mensajes:** ante saldo agotado o 429
  persistente, responder al cliente final con un mensaje neutral ("estamos
  procesando, te respondemos enseguida") en lugar de fallar en silencio, y
  **encolar/marcar** el turno para reintento (no descartar el mensaje entrante).
- **Notificar al dueño y al operador** (saldo agotado es accionable: recargar).
  Reutilizar el canal de §3.3.
- Respetar `limits.monthlyCostUsd` / `alertOnCostUsd` /
  `maxConsecutiveErrors` (`client.ts:93-96`) como umbrales de alerta proactiva
  antes de quedarse sin saldo.

**Archivos afectados (§3):** `src/adapters/whatsapp/connection.ts`,
`src/internal/server.ts` (si la alerta se expone/dispara desde el worker),
`src/agent/sdk-factory.ts`, `src/agent/tools.ts`/pipeline (degradación de turno),
`src/adapters/whatsapp/notifier.ts`, `prisma/schema.prisma` (`Notification`),
tests en `tests/adapters/whatsapp/`.

---

## 4. Backups probados (no solo configurados)

### 4.1 `pg_dump` + retención

- Cron en el host: `docker exec postgres pg_dump -U intake intake | gzip > backup-$(date +%F).sql.gz`
  (ya esbozado en el spec maestro §8.2 y en runbooks).
- Retención: conservar los últimos 7 diarios + 4 semanales. Script de limpieza.
- Almacenar **fuera del volumen de la DB** (idealmente off-host: bucket/objeto)
  para sobrevivir a la pérdida del VPS.

### 4.2 Restore drill documentado en staging

**La diferencia entre "tengo backups" y "puedo recuperarme".** Procedimiento
escrito y **ejecutado** al menos una vez:

1. Levantar una instancia Postgres limpia en staging.
2. `gunzip -c backup-YYYY-MM-DD.sql.gz | docker exec -i postgres-staging psql -U intake intake`.
3. Apuntar una API/worker de staging a esa DB restaurada.
4. Verificar: login funciona, jobs/contacts del tenant presentes, conteos
   coinciden con el día del backup.
5. Documentar tiempo de restore (RTO) y pérdida máxima tolerada (RPO = 24 h con
   backup diario) en un runbook (`docs/runbooks/restore-drill.md`).

### 4.3 Estado de sesiones de WhatsApp / media

- La sesión Baileys vive en volumen (`baileys-<tenant>`). Decidir explícitamente:
  **respaldar** ese volumen, o documentar el **flujo de re-vinculación** por QR
  como recuperación aceptada (más simple; una caída → re-escanear QR).
  Recomendado para Fase 1: documentar re-vinculación + respaldar media
  (`media-<tenant>`), que sí es irrecuperable.

**Archivos afectados (§4):** `docs/runbooks/` (script de backup, runbook de
restore drill), `docker-compose.yml`/cron del host.

---

## Criterios de aceptación

- [ ] El token de sesión nunca es accesible desde JS (cookie `HttpOnly`); la SPA
      no usa `localStorage` para auth.
- [ ] CSRF cubierto por un test (mutación sin `x-csrf-token` válido → rechazada).
- [ ] Login determinista por **email único global**; imposible colisión entre
      tenants (test).
- [ ] `GET /auth/me` rehidrata sesión desde cookie; `POST /auth/logout` limpia
      cookies.
- [ ] Recuperación de contraseña con token de un solo uso y expiración; cambio de
      contraseña desde el panel.
- [ ] Política mínima de contraseñas aplicada en reset y change.
- [ ] Rate-limit activo en `/auth/login` (429 tras N intentos) y rate-limit
      global en la API.
- [ ] `@fastify/helmet` activo (headers de seguridad presentes en la respuesta).
- [ ] Límite de payload configurado; CORS con origin concreto + credentials
      (falla si `*` en producción).
- [ ] Test automatizado de aislamiento entre tenants: un usuario de A no puede
      leer ni mutar datos de B (vacío/403/404).
- [ ] Ningún secreto aparece en logs (auditado).
- [ ] Reconexión de Baileys con backoff exponencial + jitter; reintentos se
      resetean al reconectar.
- [ ] `loggedOut` no reintenta y genera alerta de re-vinculación; caída temporal
      reintenta sola.
- [ ] Un bot desconectado > N min genera alerta al operador (y al dueño si el
      canal está vivo).
- [ ] 429/saldo agotado de OpenRouter: degradación con mensaje claro al cliente
      final, sin perder el mensaje entrante, + alerta al dueño/operador.
- [ ] `pg_dump` diario con retención corriendo.
- [ ] **Restore drill ejecutado con éxito en staging y documentado** (runbook con
      RTO/RPO).
- [ ] Política de sesión WhatsApp/media definida (respaldo o re-vinculación
      documentada).

---

## Decisiones abiertas / pendientes de confirmar

1. **Identidad de login** *(recomendado: email global único — PENDIENTE DE
   CONFIRMAR)*. Alternativa: `tenantSlug + username`. La recomendación es email
   porque encaja con signup self-service (Fase 4) y recuperación de contraseña.
   Toda la §1.2 asume email; confirmar antes de migrar el schema.
2. **`SameSite` de la cookie de sesión.** Recomendado `None` + `Secure` porque
   SPA (Netlify) y API están en dominios distintos (cross-site). Si se decide
   servir la SPA bajo el mismo dominio que la API (subdominio + proxy), se podría
   usar `Lax` (más seguro por defecto). Afecta CORS y CSRF.
3. **Proveedor de email** para recuperación de contraseña. En Fase 1 puede ser un
   stub/log; el proveedor formal (Resend/Postmark/SES) se decide en Fase 6.
   Confirmar si se adelanta a Fase 1.
4. **Invalidación de sesiones** tras cambio de contraseña: ¿`passwordChangedAt`
   en `PanelUser` comparado contra `iat` del JWT (recomendado), o vida corta del
   token? Confirmar la estrategia.
5. **Umbral N de alerta de bot desconectado** (recomendado: 5 min) y canal de la
   alerta al operador (Notification persistida / email / webhook).
6. **Backup off-host:** ¿se respaldan los dumps fuera del VPS desde Fase 1
   (recomendado) o se difiere a Fase 5 (observabilidad/ops)?
7. **Política de sesión Baileys:** ¿respaldar el volumen de sesión o aceptar
   re-vinculación por QR como recuperación (recomendado para Fase 1)?

---

## Deuda técnica que esta fase deja registrada

- **Rate-limit en memoria**: con réplicas de la API hará falta un store
  compartido (Redis). Aceptable mientras la API sea un solo proceso.
- **Email transaccional**: si en Fase 1 queda como stub, formalizar proveedor en
  Fase 6.
- **`wa-status` aún apunta a un worker fijo** (`WORKER_INTERNAL_URL` único): es
  brecha #3 del roadmap y se resuelve en Fase 2 (ruteo por tenant), no aquí. Las
  alertas de §3 deben diseñarse para no asumir un único worker.
- **`username`**: si se conserva como display name, su `@@unique([tenantId,
  username])` deja de ser la clave de login pero sigue vigente como restricción
  de unicidad de display por tenant.
