# Estrategia de ventas rápidas — 90 días (Intake)

**Fecha:** 2026-08-07 · **Meta día 90:** 7 clientes de pago (~US$490 MRR) **y la máquina
comercial encendida**. Los 20 clientes caen en el día 150.

> ⚠️ **Revisión del 2026-08-07.** La primera versión de este documento ponía 20 clientes en
> el día 90. No cabía: la misma persona que vende es la que tiene que cerrar la verificación
> de infraestructura (Compuerta 1 de los [pendientes](pendientes-antes-de-vender.md)) antes
> de tener veinte bots en producción. Los meses 1 y 2 son de ingeniería con venta
> oportunista; el motor comercial arranca el mes 3. La meta no bajó de ambición, bajó de
> fantasía.

> Documento hermano: [`plan-de-negocio.md`](plan-de-negocio.md) (modelo de negocio,
> economía unitaria, proyección y decisiones abiertas).
> Precios y condiciones oficiales: `profiles/intake/business-facts.json` (autoritativo,
> fijado por `tests/profiles/intake.test.ts`). **Nada de lo que se diga en una venta puede
> contradecir ese archivo** — es la misma regla dura que tiene el agente.

---

## 0. El principio que ordena todo

**El producto es el vendedor.** Cada movimiento comercial de estos 90 días tiene un solo
objetivo intermedio: **llevar al prospecto a escribirle al WhatsApp de Intake**. Ahí el
perfil `profiles/intake/` hace el trabajo — descubre, cotiza según país, maneja objeciones,
registra la oportunidad y da seguimiento si el prospecto se enfría.

Todo lo demás (pauta, video, red, partners) es tráfico hacia esa conversación.

**Corolario incómodo y útil:** el mejor caso de estudio del producto es su propia venta.
Si el bot no cierra, no se arregla el guion humano: se arregla `business-facts.json`,
`salesPlaybook` o las skills. El equipo comercial y el equipo de producto son el mismo.

---

## 1. Semana 0 — Preparación (no se vende nada todavía)

Sin esto, los primeros 30 días se desperdician. Es una semana, no más.

| # | Entregable | Detalle | Responsable |
| --- | --- | --- | --- |
| 1 | **Número de Intake en vivo** | Tenant `intake` operando con `profiles/intake/`, aprobado y vinculado. Probar 5 conversaciones reales de punta a punta (una en inglés, para validar `welcome.en.txt` y el aviso de IA). | Producto |
| 2 | **Stripe Payment Link × 3** | Uno por mercado (US$99 / US$69 / US$59), recurrente mensual. Se crea desde el dashboard; **no requiere la Fase 3 integrada**. | Dueño |
| 3 | **Procedimiento de alta** | Pago confirmado → aprobar en `/admin` → agendar la sesión de vinculación del QR. Escrito, de 5 líneas, para no improvisar. | Operación |
| 4 | **Hoja de partners** | Código de referido, partner, cliente, mercado, fecha de alta, estado, comisión del mes. Fuente de verdad hasta que exista `Tenant.partnerId`. | Dueño |
| 5 | **Video de demo, 60–90 s** | Pantalla partida: el cliente escribe por WhatsApp / la ficha del trabajo apareciendo en el panel. **Cerrar con la previsualización de wrapping** — es el segundo que hace scroll-stop. | Marketing |
| 6 | **Landing con precios reales** | `docs/gtm/pricing.md` ya tiene los montos; publicarla con CTA a WhatsApp (no a un formulario). | Marketing |
| 7 | **Lista de 50 prospectos** | Tapicerías y estudios de wrapping con WhatsApp visible en Google Maps / Instagram, en 2–3 ciudades. Con nombre del dueño donde se pueda. | Ventas |
| 8 | **Conteo del estanque** (30 min) | Mientras armas la lista, **cuenta el total** de negocios alcanzables por vertical en esas ciudades. Si tapicería + wrapping no llegan a ~300, mecánica entra en el mes 2 y no en el 4. Es el dato que decide si el vertical aguanta el año. | Ventas |
| 9 | **Procedimiento del día 15** | Qué pasa cuando termina la prueba y no convirtió: qué mensaje sale, quién desvincula el WhatsApp, qué se conserva y cuánto. La primera cohorte llega a ese día toda junta; improvisarlo es el peor momento para hacerlo. | Operación |
| 10 | **Decidir el límite del plan gratuito** | Con 300 respuestas/mes el free tier cubre entero al ICP y no hay nada que vender. Recomendación: ~100. Ver plan de negocio §3. | Dueño |

> ⚠️ **El ítem 10 bloquea a los demás.** Sin resolverlo, la respuesta correcta de un
> prospecto bien informado es quedarse en el plan gratuito — y tendrá razón.

---

## 2. Los tres motores, en orden de encendido

### Motor 1 — Red directa (día 1) · objetivo: los primeros 10 clientes

El fundador contacta uno por uno a negocios con los que ya hay relación o referencia. Sin
pauta, sin escala, con acompañamiento total. **El objetivo no es el MRR: son los primeros
casos con números reales.**

- Meta de los **dos primeros meses** (no del primero): 30 conversaciones → 10 pruebas →
  **3 clientes de pago**. Es una conversión de prueba a pago del 30%, que es exactamente la
  métrica que manda (§6). La versión anterior prometía 50% en el mes con el producto menos
  maduro y la agenda más ocupada: dos cosas que no pasan a la vez.
- Cada uno recibe onboarding acompañado (30 min, en vivo, vinculando el QR juntos).
- A los 14 días se le manda **su propio número**: trabajos levantados, extras aceptados,
  seguimientos recuperados. Ese mensaje es el que convierte prueba en pago.

### Motor 2 — Click-to-WhatsApp (mes 3, al cerrar la Compuerta 1) · objetivo: validar CAC

Pauta en Meta Ads con destino WhatsApp, segmentada por vertical y ciudad.

- **Presupuesto de prueba: US$300–500.** No más hasta tener datos.
- Creativo: el video de demo. Copy sin jerga: *"¿Contestas tú el WhatsApp del taller a las
  11 de la noche? Escríbele a este número y mira lo que hace."*
- **El CTA es la demo**, no un formulario: la conversación con el bot ES la landing page.
- Criterio de éxito (H3): **CAC < US$250** y ≥ 2 clientes atribuibles con $500 gastados.
- Si el CAC sale > $400 en la primera ronda: no subir presupuesto. Revisar el creativo, y
  después revisar el `salesPlaybook` del perfil `intake` — el problema suele estar ahí.

**Por qué este canal y no outbound frío:** el prospecto inicia la conversación. Eso
resuelve el consentimiento, evita el riesgo de baneo del número (Baileys) y hace que llegue
ya interesado. El outbound frío por WhatsApp a volumen **no se hace** en estos 90 días.

### Motor 3 — Partner Program (mes 4) · objetivo: el primer partner productivo

El canal con mejor economía y el más lento en arrancar. Por eso se siembra en cuanto haya
un caso real que enseñar, aunque rinda dos meses después.

> 🔄 **La estructura de comisión está en revisión** (2026-08-07): 20% de US$69 son US$13.80
> al mes, y un partner necesita ~72 clientes activos para llegar a US$1,000 mensuales — tres
> años a dos altas por mes. El pitch de abajo es el vigente hasta que se redefina; **no
> reclutes partners a volumen mientras tanto.**

**A quién reclutar:** agencias digitales, consultores de negocio, integradores, empresas de
marketing y vendedores B2B que **ya atienden a varios negocios de servicio**. Cinco
partners buenos valen más que cincuenta registrados.

**El pitch del partner (una frase):** *"No ganas dinero por una venta: construyes una
cartera. 20% de cada suscripción, todos los meses, mientras el cliente siga activo. Diez
clientes en México son US$138 al mes recurrentes — y tú no desarrollas, no operas, no
facturas ni das soporte."*

**Lo que hay que dejar clarísimo desde el minuto uno** (es lo que sostiene la relación):

- El cliente le paga a Etherion Labs; el partner nunca cobra suscripciones.
- La comisión se genera **sobre pagos efectivamente cobrados**, mes con mes.
- Si el cliente cancela, deja de generarse.
- Los clientes son de Etherion Labs; el partner construye su cartera y cobra por ella.

**Restricción hasta cerrar §10.3 del plan de negocio:** máximo **5 partners** mientras la
atribución viva en una hoja de cálculo. Reclutar más antes de tener `Tenant.partnerId` es
comprar un problema de confianza.

---

## 3. Calendario de 90 días

**La restricción que lo ordena:** una persona, dos trabajos. Cada semana tiene un foco
dominante; lo comercial de los meses 1 y 2 es lo que cabe alrededor de la ingeniería, no un
plan de ventas en paralelo.

### Días 1–30 — Que exista algo que vender sin sustos

| Semana | Foco dominante | Comercial | Meta |
| --- | --- | --- | --- |
| 1 | **Semana 0** completa (incluye decidir el free tier) | — | Número de Intake en vivo |
| 2 | Compuerta 1: infra, migraciones, 2 bots reales | 10 conversaciones de la red directa | 3 pruebas activas |
| 3 | Compuerta 1: restore drill, alertas, email real | Onboarding acompañado de las pruebas | **H1: 1 cliente pagando** |
| 4 | Compuerta 1: cierre y verificación | 10 conversaciones más | 1 cliente · 5 pruebas activas |

**Salida del mes 1:** 1 cliente pagando, infraestructura casi verificada, y las primeras
objeciones reales medidas con `intake_objections_total`.

### Días 31–60 — Cerrar la infraestructura y el primer caso

| Semana | Foco dominante | Comercial | Meta |
| --- | --- | --- | --- |
| 5 | Compuerta 1 cerrada (**H2**) | Recuperar pruebas frías con su propio número | 2 clientes |
| 6 | Landing publicada + video de demo | 10 conversaciones | 3 clientes |
| 7 | Ajustar `business-facts.json` / `salesPlaybook` con las objeciones del mes 1 | Primer caso de éxito documentado | Conversión prueba→pago medida |
| 8 | Preparar la pauta (creativos, segmentación) | — | **3 clientes acumulados** |

**Salida del mes 2:** 3 clientes, infraestructura verificada, un caso real con números y el
mensaje comercial corregido con fricción medida, no supuesta.

### Días 61–90 — Encender la máquina

| Semana | Foco dominante | Comercial | Meta |
| --- | --- | --- | --- |
| 9 | **Pauta click-to-WhatsApp ON** ($300) | El bot atiende a los prospectos que llegan | 15 conversaciones/semana |
| 10 | Medir CAC por canal | Cerrar los calificados | 5 clientes |
| 11 | Ajustar creativo o playbook según el CAC | Empujar el segundo vertical | 6 clientes |
| 12 | Cierre de trimestre: revisar cohorte del mes 1 | Sembrar los primeros partners | **7 clientes · ~US$490 MRR** |

**Salida del día 90:** 7 clientes, canal pagado con CAC conocido, churn de la primera
cohorte medido y el segundo vertical abierto. **Eso es lo que hace que el día 150 tenga 20
clientes** — que es donde la primera versión de este documento ponía el día 90.

### Lo que viene después (para no perder el hilo)

| Mes | Hito |
| --- | --- |
| 4 | Pauta escalada; primeros partners sembrados; 13 clientes |
| 5 | **20 clientes** · segundo vertical produciendo |
| 6 | Punto de equilibrio (~23 clientes) · onboarding automatizado antes de los 30 |

---

## 4. Guion de venta (humano)

El agente ya tiene el suyo en `profiles/intake/prompt-vars.json`. Este es para cuando el
que habla es una persona. **Sigue las mismas reglas duras.**

### Apertura (30 segundos)

> *"¿Quién contesta hoy el WhatsApp del taller?"*

Es la única pregunta de apertura que hace falta. La respuesta casi siempre es "yo, y a
veces de noche" — y eso es el dolor, dicho por él, no por nosotros.

### Descubrimiento (no saltar esto — es donde se pierde la venta)

Las cuatro preguntas, en orden. Una a la vez:

1. **"¿Quién contesta y cuándo?"** → destapa el dolor.
2. **"¿Qué le preguntas siempre a un cliente nuevo antes de poder cotizar?"** → *eso ya es
   su configuración de intake*. Devolvérselo es el argumento más fuerte que existe:
   *"eso que me acabas de decir, así queda configurado; el bot lo pregunta por ti"*.
3. **"¿Qué pasa cuando mandas una cotización y no te contestan?"** → casi siempre "nada,
   ahí queda". Ahí entra el seguimiento proactivo.
4. **"¿Cuánto te costaría tener a alguien contestando eso todo el día?"** → **usar SU
   número, nunca inventar sueldos.** Es regla dura.

### Demo (2 minutos, no 20)

No compartir pantalla. **Pedirle que le escriba al número de Intake desde su propio
teléfono.** Que lo pruebe con las preguntas de su negocio. Después mostrarle el panel con la
ficha que se acaba de generar.

En wrapping/estética: pedirle una foto de un coche. La previsualización generada cierra
sola.

### Cierre

Un paso concreto y chiquito (la misma regla del `salesPlaybook`):

> *"Te lo dejo andando con tu número esta semana. Son 30 minutos: escaneas un QR y me
> cuentas qué le preguntas a tus clientes. ¿Mañana a las 10 o el jueves?"*

Nunca pedir una reunión de una hora a alguien que está trabajando.

---

## 5. Manejo de objeciones

Explorar **antes** de responder — es la técnica de la skill `objeciones`, y aplica igual al
vendedor humano.

| Objeción | Primero explorar | Después responder |
| --- | --- | --- |
| **"Está caro"** | *"¿Caro comparado con qué?"* | Si es contra otro bot: no competimos ahí, ese contesta, este vende. Si es contra no hacer nada: **un solo trabajo extra al mes lo paga**. Si es contra contratar a alguien: con su número, no con uno inventado. |
| **"¿Me van a banear el número?"** | *"¿Ya te pasó algo así antes?"* | La verdad, sin adornos: es conexión por dispositivos vinculados, no la API oficial. Funciona bien para la mayoría; en casos excepcionales puede desconectarse, avisamos y reconectamos. La API oficial está en evaluación. **Nunca prometer que no pasa.** |
| **"No sé de tecnología"** | *"¿Usas WhatsApp Web?"* | Es el mismo QR. Y la configuración se hace **conversando** con un asistente, no llenando formularios. Además el onboarding es acompañado. |
| **"Ya tengo un chatbot"** | *"¿Y te ha cerrado alguna venta?"* | Casi siempre contesta menús. Intake descubre, ofrece el servicio complementario que aplica, maneja la objeción y **da seguimiento a lo que quedó sin responder**. Enseñar `Job.outcome`. |
| **"Prefiero atender yo"** | *"¿Y a las 11 de la noche también?"* | No lo reemplaza: le contesta al instante y le pasa la ficha lista. Puede pausar el bot en cualquier conversación y tomarla él. |
| **"¿Y si le dice cualquier cosa a mi cliente?"** | *"¿Qué es lo que más te preocuparía que dijera?"* | Solo puede ofrecer lo que esté cargado en su catálogo — es una regla dura del sistema, no una recomendación. Y **nunca dice que es una persona**. |
| **"Lo voy a pensar"** | Diagnóstico de tres vías: *"¿es el precio, es el momento, o es que no te terminó de convencer que funcione?"* | Cada rama tiene respuesta distinta. **"Lo voy a pensar" sin diagnosticar es una venta perdida sin enterarse.** |

---

## 6. Pipeline y métricas semanales

### Etapas

| Etapa | Definición operativa | Meta semanal (meses 1–2) | Meta semanal (mes 3, con pauta) |
| --- | --- | --- | --- |
| Conversación iniciada | Escribió al número de Intake | 5 | 15 |
| Calificado | Recibe pedidos por WhatsApp + país en los 3 mercados | 3 | 10 |
| Demo hecha | Probó el bot él mismo o vio el panel | 2 | 6 |
| Prueba activa | Tenant aprobado y WhatsApp vinculado | 1–2 | 3 |
| **Pagando** | Payment Link cobrado | **~0.4** (3 en dos meses) | **1–2** |

Las dos columnas son la misma máquina a distinta potencia. La de la izquierda es lo que
cabe mientras se cierra la Compuerta 1; la de la derecha es a lo que se parece la semana
cuando la pauta está encendida y el producto ya no necesita atención de ingeniería.

### Las cinco métricas que se revisan cada lunes

1. **Conversaciones iniciadas** (tope del embudo — si cae, es problema de tráfico).
2. **Prueba → pago** (objetivo ≥ 30%; si es menor, el problema está en los primeros 14 días
   de uso, no en el pitch).
3. **CAC por canal** (objetivo < $250).
4. **`intake_objections_total{type,state}`** — qué objeción domina y **si se está
   resolviendo**. Si "precio" aparece sin resolver semana tras semana, el encuadre de valor
   está roto; no hay que bajar el precio, hay que arreglar el descubrimiento.
5. **Churn de la cohorte del mes 1** (objetivo < 6%/mes; **umbral de alarma: 8%**). Es la
   métrica que fija el techo del negocio: con altas de 18 al mes, 6% de churn se estanca en
   300 clientes y 10% en 180. Si a los 6 meses pasa de 8%, **se congela la pauta** y todo el
   esfuerzo va a retención — comprar clientes para un balde agujereado es la forma más cara
   de descubrir el agujero.

### Ritual semanal — 45 minutos, lunes

1. Números de las cinco métricas (10 min).
2. Revisión de las conversaciones **perdidas** del bot de Intake — literalmente leerlas
   (15 min). Es la mejor fuente de mejora del producto que existe.
3. Un cambio, uno solo, a `business-facts.json`, `salesPlaybook` o al guion humano (10 min).
4. Compromisos de la semana (10 min).

---

## 7. Errores que hay que evitar (están enumerados porque son tentadores)

1. **Vender a los nueve verticales a la vez.** Dispersa el aprendizaje y ninguna demo queda
   afilada.
2. **Hacer outbound frío por WhatsApp a volumen.** Riesgo de baneo del número y de
   incumplimiento anti-spam. La pauta click-to-WhatsApp existe justo para no hacer esto.
3. **Regalar la prueba sin acompañamiento.** Una prueba sin onboarding es un churn con
   retraso, y encima cuesta dinero en LLM.
4. **Competir por precio.** El playbook del propio agente lo prohíbe; el vendedor humano
   tampoco.
5. **Reclutar partners a volumen antes de poder pagarles bien.** Máximo 5 hasta que exista
   `Tenant.partnerId`.
6. **Prometer SMS, voz o API oficial.** No existen. Es regla dura y también criterio
   comercial: se vende lo que hay.
7. **Esperar a que Fase 3 (Stripe) esté probada E2E para cobrar.** Un Payment Link resuelve
   los primeros 30 clientes hoy.
8. **Mirar solo el MRR.** Los primeros 90 días la métrica que decide el año es
   **prueba → pago** y el churn de la primera cohorte.
9. **Venderle al negocio cuyo WhatsApp *es* el negocio.** Una paquetería de alto volumen o
   un servicio de urgencias es el que más valor sacaría y el peor cliente posible hoy: con
   Baileys, 48 horas de número caído no le cuestan una molestia sino dinero, y esa reseña
   hunde el lanzamiento. Se reserva para cuando exista la API oficial — y decírselo vende
   bien con todos los demás.
10. **Vender mientras la Compuerta 1 sigue abierta.** Cada cliente nuevo antes de tener
   alertas, backups probados y dos bots verificados es una apuesta con el nombre del
   negocio de otro.

---

## 8. Resumen en una página

| | |
| --- | --- |
| **Meta 90 días** | 7 clientes de pago · ~US$490 MRR · máquina comercial encendida |
| **Meta día 150** | 20 clientes · ~US$1,400 MRR |
| **Restricción que manda** | Una persona: vende, programa y da soporte |
| **Vertical** | Tapicería + wrapping/estética automotriz |
| **Mercados** | México y Colombia primero; Estados Unidos vía dueños hispanohablantes |
| **Precio** | US$99 (EE.UU.) · US$69 (México) · US$59 (Colombia) — mensual fijo |
| **Cobro** | Stripe Payment Link + aprobación manual en `/admin` |
| **Canal día 1** | Red directa del fundador |
| **Canal mes 3** | Click-to-WhatsApp ($300–500 de prueba) |
| **Canal mes 4** | Partner Program (máx. 5 partners; estructura en revisión) |
| **Activo principal** | El propio bot de Intake como demo |
| **Métrica que manda** | Prueba → pago ≥ 30% |
| **Riesgo #1** | Churn temprano por falta de valor demostrado en los primeros 14 días |
| **Antídoto** | Mandarle al dueño **su propio número** al día 14: trabajos levantados, extras aceptados, seguimientos recuperados |
| **Bloqueante #1** | El límite del plan gratuito (300/mes) cubre al ICP entero: hay que bajarlo o no hay nada que vender |
