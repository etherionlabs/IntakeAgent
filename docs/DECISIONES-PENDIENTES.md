# Decisiones pendientes — un solo lugar para resolverlas

Toda la base teórica (specs + planes) y los documentos no-código (legal, runbooks,
GTM) están listos asumiendo las **recomendaciones** de abajo. Confirma o cambia
cada punto; varios bloquean el inicio de implementación de su fase.

| # | Decisión | Recomendación | Bloquea | Estado |
| --- | --- | --- | --- | --- |
| 1 | Arquitectura multi-tenant: `TenantManager` (Enfoque A) vs contenedor por tenant (B) | **A — TenantManager** | Fase 2 (y 4) | ☐ por confirmar |
| 2 | Identidad de login | **Email global único** (vs tenant+username) | Fase 1 (y 4) | ☐ por confirmar |
| 3 | Trial de la suscripción | **Trial corto con tarjeta requerida** (vs sin tarjeta) | Fases 3 y 4 | ☐ por confirmar |
| 4 | Precio del plan: monto + intervalo | — *(decisión de negocio)* | Fase 3 (config, no código) | ☐ pendiente |
| 5 | Mercado/moneda/impuestos (Stripe Tax) | — *(decisión de negocio)* | Fases 3 y 6 (legal) | ☐ pendiente |
| 6 | Jurisdicción legal aplicable + ¿asesoría externa? | — *(define el marco de ToS/Privacidad/DPA)* | Fase 6 | ☐ pendiente |
| 7 | Proveedor de email transaccional | Resend / Postmark / SES | Fases 1, 4, 6 | ☐ por confirmar |
| 8 | Proveedor de error tracking / logs | Sentry | Fase 5 | ☐ por confirmar |
| 9 | Voz (Fase 8): ¿incluida en plan base o **add-on**? + país para grabación | **Add-on de precio** | Fase 8 (post-lanzamiento) | ☐ pendiente |

## Notas

- **1, 2, 3** son las que desbloquean el grueso de la implementación. La **Fase 1
  no depende de billing/legal**, así que puede arrancar en cuanto se confirme la
  decisión #2 (identidad de login).
- **4 y 5** no bloquean código: todo el billing queda **parametrizado por variables
  de entorno**; son datos que se cargan al configurar Stripe.
- **6** condiciona el contenido legal (los borradores ya están con placeholders
  `[Jurisdicción]`, etc., listos para rellenar tras la decisión).
- **9** puede esperar hasta acercarse a la Fase 8.

> Cuando marques 1–3 (y 7), el siguiente paso recomendado es **empezar la
> implementación de la Fase 1** siguiendo su plan
> (`superpowers/plans/2026-06-18-fase1-security-hardening-plan.md`).
