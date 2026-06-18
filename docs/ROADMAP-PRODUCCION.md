# Roadmap a producción — Intake SaaS

**Fecha:** 2026-06-18
**Estado:** Propuesta para aprobación
**Objetivo:** Llevar Intake de "MVP desplegable" a **producto vendible** (SaaS
multi-tenant, self-service, con cobro recurrente) sin romper lo que ya funciona.

## Decisiones de negocio que guían este roadmap

| Decisión | Elección | Consecuencia en el plan |
| --- | --- | --- |
| **Monetización** | Suscripción mensual fija (Stripe) | Stripe Checkout + webhooks de estado de suscripción. Sin medición de uso para cobrar (el `CostEntry` queda como control interno, no como base de factura). |
| **Onboarding** | **Self-service completo** | Signup público → pago → aprovisionamiento automático del bot. Esto **obliga** a resolver el aprovisionamiento dinámico de workers (hoy manual en `docker-compose.yml`). Es el mayor esfuerzo de ingeniería del roadmap. |
| **Prioridad #1** | **Seguridad y confiabilidad** | El hardening (Fase 1) va **antes** que billing y signup. Vendemos con confianza primero. |

---

## 0. Línea base — qué ya está hecho

Esto **no** hay que rehacerlo; es el punto de partida real (verificado en el código):

- ✅ Schema PostgreSQL multi-tenant con `tenantId` en todas las tablas (`prisma/schema.prisma`).
- ✅ Worker dockerizado que lee `TENANT_ID` por env y escribe a Postgres aislado por tenant.
- ✅ Endpoint interno protegido con `INTERNAL_API_TOKEN` (`src/internal/server.ts`).
- ✅ API central Fastify + JWT con rutas `jobs`, `contacts`, `usage`, `settings`,
  `profile`, `wa-status` y batería de tests (`api/tests/`).
- ✅ SPA React + Vite con login, dashboard, detalle de job, contactos, uso,
  configuración y página de WhatsApp, con tests (`spa/src/`).
- ✅ Configuración del negocio editable desde el panel (`api/src/routes/settings.ts`).
- ✅ Docker Compose (postgres + api + 1 worker) y runbooks de despliegue
  (`docs/runbooks/`).

### Brechas conocidas que bloquean la venta (verificadas en código)

1. **Auth en `localStorage`** — el token viaja en el body de `/auth/login`
   (`api/src/routes/auth.ts:20`) y la SPA lo guarda en `localStorage`. Riesgo XSS.
2. **Login sin tenant** — `prisma.panelUser.findFirst({ where: { username } })`
   (`api/src/routes/auth.ts:15`): el `username` es global. Con self-service esto
   produce colisiones de usuario y es inseguro.
3. **La API cablea UN solo worker** — `WORKER_INTERNAL_URL: http://worker-tapiceria:3002`
   (`docker-compose.yml:44`, `api/src/routes/wa-status.ts:8`). No hay ruteo por
   tenant: con N tenants, `wa-status` apunta siempre al mismo worker.
4. **Un worker por tenant editado a mano** — agregar un tenant hoy = editar
   `docker-compose.yml` + `.env` + reiniciar. Incompatible con self-service.
5. **Sin billing** — no hay tablas `Subscription`/`Plan` ni integración de pagos.
6. **Sin signup** — el alta de tenant/usuario es manual (`api:create-user`).
7. **Sin CI/CD** — no hay workflows en `.github/` (build/test/deploy son manuales).
8. **Sin observabilidad** — no hay métricas, alertas, ni rastreo de errores.
9. **Sin capa legal** — falta ToS, política de privacidad y manejo de datos
   (obligatorio para cobrar y para datos de WhatsApp de terceros).

---

## 1. Estrategia de fases

Siete fases. Cada una deja el producto en un estado **más vendible** que la
anterior y es desplegable de forma independiente. El orden respeta la prioridad
elegida (seguridad primero) y las dependencias técnicas (multi-tenancy real
antes de self-service).

```
Fase 1  Hardening de seguridad y confiabilidad   ◄── PRIORIDAD #1
Fase 2  Multi-tenancy real (ruteo + provisioning) ◄── habilitador del self-service
Fase 3  Billing (Stripe, suscripción fija)
Fase 4  Onboarding self-service
Fase 5  Observabilidad y operaciones
Fase 6  Legal, cumplimiento y go-to-market
Fase 7  Beta cerrada → Lanzamiento
```

> Estimaciones en "semanas-persona" (1 dev full-time). Ajustar a tu capacidad
> real. Las fases 1, 5 y 6 pueden solaparse parcialmente con 2–4.

---

## Fase 1 — Hardening de seguridad y confiabilidad  *(prioridad #1)*

**Objetivo:** que un cliente pueda confiar sus datos y los de sus clientes
finales al producto. Cierra las brechas 1, 2 y endurece la operación.

**Esfuerzo estimado:** 2–3 semanas.

### 1.1 Autenticación robusta
- Migrar JWT de `localStorage` a **cookie `HttpOnly` + `Secure` + `SameSite`** y
  agregar protección **CSRF** (token por sesión). Tocar `api/src/routes/auth.ts`,
  middleware `authenticate`, y `spa/src/auth/AuthContext.tsx` + `api/client.ts`.
- **Login con `tenantSlug`** (o email único global): cambiar el `findFirst` por
  una búsqueda determinista por `(tenantSlug, username)` o por email único.
  Decisión recomendada: **email como identidad global única** (encaja mejor con
  signup self-service y recuperación de contraseña).
- **Recuperación de contraseña** (email con token de un solo uso) y cambio de
  contraseña desde el panel.
- Política de contraseñas mínima y rate-limit en `/auth/login` (anti fuerza bruta).

### 1.2 Endurecimiento de la API
- **Rate limiting** global y por IP (`@fastify/rate-limit`).
- **Helmet / headers de seguridad** (`@fastify/helmet`).
- Validar y limitar tamaño de payloads; revisar CORS (ya existe `cors.test.ts`).
- Auditar que **todas** las queries filtran por `tenantId` del JWT (test de
  aislamiento que intente leer datos de otro tenant y espere 403/empty).
- Revisar manejo de secretos: nada de claves en logs; `OPENROUTER_API_KEY` y
  `INTERNAL_API_TOKEN` solo por env.

### 1.3 Confiabilidad de WhatsApp (Baileys)
- **Resiliencia de sesión**: reconexión automática con backoff, detección de
  `loggedOut` vs caída temporal, y alerta al dueño (y al operador) cuando un bot
  queda desconectado > N minutos.
- Persistencia de sesión Baileys ya está en volumen; **respaldar también** ese
  estado o documentar el flujo de re-vinculación.
- Manejo de límites de OpenRouter (saldo agotado / 429): degradar con mensaje
  claro al cliente final y notificar al dueño, sin perder mensajes.

### 1.4 Backups probados (no solo configurados)
- Script `pg_dump` diario con retención (ya esbozado en runbooks) **+ un
  restore drill documentado** en staging (la diferencia entre "tengo backups" y
  "puedo recuperarme").
- Backup del estado de sesiones de WhatsApp / media, o política explícita de
  re-vinculación.

### Criterios de aceptación
- [ ] Token nunca accesible desde JS (cookie `HttpOnly`); CSRF cubierto por test.
- [ ] Identidad de login única y a prueba de colisiones entre tenants.
- [ ] Rate-limit activo en login y API; headers de seguridad presentes.
- [ ] Test automatizado que prueba el aislamiento entre tenants.
- [ ] Un bot desconectado genera alerta; reconecta solo cuando es posible.
- [ ] Restore de Postgres ejecutado con éxito en staging y documentado.

---

## Fase 2 — Multi-tenancy real: ruteo + aprovisionamiento  *(habilitador)*

**Objetivo:** que agregar un tenant **no requiera tocar `docker-compose.yml`,
`.env` ni reiniciar**. Es el prerequisito técnico del self-service. Cierra las
brechas 3 y 4.

**Esfuerzo estimado:** 3–5 semanas (la pieza más pesada del roadmap).

### Decisión de arquitectura (requiere tu aprobación)
Hay dos caminos para soportar N tenants dinámicos:

- **Enfoque A — Worker multi-tenant (`TenantManager`)** *(recomendado)*: un
  solo proceso worker mantiene N conexiones Baileys, una por tenant, creadas/
  destruidas en caliente al alta/baja. La API rutea `wa-status` por `tenantId`
  hacia el `TenantManager` (un solo endpoint interno, no uno por worker).
  - ✔ Self-service trivial: alta de tenant = crear conexión en memoria, no un
    contenedor. ✔ Menos infra. ✔ Ya previsto como destino en el spec maestro.
  - ✗ Aislamiento de fallos más débil (un crash afecta a varios). Mitigable con
    supervisión por-tenant y reinicio aislado de la conexión.
- **Enfoque B — Un contenedor worker por tenant, orquestado por código**: la API
  lanza/para contenedores vía Docker API o un orquestador. Mejor aislamiento,
  mucha más complejidad operativa (no recomendado para este tamaño).

> **Recomendación:** Enfoque A. El resto de esta fase lo asume.

### Tareas (Enfoque A)
- Implementar `TenantManager`: registro de conexiones Baileys por `tenantId`,
  arranque al boot (todos los tenants activos), y API en memoria para
  `addTenant` / `removeTenant` / `getStatus(tenantId)`.
- Refactor de `src/index.ts` para no asumir un único `TENANT_ID`; cargar la
  lista de tenants activos desde Postgres.
- **Ruteo dinámico en la API**: `wa-status` (y logout/reconnect) reciben el
  `tenantId` del JWT y se lo pasan al endpoint interno, que despacha a la
  conexión correcta. Eliminar la suposición de `WORKER_INTERNAL_URL` único.
- Config por tenant fuera de `profileDir` JSON estático → **tabla
  `TenantSettings`** editable por UI (cierra deuda técnica #3/#4 del spec). El
  `TenantManager` carga la config del tenant desde la tabla.
- Carga de perfiles de intake por industria seleccionable (tapicería,
  paquetería, genérico) como plantillas al alta.

### Criterios de aceptación
- [ ] Alta de un tenant nuevo desde código/API crea su conexión sin reiniciar
      el proceso ni tocar archivos.
- [ ] `wa-status` devuelve el estado **del tenant del usuario**, no de uno fijo.
- [ ] Dos tenants con bots simultáneos, mensajes aislados, verificado en staging.
- [ ] Config del bot editable por tenant desde el panel (sin tocar JSON en disco).

---

## Fase 3 — Billing: Stripe, suscripción mensual fija

**Objetivo:** cobrar de forma recurrente y que el acceso dependa del estado de
la suscripción. Cierra la brecha 5.

**Esfuerzo estimado:** 1.5–2.5 semanas.

### Tareas
- Modelo de datos: `Plan` (precio, intervalo, límites) y `Subscription`
  (`tenantId`, `stripeCustomerId`, `stripeSubscriptionId`, `status`,
  `currentPeriodEnd`). Migración Prisma.
- **Stripe Checkout** para alta de suscripción y **Customer Portal** para que el
  cliente gestione método de pago / cancele.
- **Webhooks de Stripe** (`checkout.session.completed`,
  `customer.subscription.updated/deleted`, `invoice.payment_failed`) que
  actualizan `Subscription.status`. Endpoint verificado por firma.
- **Enforcement**: middleware que bloquea el panel/bot cuando la suscripción no
  está `active`/`trialing` (con periodo de gracia y aviso). Estados: trial →
  active → past_due → canceled.
- Pantalla de facturación en la SPA (estado del plan, enlace al portal).
- Manejo de impuestos/moneda según mercado objetivo (Stripe Tax si aplica).

### Criterios de aceptación
- [ ] Un cliente puede suscribirse con tarjeta real (modo test) y queda `active`.
- [ ] Falla de pago → `past_due` → tras gracia, el bot deja de operar y se avisa.
- [ ] Cancelación desde el portal refleja `canceled` y corta acceso al fin del
      periodo.
- [ ] Webhooks idempotentes y verificados por firma (test de webhook).

---

## Fase 4 — Onboarding self-service

**Objetivo:** un negocio se registra, paga y tiene su bot funcionando **sin
intervención manual**. Cierra la brecha 6. Depende de Fases 1–3.

**Esfuerzo estimado:** 2–3 semanas.

### Flujo objetivo
1. **Signup** (email + contraseña + nombre del negocio + industria) → crea
   `Tenant` + `PanelUser` (admin) en una transacción, con validación.
2. **Suscripción** (Fase 3): Checkout antes de activar el bot (o trial sin
   tarjeta, decisión de negocio — ver abajo).
3. **Aprovisionamiento automático**: al activarse, el `TenantManager` (Fase 2)
   crea la conexión del tenant y la SPA muestra el **QR de WhatsApp** para
   vincular.
4. **Asistente de configuración** guiado: nombre/giro, mensaje de bienvenida,
   datos del negocio, schema de intake de su industria (plantilla precargada).
5. **Primer mensaje de prueba** y checklist de "listo para operar".

### Decisión de negocio pendiente
- ¿**Trial gratuito** (X días sin tarjeta) o **tarjeta requerida** desde el
  signup? Afecta el orden de los pasos 1–2. Recomendación: trial corto con
  tarjeta requerida (menos fraude, mejor conversión a pago).

### Tareas
- `POST /auth/signup` con validación, anti-abuso (rate-limit, verificación de
  email) y creación transaccional de tenant+admin.
- Verificación de email (token).
- Wizard de onboarding en la SPA (multi-paso, reanudable).
- Integración signup ↔ Stripe ↔ `TenantManager` (provisioning end-to-end).

### Criterios de aceptación
- [ ] Un usuario nuevo, sin que el operador toque nada, llega de signup a "bot
      vinculado y respondiendo" en staging.
- [ ] Email verificado obligatorio antes de operar.
- [ ] El flujo es reanudable si el usuario abandona a medias.

---

## Fase 5 — Observabilidad y operaciones

**Objetivo:** poder operar el SaaS con varios clientes sin volar a ciegas.
Cierra las brechas 7 y 8. Puede correr en paralelo desde la Fase 1.

**Esfuerzo estimado:** 1.5–2 semanas.

### Tareas
- **CI/CD** (`.github/workflows/`): en cada PR, `npm test` (raíz + `api/` + `spa/`)
  + `npm run typecheck` + build de imágenes. Deploy a staging en merge a main;
  deploy a prod manual/aprobado.
- **Rastreo de errores** (Sentry o equivalente) en API, worker y SPA.
- **Métricas y health**: `/health` ya existe; agregar métricas básicas (mensajes/
  min, errores LLM, bots conectados) y un **uptime monitor** externo con alerta.
- **Alertas operativas**: bot caído, pago fallido, error rate alto, saldo
  OpenRouter bajo, disco/DB.
- **Logs estructurados** (pino ya está) centralizados y con `tenantId`.
- **Panel de operador/admin** interno: ver tenants, estado de bots y
  suscripciones, suspender/reactivar (soporte).

### Criterios de aceptación
- [ ] PR no mergeable si fallan tests o typecheck.
- [ ] Un error en producción aparece en el rastreador con `tenantId`.
- [ ] Una caída de bot dispara alerta al operador en < 5 min.

---

## Fase 6 — Legal, cumplimiento y go-to-market

**Objetivo:** poder cobrar legalmente y vender. Cierra la brecha 9.

**Esfuerzo estimado:** 1–2 semanas (parte legal puede requerir asesoría externa).

### Tareas
- **Términos de Servicio** y **Política de Privacidad** (manejo de datos de
  WhatsApp de terceros — los clientes finales del negocio). Aceptación
  registrada en el signup.
- **Cumplimiento de datos**: política de retención, exportación y borrado de
  datos por tenant (derecho de acceso/borrado). Endpoint de export/delete.
- **Política de uso de WhatsApp**: dejar claro el modelo Baileys (no API oficial)
  y sus riesgos/términos al cliente, para gestionar expectativas y
  responsabilidad.
- **Landing page** con propuesta de valor, precios y CTA a signup.
- **Documentación de cliente**: guía de inicio, FAQ, soporte (email/WhatsApp).
- Email transaccional (verificación, recuperación, avisos de pago) con un
  proveedor (Postmark/Resend/SES).

### Criterios de aceptación
- [ ] ToS + Privacidad publicados y aceptados en signup.
- [ ] Un tenant puede exportar y solicitar borrado de sus datos.
- [ ] Landing con precios y signup en vivo.

---

## Fase 7 — Beta cerrada → Lanzamiento

**Objetivo:** validar con clientes reales antes de abrir el grifo.

**Esfuerzo estimado:** 2–4 semanas de operación (no de código).

### Tareas
- **Beta cerrada** con los 2 tenants iniciales del spec (tapicería + paquetería)
  ya bajo el flujo self-service real (no manual).
- Recoger fricción de onboarding, fallos de bot, dudas de cobro; iterar.
- **Runbook de soporte e incidentes** (qué hacer si un bot cae, si un pago
  falla, si OpenRouter se queda sin saldo).
- Revisión de costos unitarios (OpenRouter por tenant) vs precio del plan →
  confirmar márgenes.
- **Go/No-Go** contra el checklist de lanzamiento.

### Checklist de lanzamiento (Go/No-Go)
- [ ] Fases 1–6 con criterios de aceptación cumplidos.
- [ ] Backups con restore probado.
- [ ] Monitoreo y alertas activos.
- [ ] Cobro real funcionando (un pago de verdad cobrado y conciliado).
- [ ] Self-service end-to-end probado por alguien externo al equipo.
- [ ] ToS/Privacidad publicados; soporte definido.
- [ ] Márgenes por tenant validados.

---

## Resumen de secuencia y dependencias

```
Fase 1 (seguridad) ──┐
                     ├─► Fase 4 (self-service) ──► Fase 7 (beta → launch)
Fase 2 (multi-tenant)┤        ▲
                     │        │
Fase 3 (billing) ────┘────────┘
Fase 5 (observabilidad)  ── en paralelo desde Fase 1 ──► requisito de launch
Fase 6 (legal/GTM)       ── en paralelo, cierra antes de Fase 7
```

**Ruta crítica:** 1 → 2 → 3 → 4 → 7. Las fases 5 y 6 corren en paralelo y son
requisitos del Go/No-Go.

**Estimación total (1 dev full-time, secuencial):** ~13–21 semanas de ingeniería
+ 2–4 de beta. Con paralelización (5 y 6 solapadas) y foco, una ventana realista
es **~3–4 meses** hasta lanzamiento.

---

## Decisiones abiertas que necesito de ti antes de ejecutar

1. **Enfoque 2** — ¿apruebas el `TenantManager` multi-tenant (Enfoque A) sobre
   un contenedor por tenant? (recomendado: sí).
2. **Identidad de login** — ¿email global único (recomendado) o
   `tenantSlug + username`?
3. **Trial** — ¿trial gratuito con/sin tarjeta, o tarjeta requerida desde el
   signup?
4. **Precio del plan** — define el monto y el intervalo para configurar el `Plan`
   en Stripe.
5. **Mercado/moneda/impuestos** — ¿país objetivo inicial? (afecta Stripe Tax y
   requisitos legales).

> Cuando confirmes 1–5, el siguiente paso es convertir **Fase 1** en un plan de
> implementación detallado (spec → plan → ejecución) y arrancar, ya que no
> depende de las decisiones de billing/onboarding.
