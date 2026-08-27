# Movilidad laboral — herramienta de validación

Esto **no es una vertical**. Es el instrumento para contestar la pregunta de la
que depende que la vertical exista.

## La pregunta

> ¿Podemos traer hoy, **con fuente y fecha**, oportunidades y requisitos reales
> para un puesto y una ciudad concretos?

Todo lo demás del producto —perfil, rutas, viabilidad, seguimiento, cobro— es
construcción normal sobre lo que ya existe en este repositorio. La investigación
no: es capacidad nueva, es el corazón del producto y es la parte frágil.

Los job boards bloquean scrapers, los datos caducan en días, y la regla del
producto prohíbe inventar. **Si esto no funciona de forma fiable, el producto
deja de ser un agente de movilidad y se convierte en un orientador vocacional**
— justo lo que el brief descarta. Por eso se valida antes de escribir una ruta.

## Cómo se corre

```bash
export OPENROUTER_API_KEY=sk-or-v1-…

npm run cli:investigar -- --puesto "HVAC Helper" --lugar "Brandon, Florida"

npm run cli:investigar -- --puesto "HVAC Helper" --lugar "Brandon, FL" \
  --contexto "sin experiencia previa, inglés básico, tiene auto"

# probar otra vía de búsqueda
npm run cli:investigar -- --puesto "HVAC Helper" --lugar "Brandon, FL" --modelo "perplexity/sonar"
```

Lanza **cuatro** preguntas, no una búsqueda genérica. Cada una alimenta un trozo
concreto de una futura ruta:

| Pregunta | Qué parte de la ruta alimenta |
|---|---|
| Vacantes reales | el destino y las oportunidades concretas |
| Requisitos de entrada | la **brecha** — y si hay certificación obligatoria |
| Salario | la evaluación de viabilidad y el incentivo |
| Formación / apprenticeships | los **pasos**, con coste y duración |

## Estado: sin verificar empíricamente

⚠ **La conexión real está sin probar.** No hay `OPENROUTER_API_KEY` en el entorno
donde se escribió, así que no se ha confirmado que la búsqueda web de OpenRouter
(sufijo `:online` en el nombre del modelo) devuelva vacantes reales.

Por eso el investigador **falla ruidosamente** en vez de devolver vacío. En este
producto "no encontré nada" y "la búsqueda no funciona" se ven igual desde fuera,
y confundirlos haría recomendar rutas sin respaldo.

El primer `cli:investigar` con clave real es lo que confirma o tumba esta pieza.

## La regla de procedencia

*"No inventes requisitos, salarios ni vacantes"* pedido en el prompt es una
esperanza, no una garantía. Aquí se hace comprobable:

- Un hallazgo `verificado` **sin URL abrible se degrada a `inferido`**, y queda
  constancia de la degradación.
- La **fecha de consulta la sella el sistema**, no el modelo: un salario
  "consultado hoy" inventado parece fresco sin serlo.
- `desconocido` es una respuesta de primera clase. No saber es información.
- Una respuesta sin JSON reconocible **falla**; no se traga como "cero
  hallazgos".

Cubierto por `tests/research/procedencia.test.ts`.

## Qué juzgar cuando lo corras

El veredicto que imprime cuenta hallazgos y fuentes, pero lo que decide el
producto no lo dice ningún número:

- ¿Las vacantes **existen de verdad** y siguen abiertas?
- ¿Los requisitos son los **reales**, o los que "suenan" razonables?
- ¿Esto le sirve a una persona que hace delivery **hoy**?

Si sale con cero fuentes abribles, la vía de búsqueda no sirve y hay que probar
otra (`--modelo`, o una API de búsqueda dedicada) antes de seguir.

## Lo que se reutiliza y lo que es nuevo

**Reutilizado sin tocar:** el patrón `Researcher` / `NoopResearcher` /
`ScriptedResearcher` es el mismo de `Transcriber` y `Describer` —interfaz,
degradación e implementación real— y la llamada a OpenRouter usa el mismo camino
que el resto del proyecto.

**Nuevo y generalizable:** `src/research/` no sabe nada de empleo. Es
investigación con procedencia; cualquier vertical que necesite hechos del mundo
la usa igual.

**Nuevo y específico de esta vertical:** las cuatro preguntas de
`src/cli/investigar.ts`. Ahí está todo el conocimiento de dominio, y es
deliberadamente lo único.

## Lo que NO se construyó, y por qué

Perfil estructurado, rutas, viabilidad, replanificación, canal, cobro y panel.

Construirlos antes de saber si la investigación funciona sería edificar sobre un
cimiento sin probar. Además hay un desajuste de fondo que conviene resolver con
señal de mercado en la mano y no antes: **esta vertical invierte el modelo de
negocio**. Intake asume un negocio (tenant) cuyos clientes escriben, y avisa *al
dueño* para que cotice. Aquí la persona **es** quien paga y no hay dueño: el
ciclo `OPEN_INTAKE → READY_FOR_REVIEW → CLOSED`, `notifyOwnerReady` y el panel de
trabajos no aplican.

Es exactamente la pregunta abierta de §4 —si el ciclo de vida del caso se
comparte entre verticales— y ésta la ejerce el primer día. La respuesta parece
ser que **no** se comparte.

---

# La vertical: `[intake, rutas]`

Construida como herramienta, no como producto: sin canal propio, sin cobro, sin
panel, sin multi-tenant. Se conversa desde la línea de comandos.

## Cómo correrla

```bash
export OPENROUTER_API_KEY=sk-or-v1-…          # sin clave, `investigar` no se expone
npm run cli:chat -- --perfil ./profiles/movilidad
```

El CLI imprime al arrancar qué perfil, qué módulos y si la investigación está
disponible. `--perfil` sirve igual para depurar cualquier giro de Intake.

## Qué prueba sobre la arquitectura

Es la primera vertical que **no es Intake**, y se construyó **componiendo**:

| | |
|---|---|
| Módulos | `[intake, rutas]` — sin `ventas`, que no pinta nada aquí |
| Fragmento reutilizado | `customer.identity`, **nacido en tapicería**, con la etiqueta adaptada a "Ciudad / Zona donde vive" |
| Núcleo tocado | **ninguno** — ni runner, ni artefacto, ni canales, ni pipeline |
| Primitiva nueva | `ElementHost.research`, opcional |

Lo único que se añadió al contrato del anfitrión fue `research`, y se admitió por
la misma regla que `saveArtifact`: **el anfitrión es dueño de todo lo que exige
credenciales o E/S.** Un elemento no debe sostener una clave de API igual que no
sostiene una conexión a la base de datos. Qué se pregunta es del dominio; con qué
se pregunta, del arnés.

## El elemento `rutas`

Cuatro tools, en el orden del proceso: `investigar` → `registrar_ruta` →
`activar_ruta` → `registrar_avance`. `investigar` solo se expone si el arnés
ofrece investigación; sin clave, el modelo no la ve y no puede fingir que buscó.

Tres motivos de seguimiento propios, con prioridad **5** — por delante de
`incomplete_intake` (20), porque una ruta viva sin avanzar cuesta más que un campo
del perfil sin capturar:

| Motivo | Cuándo |
|---|---|
| `ruta_bloqueada` | algo la frenó; retoma proponiendo un cambio, no repitiendo |
| `ruta_en_marcha` | hay próxima acción pendiente y silencio |
| `rutas_sin_elegir` | se le presentaron y no eligió — suele ser tiempo o dinero, no interés |

## Un bug que encontró el test

`registrarAvance` con un bloqueo ponía la ruta en `bloqueada`, y la función que
devolvía "la ruta actual" solo miraba `activa`. Resultado: **una ruta bloqueada
quedaba irrecuperable** — no se le podía registrar más avance, el seguimiento no
la perseguía y desaparecía del prompt. Es decir, un tropiezo mataba el
acompañamiento, que es justo lo que el producto existe para evitar.

Estar bloqueada es una condición de la ruta en curso, no un abandono.
`rutaEnCurso` incluye ahora ambos estados, y desbloquear limpia el motivo.

## Lo que sigue faltando

**La investigación sigue sin verificar** (ver arriba): sin ella, el agente tiene
la tool pero no material, y por diseño no puede inventarlo.

**No hay evaluación comparativa de rutas.** El modelo registra 2-3 y las explica,
pero no hay puntuación por probabilidad de entrada / incremento de ingreso /
tiempo / coste. Se hará cuando haya rutas reales que comparar.

**El ciclo de vida del caso sigue siendo el de Intake.** No se usa
`mark_ready_for_review` ni el aviso al dueño —aquí no hay dueño— pero las tools
siguen expuestas. Es la deuda de §4, ahora ejercida por una vertical real.
