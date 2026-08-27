# Fronteras de arquitectura: qué es Intake y qué es infraestructura

Este documento responde dos preguntas y nada más:

1. ¿Qué partes de este repositorio pertenecen a **Intake** y cuáles son
   **capacidades agénticas reutilizables** que un día se moverán a una
   infraestructura más general?
2. ¿Qué dependencias hay que eliminar **ahora** para que esa migración sea
   limpia, sin construir todavía esa infraestructura?

No describe una plataforma futura. Describe el corte que ya existe dentro de
Intake y que hasta ahora no estaba dicho en ninguna parte.

---

## 1. El hallazgo principal: la hipótesis es correcta a medias

La hipótesis de partida era:

> Lo que convierte al agente en un agente de ventas no es el runtime, sino el
> artefacto dinámico que gobierna el proceso — en Intake, el formulario.

**El código dice que eso es cierto para un tercio de la especialización.** El
formulario es un eje real, pero no es el único, y no es el que más cuesta.
Intake se especializa por **tres ejes**, no por uno:

| Eje | Qué controla | Dónde vive hoy | ¿Está listo para otra vertical? |
|---|---|---|---|
| **1. Artefacto** | Qué información hay que reunir | `profiles/<giro>/intake-schema.json` | **Sí.** Es dato, no código. Nueve giros ya lo demuestran. |
| **2. Comportamiento** | Cómo conversa, qué tono, qué reglas duras | `profiles/<giro>/prompt-vars.json` + `skills/<técnica>/skill.json` | **Sí.** También es dato, cargado por nombre. |
| **3. Estado y tools de dominio** | Qué significa avanzar en el proceso | **TypeScript, repartido en 6+ módulos** | **No.** Aquí está todo el trabajo. |

El eje 3 es el que rompe la tesis en su forma ingenua. En Intake ese eje son las
**oportunidades de venta** y el **diagnóstico** (dolor, implicación, urgencia,
objeciones). No son campos del formulario: son un modelo de proceso paralelo, con
su propio estado, sus propias tools, su propio render, sus propias métricas y su
propia UI.

La prueba concreta: antes de este trabajo, `renderIntakeForModel()` —el renderer
supuestamente genérico del artefacto— **escribía a mano el bloque de diagnóstico
de venta y nombraba las tools `register_discovery` y `register_opportunity` en su
salida**. El runtime del artefacto no solo conocía el dominio: le daba
instrucciones. Ese era el nudo más apretado del repositorio.

**Corolario para la estrategia:** la frase "especializamos cambiando artefacto +
tools + configuración" es correcta, pero *tools* está haciendo mucho más trabajo
del que sugiere la palabra. Una vertical nueva no aporta "unas cuantas tools":
aporta **un modelo de proceso propio** que hay que poder enchufar sin tocar el
core. Eso es lo que los contratos introducidos aquí hacen posible.

---

## 2. Mapa de componentes

### 2.1 Núcleo reutilizable — portable tal cual

Estos módulos no saben qué es una venta, un taller ni un cliente. Son los
candidatos reales a extracción.

| Módulo | Capacidad | Notas |
|---|---|---|
| `src/agent/runner.ts` | Loop del agente: prompt → modelo → tools → auditoría | **Ya era neutral.** Cero conocimiento de dominio. |
| `src/agent/toolRegistry.ts` | Contrato de tool + registro con exposición condicional | Nuevo. Ver §3.2. |
| `src/agent/errors.ts` | Clasificación de errores del LLM (429 / saldo / red) | Determinista, sin dominio. |
| `src/agent/audit.ts` | Historial de ejecución (`AgentRun`: tokens, costo, tool calls) | Observabilidad agéntica genuina. |
| `src/agent/sdk-factory.ts` | Adaptador del SDK del modelo | Sustituible por otro proveedor. |
| `src/agent/followUpGate.ts` | Reglas de "¿se puede escribir sin molestar?" | Nuevo. Ver §3.3. |
| `src/artifact/state.ts` | Estado del artefacto, escritura validada, completitud | Nuevo. Ver §3.1. |
| `src/artifact/render.ts` | Render del artefacto para el modelo + punto de extensión | Nuevo. Ver §3.1. |
| `src/config/intake-schema.ts` | Esquema de artefacto (secciones, campos, tipos, validación) | **Genérico, solo mal nombrado.** No sabe nada de servicios. |
| `src/channels/types.ts` | Contratos de canal: fuente entrante, sender, notifier, estado | Frontera ya bien puesta, con una sola implementación. |
| `src/adapters/whatsapp/*` | Implementación WhatsApp (Baileys) | Aislada detrás de los contratos anteriores. |
| `src/media/*` | Store, transcripción, descripción y edición de imágenes | Interfaz + implementación + `Noop`, con contexto **inyectado**. |
| `src/pipeline/debouncer.ts`, `idempotency.ts`, `normalize.ts`, `resolveContact.ts` | Ingesta: agrupar ráfagas, deduplicar, persistir | Mecánica pura de entrada. |
| `src/config/loader.ts` (`ConfigCache`) | Carga de perfil + recarga en caliente con última versión válida | Patrón reutilizable, tipos con nombres de Intake. |
| `src/tenant/*` | Supervisión multi-tenant: arrancar, reconectar, estado | Genérico. |
| `src/lib/*` | Logger, observabilidad, alertas, rutas | Genérico. |

### 2.2 Módulos de dominio — componibles, no exclusivos de Intake

> **Corrección (revisión posterior).** Una versión anterior de este documento
> clasificó `src/domain/sales/` como *"específico de Intake — NO extraer"*. Es
> falso, y la etiqueta era activamente dañina: le decía al siguiente que tirara
> el módulo de ventas al construir otra vertical.
>
> **Ventas no es una vertical: es un módulo.** Cualquier vertical que además de
> captar información quiera vender lo compone. Lo específico de Intake es la
> COMBINACIÓN (`intake` + `ventas`) y los giros de `profiles/`.

El modelo correcto es el de la biblioteca de skills, que ya funciona en este
repositorio: capacidades en una biblioteca, verticales que las referencian **por
nombre**, sin repetir código.

```
VERTICAL = [módulos componibles] + perfil (giro, copy, hechos) + canal

Intake (talleres)        = [intake, ventas] + profiles/tapiceria  + WhatsApp
Captación pura           = [intake]         + profiles/<x>        + WhatsApp
Otra vertical            = [intake?, <su módulo>] + …
```

| Módulo | Qué aporta | Reutilizable |
|---|---|---|
| `intake` | Artefacto declarativo, captura validada, completitud, escalado a humano | **Sí** |
| `ventas` | Oportunidades, diagnóstico, objeciones, sus tools, sus bloques, sus skills | **Sí** |

**Específico de Intake** (esto sí se sustituye por vertical):

| Pieza | Qué contiene |
|---|---|
| `src/services/intake.ts` | La composición concreta: qué módulos y en qué orden |
| `profiles/<giro>/` | Artefacto, plantilla de prompt, hechos del negocio, bienvenida |
| `spa/src/**` | UI del panel |
| `api/src/onboarding/industries.ts` | Catálogo de giros: el **mercado** de Intake |

#### Qué necesita declarar un módulo

Derivado de los dos que existen, no diseñado por anticipación:

| Slot | `intake` | `ventas` | Contrato |
|---|---|---|---|
| Estado que añade al artefacto | secciones del esquema | `opportunities`, `diagnosis` | parcial |
| Tools | 5 | 2 | `ToolProvider` |
| Bloques de prompt | render del core | 2 secciones | `ArtifactRenderSection` |
| Compuerta de cierre | `isIntakeComplete` | **ninguna** (ver §5) | no existe |
| Motivo de seguimiento | `incomplete_intake` | `pending_offer` | medio |
| Skills que aporta | — | `descubrimiento`, `ventas`, `objeciones` | por nombre |

Dos de seis slots ya tienen contrato. Esto no es reescribir: es recoger lo que ya
existe en una declaración.

#### Lo genuinamente difícil de componer

No es la lista de módulos; son sus interacciones:

1. **Cierre compuesto.** El cierre debe consultar a todos los módulos que
   declaren compuerta. Pero `ventas` quiere *avisar fuerte*, no *bloquear*:
   impedir cerrar un trabajo porque falta registrar `urgency` sería peor que el
   hueco actual. Las compuertas necesitan severidad, no un booleano.
2. **Prioridad entre módulos.** Hoy `pending_offer` gana a `incomplete_intake`.
   Esa decisión no pertenece a ningún módulo: es de la composición.
3. **Presupuesto de pasos y de prompt.** `maxSteps: 6` y hasta 10 tools
   expuestas. Cada módulo suma bloque y tools. La composabilidad tiene un techo
   empírico que no aparece en ningún diagrama.

#### Advertencia sobre la analogía con skills

Las skills son **inertes**: texto inyectado en el prompt, sin estado, sin
escrituras, sin modos de fallo. Los módulos son **activos**: son dueños de
estado, escriben en `job.intake` y controlan transiciones. La biblioteca de
skills prueba la **ergonomía** (referenciar por nombre, seleccionar por tenant,
degradar sin brickear), no la **semántica** de componer cosas activas.

Y un dato sobrio: los 10 perfiles declaran exactamente las mismas 3 skills. El
mecanismo está probado; la *variación* nunca se ha ejercido.

### 2.3 Servicios con potencial de plataforma — hoy correctamente acoplados

Multi-tenancy, persistencia, historial de ejecución, límites de uso, facturación
y acciones humanas (panel) son capacidades que cualquier vertical necesitará.
**Hoy están bien donde están.** Extraerlas ahora significaría diseñar una
plataforma con una sola vertical de referencia, que es exactamente el error que
esta etapa quiere evitar. Se documentan como candidatos, no se tocan.

---

## 3. El refactor que se hizo (y por qué exactamente ese)

Criterio aplicado: **abstraer solo donde Intake ya demostró la frontera**, y con
cambio de comportamiento cero. Los tres refactors salen de fronteras que el
código ya estaba dibujando mal por su cuenta.

### 3.1 Separar el runtime del artefacto de su contenido de venta

**Frontera demostrada por:** `opportunities` y `diagnosis` se añadieron en dos
momentos distintos siguiendo *el mismo patrón* (bloque en el estado + tool +
sección en el render + métrica + UI). Dos instancias del mismo patrón es una
frontera, no una coincidencia.

- `src/artifact/state.ts` — estado, escritura validada, completitud. Genérico.
- `src/artifact/render.ts` — render + contrato `ArtifactRenderSection`.
- `src/domain/sales/{state,render}.ts` — lo de venta.
- `src/services/intake.ts` — fachada que compone ambos y **conserva su API
  pública completa**, así que ningún otro archivo del repositorio cambió.

El renderer ya no sabe qué es una objeción. El dominio le pasa bloques; el core
los inserta sin interpretarlos. La salida del prompt es **idéntica byte a byte**:
el prompt es una interfaz con el modelo y cambiarlo dentro de un refactor de
fronteras habría mezclado dos riesgos distintos.

### 3.2 Registro de tools en vez de una lista escrita a mano

**Frontera demostrada por:** `buildTools()` ya hacía exposición condicional (hay
fotos → `reanalyze_image`; hay editor → `generate_preview`; hay otro trabajo
abierto → `select_or_open_job`). Era un registro intentando nacer, escrito como
`if`s sueltos.

- `ToolProvider` = `{ name, isAvailable?, build }`; un pack es una lista.
- `runtimeToolProviders` (capacidades) + `salesToolProviders` (dominio) +
  `conditionalToolProviders`, compuestos en `intakeToolProviders`.
- El orden que ve el modelo se conserva exactamente.

Una vertical nueva arma **su** pack sustituyendo `salesToolProviders`. No toca ni
el runner ni el registro.

### 3.3 Separar "¿se puede molestar?" de "¿hay algo que perseguir?"

**Frontera demostrada por:** el seguimiento proactivo mezclaba reglas de
protección del cliente (bot pausado, tope de envíos, horario, cuota) con juicio
comercial (una oferta en el aire vale más que un dato faltante) en una sola
función.

- `src/agent/followUpGate.ts` — la compuerta. Vale para cualquier vertical.
- `src/domain/sales/followUp.ts` — los motivos y el copy.
- `src/services/followUp.ts` — compone ambos, misma API pública.

El orden importa y quedó explícito: **primero la compuerta, después el dominio.**
Ninguna razón comercial justifica escribirle a quien pausó el bot.

### 3.4 Un test que sostiene la frontera

`tests/architecture/boundaries.test.ts` falla si un módulo del núcleo importa de
`src/domain/` o menciona vocabulario de ventas en su **código** (los comentarios
que explican la frontera sí pueden nombrar el ejemplo). Es la versión ejecutable
de la regla "si hace falta un `if <dominio>` en el runtime, la abstracción está
mal puesta" — y está verificado que falla cuando se introduce una fuga real.

**Estado:** 646 tests en verde (616 previos + 30 de frontera), typecheck limpio,
cero cambios de comportamiento.

---

## 4. Lo que deliberadamente NO se abstrajo

Cada una de estas es una decisión, no un olvido.

| Pieza | Por qué se deja | Qué la desbloquearía |
|---|---|---|
| **Ciclo de vida del trabajo** (`OPEN_INTAKE → READY_FOR_REVIEW → IN_PROGRESS → CLOSED`, `outcome: WON/LOST`) | Es un modelo de proceso **de dominio** grabado en Prisma, `services/job.ts`, tools, API y SPA. Generalizarlo con una sola vertical en producción sería inventar una máquina de estados para necesidades imaginarias. | Ver qué estados pide la segunda vertical. Si coinciden en forma, hay abstracción; si no, hay dos procesos distintos y está bien. |
| **Nombres en Prisma** (`Job.intake`, `intakeComplete`, `TenantSettings.industry`) | Renombrar cuesta migraciones sobre datos de producción y no elimina ni un acoplamiento. | Una extracción real, donde el esquema se rediseña de todos modos. |
| **Métricas** (`intake_opportunities_total`, `intake_objections_total{type,state}`) | La taxonomía de ventas está en los **nombres** de las métricas. Renombrarlas rompe dashboards y alertas en operación. | Hacerlo junto con el cambio de observabilidad, no dentro de un refactor de fronteras. |
| **Mover `src/config/intake-schema.ts` a `src/artifact/`** | Es genérico y está bien; solo tiene un nombre heredado. Mover el archivo son ~15 imports tocados y **cero acoplamiento eliminado**. | El día de la extracción, que es cuando el rename es gratis. |
| **`api/`, `spa/`, facturación, onboarding** | Son la capa de producto de Intake. Están donde deben. | Nada; no son candidatos. |
| **Un `ArtifactRuntime` inyectable, un bus de eventos, un motor de estados** | No hay una segunda vertical que muestre qué forma deben tener. Sería infraestructura hipotética. | La segunda vertical. |

---

## 5. Qué impide hoy conectar un artefacto distinto

Con el refactor hecho, el inventario honesto de lo que sigue atado:

| Dependencia | Gravedad | Comentario |
|---|---|---|
| Ciclo de vida del `Job` grabado en el esquema | **Alta** | Es el bloqueo real, no el formulario. Una vertical con otro proceso (ej. estados que se repiten o van hacia atrás) no cabe sin migración. |
| `mark_ready_for_review` / `close_job` asumen ese ciclo y el aviso al dueño | Media | Documentado en el código. Se mueven cuando se sepa qué ciclo pide la vertical B. |
| `intake.media.photo_count` mutado directamente por el coordinator | Baja | El pipeline conoce la forma interna del artefacto en dos sitios. Trivial de encapsular cuando estorbe. |
| Métricas con taxonomía de venta en el nombre | Baja | Aislado, sin efecto arquitectónico. |
| `isBareGreeting` con lista de saludos en español | Baja | Heurística de idioma, no de dominio. |
| `Profile` mezcla artefacto, comportamiento y ajustes de media | Baja | Funciona; separarlo ahora sería cosmético. |

Ninguna de estas impide **hoy** enchufar otro artefacto con otras tools. La única
que impondría trabajo de esquema es el ciclo de vida del trabajo.

---

## 6. Riesgos de generalizar demasiado pronto

1. **El prompt es una interfaz, no un detalle.** Todo el comportamiento útil del
   agente está afinado contra el texto exacto que ve el modelo. Cualquier
   refactor que cambie ese texto es un cambio de producto disfrazado de limpieza.
   Por eso aquí la salida se conservó idéntica.
2. **Dos verticales no hacen una plataforma.** El patrón que se repita entre
   Intake y la vertical B puede ser coincidencia. El momento de decidir la forma
   final es después de la segunda, no durante.
3. **La configuración se vuelve un lenguaje de programación.** `profiles/` +
   `skills/` funcionan porque son declarativos y pequeños. Cuando una vertical
   necesite condicionales o bucles en JSON, la respuesta correcta es código en
   `src/domain/`, no un motor de reglas.
4. **El multi-tenant de Intake no es el multi-tenant de una plataforma.** Hoy un
   tenant es un negocio con un WhatsApp. Una plataforma con varias verticales
   tiene otra forma. Extraer el modelo actual sería exportar una suposición.
5. **El eje 3 se puede volver a fugar en silencio.** Es lo que ya pasó una vez.
   El test de fronteras existe justo para que la próxima fuga falle en CI en vez
   de descubrirse dos verticales después.

---

## 7. Cómo se construiría otra vertical (sin construirla)

Una vertical **compone**, no reescribe. Solo aporta lo que ningún módulo cubre:

```
NÚCLEO                      MÓDULOS (biblioteca)      VERTICAL (aporta)
──────                      ────────────────────      ─────────────────
src/agent/runner.ts         intake  ← reutiliza       lista de módulos + prioridad
src/agent/toolRegistry.ts   ventas  ← reutiliza       profiles/<giro>/
src/agent/followUpGate.ts   <nuevo> ← escribe SOLO    canal
src/artifact/*                        si ningún        UI del panel
src/channels/*, src/media/*           módulo lo cubre
src/pipeline/{debouncer,…}
```

Una vertical de captación pura es `[intake]`. Una de venta es `[intake, ventas]`.
Una de contabilidad sería `[intake?, conciliación]` — y solo `conciliación` es
código nuevo.

### La prueba barata, antes de cualquier vertical nueva

La validación no exige inventar un dominio. Basta con **quitar** uno:

> ¿Funciona Intake con `[intake]` a secas, sin `ventas`?

Es un producto real (negocios que solo quieren captación, sin upselling), ejerce
la composición con **variación auténtica** —que es justo lo que la biblioteca de
skills nunca ha ejercido— y saca a la luz cada acoplamiento oculto sin socio ni
mercado nuevo. Los resultados están en §8.

Lo que ni esa prueba ni la vertical B pueden esquivar es la pregunta de §4: si el
**ciclo de vida del caso** es compartido o propio de cada vertical. Es lo único
que el código de hoy no puede responder.

---

## 8. Resultado del experimento: Intake sin `ventas`

Se compuso una vertical de **captación pura** (`profiles/captacion`, `modules:
["intake"]`) para ver qué se derrama al quitar un módulo. Esto es lo que salió.

### 8.1 Lo que se rompió (y que era invisible de otro modo)

**1. `incomplete_intake` estaba en el módulo equivocado.** El motivo de
seguimiento "faltan campos requeridos" vivía en `domain/sales/`. Al componer sin
ventas, la vertical de captación se quedaba **sin ningún motivo de seguimiento**:
muda ante el silencio del cliente, que es justo el problema que el seguimiento
existe para resolver. Ahora vive en el módulo `intake`, donde siempre debió estar.

**2. El acoplamiento más fuerte no estaba en `src/`, estaba en los tests.**
`tests/profiles/sales.test.ts` exigía a **todo** perfil del directorio traer
`salesPlaybook`, referenciarlo en su plantilla y adoptar la skill `ventas`. Es
decir: la suite codificaba *"toda vertical vende"* como invariante del sistema.
Ninguna revisión del código fuente lo habría encontrado. El invariante correcto
—"vende quien compone `ventas`, y quien no lo compone no arrastra copy de
venta"— ahora está expresado en ambas direcciones.

**3. El orden del catálogo de tools cambió.** Agrupar las tools por módulo mueve
`flag_non_intake` y `request_photo` detrás de las de venta. Es inherente al
modelo de composición: o se agrupan por módulo o se conserva un orden plano
escrito a mano. Se eligió agrupar (las tools relacionadas quedan adyacentes),
y queda anotado porque el orden es parte de lo que ve el modelo.

### 8.2 Lo que NO se rompió

Cero cambios en `runner.ts`, `artifact/`, `channels/`, `media/` y el pipeline de
ingesta. **La tesis se sostiene para el runtime**: el loop agéntico no se enteró
de que le quitaron medio dominio.

Y un regalo inesperado: los consumidores de estado de venta (aviso al dueño,
panel, overview) **degradan a vacío en lugar de reventar**, porque ya toleraban
`undefined` para los jobs anteriores a esa función. La retro-compatibilidad
resultó ser, gratis, compatibilidad de composición.

### 8.3 El hallazgo de fondo: vertical ≠ giro

Es el más importante y el que no se arregla con un refactor.

Hoy `Tenant.industry` mapea directo a `profiles/<industry>`: **un solo eje**. Una
tapicería que quiera captación pura no tiene cómo expresarlo — o elige
`tapiceria` (que compone `ventas`) o elige `captacion` (que pierde todo el
conocimiento de tapicería: catálogo, foco de imágenes, vocabulario).

Son dos ejes independientes que el modelo de datos fusionó en uno:

```
GIRO         (qué sabe el negocio)      tapicería, plomería, mecánica…
COMPOSICIÓN  (qué hace el agente)       [intake] · [intake, ventas] · …
```

Mientras sigan fusionados, cada combinación exige un directorio de perfil propio
—`tapiceria`, `tapiceria-captacion`, `plomeria`, `plomeria-captacion`…—, que es
exactamente la repetición de código que la plataforma quiere eliminar. **Separar
estos dos ejes es el siguiente trabajo estructural**, por delante de cualquier
vertical nueva.

### 8.4 Hueco conocido: skills y módulos no se validan entre sí

`TenantSettings.skills` (el selector del panel) sustituye las skills del perfil
sin consultar los módulos compuestos. Se le puede inyectar la técnica `ventas` a
una vertical que no compone el módulo: el modelo recibe instrucciones para
ofrecer y registrar oportunidades, pero `register_opportunity` no existe en su
catálogo. Está pintado por un test, no aprobado. La corrección natural llega con
§8.3, cuando la composición sea un eje de primera clase.

### 8.5 Qué costó

Dos módulos declarados, un registro, la composición enhebrada por cuatro puntos
(estado inicial, render, tools, seguimiento) y los fixtures de test actualizados.
Ni el runner ni el artefacto ni los canales se tocaron.

Ése es el número honesto de "cuán componible era ya": **caro en los bordes,
gratis en el núcleo** — que es la forma que debe tener si la separación de §3
estaba bien hecha.

---

## 9. Fragmentos: reutilización por debajo de la vertical

El objetivo declarado es que el repositorio quede partido en dos mitades:

```
NÚCLEO    → sustituible por cualquier otro arnés agéntico
VERTICAL  → creable de cero, o por REFERENCIA a lo que ya existe
```

Los módulos (§8) resolvieron la mitad de la segunda: una vertical compone
capacidades. Faltaba la otra mitad — que **no tenga que repetir lo que ya está
escrito en otra**.

### 9.1 La duplicación era real, no hipotética

```
sección client     → IDÉNTICA en 7 giros (campos, tipos, required y etiquetas)
sección logistics  → IDÉNTICA en 3 giros, con una variante deliberada en cerrajería
```

Once copias entre las dos, con **una sola vertical en producción**. La necesidad
de reutilizar por debajo del módulo no había que anticiparla: ya se estaba
pagando.

Y fíjese qué son esas piezas. `client` es *"cómo se identifica a un cliente"*;
`logistics` es *"dónde y cuándo"*. No son verticales ni módulos: son **fragmentos
de conocimiento operativo**, una granularidad por debajo.

### 9.2 Se referencia por contrato, nunca por el vecino

Ésta es la decisión que evita reproducir el acoplamiento que se está quitando:

```
✗  "dame el `client` de cerrajería"   → tapicería queda atada a cerrajería
✓  "necesito `customer.identity`"     → ambas atadas al mismo contrato
```

Tapicería no depende de cerrajería: las dos dependen de un concepto compartido.
Con referencias por nombre, cualquier vertical se convierte en la base frágil de
sus hermanas. Con `provides`/`use`, un fragmento se puede sustituir por otro que
prometa lo mismo sin que ninguna vertical se entere.

```json
"sections": [
  { "use": "customer.identity" },
  { "key": "work", "label": "Servicio", "fields": [ … ] },
  { "use": "service.logistics" }
]
```

La expansión es **posicional**: el orden de las secciones es el orden en que el
modelo las lee, así que la vertical decide dónde va el fragmento.

### 9.3 La estructura es del contrato; las palabras, de la vertical

Cerrajería pide *"Dirección exacta"* donde las demás dicen *"Dirección"* — un
cerrajero necesita el número. Sin una válvula para eso, la primera vertical que
necesite cambiar una palabra abandona el fragmento y vuelve a copiar la sección
entera.

La válvula existe, y está acotada a propósito:

| | Dueño |
|---|---|
| claves, tipos, `required`, opciones | **el contrato** |
| etiquetas visibles | **la vertical** (`labels`) |

Cambiar una etiqueta no rompe el contrato; cambiar un tipo sí. Renombrar un campo
que no existe falla al cargar — casi siempre es un typo, y en silencio dejaría a
la vertical creyendo que renombró algo.

### 9.4 Lo que falla al cargar, y por qué

Un fragmento ausente, dos fragmentos prometiendo el mismo contrato, una sección
declarada dos veces o un renombrado a un campo inexistente **revientan al cargar
el perfil**, no en el turno de un cliente. Un fragmento no es una skill: una skill
que falta se pierde como texto, un fragmento que falta cambia qué campos existen
y qué se persiste.

### 9.5 Trazabilidad

El `configHash` incorpora la huella de los fragmentos referenciados. Sin eso,
editar `customer.identity` cambiaría el esquema efectivo de 7 giros sin mover su
hash, y los `AgentRun` quedarían atribuidos a una configuración que no corrió. Es
el mismo problema que ya se había resuelto para las skills.

### 9.6 Estado

Los 11 perfiles resuelven a un esquema **idéntico** al anterior, campo por campo
y etiqueta por etiqueta. El aprovisionamiento de tenants no cambió: copia
`profile.intakeSchema`, que ya llega plano, así que `TenantSettings` sigue
guardando un esquema completo y el panel no se entera de que los fragmentos
existen.

### 9.7 Lo que deliberadamente NO se fragmentó

`generico`, `captacion` y `paqueteria` tienen secciones `client` **parecidas pero
distintas** (2 campos en vez de 3, `phone` en vez de `phone_alt`). Se dejan como
están.

Forzarlas al fragmento exigiría un mecanismo de subconjuntos o de campos
opcionales, y la evidencia sostiene **dos** fragmentos, no un sistema de
composición de esquemas. Si crear una vertical acabara siendo ensamblar treinta
referencias, se habría cambiado duplicación por indirección sin ganar nada.

Que existan tres variantes cercanas sí es señal de que el override acabará
necesitando más que etiquetas. Se hará cuando haya casos, no antes.

---

## 10. El elemento ejecuta procesos, y por eso se puede mejorar

Un elemento de vertical no es solo datos. Ejecuta lógica propia —hoy TypeScript,
mañana lo que haga falta— y eso **no es una concesión: es el mecanismo**.

El razonamiento corto: si el elemento fuera solo datos, quien los interpreta es
el núcleo. Mejorar cómo funciona algo obligaría a tocar el núcleo, y eso afecta a
todas las verticales a la vez. **Para poder actualizar un elemento por separado,
el elemento tiene que ser dueño de su comportamiento.**

### 10.1 Lo que lo impedía

```
sales/tools.ts: import { updateJobIntake } from '../../services/job';   ← Prisma + modelo Job
sales/tools.ts: import { incOpportunity }  from '../../lib/metrics';    ← registro en memoria
```

Dos imports. Con ellos, cambiar el núcleo por otro arnés rompía el elemento, y
cambiar cómo se persiste o cómo se mide obligaba a editar el dominio. Los dos
objetivos —núcleo sustituible, elementos actualizables— estaban bloqueados por la
misma línea de código.

### 10.2 `ElementHost`: la superficie completa del anfitrión

```ts
interface ElementHost {
  saveArtifact(caseId, state): Promise<void>;
  countEvent(name, labels?): void;
}
```

Dos métodos. El criterio de admisión es explícito: **aquí solo entra lo que
cualquier arnés agéntico tendría**. Si algún día hace falta un método que solo
este runtime sabe hacer, la abstracción está mal puesta.

Y la frontera no depende de disciplina. Un elemento declara sus tools como
`ElementToolProvider`, cuya firma es `build(ctx, host)` — **nunca recibe
`AgentDeps`**. No puede alcanzar la base de datos, el notificador ni la config
aunque quiera, porque nadie se los entrega.

`src/services/elementHost.ts` es la única pieza que traduce entre lo que pide un
elemento y cómo lo resuelve este runtime. Portar Intake a otro arnés consiste,
del lado del dominio, en escribir otro archivo como ése.

### 10.3 Las métricas dejaron de conocer el dominio

`incOpportunity` / `incObjection` desaparecen del núcleo; queda
`incDomainEvent(name, labels)`. El nombre lo elige el elemento y el arnés lo
transporta sin interpretarlo. **Los nombres publicados no cambian**
(`intake_opportunities_total{status}`, `intake_objections_total{type,state}`), así
que ningún dashboard ni alerta se entera — pero ahora un elemento puede añadir o
cambiar sus métricas sin tocar `src/lib/`.

### 10.4 Hallazgo: `intake` no era un elemento

Al intentar declarar sus tools como tools de elemento, el compilador mostró que
`update_intake`, `mark_ready_for_review` y `close_job` necesitan el notificador,
la config y el esquema del perfil. Es decir: **son primitivas del arnés, no
conocimiento de dominio.** Capturar información estructurada en un artefacto y
escalarla a una persona es lo que hace el runtime.

El módulo `intake` queda sin tools. Lo específico de ese dominio son el esquema
—que ya vive en `profiles/`— y su motivo de seguimiento. **El único elemento con
código propio hoy es `ventas`**, y conviene saberlo: la superficie real de lo que
hay que portar, o reescribir para otra vertical, es mucho menor de lo que
parecía.

### 10.5 Versión: la puerta a mejorarlos

Cada elemento declara `version`, y esa versión entra en el `configHash`. Si se
publica una forma mejor de que `ventas` haga su trabajo, el hash se mueve aunque
no cambie ningún archivo del giro, y cada `AgentRun` queda atribuido a la versión
que de verdad corrió. Sin eso, "actualizar el elemento" sería un cambio invisible
en la auditoría.

### 10.6 La regla, ejecutable

`tests/architecture/boundaries.test.ts` falla si cualquier archivo de
`src/domain/**` importa `services/`, `lib/metrics`, `storage/` o `@prisma/client`.
Está verificado que caza una violación real, no que pase por vacío.

Es la traducción a CI de las dos frases del objetivo: el núcleo se puede
sustituir, y el elemento se puede actualizar.

---

## 11. El diagnóstico, declarado

### 11.1 Un desvío deliberado

El plan era meter `diagnosis` como sección del esquema del artefacto. Al ir a
hacerlo apareció el coste real: `GET /settings/fields` devuelve
`intakeSchema.sections` y el `PUT` las reescribe, así que el dueño del negocio
vería —y podría borrar— la sección del módulo de ventas. Evitarlo obligaba a que
el esquema del worker y el del panel divergieran, componiendo en tres sitios, más
una migración de datos en producción.

Demasiado riesgo para lo que aportaba. La vía que se tomó da casi todo el valor
sin nada de eso: **el elemento declara sus campos y usa los validadores del
núcleo**, sin vivir en el array de secciones.

### 11.2 Qué era antes

```ts
function missingDiscovery(state) {
  if (!diag.pain)        missing.push('el problema en sus palabras');
  if (!diag.implication) missing.push('qué le cuesta si NO lo resuelve');
  if (!diag.urgency)     missing.push('qué tan urgente es');
}
```

Los tipos en una interfaz, las etiquetas incrustadas en tres condiciones, y la
validación en ninguna parte. Tres copias del mismo conocimiento en tres formas
distintas.

### 11.3 Qué es ahora

```ts
export const DIAGNOSIS_FIELDS: readonly IntakeField[] = [
  { key: 'pain',        label: 'el problema en sus palabras',    type: 'text', required: true },
  { key: 'implication', label: 'qué le cuesta si NO lo resuelve', type: 'text', required: true },
  { key: 'urgency',     label: 'qué tan urgente es',              type: 'enum',
    required: true, options: ['alta', 'media', 'baja'] },
];
```

De esa declaración se derivan ahora **lo que falta** (`unsetDeclaredFields`), **la
validación** (`validateDeclaredFields`) y **el bloque del prompt**. Añadir un
campo al diagnóstico ya no exige tocar tres funciones: se añade a la lista.

El reparto es el del §10: el elemento es dueño de QUÉ hay que descubrir; el
núcleo pone el CÓMO se calcula lo que falta y cómo se valida — los mismos
mecanismos que usa el artefacto, no una copia.

### 11.4 Lo que se ganó por el camino

**Validación que no existía.** `register_discovery` escribe lo que el modelo
interpretó de una conversación, y hasta ahora nadie lo miraba: un `urgency` fuera
de las opciones o un `pain` vacío entraban sin más. Ahora se rechazan.

**El texto que ve el modelo no cambió**, y hay tests que lo fijan palabra por
palabra, con el bloque vacío y con el bloque completo.

### 11.5 Lo que sigue pendiente

Las **colecciones** (`opportunities`, `objections`) siguen sin declarar: son
listas con upsert por clave y el vocabulario de campos declarados solo conoce
escalares. Hay dos casos, que es evidencia suficiente para justificar un tipo
"colección" — pero se hará cuando se aborde, no de rebote.

Y el **criterio de cierre** sigue sin conectarse: `mark_ready_for_review` solo
consulta `isIntakeComplete`, así que se pueden cerrar trabajos con el formulario
lleno y sin haber descubierto nada. La declaración ya marca los tres campos como
`required`; falta el contrato de entrega (§4) que le dé voz al elemento en el
cierre, **con severidad de advertir, no de bloquear**.

---

## 12. Portabilidad: qué sale primero al separar en proyectos

Intake, movilidad y lo que venga acabarán siendo proyectos separados que
comparten arquitectura. Esta sección fija qué se puede extraer **hoy**, medido
en vez de supuesto.

### 12.1 Contar archivos no sirve

La primera medición fue por archivo: *"¿cuántos importan `@prisma/client`?"*.
Daba esto:

```
src/adapters   0 de 8      ← "limpio"
src/channels   0 de 1      ← "limpio"
```

**Ambos eran falsos.** Un recorrido transitivo del grafo de imports encontró 13
caminos que llegaban a Prisma:

```
src/channels/types.ts → src/pipeline/types.ts → @prisma/client
src/adapters/whatsapp/adapter.ts → src/pipeline/coordinator.ts → @prisma/client
```

Una carpeta es portable cuando **nada de lo que alcanza** necesita la base de
datos, no cuando sus archivos no la nombran. Es la diferencia entre creer que se
puede extraer y poder hacerlo.

### 12.2 La inversión que lo arregló

Los dos escapes eran el mismo error de dirección:

| Estaba en | Debía estar en | Por qué |
|---|---|---|
| `Channel` | `channels/` | Es vocabulario del canal; el pipeline los consume, no al revés |
| `RawInboundMessage` | `channels/` | Es lo que un canal PRODUCE, antes de que nadie lo interprete |
| — | `InboundSink` (nuevo) | El adaptador importaba la clase `InboundCoordinator` y arrastraba el pipeline entero, cuando solo usa **un método** |

Un adaptador no debe saber qué se hace con el mensaje: solo que alguien lo
recoge. Con eso, los caminos a Prisma pasaron de 13 a **cero**.

### 12.3 Lo que sale hoy sin tocar una línea

```
@etherion/core   src/artifact · src/research · src/channels
                 src/media · src/lib · src/adapters
```

28 archivos alcanzables, ninguno necesita la base de datos.

`src/domain/` (los elementos `intake`, `ventas`, `rutas`) y `fragments/` salen
también: ya los protege la regla del §10.

### 12.4 Lo que NO sale, y es una sola cosa

`src/pipeline/` y `src/services/` siguen atados a Prisma, y **está bien**: son el
modelo de caso de Intake —`Job`, `Contact`, `Message`, el ciclo `OPEN_INTAKE →
READY_FOR_REVIEW`—. No es acoplamiento accidental repartido: es la deuda de §4,
concentrada en un sitio.

Queda una fuga menor apuntada: **`AgentDeps` menciona `PrismaClient`**. Los
elementos están blindados por `ElementHost`, pero los tipos del arnés no.

### 12.5 Por qué no separar todavía

Movilidad ya demostró que su ciclo de vida **no** es el de Intake: no hay dueño a
quien avisar, `mark_ready_for_review` no aplica. Publicar `@etherion/core` con
`Job` dentro heredaría ese error en tres proyectos a la vez.

Separar después es barato porque las fronteras están limpias y hay tests que las
sostienen. Decidir mal el modelo de caso es caro siempre.

### 12.6 La regla, ejecutable

`tests/architecture/portabilidad.test.ts` recorre el grafo transitivo desde las
seis carpetas portables y falla si alguna alcanza la persistencia, **imprimiendo
el camino completo** — sin él, "algo importa Prisma" no dice por dónde. Además
comprueba que la deuda siga donde está documentada, y que el recorrido no pase
por vacío. Verificado que caza una regresión real.
