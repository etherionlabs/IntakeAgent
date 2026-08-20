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

### 2.2 Capa de dominio — específica de Intake, se sustituye, no se adapta

| Módulo | Qué contiene |
|---|---|
| `src/domain/sales/state.ts` | `Opportunity`, `SalesDiagnosis`, `Objection`, `Urgency` y sus operaciones |
| `src/domain/sales/render.ts` | Los bloques "Diagnóstico de venta" y "Servicios adicionales" del prompt |
| `src/domain/sales/tools.ts` | `register_opportunity`, `register_discovery` |
| `src/domain/sales/followUp.ts` | Motivos de seguimiento (`pending_offer`, `incomplete_intake`) y su copy |
| `src/services/intake.ts` | **Punto de composición:** core genérico + extensiones de venta |
| `profiles/<giro>/` | Artefacto, plantilla de prompt, hechos del negocio, bienvenida |
| `skills/<técnica>/` | Técnicas de venta consultiva, descubrimiento y objeciones |
| `spa/src/components/{Opportunities,Diagnosis,SalesSummary,IntakeForm}.tsx` | UI del dominio |
| `api/src/onboarding/industries.ts` | Catálogo de giros: el **mercado** de Intake |

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

## 7. Cómo se construiría la vertical B (sin construirla)

El mapa, para que la afirmación de §1 sea verificable:

```
REUTILIZABLE (no se toca)          DOMINIO B (se escribe)
─────────────────────────          ──────────────────────
src/agent/runner.ts                src/domain/b/state.ts      ← su modelo de proceso
src/agent/toolRegistry.ts          src/domain/b/render.ts     ← sus bloques de prompt
src/agent/followUpGate.ts          src/domain/b/tools.ts      ← su pack de tools
src/artifact/state.ts              src/domain/b/followUp.ts   ← sus motivos
src/artifact/render.ts             src/services/<b>.ts        ← composición
src/channels/*                     profiles/<b>/              ← su artefacto + prompt
src/media/*                        skills/<...>/              ← sus técnicas
src/pipeline/{debouncer,…}
```

Lo que esa prueba mediría de verdad **no** es si el runtime sirve —eso ya se
sabe—, sino si el **ciclo de vida del caso** (§4) es compartido o propio de cada
vertical. Esa es la pregunta abierta que el código de hoy no puede responder, y
la que debería guiar la elección de la segunda vertical.
