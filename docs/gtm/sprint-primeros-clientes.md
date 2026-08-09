# Sprint de primeros clientes — 21 días

**Fecha:** 2026-08-07 · **Meta:** primer bot de un cliente real atendiendo en **7 días**, tres
bots vivos en 14, y el **primer peso cobrado el día 21**.

> Este documento es el zoom de los primeros 21 días de
> [`estrategia-ventas-90-dias.md`](estrategia-ventas-90-dias.md). El Partner Program
> **no participa**: está definido (plan de negocio §5) y arranca en el mes 4. No bloquea nada
> de lo que sigue.

---

## 1. La conclusión que acorta el calendario

Compuerta 1 de los [pendientes](pendientes-antes-de-vender.md) está dimensionada para *el
cliente #10*: signup self-service, email transaccional, landing, CI, dos bots verificados. Se
estaba tratando como requisito del cliente **#1**, y no lo es.

**Verificado en el código:** existe un camino de alta completamente manual que salta el
signup, el email, Stripe, la landing y el asistente de onboarding. Todo desde el panel de
plataforma, en clics:

| Paso | Qué hace por dentro |
| --- | --- |
| `/platform` → **Crear tenant** (slug, nombre, giro, país) | `POST /platform/tenants` crea el tenant `status: 'active'` **y siembra su `TenantSettings` desde la plantilla del giro** (`seedTenantSettingsFromTemplate`) |
| **Crear dueño** (email + contraseña) | `POST /platform/tenants/:id/users` crea el `PanelUser` admin con la contraseña que tú pongas — **sin verificación de email** |
| **Aprobar** | `approveTenant`: marca aprobado, activa y hace el alta en caliente en el worker (`/internal/tenant/add`) |
| El dueño entra al panel → **Vincular WhatsApp** | `GET /wa-status` devuelve el QR de su tenant |

Tres hechos que lo hacen viable hoy y que están verificados, no supuestos:

- **Sin email no se rompe nada.** Sin `EMAIL_PROVIDER=resend`, `createEmailSender()` cae en
  `LogEmailSender` y el aviso de aprobación se registra en el log; además el envío va con
  `.catch(() => {})`. Nadie queda esperando un correo que no llega.
- **El worker levanta por `active`, no por aprobación.** `TenantManager.start()` busca
  `tenant.findMany({ where: { active: true } })`, así que si el alta en caliente fallara, un
  reinicio del worker recoge al tenant igual.
- **La aprobación es el interruptor real.** `checkTenantAccess` da 403 mientras
  `approvalStatus !== 'approved'`; aprobar es un botón en `/platform`.

**El cuello de botella no es el producto: es que todavía nadie ha sido invitado.** Dar de
alta a un cliente cuesta ~10 minutos de tu tiempo. Encontrar al cliente es el trabajo.

---

## 2. Qué es indispensable de verdad para el cliente #1

| Sí, antes del primer cliente real | Por qué no se recorta |
| --- | --- |
| **Respaldo diario de Postgres** (`pg_dump` en cron) | Son las conversaciones de los clientes de otro negocio. Basta el volcado diario; el *drill* documentado puede esperar. |
| **Alerta de bot caído en tu teléfono** | Es el único fallo que te cuesta el cliente Y la referencia. Enterarte por él es perderlo. Cablear el sink de `src/lib/alerts.ts` a lo que ya uses. |
| **Cutover ordenado del piloto** si despliegas sobre esa infra | El piloto se auto-despliega desde `master` y el deploy no corre el backfill de `TenantSettings`. Ver `runbooks/cutover-piloto-fases-1-6.md`. |
| **Decidir el límite del plan gratuito** | Sin esto vendes contra tu propia versión gratis (plan de negocio §3). |

| Se puede aplazar sin riesgo | Cuándo lo necesitas |
| --- | --- |
| Email transaccional (Resend) | Cuando el alta deje de ser manual |
| Landing publicada | Cuando haya pauta que mandar a algún sitio |
| Sentry, CI/CD, branch protection | Cliente #5–10 |
| Signup self-service y wizard | Cliente #10+ |
| Restore drill documentado | Antes del cliente #10 |
| Stripe integrado | Payment Link resuelve los primeros 30 |

---

## 3. El sprint, día por día

### Días 1–2 · Que puedas dar de alta a mano, hoy

| # | Tarea | Tiempo |
| --- | --- | --- |
| 1 | **Ensayo del alta concierge de punta a punta** en staging: crea un tenant de mentira, su dueño, apruébalo, vincula **tu segundo número de WhatsApp** y mándale 5 mensajes como si fueras un cliente. | 2 h |
| 2 | Decidir `FREE_MONTHLY_RUN_LIMIT` (~100) y fijar el override de los tenants del piloto **antes** de bajarlo. | 20 min |
| 3 | Los 3 Payment Links en el dashboard de Stripe. | 20 min |
| 4 | `pg_dump` diario + alerta de bot caído a tu teléfono. | 3 h |

> El ensayo (#1) es la tarea de mayor rendimiento del sprint: es donde descubres qué se
> rompe, **antes** de que lo vea un cliente. Si algo falla, arreglarlo es el trabajo del día 2.

### Días 3–5 · Los activos mínimos y las primeras conversaciones

| # | Tarea | Tiempo |
| --- | --- | --- |
| 5 | **Lista de 20 negocios que ya te conocen**: donde eres cliente, donde conoces al dueño, o donde alguien te presenta. Nada de fríos todavía. | 1 h |
| 6 | Video de 90 s con la previsualización de wrapping al final. | 3 h |
| 7 | **Las primeras 10 conversaciones.** Sin guion largo: la pregunta de apertura y la oferta de dejárselo andando. | 2 h/día |

### Días 6–12 · Altas el mismo día

La regla que da velocidad: **el que dice que sí, queda dado de alta esa misma tarde.** Nada
de "te mando la información". Diez minutos tuyos en `/platform` y treinta con él vinculando
el QR y contándote qué le pregunta a sus clientes.

- Meta: **3 bots vivos** al día 12.
- 10 conversaciones más en paralelo, para no quedarte sin embudo.

### Días 13–21 · Convertir la prueba en pago

- **Día 14 de cada cliente** (no el 15): le mandas *su propio número* —trabajos levantados,
  extras aceptados, seguimientos recuperados— y con eso, el Payment Link. Ese mensaje es la
  venta; el link es el trámite.
- Meta: **1–2 pagando al día 21**, y los demás con una razón concreta de por qué no.

---

## 4. El procedimiento de alta concierge

Para pegarlo en una nota y no improvisar con el primero delante.

1. `/platform` → **Crear tenant**: nombre del negocio, giro (plantilla), **país** (define el
   precio) y el slug se rellena solo.
2. **Crear dueño**: su email y una contraseña temporal. Se la das tú; no hay correo de por
   medio.
3. **Aprobar** el tenant. Sin este clic el panel le responde 403.
4. Él entra a su panel → **WhatsApp** → escanea el QR desde el teléfono del negocio.
5. **Configúralo con él delante** (§5).
6. Prueba en vivo: que un tercero le escriba al número del negocio.
7. Anótalo con su **fecha de día 14** en la hoja de seguimiento.

> Si el alta en caliente en el worker fallara, reiniciarlo lo recoge: levanta todos los
> tenants con `active: true`. No lo des por perdido.

---

## 5. Configurar en 20 minutos: su propio historial es la configuración

El atajo que más impresiona y menos tiempo cuesta:

> *"Reenvíame cinco conversaciones recientes con clientes, de las normales."*

De ahí sale todo: los campos del intake son literalmente lo que él pregunta siempre, el tono
es el suyo, y los servicios del catálogo son los que ya vende. Se cargan desde
**Configuración → Asistente** conversando con el panel, que es más rápido que llenar
pestañas.

Y es el mejor argumento de venta que tienes, porque no es un argumento: es enseñarle su
propio negocio ya configurado. *"Esto que me acabas de decir, así queda; el bot lo pregunta
por ti."*

---

## 6. Cómo se pide, para que sea rápido

**Apertura** (una sola pregunta): *"¿Quién contesta el WhatsApp del taller a las 10 de la
noche?"*

**La oferta** — el ask no es dinero, es media hora:

> *"Déjame dejártelo andando con tu número. Son 30 minutos hoy, tú no configuras nada. Lo
> pruebas 14 días con tus clientes de verdad; si te sirve son US$69 al mes y te mando el
> link el día 14, y si no, lo apagamos y no pagas nada."*

Pedir el compromiso verbal del precio **el día 1** es lo que filtra al curioso sin meter
fricción. El que dice "sí, si funciona" es un cliente; el que esquiva el número, no.

**A quién primero**, en este orden: negocios donde eres cliente (tienes relación y excusa),
negocios donde conoces al dueño, y referencias de los dos anteriores. El outbound frío no
entra en este sprint.

---

## 7. Los tres riesgos de ir rápido, y qué hacer con ellos

1. **Un bot caído sin que te enteres.** Es el único que te quita el cliente y la referencia
   de golpe. Por eso la alerta al teléfono está en los días 1–2 y no se aplaza.
2. **Prometer de más para cerrar rápido.** El agente tiene reglas duras contra inventar
   precios y prometer SMS o la API oficial; tú no las tienes. La honestidad sobre Baileys
   —"puede desconectarse, te aviso y lo reconecto"— cierra mejor de lo que parece, y evita
   la conversación fea del mes 2.
3. **Un cuarto cliente con la Compuerta 1 abierta.** Tres bots a mano se sostienen; el
   cuarto ya no, y diez menos. Al tercer bot vivo la prioridad vuelve a la infraestructura
   — el sprint termina ahí a propósito.

---

## 8. Resumen

| | |
| --- | --- |
| **Día 7** | Primer cliente real con su bot atendiendo |
| **Día 12** | 3 bots vivos |
| **Día 21** | 1–2 pagando · primer peso cobrado |
| **Cuello de botella real** | No el producto: que nadie ha sido invitado todavía |
| **Lo que no se recorta** | Respaldo diario, alerta de bot caído, cutover ordenado, límite del free tier |
| **Lo que sí se aplaza** | Email, landing, Sentry, CI, signup self-service, Stripe integrado |
| **Regla que da velocidad** | El que dice que sí, queda dado de alta esa misma tarde |
| **El sprint termina** | Al tercer bot vivo: de ahí, Compuerta 1 |
