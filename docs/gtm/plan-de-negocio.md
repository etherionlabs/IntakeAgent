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

**Objetivo declarado por el dueño (2026-08-07):** que el negocio **le pague un sueldo**, a
tiempo completo y con un runway de 3 a 6 meses. Eso son **25–32 clientes**, no 100 — y cae
entre el mes 6 y el 7 del escenario base, justo en el borde del runway. Cómo se compra
holgura para ese borde está en [`plan-maestro.md`](plan-maestro.md).

**Objetivo 12 meses (escenario base, una sola persona):** 100 negocios pagando, ~US$6.5k
MRR neto (~US$84k ARR run-rate), margen bruto >85%.

**Las cuatro decisiones que hay que tomar esta semana** (detalle en §10):

1. **Bajar el límite del plan gratuito** de 300 a ~100 respuestas/mes. Con 300, el free
   tier cubre entero a dos tercios del ICP: estaríamos vendiendo contra nosotros mismos.
   Bloquea a las otras tres.
2. **Cobrar desde el día 1** con Stripe Payment Link manual, sin esperar a que Fase 3 esté
   probada end-to-end. Cero código; desbloquea ingresos ~3 meses antes.
3. **Un solo vertical de cabeza de playa**, verificando antes que tenga volumen suficiente.
4. **Arreglar la atribución de Partners** — el programa ya está redefinido (§5), pero la
   base de datos **no sabe a quién pagarle** (`Tenant` no tiene campo de partner referente).

**La restricción que ordena el calendario:** hay una persona. La misma que cierra la
verificación de infraestructura es la que vende y da soporte, así que la máquina comercial
arranca en el mes 3 y no en la semana 2.

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
| 14 días de prueba | Aprobación manual del operador desde `/admin` |
| Pago con tarjeta vía Stripe, renovación automática | Stripe construido pero **dormante** (`ACCESS_MODE=subscription` apagado) |
| Partner Program de dos niveles, con bono al día 90 | **No existe atribución de partner en el modelo de datos** |

Y `docs/gtm/pricing.md` todavía tenía `[precio]` como placeholder mientras el agente ya
cotizaba montos reales (corregido en este mismo cambio).

### El conflicto que hay que resolver antes que ningún otro

`FREE_MONTHLY_RUN_LIMIT` está propuesto en **300 respuestas al mes**. El ICP de este plan
(§4) es un negocio con **20–300 conversaciones al mes**. Los dos números son el mismo
número: **el plan gratuito cubre entero a dos tercios del cliente que queremos cobrar.**

No es un detalle de pricing, es la premisa. Toda la estrategia de cobrar desde el día 1
supone que hay algo que comprar; con 300 respuestas gratis, la decisión racional del
cliente es quedarse donde está. Las dos salidas son excluyentes:

- **Bajar el límite gratuito a ~100 respuestas/mes** *(recomendado)*. Cien alcanza para
  que un dueño vea el bot funcionando con clientes reales y no para que le resuelva el
  mes. El free tier vuelve a ser lo que la decisión #11 quería —una puerta sin fricción—
  en vez de un competidor interno.
- **Asumir que el free tier es el producto** y monetizar por otra vía (más adelante, con
  otro plan de negocio). Coherente, pero incompatible con todo lo que sigue en este
  documento.

Es ajustable en caliente (`FREE_MONTHLY_RUN_LIMIT` + override por tenant desde `/admin`),
así que la decisión es barata de tomar y de revertir. **Lo caro es no tomarla:** salir a
vender contra tu propia versión gratuita es perder los tres primeros meses averiguándolo.

> ⚠️ Al bajarlo en un deploy con el piloto en vivo, **primero** hay que fijar
> `Tenant.monthlyRunLimit` en los tenants del piloto: el límite global no debe estrangular
> a un negocio real que ya está operando con él.

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

### A quién NO venderle todavía

Mientras el canal sea Baileys y no la API oficial, hay un perfil al que **no conviene
vender aunque pague**: el negocio cuyo WhatsApp *es* el negocio — una paquetería de alto
volumen, un servicio de urgencias — donde 48 horas con el número caído no es una molestia
sino una pérdida grave.

Es contraintuitivo, porque es justo el que más valor sacaría del producto. Pero el riesgo
de baneo es real y está declarado en la venta; el día que se materialice, ese cliente no
escribe una queja, escribe la reseña que hunde el lanzamiento. **Ese segmento se reserva
para cuando exista la API oficial de Meta** (4.2 en los pendientes), y mientras tanto se le
dice por qué — que además es un argumento de honestidad que vende bien en los demás.

### Verificar el tamaño del estanque antes de comprometerse

La cabeza de playa de abajo está elegida por calidad de demo y ticket, **no por volumen
verificado**. Antes de comprometer el trimestre, media hora de Google Maps: contar
negocios con WhatsApp visible, por vertical, en las dos ciudades objetivo.

El umbral: si tapicería + wrapping no suman al menos **300 negocios alcanzables**, el
vertical de volumen (mecánica) tiene que entrar en el **mes 2**, no en el 4. Con 20 clientes
se llena un vertical chico; con 100 no. Es el error que más caro sale corregir tarde,
porque se descubre justo cuando la máquina comercial ya está engrasada.

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

Suscripción mensual fija, sin cobro por mensaje ni por cliente atendido. **Prueba de 14
días.** Sin permanencia. *(Fijados por `tests/profiles/intake.test.ts`; cambiarlos exige
tocar ese archivo y `profiles/intake/business-facts.json`.)*

### Recomendaciones sobre el pricing

1. ✅ **Prueba de 14 días** *(aplicado 2026-08-06, antes 30)*. Cada prueba tiene costo
   marginal real y 30 días es tiempo suficiente para que el prospecto se olvide del dolor
   que lo trajo. 14 días con un onboarding acompañado convierte más. **Pendiente de
   propagar al cobro:** `Plan.trialDays` debe valer `14` cuando se active Stripe (hoy el
   default del schema es `0`) — ver [pendientes](pendientes-antes-de-vender.md).
2. **Añadir un plan anual con 2 meses gratis** (US$690 MX / US$590 CO / US$990 US). Es la
   forma más barata de comprar retención y flujo de caja sin tocar el precio de lista.
3. **No introducir un plan "básico" barato.** Con un solo plan la conversación es sobre
   valor; con dos, sobre cuál es más barato. Si hace falta una versión de entrada, que sea
   por **límite de conversaciones**, no por funciones recortadas.
4. **La voz (Fase 8) va como add-on**, no en el plan base: su costo por minuto no cabe en
   una cuota fija. Ya está recomendado así en `DECISIONES-PENDIENTES.md` #9.

### Partner Program *(redefinido el 2026-08-07)*

**El diagnóstico que obligó a rediseñarlo:** con solo 20% recurrente, una venta le cuesta al
partner ~4 horas y le devuelve US$13.80 al mes. Si valora su hora en US$35, **recupera su
propio tiempo en el mes 10**. Nadie con alternativas hace eso: la misma agencia cobra US$500
por un sitio web y lo entrega en dos semanas. El programa atraía solo a quien tuviera costo
de oportunidad casi nulo y horizonte de tres años.

**La causa de fondo:** había dos trabajos distintos metidos en un solo programa — el que
*vende* (invierte horas) y el que *presenta* (esfuerzo casi cero, valor enorme). Pagarles
igual garantizaba perder a los dos.

#### Dos niveles

| | **Referidor** | **Partner comercial** |
| --- | --- | --- |
| Qué hace | Presenta el negocio. Nada más. | Prospecta, presenta, demuestra y acompaña el arranque. |
| Quién es | Proveedores y distribuidores del gremio, cámaras, asociaciones, agencias que quieren sumarlo sin vender. | Consultores independientes, automatizadores, integradores, vendedores B2B. |
| Qué cobra | **Una mensualidad, una sola vez**, al completar el cliente su primer mes pagado. | **Bono de dos mensualidades al día 90** + **20% recurrente** mientras el cliente siga activo. |
| US / MX / CO | US$99 / US$69 / US$59 | Bono US$198 / US$138 / US$118 · recurrente US$19.80 / US$13.80 / US$11.80 |

#### Por qué el bono no cuesta nada

| Por cliente vía partner comercial | |
| --- | --- |
| Contribución mensual (ARPU $70 − 20% comisión − COGS $5) | **$51** |
| Contribución cobrada al día 90 | $153 |
| Bono que se paga ese día | −$140 |
| **Caja al momento de pagarlo** | **+$13** |
| LTV a 16.7 meses, neto del bono | **~$712** |
| **LTV / CAC efectivo** | **6.1×** |

El bono se paga **con dinero ya cobrado**, y solo por clientes que ya sobrevivieron la
ventana de mayor churn. Nunca sales de caja. Y comparado con la pauta —CAC de US$250 para
4.3×— **el canal de partners con bono sigue siendo más barato que comprar el cliente**, sin
consumir tus horas.

Para el partner, sus 4 horas se pagan en el mes 3 en vez del mes 10, y la renta queda
encima. A dos clientes nuevos al mes en México, su sexto mes son ~US$430 entre bono y
recurrente — contra ~US$152 con el esquema anterior.

#### Lo que el programa exige

Hoy no pedía nada, y el riesgo no era económico: **el agente tiene reglas duras que le
impiden inventar precios o prometer SMS y la API oficial; un partner humano no tiene
ninguna.** Un socio que promete el canal oficial para cerrar crea justo la responsabilidad
que el producto evita por diseño.

1. **Certificación de ~2 horas** antes de entregar el código: configurar un tenant de prueba
   y hacer una demo con nosotros mirando.
2. **Una hoja de "qué puedes y qué no puedes decir"**, calcada de las reglas duras del agente.
3. **Primer cliente en 60 días** o el código queda en pausa.
4. **Prohibido el outbound frío masivo por WhatsApp.**

El **20% recurrente no se condiciona** a seguir vendiendo: es el ancla de confianza del
programa, y el abandono ya está cubierto por la cláusula de reasignación de cartera.

#### Lo que no se ofrece

**Exclusividad territorial, no.** Con un tope de 5 partners y un mercado enorme, regalar
territorio es ceder palanca a cambio de nada. Lo que sí se garantiza —y es lo que de verdad
les preocupa— es que **el cliente que ellos trajeron no se le asigna a otro**, que es
exactamente lo que resuelve la atribución (§10.3).

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

### El costo que no aparece en la tabla: las horas

Ese 90% es correcto como contabilidad y engañoso como número de planeación, porque el
costo real por cliente en los primeros meses no son los tokens: **es el tiempo del
fundador.**

| Concepto | Horas |
| --- | --- |
| Onboarding acompañado (vinculación del QR + configuración) | 0.5 h, una vez |
| Soporte y ajustes | ~0.3 h/mes |
| **Mes 1 de un cliente nuevo** | **≈ 0.8 h** |

A cualquier valuación razonable de esa hora, el mes 1 de un cliente cuesta más que un año
entero de sus tokens. La consecuencia para el plan:

- **El límite para llegar a 50 clientes no es el dinero, son las horas.** A 0.3 h/mes de
  soporte, 50 clientes son 15 horas mensuales solo de mantenimiento, más el onboarding de
  las altas nuevas. Eso ya es media jornada semanal que no está vendiendo ni programando.
- **Umbral de acción: ~30 clientes.** Antes de llegar ahí hay que haber automatizado el
  onboarding (el wizard existe; lo que falta es confiar en él) o haber contratado apoyo.
  Ese momento llega **antes** que el punto de equilibrio en dinero, que es el error de
  lectura que induce mirar solo el margen bruto.

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

> ⚠️ **Corregido el 2026-08-07.** Antes decía US$1,500/mes de costos fijos y ~23 clientes de
> equilibrio. No era real para un SaaS de una persona a esta escala: con Railway/VPS, dominio
> y los planes gratuitos de Sentry, Resend y monitoreo son **~US$100–150/mes**, subiendo a
> ~US$300 con cincuenta clientes. El error hacía parecer el negocio mucho menos alcanzable de
> lo que es.

Con costos fijos reales de **~US$150/mes** y una contribución de US$67 por cliente
(ARPU US$70 − US$3 de costo variable):

- **3 clientes** cubren los costos fijos de la plataforma.
- **25 clientes** pagan un sueldo de US$1,500/mes; **32**, uno de US$2,000; **48**, uno de
  US$3,000. Ver [`plan-maestro.md`](plan-maestro.md) §1.

---

## 7. Proyección financiera a 12 meses

> **Supuesto que manda sobre todos los demás: hay UNA persona.** La misma que cierra la
> Compuerta 1 de los [pendientes](pendientes-antes-de-vender.md) es la que vende y la que
> da soporte. Por eso los dos primeros meses son de ingeniería con venta oportunista, y la
> máquina comercial no arranca de verdad hasta el mes 3. Una proyección que ignore esto no
> es optimista: es de otra empresa.

### Escenario base

| Mes | Foco | Altas | Churn | Clientes | MRR (ARPU $70) | Comisión partners | MRR neto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Ingeniería + red directa | 1 | 0 | 1 | $70 | $0 | $70 |
| 2 | Ingeniería + red directa | 2 | 0 | 3 | $210 | $0 | $210 |
| 3 | **Máquina comercial ON** | 4 | 0 | 7 | $490 | $27 | $463 |
| 4 | Pauta validándose | 6 | 0 | 13 | $910 | $58 | $852 |
| 5 | Escala de pauta | 8 | 1 | 20 | $1,400 | $90 | $1,310 |
| 6 | Segundo vertical | 10 | 1 | 29 | $2,030 | $130 | $1,900 |
| 7 | Partners produciendo | 12 | 2 | 39 | $2,730 | $175 | $2,555 |
| 8 | | 14 | 2 | 51 | $3,570 | $228 | $3,342 |
| 9 | | 15 | 3 | 63 | $4,410 | $282 | $4,128 |
| 10 | | 16 | 4 | 75 | $5,250 | $336 | $4,914 |
| 11 | | 17 | 5 | 87 | $6,090 | $390 | $5,700 |
| 12 | | 18 | 5 | 100 | $7,000 | $448 | $6,552 |

**Cierre M12:** 100 clientes · US$7,000 MRR bruto · **US$6,552 MRR neto** · ~US$84k ARR
run-rate. *(Comisión calculada sobre el 40% de la base originada por partners — sujeta a
la revisión del programa, ver §5.)*

Los 20 clientes que la versión anterior de este plan ponía en el día 90 caen ahora en el
**mes 5**. No es un recorte de ambición: es lo que cabe en una agenda donde la misma
persona tiene que verificar dos bots simultáneos en staging antes de venderle al tercer
cliente.

### El churn fija el techo, y es el número con menos evidencia de todo el documento

El 6% mensual es un supuesto, no un dato. Y su efecto no se ve en el año 1 —donde cambia
poco— sino en dónde se estanca el negocio. Con altas sostenidas de 18 al mes, el equilibrio
es `altas ÷ churn`:

| Churn mensual | Clientes M12 | **Techo (equilibrio)** |
| --- | --- | --- |
| 5% | 105 | **360** |
| **6%** *(base)* | **100** | **300** |
| 8% | 92 | **225** |
| 10% | 85 | **180** |

Dicho de otra forma: **el año 2 no lo decide cuánto vendes, lo decide cuánto retienes.**
Duplicar el esfuerzo comercial mueve el techo en proporción; bajar el churn del 10% al 6%
lo mueve un 67% sin vender ni un cliente más.

> **Umbral de alarma:** si a los 6 meses el churn de la primera cohorte supera el **8%**,
> se congela la inversión en pauta y todo el esfuerzo va a retención. Comprar clientes para
> un balde agujereado es la forma más cara de aprender que el balde tiene un agujero.

### Escenarios comparados

| | Conservador | **Base** | Agresivo |
| --- | --- | --- | --- |
| Supuesto clave | Partners no arrancan; la ingeniería se come el mes 3 | Máquina comercial desde el mes 3; pauta validada; partners aportan ~40% de altas | Dos verticales en paralelo y partners produciendo desde el mes 4 |
| Churn mensual | 8% | 6% | 5% |
| Clientes M12 | **~55** | **100** | **~180** |
| MRR neto M12 | **~$3,600** | **$6,552** | **~$11,600** |

### Inversión requerida (12 meses, escenario base)

| Partida | Total 12 meses |
| --- | --- |
| Infraestructura y herramientas (Railway/VPS, Sentry, Resend, dominio, monitoreo) | ~$2,000 |
| Pauta click-to-WhatsApp (arranca en $300/mes desde el mes 3, escala a $1,200) | ~$7,000 |
| Legal (revisión profesional de ToS/Privacidad/DPA — pendiente `[LEGAL-EXT]`) | ~$1,500 (una vez) |
| Materiales de venta (video de demo, landing, casos) | ~$1,000 |
| **Total** | **≈ US$11,300** |

Con el acumulado del escenario base (~US$31k netos en los 12 meses) **el negocio se
autofinancia a partir del mes 6–7** y no requiere capital externo. Dos matices honestos:

- **El modelo cobra desde el mes del alta**, pero con 14 días de prueba cada cohorte no
  paga su primera media mensualidad. El acumulado real del año 1 es un **5–8% menor** que
  el de la tabla.
- Los costos fijos (~US$150/mes) **no incluyen sueldo del fundador**. Cubrirlos con 3
  clientes es equilibrio de caja, no sostenibilidad personal: el sueldo empieza en ~25.

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

### 10.0 Límite del plan gratuito — **la que bloquea a todas las demás**

**Recomendación: bajarlo de 300 a ~100 respuestas/mes.** Con 300, el plan gratuito cubre
entero a dos tercios del ICP y no hay nada que vender (§3). Es un cambio de una variable de
entorno, reversible en caliente, y sin él las decisiones 10.1 a 10.3 se apoyan en una
premisa falsa.

⚠️ Antes de bajarlo con el piloto en vivo: fijar `Tenant.monthlyRunLimit` en los tenants
que ya operan, para no estrangular a un negocio real.

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

### 10.2 Cabeza de playa — **Recomendación: tapicería + wrapping, con verificación**

Concentrar los primeros 90 días. Nueve verticales en paralelo es cero verticales.

**Condicionada al conteo de §4:** si tapicería + wrapping no suman ~300 negocios
alcanzables en las ciudades objetivo, mecánica entra en el mes 2. Están elegidos por
calidad de demo y ticket alto — que es lo correcto para las primeras 10 ventas y no
necesariamente para las siguientes 90.

### 10.3 Partner Program — ✅ **redefinido (2026-08-07)**; la atribución sigue bloqueante

La estructura quedó decidida y está en §5: **dos niveles** (referidor y partner comercial),
**bono de activación de 2 mensualidades al día 90** más el **20% recurrente**, y cuatro
requisitos de entrada. Aplicado ya en el perfil de venta (`business-facts.json`,
`salesPlaybook`) y fijado por `tests/profiles/intake.test.ts`.

**Atribución: bloqueante, hay que resolverlo.**

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

### 10.4 Prueba: 30 → 14 días — ✅ **Decidido y aplicado (2026-08-06)**

Menos costo marginal, más urgencia, mejor conversión. Aplicado en
`profiles/intake/business-facts.json` y fijado por `tests/profiles/intake.test.ts`, que
ahora también impide que otro fact prometa un plazo distinto. Propagado a README, FAQ y
página de precios. **Falta cerrarlo en el cobro** (`Plan.trialDays = 14`) al activar Stripe.

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
| **H0 — Free tier decidido** | Semana 1 | `FREE_MONTHLY_RUN_LIMIT` fijado con criterio comercial, no por defecto |
| **H1 — Primer peso cobrado** | Semana 3 | 1 cliente pagando por Payment Link |
| **H2 — Compuerta 1 cerrada** | Mes 2 | Infra verificada: 2 bots reales, restore drill, alertas, email |
| **H3 — Validación del ICP** | Mes 3 | 7 clientes de pago, del vertical de cabeza de playa |
| **H4 — Canal pagado validado** | Mes 4 | CAC < $250 con $500 de pauta; ≥ 2 clientes atribuibles |
| **H5 — Sueldo del fundador** | Mes 6–7 | 25–32 clientes; MRR neto > sueldo objetivo (el equilibrio de caja, 3 clientes, cae en el mes 2) |
| **H6 — Retención probada** | Mes 6 | Churn mensual < 8% con cohortes de ≥ 3 meses (umbral de alarma) |
| **H7 — Segundo vertical** | Mes 6 | Mecánica/refrigeración con ≥ 10 clientes |
| **H8 — Onboarding automatizado** | Mes 6 | Antes de los 30 clientes: el alta deja de costar 0.8 h |
| **H9 — Cobro automático** | Mes 7 | `ACCESS_MODE=subscription` activo; altas sin operador |
| **H10 — Primer partner productivo** | Mes 7 | 1 partner con ≥ 2 clientes activos y comisión pagada correctamente |
| **H11 — 100 clientes** | Mes 12 | MRR neto > US$6,500 |

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
