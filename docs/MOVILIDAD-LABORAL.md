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
