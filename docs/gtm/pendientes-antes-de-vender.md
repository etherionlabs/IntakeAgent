# Pendientes antes de vender

**Fecha:** 2026-08-06 · **Estado del producto:** Fases 1–6 implementadas con tests en
sandbox; Fase 7 (go-live) pendiente. Billing de Stripe **construido y dormante**.

> Complementa a [`plan-de-negocio.md`](plan-de-negocio.md) (por qué) y a
> [`estrategia-ventas-90-dias.md`](estrategia-ventas-90-dias.md) (cómo se vende).
> El detalle técnico de cada ítem vive en [`../HANDOFF.md`](../HANDOFF.md);
> aquí está ordenado por **qué bloquea qué venta**.

La pregunta que ordena la lista no es "¿está terminado?" sino **"¿qué es lo que me impide
cobrarle al siguiente cliente sin quedar mal?"**. Por eso va por compuertas: cada una es un
punto donde vender más sin haberla cerrado empieza a hacer daño.

**Leyenda de esfuerzo:** ▪ horas · ▪▪ 1–3 días · ▪▪▪ 1–2 semanas.

---

## Compuerta 0 — Antes del primer peso cobrado *(esta semana)*

Lo mínimo para cobrarle a un cliente hoy, con operación manual y **sin escribir código**.

| # | Pendiente | Esfuerzo | Responsable |
| --- | --- | --- | --- |
| 0.1 | **Tenant `intake` en vivo**: perfil `profiles/intake/` aprobado, WhatsApp vinculado, 5 conversaciones probadas de punta a punta (una en inglés). Es el vendedor y la demo. | ▪▪ | Producto |
| 0.2 | **Stripe Payment Link × 3** (US$99 / US$69 / US$59, recurrente mensual) creados desde el dashboard. **No requiere la integración de Fase 3.** | ▪ | Dueño |
| 0.3 | **Procedimiento de alta escrito**: pago confirmado → aprobar en `/admin` → sesión de vinculación del QR. Cinco líneas, para no improvisar con el primer cliente. | ▪ | Operación |
| 0.4 | **Hoja de atribución de partners**: código, partner, **nivel** (referidor / comercial), cliente, mercado, fecha de alta, **fecha de día 90 y si el bono ya se pagó**, estado y recurrente del mes. Sustituye a `Tenant.partnerId` mientras no exista. La columna del día 90 es la que no se puede improvisar: un bono olvidado es un socio perdido. | ▪ | Dueño |
| 0.5 | **Decidir el trato del trial pagado**: hoy se anuncian 14 días de prueba y el cobro es un Payment Link manual → o se envía el link al día 14, o se cobra desde el día 1 con reembolso pactado. **Elegir una y escribirla.** | ▪ | Dueño |
| 0.6 | **Bajar el límite del plan gratuito** de 300 a ~100 respuestas/mes (`FREE_MONTHLY_RUN_LIMIT`). Con 300 el free tier cubre entero al ICP y no hay nada que vender. Antes de aplicarlo con el piloto en vivo, fijar `Tenant.monthlyRunLimit` en los tenants que ya operan. | ▪ | Dueño |
| 0.7 | **Escribir el procedimiento del día 15**: termina la prueba y no convirtió → qué mensaje sale, quién desvincula el WhatsApp, qué datos se conservan y cuánto. La primera cohorte llega a ese día toda junta. | ▪ | Operación |
| 0.8 | **Contar el estanque** (30 min de Google Maps): negocios alcanzables por vertical en las ciudades objetivo. Si tapicería + wrapping no llegan a ~300, mecánica entra en el mes 2. | ▪ | Ventas |

> ⚠️ **0.6 bloquea a toda la compuerta.** Vender un plan de pago mientras la versión
> gratuita cubre al cliente objetivo entero no es una desventaja competitiva: es no tener
> producto que vender. Y **sin 0.5 no se sale a vender** tampoco: si se improvisa, genera
> una disputa con el primer cliente.

> 📌 **Lo que esta compuerta NO puede hacer sola:** vender a volumen antes de cerrar la
> Compuerta 1. Con una persona haciendo ingeniería y venta, el ritmo realista de los dos
> primeros meses es de **1 a 3 clientes**, no de diez — ver el calendario en
> [`estrategia-ventas-90-dias.md`](estrategia-ventas-90-dias.md) §3.

---

## Compuerta 1 — Antes del cliente #1 en producción

Todo esto está implementado y probado en sandbox; lo que falta es **verificarlo contra
infraestructura real**. Un bot que se cae con el primer cliente cuesta más que los 90 días
de venta que lo consiguieron.

| # | Pendiente | Origen | Esfuerzo |
| --- | --- | --- | --- |
| 1.1 | **Levantar el stack real** (`docker compose` + `prisma migrate deploy` en staging y prod). | HANDOFF §2.1 | ▪▪ |
| 1.2 | **Cutover ordenado del piloto** siguiendo `runbooks/cutover-piloto-fases-1-6.md`. ⚠️ El piloto se auto-despliega desde `master` y el deploy **no corre el backfill de `TenantSettings`**: mergear sin el runbook rompe el piloto. | HANDOFF ⚠️ | ▪▪ |
| 1.3 | **Dos bots simultáneos verificados** con números reales y sesiones aisladas (`./data/baileys-session/<tenantId>`). Es la promesa multi-tenant; nunca se ha probado con dos números de verdad. | HANDOFF §2.3 | ▪▪ |
| 1.4 | **Restore drill real** en staging (no round-trip local). La diferencia entre "tengo backups" y "puedo recuperarme". | HANDOFF §2.2 | ▪▪ |
| 1.5 | **Email transaccional real**: `EMAIL_PROVIDER=resend`, dominio con SPF/DKIM/DMARC verificados. Sin esto la verificación de email del signup no llega y el onboarding se corta en el paso 1. | HANDOFF §2.7 | ▪▪ |
| 1.6 | **Alertas cableadas** al sink de `src/lib/alerts.ts` (email/Telegram) + **uptime monitor externo** sobre `/health`. Enterarte de que un bot cayó por el cliente es perder al cliente. | HANDOFF §2.6 | ▪▪ |
| 1.7 | **`SENTRY_DSN` reales** en api/worker/spa. | HANDOFF §2.6 | ▪ |
| 1.8 | **Landing publicada** (Netlify, `netlify.toml` ya existe) con precios reales y CTA a WhatsApp. | HANDOFF §2.7 | ▪▪ |
| 1.9 | **Canal y SLA de soporte definidos** — aunque sea "WhatsApp del dueño, respuesta en 24 h hábiles". Escrito, no implícito. | HANDOFF §2.7 | ▪ |

---

## Compuerta 2 — Antes del cliente #10

Lo que aguanta con 3 clientes y deja de aguantar con 10.

| # | Pendiente | Por qué aquí | Esfuerzo |
| --- | --- | --- | --- |
| 2.1 | **Revisión legal profesional** de ToS, Privacidad y DPA (borradores en `docs/legal/`, marcados `[LEGAL-EXT]`). Requiere cerrar antes la **decisión #6: jurisdicción**. | Se cobra dinero real y se procesan datos de terceros (los clientes del cliente). | ▪▪▪ + externo |
| 2.2 | **Ventana de retención definida** (propuesta: 12 meses + 30 días de gracia) y reflejada en la política de privacidad. | Es un dato que la política debe declarar, y hoy es un placeholder. | ▪ |
| 2.3 | **Branch protection en `master`** (`test-root`, `test-spa`, `docker-build`) + Environment `production` con revisores. | Con clientes en vivo, un merge malo es una caída. | ▪ |
| 2.4 | **Secretos de CI** (`GHCR_TOKEN`, `STAGING_SSH_KEY`, `PROD_SSH_KEY`, hosts, `DOMAIN`). | Sin esto el deploy sigue siendo manual. | ▪ |
| 2.5 | **Validar COGS reales** contra `CostEntry`/`AgentRun.costUsd` de los primeros clientes, y contrastarlos con la estimación de US$3–10/tenant del plan de negocio. | Es el supuesto del que cuelga todo el margen. Es el ítem de Fase 7 que nadie ha corrido. | ▪▪ |
| 2.6 | **Migrar la edición de `TenantSettings`**: `api/src/routes/settings.ts` todavía escribe a `config.json`/`profileDir` en vez de a la tabla que el worker consume. `businessFacts`/`promptVars` aún no están modelados ahí. | Con varios tenants, editar la configuración desde el panel se vuelve inconsistente. | ▪▪▪ |
| 2.7 | **Export como ZIP con URL firmada** (hoy es un bundle JSON). | Derecho de acceso del cliente; con 10 clientes empieza a pedirse. | ▪▪ |

---

## Compuerta 3 — Antes de activar el cobro automático (Stripe)

El billing está **construido, testeado y dormante**: `Plan`, `Subscription`, `StripeEvent`,
Checkout, Customer Portal, webhook firmado e idempotente, máquina de estados, enforcement
402 con suspensión y reanudación del bot, y pantalla de facturación en la SPA. Las dos cosas
que no cuadraban con el pricing anunciado ya están corregidas (3.A); lo que falta no es
programarlo, es **conectarlo a una cuenta real y verificarlo contra Stripe de verdad**.

### 3.A Los dos bloqueantes de código — ✅ **resueltos (2026-08-06)**

| # | Bloqueante | Cómo quedó |
| --- | --- | --- |
| **3.1** | **`/billing/checkout` solo soportaba UN plan activo** (`plan.findFirst({ active: true })`): con los tres precios de mercado habría cobrado uno arbitrario, probablemente el de otro país. | El plan se elige por el **mercado del tenant** (`Tenant.market`, capturado en el signup) y el intervalo. Sin mercado, o sin plan para ese mercado, responde **409 y no crea Customer**: preferimos no cobrar a cobrar mal. Un **índice único parcial** garantiza en la base de datos que solo haya un plan activo por mercado e intervalo. |
| **3.2** | **`Plan.trialDays` por defecto era `0`** contra los 14 días que promete el asistente: el Checkout solo manda `trial_period_days` si es > 0. | El default del schema es **14**, y el fixture de tests ya no lo fija para que el default sea lo que se prueba. `npm run billing:seed-plans` lo pone explícito y avisa si alguien siembra con 0. |

> Quedaba para 3.5 sembrar los `Plan` a mano — que es donde se colaban ambos errores. Ahora
> hay un comando: `npm run billing:seed-plans -- US=price_… MX=price_… CO=price_…`.
> Es idempotente y, al cambiar el precio de un mercado, desactiva el plan anterior.

**Lo que falta de estos dos:** asignar mercado a los **tenants anteriores al campo** (nacen
con `market = null`). Se hace desde el panel de plataforma; hasta entonces esos tenants no
pueden pasar por el Checkout — a propósito.

### 3.B Configuración de la cuenta

| # | Pendiente | Detalle |
| --- | --- | --- |
| 3.3 | **Cuenta Stripe en modo test** | Punto de partida de todo lo demás. |
| 3.4 | **`Product` + 3 `Price` recurrentes** | Uno por mercado, en USD mensual. Opcional pero recomendado: 3 más anuales (2 meses gratis) — ver plan de negocio §5. |
| 3.5 | **Sembrar los registros `Plan`** | `npm run billing:seed-plans -- US=price_… MX=price_… CO=price_…` (añade `--interval=year` para los anuales). Ya no es SQL a mano. |
| 3.6 | **Variables de entorno** | `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` — `env.ts:47` las exige en cuanto `ACCESS_MODE=subscription`. Los `price_…` **no** van por env: hay uno por mercado y viven en la tabla `Plan`. |
| 3.7 | **Decisión #5: moneda e impuestos** | Propuesta del plan: cobrar en USD en los tres mercados y activar Stripe Tax. Sin decidir esto no se puede facturar bien. |

### 3.C Verificación end-to-end *(nada de esto se ha corrido contra Stripe real)*

| # | Prueba | Criterio de éxito |
| --- | --- | --- |
| 3.8 | `stripe listen --forward-to localhost:3001/billing/webhook` + `stripe trigger checkout.session.completed` / `invoice.payment_failed` | El estado local refleja el evento; reenviar el mismo evento no lo aplica dos veces (idempotencia). |
| 3.9 | Pago con tarjeta de prueba | La suscripción queda `active` y el bot opera. |
| 3.10 | Trial completo | Alta con `trial_period_days: 14` → `trialing` → cobro automático al día 15. |
| 3.11 | Customer Portal | Cambiar tarjeta y cancelar; el corte ocurre **al fin del periodo pagado**, no antes. |
| 3.12 | Fallo de pago | `past_due` → periodo de gracia (`BILLING_GRACE_DAYS`) → suspensión del bot con aviso, y **reanudación** al regularizar. |
| 3.13 | Selección de plan por mercado | Un tenant de Colombia llega al Checkout con US$59, no con US$99. Cubierto por tests contra la base real (`api/tests/billing.checkout.test.ts`); falta verlo contra Stripe de verdad. |
| 3.14 | Tenants sin mercado | Los anteriores al campo `Tenant.market` tienen que recibir el suyo desde el panel de plataforma, o no podrán pagar. |

### 3.D El interruptor

| # | Pendiente | Detalle |
| --- | --- | --- |
| 3.15 | **`ACCESS_MODE=subscription`** | Cambia el flujo: la cuenta se activa por pago en vez de por aprobación manual. Reactiva también la decisión #3 (trial con tarjeta, `TRIAL_REQUIRES_CARD`). |
| 3.16 | **Migrar a los clientes cobrados a mano** | Los de Payment Link tienen que pasar a suscripción gestionada, sin cobrarles dos veces ni cortarles el servicio. **Escribir el procedimiento antes de encender.** |
| 3.17 | **Primer pago real conciliado** | Criterio de Go/No-Go de Fase 7: un pago de verdad, cobrado y cuadrado. |

---

## Compuerta 4 — Antes de escalar *(≈50 clientes o ≈5 partners)*

| # | Pendiente | Detonante |
| --- | --- | --- |
| 4.1 | **Modelo de datos de partners**: `Partner` (con `tier`: referidor / comercial) + `Tenant.partnerId` + `referralCode` en el signup + reporte mensual de comisiones sobre pagos cobrados + **cola de bonos de activación** (pendiente / pagado, con la fecha de día 90 de cada cliente). | Hoy se vende un programa de dos niveles con bono al día 90 que la base de datos no sabe a quién atribuir ni cuándo pagar. **Tope de 5 partners hasta cerrarlo.** Con más, el cálculo a mano de bonos con fecha se vuelve un error de pago, que es el peor error posible con un socio. |
| 4.2 | **Evaluación de la API oficial de WhatsApp Business Cloud** (decisión #10, diferida). | Baileys es el cuello de botella real del self-service a escala: sesión con estado, riesgo de baneo, sockets por proceso. Detonante: ~50 tenants o el primer baneo de un cliente que paga. |
| 4.3 | **Centralización de logs** (driver Docker → Loki/Better Stack). | Depurar 50 tenants con `docker logs` no es viable. |
| 4.4 | **Plan anual** en Stripe (2 meses gratis). | Palanca de retención y caja; se monta sobre 3.4. |
| 4.5 | **Fase 8 — SMS (~2 semanas) y voz (6–10+ semanas)**. | Solo cuando la demanda lo pida. La voz va como **add-on de precio**, no en el plan base (decisión #9). |

---

## Resumen: qué bloquea qué

| Quiero… | Tengo que cerrar |
| --- | --- |
| **Cobrarle al primer cliente** | Compuerta 0 (5 ítems, ninguno de código) |
| **Tener clientes en producción sin sustos** | Compuerta 1 (verificación en infra real) |
| **Llegar a 10 clientes** | Compuerta 2 (legal, CI, márgenes reales) |
| **Dejar de cobrar a mano** | Compuerta 3 (3.1 y 3.2, los bloqueantes de código, ya están resueltos) |
| **Reclutar partners a volumen** | 4.1 (atribución en la base de datos) |
| **Crecer más allá de ~50 bots** | 4.2 (API oficial de Meta) |

**Lo que no está en ninguna lista y es la decisión más importante:** nada de esto justifica
retrasar la Compuerta 0. Cobrar el primer peso con un Payment Link y una aprobación manual
enseña más sobre el negocio que cerrar las compuertas 1 a 3 en el vacío.
