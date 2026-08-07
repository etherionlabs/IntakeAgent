# Registro de decisiones — Intake SaaS

Las decisiones **tomadas** son autoritativas para specs, planes e implementación.
Las **pendientes** son de negocio y se irán cerrando; varias no bloquean código
(quedan parametrizadas por configuración).

Última actualización: 2026-06-30.

---

## ✅ Decisiones tomadas

| # | Decisión | Elección | Razón / nota | Afecta |
| --- | --- | --- | --- | --- |
| 1 | Arquitectura multi-tenant | **`TenantManager` (Enfoque A), diseño shardeable** | Aprovisionar bots en caliente sin tocar infra (requisito del self-service). Asignación de tenants por worker desde la BD para sharding horizontal y evitar que un solo proceso sostenga todos los sockets de WhatsApp. | Fases 2, 4 |
| 2 | Identidad de login | **Email global único** | Encaja con signup self-service y recuperación de contraseña; reemplaza el `findFirst({ username })` (`api/src/routes/auth.ts:15`). | Fases 1, 4 |
| 3 | Trial de la suscripción | **Trial corto con tarjeta requerida** | Cada trial tiene costo marginal real (bot + OpenRouter) y es blanco de abuso si es público y gratis; la tarjeta filtra fraude y mejora conversión. | Fases 3, 4 |
| 7 | Email transaccional | **Resend** | Simplicidad de integración para verificación/recuperación/avisos. | Fases 1, 4, 6 |
| 8 | Error tracking / observabilidad | **Sentry** | Rastreo en API, worker y SPA con `tenantId`. | Fase 5 |
| 10 | WhatsApp a escala *(dirección estratégica)* | **Adelantar evaluación de la API oficial de WhatsApp Business Cloud** | Baileys (no oficial) es el verdadero cuello de botella del self-service a escala: sesión con estado, riesgo de baneo, sockets por proceso. La API oficial es *stateless* y provisionable por API. No bloquea el lanzamiento; se evalúa como canal en paralelo antes de crecer. **Re-alcance 2026-06-30: se pospone a la siguiente iteración** (ver #11). | Fase 2 (diseño), deuda |
| 11 | **Alcance de la v1 de mercado** *(re-alcance 2026-06-30)* | **Plan gratuito con límite de uso mensual + aprobación manual de cuentas** (`ACCESS_MODE=approval`). Sin pagos en v1. | Salir al mercado sin fricción de cobro ni riesgo de abuso: el signup sigue siendo self-service, pero **la cuenta no opera hasta que el operador la aprueba desde `/admin`**; el consumo queda acotado por un límite mensual de respuestas del bot (global por env + override por tenant). El billing de Stripe (Fase 3) queda **dormante e intacto**: se reactiva con `ACCESS_MODE=subscription` en la siguiente iteración. La decisión #3 (trial con tarjeta) queda diferida junto con Stripe. | Fases 3, 4, 5 (admin) |
| 12 | **Diferidos a la siguiente iteración** *(re-alcance 2026-06-30)* | Pagos (Stripe), **API oficial de Meta**, **SMS y llamadas (Fase 8)** | v1 sale solo con WhatsApp vía Baileys. El código de billing y la capa de canal ya construidos se conservan sin borrar nada. | Fases 3, 8 |

---

## ☐ Decisiones pendientes (de negocio)

| # | Decisión | Recomendación | Bloquea | Nota |
| --- | --- | --- | --- | --- |
| 4 | Precio del plan: monto + intervalo | — | ~~Fase 3~~ **Diferida** (re-alcance #11: v1 sin pagos) | Billing queda parametrizado por env; es un dato al configurar Stripe. |
| 5 | Mercado/moneda/impuestos (Stripe Tax) | — | ~~Fases 3 y 6~~ **Diferida** (re-alcance #11) | Define configuración de Stripe y parte del marco legal. |
| — | Límite mensual del plan gratuito (valor por defecto) | **~100 respuestas/mes** (`FREE_MONTHLY_RUN_LIMIT`). *Revisado el 2026-08-07: la propuesta anterior de 300 cubre entero al ICP (20–300 conversaciones/mes) y deja el plan de pago sin nada que vender.* | **Bloquea la estrategia comercial**, no el código | Ajustable en caliente sin deploy. Antes de bajarlo con el piloto en vivo, fijar `Tenant.monthlyRunLimit` en los tenants que ya operan. Ver `gtm/plan-de-negocio.md` §3. |
| 6 | Jurisdicción legal + ¿asesoría externa? | — | Fase 6 | Los borradores legales ya tienen placeholders `[Jurisdicción]` listos para rellenar. |
| 9 | Voz (Fase 8): ¿plan base o **add-on**? + país para grabación | Add-on de precio | Fase 8 (post-lanzamiento) | Puede esperar hasta acercarse a la Fase 8. |

---

## Notas

- Con **1, 2, 3, 7 y 8 tomadas**, la implementación de la **Fase 1 ya no tiene
  bloqueos** (no depende de billing ni legal). Siguiente paso recomendado: ejecutar
  su plan (`superpowers/plans/2026-06-18-fase1-security-hardening-plan.md`).
- **4 y 5** no bloquean código: el billing se parametriza por variables de entorno.
- **Propagado ✅:** el diseño *shardeable* del `TenantManager` (decisión #1) y la
  dirección de la API oficial de WhatsApp (decisión #10) ya están reflejados en el
  spec (§2.1, §2.2, §3.3, §5.2, §9) y el plan de la Fase 2 (B3 `ownsTenant`, D2/D3
  ruteo por shard + `SHARD_ID`/`SHARD_COUNT`, E2 interfaz neutral, riesgo #4).
