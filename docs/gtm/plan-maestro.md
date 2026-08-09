# Plan maestro — de cero clientes a un sueldo

**Fecha:** 2026-08-07 · **Objetivo:** que Intake le pague un sueldo al fundador.
**Dedicación:** tiempo completo · **Runway:** 3 a 6 meses.

> Este es el documento que ata a los otros cinco. No repite lo que ya dicen: los usa.
> [Plan de negocio](plan-de-negocio.md) (modelo y economía) ·
> [Estrategia 90 días](estrategia-ventas-90-dias.md) (marco comercial) ·
> [Sprint de primeros clientes](sprint-primeros-clientes.md) (días 1–21) ·
> [Pendientes antes de vender](pendientes-antes-de-vender.md) (qué bloquea qué).

---

## 1. El objetivo, en número de clientes

Antes que nada, una **corrección a mi propio plan de negocio**: estimé los costos fijos en
US$1,500/mes y no son reales para un SaaS de una persona a esta escala. Con Railway/VPS,
dominio y los planes gratuitos de Sentry, Resend y monitoreo, son **~US$100–150/mes**, y
llegan a ~US$300 con cincuenta clientes. Eso mueve el punto de equilibrio de caja de 23
clientes a **3**, y cambia por completo cuán alcanzable es tu objetivo.

La aritmética correcta:

| | |
| --- | --- |
| ARPU mezclado (50% MX, 30% CO, 20% US) | **US$70** |
| − costo variable por cliente (LLM, audio, visión) | −US$3 |
| **Contribución por cliente** | **US$67/mes** |
| Costos fijos de plataforma | ~US$150/mes |

**Cuántos clientes son un sueldo:**

| Sueldo objetivo | Clientes | Cuándo llega *(escenario base)* |
| --- | --- | --- |
| US$1,500/mes | **25** | mes 6 |
| US$2,000/mes | **32** | mes 7 |
| US$3,000/mes | **48** | mes 8 |

> **Dato útil para decidir rápido:** cada US$10 de ARPU adicional quita ~4 clientes del
> objetivo. Si en el mes 4 el embudo funciona pero la cuenta va lenta, **subir el precio a
> los nuevos es más rápido que vender más volumen.**

---

## 2. La tensión central: el sueldo llega justo cuando se acaba el dinero

Con el runway de 3 a 6 meses y el escenario base, hasta el objetivo más modesto —25 clientes,
US$1,500— cae en el **mes 6**. Es decir: **el plan llega a la meta exactamente cuando se
agota el margen, sin ninguna holgura para el error.**

Esa es la única frase que importa de este documento. Todo lo demás es cómo comprar holgura.

### Las cuatro palancas de caja, por orden de impacto

| # | Palanca | Efecto | Recomendación |
| --- | --- | --- | --- |
| **1** | **Prepago anual** (US$690 MX / US$590 CO / US$990 US, dos meses gratis) | Un cliente anual son **10 meses de caja hoy** en vez de un goteo. Si 3 de los primeros 10 lo toman, son ~US$2,000 en el banco: **más de un mes de runway comprado**, y sin bajar el precio de lista. | **Ofrecerlo desde el primer cierre**, como la opción "recomendada" al mandar el Payment Link del día 14. |
| **2** | **Cobrar el día 1 con garantía de devolución** en vez de prueba de 14 días | Adelanta dos semanas de caja por cliente y filtra al curioso. | **Desde el cliente #4.** Los tres primeros van con prueba gratis: ahí necesitas los casos más que el dinero. |
| **3** | **Cobro de implementación** (US$99 una vez) | Caja inmediata y filtro fuerte. | **No** en los primeros cinco: mata la velocidad, que es lo que hoy más vale. Reconsiderar en el mes 3. |
| **4** | **Mercado de mayor ARPU** (US, hispanohablantes) | US$99 en vez de US$69: 32 clientes bajan a 23. | Oportunista, no como eje: vender frío en EE.UU. es más lento y el runway no lo aguanta. |

### Lo que el runway obliga a cambiar del plan anterior

- **La pauta pagada se condiciona.** Estaba en el mes 3 con US$300–500. Con este runway, **solo se enciende con dinero ya cobrado**, nunca del runway. Regla: se invierte en pauta como mucho el 30% del MRR del mes anterior.
- **Los bonos del Partner Program se aplazan o se topan.** Un bono de US$138 al día 90 es caja que sale justo en los meses 4–6, que son los peores. **Máximo 2 bonos al mes hasta pasar el sueldo objetivo**, y decírselo al partner de entrada.
- **Los clientes vía partner valen menos para este objetivo:** contribuyen US$51 en vez de US$67, así que harían falta 42 clientes en vez de 32. Siguen valiendo la pena por los clientes que traen y tú no, pero **en los primeros seis meses la venta directa es la que paga el sueldo.**

---

## 3. El plan, en cuatro fases

### Fase 1 · Semanas 1–3 — Los primeros tres clientes
**Objetivo:** 3 bots vivos, 1–2 pagando. **Detalle:** [sprint](sprint-primeros-clientes.md).

Lo que no se negocia aquí: el ensayo del alta a mano antes de tocar a un cliente, el respaldo
diario, la alerta de bot caído, y decidir el límite del plan gratuito.

### Fase 2 · Semanas 4–8 — Que aguante diez
**Objetivo:** cerrar la Compuerta 1 y llegar a **13 clientes** (~US$870 MRR).

Es la fase incómoda: hay que programar mientras se vende, y ninguna de las dos cosas se
puede soltar. La regla de reparto que propongo, con 40 horas: **60% venta, 40% infraestructura**
hasta el cliente 10, y se invierte si un bot se cae.

Aquí entra el **prepago anual** en todas las conversiones y el **cobro día 1** desde el
cliente #4.

### Fase 3 · Semanas 9–16 — La máquina
**Objetivo:** **25–32 clientes**. Es el sueldo.

Entra el segundo vertical, entra la pauta (financiada con MRR, no con runway) y entra el
Partner Program con el tope de bonos. Y entra la primera contratación posible: si el soporte
pasa de 10 horas semanales, se paga con el MRR antes que ahogar la venta.

### Fase 4 · Mes 5 en adelante — Consolidar o corregir
**Objetivo:** sostener el sueldo y bajar el churn por debajo del 6%.

A partir de aquí el techo lo fija la retención, no la venta: con 18 altas al mes, 6% de churn
se estanca en 300 clientes y 10% en 180.

---

## 4. El punto de decisión: fin del mes 4

No al mes 6. Con este runway, la revisión tiene que caer **con margen para reaccionar**.

Al cierre del mes 4 deberías tener ~13 clientes y ~US$870 MRR. Con ese dato:

| Semáforo | Qué ves | Qué haces |
| --- | --- | --- |
| 🟢 **Verde** | ≥13 clientes · prueba→pago ≥30% · churn <8% | Acelerar: pauta con el 30% del MRR, empujar partners, y considerar apoyo para soporte. |
| 🟡 **Ámbar** | 7–12 clientes | Diagnosticar **cuál** de los tres cuellos, y atacar uno solo: pocas conversaciones (embudo), muchas pruebas que no pagan (valor no demostrado al día 14), o clientes que se van (retención). Subir precio a los nuevos es la palanca rápida si el embudo está sano. |
| 🔴 **Rojo** | <7 clientes **con 40+ conversaciones hechas** | El problema no es ejecución: es la propuesta o el ICP. Ver §5. |

**La condición del rojo importa tanto como el número.** Menos de 7 clientes con 15
conversaciones es que no has vendido lo suficiente; con 40+, es que el mercado te está
contestando y no te gusta la respuesta.

---

## 5. Criterios de pivote y de parada

Un plan sin criterio de fracaso es un deseo. Estos son explícitos y con fecha.

**Si al mes 4 estás en rojo, hay tres salidas y hay que elegir una, no probar las tres:**

1. **Menos clientes, más caros.** El mismo producto vendido como implementación a medida:
   US$300–500 de setup más US$99–149 al mes, a negocios más grandes. Ocho clientes así son el
   sueldo. Cambia el negocio de SaaS a servicio, con techo más bajo y caja mucho más rápida.
2. **Cambiar de vertical.** Si las objeciones registradas en `intake_objections_total` se
   concentran en "no lo necesito" más que en precio, el ICP está mal elegido, no el producto.
3. **Parar y capitalizar lo construido.** Vender el código o el equipo, o dejarlo en modo
   mantenimiento mientras entra ingreso por otra vía. No es fracaso: es no quemar el runway
   completo averiguando lo que ya sabes en el mes 4.

**Señales de parada dura, en cualquier momento:**

- Dos clientes de pago cancelan por **desconexiones de WhatsApp** en el mismo mes. Es el
  riesgo Baileys materializándose, y no se resuelve vendiendo más: se resuelve con la API
  oficial, que es un proyecto, no un parche.
- Runway por debajo de **6 semanas** sin haber llegado a 10 clientes.

---

## 6. El tablero del lunes

Cinco números, cuarenta y cinco minutos, todos los lunes. Nada más.

| # | Número | Meta | Si falla |
| --- | --- | --- | --- |
| 1 | **Caja restante, en semanas** | > 8 | Activar palancas de caja (§2) antes que cualquier otra cosa |
| 2 | **Clientes pagando** | Según fase | Ver el semáforo del mes 4 |
| 3 | **Conversaciones nuevas** | 10/semana | Es el único número que depende solo de ti. Si cae, no hay excusa de producto |
| 4 | **Prueba → pago** | ≥30% | El problema está en los primeros 14 días de uso, no en el pitch |
| 5 | **Churn de la primera cohorte** | <8% | Congelar pauta, todo a retención |

Y la práctica que más rinde y no es un número: **leer las conversaciones perdidas del bot de
Intake**. Es la mejor fuente de mejora que existe, y es gratis.

---

## 7. Lo que se cancela

Con este objetivo y este runway, estas cosas salen del plan hasta pasar el sueldo:

- **Pauta financiada con runway** — solo con MRR cobrado, máximo 30% del mes anterior.
- **Reclutar partners a volumen** — máximo 5, y con tope de 2 bonos al mes.
- **SMS, voz y API oficial de Meta** — ya estaban diferidos; siguen fuera.
- **Cualquier documento de planeación nuevo.** Este es el último. A partir de aquí, lo único
  que cambia el resultado es hablar con negocios.

---

## 8. La semana que viene

1. Decidir el límite del plan gratuito y aplicarlo *(30 min — bloquea todo lo demás)*.
2. Ensayo del alta a mano con tu segundo número *(2 h — la tarea de mayor rendimiento)*.
3. Respaldo diario y alerta de bot caído al teléfono *(3 h)*.
4. Los Payment Links, **incluyendo los anuales** *(30 min)*.
5. La lista de 20 negocios que ya te conocen *(1 h)*.
6. **Las primeras diez conversaciones** *(2 h/día a partir del día 3)*.

El punto 6 es el plan. Los cinco anteriores existen para que el 6 no dé vergüenza.
