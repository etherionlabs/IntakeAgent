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
| 0.4 | **Hoja de atribución de partners** (código, partner, cliente, mercado, alta, estado, comisión del mes). Sustituye a `Tenant.partnerId` mientras no exista. | ▪ | Dueño |
| 0.5 | **Decidir el trato del trial pagado**: hoy se anuncian 14 días de prueba y el cobro es un Payment Link manual → o se envía el link al día 14, o se cobra desde el día 1 con reembolso pactado. **Elegir una y escribirla.** | ▪ | Dueño |

> ⚠️ **Sin 0.5 no se sale a vender.** Es la única de esta compuerta que, si se improvisa,
> genera una disputa con el primer cliente.

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
402 con suspensión y reanudación del bot, y pantalla de facturación en la SPA. Lo que falta
no es programarlo: es **conectarlo a una cuenta real y arreglar dos cosas que no cuadran con
el pricing anunciado**.

### 3.A Los dos bloqueantes de código *(hay que resolverlos antes de encender)*

| # | Bloqueante | Detalle | Esfuerzo |
| --- | --- | --- | --- |
| **3.1** | **`/billing/checkout` solo soporta UN plan activo** | `api/src/routes/billing.ts:43` hace `prisma.plan.findFirst({ where: { active: true } })`. Con los tres precios de mercado (US$99 / US$69 / US$59) habrá **tres `Plan` activos** y el checkout cobrará uno arbitrario — probablemente el precio de otro país. Hay que **seleccionar el plan por el mercado del tenant** (país del onboarding), no por `findFirst`. | ▪▪ |
| **3.2** | **`Plan.trialDays` por defecto es `0`** | `prisma/schema.prisma:51`. Se anuncian **14 días de prueba** y el Checkout solo los aplica si `trialDays > 0`. Al sembrar los `Plan` hay que poner `trialDays: 14` en los tres, o el cliente paga el día 1 después de que el asistente le prometió dos semanas. | ▪ |

> Ambos son baratos ahora y caros después: el primero cobra de más o de menos, el segundo
> incumple por escrito lo que el agente prometió. Los dos son reclamaciones, no bugs.

### 3.B Configuración de la cuenta

| # | Pendiente | Detalle |
| --- | --- | --- |
| 3.3 | **Cuenta Stripe en modo test** | Punto de partida de todo lo demás. |
| 3.4 | **`Product` + 3 `Price` recurrentes** | Uno por mercado, en USD mensual. Opcional pero recomendado: 3 más anuales (2 meses gratis) — ver plan de negocio §5. |
| 3.5 | **Sembrar los registros `Plan`** | Uno por `price_…`, con `amountCents`, `currency`, `interval` y **`trialDays: 14`**. |
| 3.6 | **Variables de entorno** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`. Ojo: `env.ts:47` exige las dos primeras en cuanto `ACCESS_MODE=subscription`. |
| 3.7 | **Decisión #5: moneda e impuestos** | Propuesta del plan: cobrar en USD en los tres mercados y activar Stripe Tax. Sin decidir esto no se puede facturar bien. |

### 3.C Verificación end-to-end *(nada de esto se ha corrido contra Stripe real)*

| # | Prueba | Criterio de éxito |
| --- | --- | --- |
| 3.8 | `stripe listen --forward-to localhost:3001/billing/webhook` + `stripe trigger checkout.session.completed` / `invoice.payment_failed` | El estado local refleja el evento; reenviar el mismo evento no lo aplica dos veces (idempotencia). |
| 3.9 | Pago con tarjeta de prueba | La suscripción queda `active` y el bot opera. |
| 3.10 | Trial completo | Alta con `trial_period_days: 14` → `trialing` → cobro automático al día 15. |
| 3.11 | Customer Portal | Cambiar tarjeta y cancelar; el corte ocurre **al fin del periodo pagado**, no antes. |
| 3.12 | Fallo de pago | `past_due` → periodo de gracia (`BILLING_GRACE_DAYS`) → suspensión del bot con aviso, y **reanudación** al regularizar. |
| 3.13 | Selección de plan por mercado | Un tenant de Colombia llega al Checkout con US$59, no con US$99 (valida el arreglo 3.1). |

### 3.D El interruptor

| # | Pendiente | Detalle |
| --- | --- | --- |
| 3.14 | **`ACCESS_MODE=subscription`** | Cambia el flujo: la cuenta se activa por pago en vez de por aprobación manual. Reactiva también la decisión #3 (trial con tarjeta, `TRIAL_REQUIRES_CARD`). |
| 3.15 | **Migrar a los clientes cobrados a mano** | Los de Payment Link tienen que pasar a suscripción gestionada, sin cobrarles dos veces ni cortarles el servicio. **Escribir el procedimiento antes de encender.** |
| 3.16 | **Primer pago real conciliado** | Criterio de Go/No-Go de Fase 7: un pago de verdad, cobrado y cuadrado. |

---

## Compuerta 4 — Antes de escalar *(≈50 clientes o ≈5 partners)*

| # | Pendiente | Detonante |
| --- | --- | --- |
| 4.1 | **Modelo de datos de partners**: `Partner` + `Tenant.partnerId` + `referralCode` en el signup + reporte mensual de comisiones sobre pagos cobrados. | Hoy se vende un 20% recurrente que la base de datos no sabe a quién atribuir. **Tope de 5 partners hasta cerrarlo.** |
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
| **Dejar de cobrar a mano** | Compuerta 3 — y dentro de ella, **3.1 y 3.2 son bloqueantes de código** |
| **Reclutar partners a volumen** | 4.1 (atribución en la base de datos) |
| **Crecer más allá de ~50 bots** | 4.2 (API oficial de Meta) |

**Lo que no está en ninguna lista y es la decisión más importante:** nada de esto justifica
retrasar la Compuerta 0. Cobrar el primer peso con un Payment Link y una aprobación manual
enseña más sobre el negocio que cerrar las compuertas 1 a 3 en el vacío.
