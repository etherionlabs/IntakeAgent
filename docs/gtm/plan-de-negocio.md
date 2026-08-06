# Plan de negocio — Intake (Etherion Labs)

**Fecha:** 2026-08-06 · **Horizonte:** 12 meses · **Estado del producto:** Fases 1–6 del
roadmap implementadas; v1 de mercado re-alcanzada a *plan gratuito + aprobación manual*
(`ACCESS_MODE=approval`), con el billing de Stripe construido pero **dormante**.

> Documento hermano: [`estrategia-ventas-90-dias.md`](estrategia-ventas-90-dias.md)
> (ejecución comercial, guiones y métricas semanales).
> Fuentes autoritativas usadas aquí: `docs/ROADMAP-PRODUCCION.md`,
> `docs/DECISIONES-PENDIENTES.md`, `docs/HANDOFF.md`, `profiles/intake/business-facts.json`
> y `tests/profiles/intake.test.ts` (precios y comisión oficiales).

---

## 1. Resumen ejecutivo

Intake es un **asesor de ventas autónomo de WhatsApp** para negocios de servicio. No es un
chatbot de FAQ: descubre la necesidad, levanta la ficha del trabajo conversando, **ofrece
los servicios complementarios que apliquen**, maneja objeciones, da seguimiento a las
ofertas sin respuesta y avisa al dueño con el resumen y los extras aceptados.

**La tesis:** el mercado está lleno de bots que *contestan*. Intake *vende*. Para un taller
o una tapicería, un bot que ahorra tiempo es un gasto; un bot que cierra un servicio extra
al mes se paga solo. Ese es el encuadre de toda la venta.

**La ventaja injusta:** el propio producto es el vendedor. El perfil `profiles/intake/` es
Intake vendiéndose a sí mismo por WhatsApp — el prospecto **está usando el producto
mientras pregunta el precio**. Ningún competidor puede demostrar tan barato.

**Objetivo 12 meses (escenario base):** 100 negocios pagando, ~US$6.8k MRR (~US$82k ARR
run-rate), margen bruto >85%, con el Partner Program aportando ~40% de las altas.

**Las tres decisiones que hay que tomar esta semana** (detalle en §10):

1. **Cobrar desde el día 1** con Stripe Payment Link manual, sin esperar a que Fase 3 esté
   probada end-to-end. Cero código; desbloquea ingresos ~3 meses antes.
2. **Un solo vertical de cabeza de playa** para los primeros 90 días, no nueve.
3. **Arreglar la atribución de Partners** — hoy se vende un 20% recurrente que la base de
   datos **no sabe a quién pagarle** (`Tenant` no tiene campo de partner referente).

---

## 2. El producto: qué se vende de verdad

Lo que el código ya hace y es defendible en una demo (todo verificado en el repo):

| Capacidad | Por qué importa en la venta |
| --- | --- |
| **Venta proactiva** con catálogo curado (`business-facts.json`) | El agente **solo** ofrece lo que el dueño cargó. No inventa. Es el argumento que mata el miedo a "¿y si le dice cualquier cosa a mi cliente?" |
| **Descubrimiento antes de proponer** (`register_discovery`: dolor, implicación, urgencia, objeciones) | Vende como un buen vendedor, no como un formulario. Y el dueño **lee el diagnóstico antes de cotizar**. |
| **Seguimiento proactivo** (`FollowUpCoordinator`) | Recupera la oferta que se murió en silencio. Es la función que más fácil se traduce a dinero: "el 30% de tus cotizaciones sin responder". |
| **Fotos y audios** (visión + transcripción) | El intake real de estos giros es "mándame foto y medidas". |
| **Previsualización generada** (wrapping/estética) | Demo visual imbatible: el cliente manda su coche y recibe cómo quedaría. |
| **Panel + pipeline + cierre ganado/perdido** (`Job.outcome`) | Convierte "creo que funciona" en tasa ofrecido→aceptado→ganado. |
| **Configuración conversando** (`/settings/assist/chat`) | Elimina la fricción de onboarding del dueño que no es técnico. |
| **Divulgación de IA por tenant** (AI Act art. 50, vigente 2026-08-02) | Cumplimiento como argumento de venta, no como carga. |
| **9 verticales con perfil propio + genérico** | mecánica, tapicería, cerrajería, plomería, electricista, refrigeración, paquetería, wrapping, genérico. |

**Lo que NO hace hoy** (y no se promete): no usa la API oficial de WhatsApp Business
(usa Baileys / dispositivos vinculados), no cobra a los clientes finales, no gestiona
inventario ni facturación, y no tiene SMS ni voz.

---

## 3. Estado real vs. lo vendible — la brecha que define el plan

Esta es la tensión central del negocio hoy, y hay que verla con claridad:

| Se vende (perfil `intake`, business-facts) | Se opera (decisiones #11/#12) |
| --- | --- |
| Suscripción US$99 / US$69 / US$59 al mes | v1 **sin pagos**: plan gratuito con límite mensual |
| "30 días de prueba" | Aprobación manual del operador desde `/admin` |
| Pago con tarjeta vía Stripe, renovación automática | Stripe construido pero **dormante** (`ACCESS_MODE=subscription` apagado) |
| Partner Program: 20% recurrente por cliente | **No existe atribución de partner en el modelo de datos** |

Y `docs/gtm/pricing.md` todavía tenía `[precio]` como placeholder mientras el agente ya
cotizaba montos reales (corregido en este mismo cambio).

**Conclusión operativa:** el producto está más listo para *vender* que para *cobrar
solo*. La estrategia de los primeros 90 días consiste en **cerrar esa brecha con
operación manual, no con ingeniería**: cobro por Payment Link, alta aprobada a mano,
atribución de partners en una hoja hasta que exista el campo. Diez clientes se atienden
así perfectamente; a los cincuenta ya no, y para entonces Fase 3 estará probada.

---

## 4. Mercado, ICP y cabeza de playa

### Cliente ideal (ICP)

Un negocio de servicio donde **el WhatsApp lo contesta el dueño**, que:

- recibe pedidos por WhatsApp con foto/medidas (el "mándame una foto" es el disparador);
- cotiza caso por caso, no vende un catálogo cerrado;
- tiene 20–300 conversaciones al mes (por debajo no duele; por encima ya tiene a alguien);
- factura lo suficiente para que **un solo trabajo extra al mes** pague la suscripción.

**Señal de descalificación (regla dura del agente):** si el negocio no recibe pedidos por
WhatsApp, se le dice y se corta. Perder cinco minutos es mejor que un cliente que churnea.

### Cabeza de playa recomendada

No atacar los nueve verticales a la vez. Orden propuesto:

1. **Tapicería + wrapping/estética automotriz** *(meses 1–3)* — el intake es visual, el
   ticket es alto (una cotización de wrap paga meses de suscripción), y **wrapping tiene la
   previsualización generada**: la demo se vende sola en video.
2. **Mecánica + refrigeración** *(meses 3–6)* — volumen alto de mensajes repetitivos y
   servicios complementarios evidentes (el upsell natural que justifica el precio).
3. **Cerrajería, plomería, electricista** *(meses 6–9)* — urgencia alta, el que contesta
   primero gana. Argumento de "24/7" en su punto más fuerte.
4. **Paquetería y genérico** *(meses 9+)* — el genérico se apoya en lo que cargue el dueño;
   sirve para no rechazar entradas inbound de giros no previstos.

### Mercados

Estados Unidos, México y Colombia (los tres del catálogo de precios). Fuera de ahí el
agente toma datos y no promete servicio.

- **México y Colombia** — mayor densidad de negocios que operan por WhatsApp, CAC más bajo,
  ciclo de venta corto. **Es donde se aprende y se factura primero.**
- **Estados Unidos** — ARPU 43% mayor que México, pero mayor exigencia de estabilidad
  (Baileys es un riesgo más caro ahí) y más competencia. Entrar vía **hispanohablantes
  dueños de negocio de servicio** (mercado desatendido), no compitiendo de frente en inglés.

---

## 5. Modelo de negocio y precios

### Precios oficiales de lanzamiento

| Mercado | Precio/mes | Comisión Partner (20%) |
| --- | --- | --- |
| Estados Unidos | US$99 | US$19.80 |
| México | US$69 | US$13.80 |
| Colombia | US$59 | US$11.80 |

Suscripción mensual fija, sin cobro por mensaje ni por cliente atendido. Prueba de 30 días.
Sin permanencia. *(Fijados por `tests/profiles/intake.test.ts`; cambiarlos exige tocar ese
archivo y `profiles/intake/business-facts.json`.)*

### Recomendaciones sobre el pricing

1. **Reducir la prueba de 30 a 14 días.** Cada prueba tiene costo marginal real y 30 días
   es tiempo suficiente para que el prospecto se olvide del dolor que lo trajo. 14 días con
   un onboarding acompañado convierte más. *(Requiere actualizar business-facts + test.)*
2. **Añadir un plan anual con 2 meses gratis** (US$690 MX / US$590 CO / US$990 US). Es la
   forma más barata de comprar retención y flujo de caja sin tocar el precio de lista.
3. **No introducir un plan "básico" barato.** Con un solo plan la conversación es sobre
   valor; con dos, sobre cuál es más barato. Si hace falta una versión de entrada, que sea
   por **límite de conversaciones**, no por funciones recortadas.
4. **La voz (Fase 8) va como add-on**, no en el plan base: su costo por minuto no cabe en
   una cuota fija. Ya está recomendado así en `DECISIONES-PENDIENTES.md` #9.

### Partner Program

20% recurrente sobre cada suscripción cobrada, mientras el cliente siga activo. El partner
prospecta, presenta, demuestra y acompaña; Etherion Labs desarrolla, opera, factura y da
soporte. El cliente es de Etherion Labs.

**Es el mejor canal del negocio y el que está peor instrumentado.** Ver §8 y §10.

---

## 6. Economía unitaria

> Estimaciones a partir de la configuración real (`config.json`: `openai/gpt-4o-mini`,
> `maxSteps: 6`, transcripción y visión con modelos mini) y precios públicos de los modelos.
> **Deben validarse contra `CostEntry`/`AgentRun.costUsd` reales en la beta** — es un ítem
> abierto de Fase 7 en `HANDOFF.md` §3.

### Costo por tenant al mes

| Concepto | Tenant típico | Tenant intensivo |
| --- | --- | --- |
| Turnos del agente (≈US$0.002/turno, 2–3 llamadas por turno) | 300 turnos → **$0.60** | 1,500 turnos → **$3.00** |
| Transcripción de audios | ~$0.10 | ~$0.50 |
| Descripción de imágenes | ~$0.15 | ~$0.75 |
| Previsualizaciones generadas (opt-in, ~$0.03 c/u) | $0 | 100 → **$3.00** |
| Infra prorrateada (Postgres + API + worker/shard) | ~$2.00 | ~$3.00 |
| **COGS total** | **≈ US$3** | **≈ US$10** |

**Margen bruto:** 96% (típico) a 86% (intensivo) sobre un ARPU de US$69. El guardarraíl
`limits.monthlyCostUsd: 50` por tenant protege contra el caso patológico, pero con estos
números **el margen no es el riesgo del negocio; la retención sí.**

### ARPU, LTV y CAC

Mezcla asumida: 50% México, 30% Colombia, 20% Estados Unidos → **ARPU ≈ US$70**.

| Métrica | Directo | Vía Partner |
| --- | --- | --- |
| ARPU | $70 | $70 |
| − comisión partner (20%) | — | −$14 |
| − COGS (~$5) | −$5 | −$5 |
| **Contribución mensual** | **$65** | **$51** |
| Vida media (churn 6%/mes) | 16.7 meses | 16.7 meses |
| **LTV** | **≈ $1,085** | **≈ $850** |
| **CAC máximo aceptable (LTV/CAC ≥ 4)** | **$270** | **$210** |

**Payback objetivo: < 4 meses.** Con CAC de $200 y contribución de $51–65, el payback cae
entre 3 y 4 meses. Es el umbral que decide si se puede escalar con pauta pagada.

### Punto de equilibrio

Con costos fijos de operación estimados en **US$1,500/mes** (infra, herramientas, dominio,
email transaccional, y sin contar sueldo del fundador):

- **~23 clientes** cubren los costos fijos.
- **~60 clientes** sostienen un primer sueldo de soporte/ventas.

---

## 7. Proyección financiera a 12 meses

Tres escenarios. La diferencia entre ellos **no es el producto: es la disciplina del
seguimiento comercial y si el Partner Program arranca o no.**

### Escenario base

| Mes | Altas | Churn | Clientes | MRR (ARPU $70) | Comisión partners | MRR neto |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 5 | 0 | 5 | $350 | $0 | $350 |
| 2 | 7 | 0 | 12 | $840 | $28 | $812 |
| 3 | 9 | 1 | 20 | $1,400 | $84 | $1,316 |
| 4 | 10 | 1 | 29 | $2,030 | $142 | $1,888 |
| 5 | 11 | 2 | 38 | $2,660 | $213 | $2,447 |
| 6 | 12 | 2 | 48 | $3,360 | $269 | $3,091 |
| 7 | 13 | 3 | 58 | $4,060 | $325 | $3,735 |
| 8 | 14 | 3 | 69 | $4,830 | $386 | $4,444 |
| 9 | 15 | 4 | 80 | $5,600 | $448 | $5,152 |
| 10 | 16 | 5 | 91 | $6,370 | $510 | $5,860 |
| 11 | 17 | 5 | 103 | $7,210 | $577 | $6,633 |
| 12 | 18 | 6 | 115 | $8,050 | $644 | $7,406 |

**Cierre M12:** 115 clientes · US$8,050 MRR bruto · **US$7,406 MRR neto** ·
~US$97k ARR run-rate · margen de contribución ~92%.
*(Comisión calculada sobre el 40% de la base originada por partners.)*

### Escenarios comparados

| | Conservador | **Base** | Agresivo |
| --- | --- | --- | --- |
| Supuesto clave | Solo venta directa del fundador; partners no arrancan | Partners aportan 40% de altas; pauta click-to-WhatsApp validada | Partners aportan 60%; 2 verticales escalando en paralelo |
| Churn mensual | 8% | 6% | 5% |
| Clientes M12 | **55** | **115** | **210** |
| MRR neto M12 | **$3,600** | **$7,406** | **$13,100** |

### Inversión requerida (12 meses, escenario base)

| Partida | Total 12 meses |
| --- | --- |
| Infraestructura y herramientas (Railway/VPS, Sentry, Resend, dominio, monitoreo) | ~$1,800 |
| Pauta click-to-WhatsApp (arranca en $300/mes desde M2, escala a $1,200) | ~$8,000 |
| Legal (revisión profesional de ToS/Privacidad/DPA — pendiente `[LEGAL-EXT]`) | ~$1,500 |
| Materiales de venta (video de demo, landing, casos) | ~$1,000 |
| **Total** | **≈ US$12,300** |

Con el MRR acumulado del escenario base (~US$42k en los 12 meses), **el negocio se
autofinancia a partir del mes 4–5.** No requiere capital externo.

---

## 8. Canales de adquisición, ordenados por velocidad

| # | Canal | Time-to-first-sale | CAC esperado | Escala | Veredicto |
| --- | --- | --- | --- | --- | --- |
| 1 | **El propio bot como demo** (número público de Intake) | Días | ~$0 | Media | **Hacer ya.** Es el activo, no un experimento. |
| 2 | **Red directa del fundador** (talleres, tapicerías conocidas) | Días | ~$0 | Baja | **Hacer ya.** Los primeros 10 clientes salen de aquí. |
| 3 | **Pauta click-to-WhatsApp** (Meta Ads) | 2–4 semanas | $50–250 | Alta | **Probar con $300–500.** El prospecto inicia la conversación → cero riesgo de spam y el agente vende solo. |
| 4 | **Partner Program** (agencias, consultores, integradores) | 4–8 semanas | ~$0 fijo (20% variable) | **Muy alta** | **El motor del año 2.** Sembrarlo desde el mes 1. |
| 5 | **Grupos y asociaciones del gremio** (Facebook, cámaras, proveedores) | 2–6 semanas | Bajo | Media | Complemento barato del #3. |
| 6 | **Contenido en video** (previsualización de wrapping, "así atendió a un cliente a las 2am") | 4–12 semanas | Bajo | Alta | Combustible orgánico de #3 y #5. |
| 7 | **Outbound frío por WhatsApp** | Días | Bajo | Media | ⚠️ **No hacerlo a volumen.** Riesgo real de baneo del número (Baileys) y de incumplimiento anti-spam. Solo contactos con relación previa. |

**El insight de canal:** la pauta click-to-WhatsApp es una combinación casi perfecta para
este producto. El prospecto inicia (consentimiento resuelto), llega al bot que **es** el
producto (demo resuelta), el bot descubre, cotiza según país, maneja objeciones, registra
la oportunidad y da seguimiento si el prospecto se enfría (pipeline resuelto). El costo
marginal de atender un prospecto más es de centavos.

---

## 9. Riesgos y mitigaciones

| Riesgo | Impacto | Probabilidad | Mitigación |
| --- | --- | --- | --- |
| **Baneo/desconexión de números por Baileys** | Alto — es el riesgo existencial | Media | Ya se declara honestamente en la venta (business-facts lo dice). Reconexión con backoff + alerta ya implementadas. **Acelerar la evaluación de la API oficial de Meta al llegar a ~50 tenants** (decisión #10, diferida). No prometer SLA de disponibilidad del número. |
| **Churn temprano** (el dueño no ve valor en 30 días) | Alto | **Alta** | Onboarding acompañado en los primeros 10 clientes. Usar `Job.outcome` (ganado/perdido) para mandarle al dueño su propio número al mes 1: "el bot te cerró X trabajos". El valor demostrado, no argumentado. |
| **El agente dice algo incorrecto a un cliente final** | Alto en reputación | Baja | Regla dura de catálogo curado (solo ofrece lo de `business-facts.json`) + divulgación de IA + pausa manual por contacto. Es un argumento de venta, no solo una defensa. |
| **Vender el Partner Program sin poder pagarlo bien** | Alto en confianza | **Alta hoy** | Ver §10.3 — la atribución no existe en la base de datos. Bloquear reclutamiento masivo de partners hasta cerrarlo. |
| **Costo de LLM se dispara con un tenant abusivo** | Bajo | Baja | `limits.monthlyCostUsd: 50` + `FREE_MONTHLY_RUN_LIMIT` + override por tenant. Ya cubierto. |
| **Legal sin revisar** (ToS/Privacidad/DPA marcados `[LEGAL-EXT]`) | Medio | Media | Revisión profesional antes de superar ~20 clientes de pago. Es barato ahora y caro después. |
| **Competencia de plataformas genéricas de chatbot** | Medio | Alta | No competir en "chatbot". Competir en **"asesor que vende"**: descubrimiento, upsell registrado, seguimiento, atribución ganado/perdido. Ninguna plataforma genérica trae el playbook del giro. |
| **Dependencia de un solo fundador vendiendo** | Alto | Alta | Es exactamente lo que resuelve el Partner Program. Por eso es prioridad estratégica, no un extra. |

---

## 10. Decisiones que se necesitan del dueño

### 10.1 ¿Cobramos en los primeros 90 días? — **Recomendación: SÍ**

La v1 salió sin pagos para evitar fricción, pero eso también significa **cero validación
comercial**: un negocio que dice "sí, me gusta" gratis no ha validado nada.

**Propuesta, sin escribir una línea de código:**

1. Se mantiene `ACCESS_MODE=approval` (el operador aprueba desde `/admin`).
2. Se cobra con un **Stripe Payment Link** (se crea desde el dashboard de Stripe, no
   requiere la Fase 3 integrada) enviado al cerrar.
3. El operador aprueba la cuenta **al confirmarse el pago**. La aprobación manual, que hoy
   es un cuello de botella, se convierte en el mecanismo de cobro.
4. Al llegar a ~30 clientes, se activa `ACCESS_MODE=subscription` y se migran los cobros a
   la integración ya construida.

**Ganancia:** ingresos y validación real ~3 meses antes de que Fase 3 esté probada E2E.

### 10.2 Cabeza de playa — **Recomendación: tapicería + wrapping**

Concentrar los primeros 90 días. Nueve verticales en paralelo es cero verticales.

### 10.3 Atribución de Partners — **Bloqueante, hay que resolverlo**

Se está vendiendo un 20% recurrente y **`Tenant` no tiene campo de partner referente**
(verificado en `prisma/schema.prisma`). Hoy no se puede responder "¿cuánto le toca a este
partner este mes?" sin releer conversaciones.

**Corto plazo (esta semana, sin código):** código de referido por partner, capturado en el
signup como parte del nombre del negocio o registrado a mano al aprobar la cuenta en
`/admin`, y una hoja de cálculo como fuente de verdad. Funciona hasta ~10 partners.

**Mediano plazo (antes de reclutar partners a volumen):** `Partner` + `Tenant.partnerId` +
`referralCode` en el signup + un reporte de comisiones por mes sobre pagos cobrados. Es
una tarea pequeña (una migración y una vista) comparada con el costo de pagarle mal a un
socio.

### 10.4 Prueba: 30 → 14 días — **Recomendación: 14 días**

Menos costo marginal, más urgencia, mejor conversión. Requiere actualizar
`profiles/intake/business-facts.json` y `tests/profiles/intake.test.ts`.

### 10.5 Decisiones ya pendientes que este plan resuelve o mantiene

| # (de `DECISIONES-PENDIENTES.md`) | Estado tras este plan |
| --- | --- |
| #4 Precio e intervalo | **Resuelto de facto**: US$99/69/59 mensual (ya en producto y tests). Añadir plan anual con 2 meses gratis. |
| #5 Mercado/moneda/impuestos | **Propuesta**: cobrar en USD en los tres mercados; Stripe Tax al activar `ACCESS_MODE=subscription`. |
| #6 Jurisdicción legal | Sigue pendiente. **Cerrar antes de 20 clientes de pago.** |
| #9 Voz: plan base o add-on | **Add-on**, confirmado por economía unitaria (§5). |

---

## 11. Hitos comerciales

| Hito | Cuándo | Criterio de éxito |
| --- | --- | --- |
| **H1 — Primer peso cobrado** | Semana 2 | 1 cliente pagando por Payment Link |
| **H2 — Validación del ICP** | Mes 1 | 5 clientes de pago, todos del vertical de cabeza de playa |
| **H3 — Canal pagado validado** | Mes 2 | CAC < $250 con $500 de pauta; ≥ 2 clientes atribuibles |
| **H4 — Primer partner productivo** | Mes 3 | 1 partner con ≥ 2 clientes activos y comisión pagada correctamente |
| **H5 — Punto de equilibrio** | Mes 4–5 | ~23 clientes; MRR > costos fijos |
| **H6 — Cobro automático** | Mes 5 | `ACCESS_MODE=subscription` activo; altas sin operador |
| **H7 — Retención probada** | Mes 6 | Churn mensual < 6% con cohortes de ≥ 3 meses |
| **H8 — Segundo vertical** | Mes 6 | Mecánica/refrigeración con ≥ 10 clientes |
| **H9 — Escala de partners** | Mes 9 | 5 partners activos aportando ≥ 40% de las altas |
| **H10 — 100 clientes** | Mes 11–12 | MRR neto > US$7,000 |

---

## 12. Qué mide el éxito (y ya está instrumentado)

El producto expone en `GET /metrics` exactamente lo que necesita el negocio — la ventaja de
que la herramienta de venta y el producto sean lo mismo:

- `intake_opportunities_total{status}` — ofrecidos / aceptados / rechazados. **Es el
  embudo de venta del pipeline propio, medido por el propio bot.**
- `intake_objections_total{type,state}` — qué fricción aparece de verdad y si se resuelve.
  Si "precio" domina y no se resuelve, el problema es el encuadre de valor, no el monto.
- `intake_followups_total{reason}` — cuánta venta se recupera del silencio.
- `Job.outcome` (`WON`/`LOST`) — cierra la atribución ofrecido→aceptado→ganado.

**Regla de gestión:** estas métricas se revisan semanalmente sobre el tenant `intake`
(nuestra propia venta) *antes* que cualquier tablero externo. Si el bot no logra vender
Intake, no hay que arreglar el pitch: hay que arreglar el producto.
