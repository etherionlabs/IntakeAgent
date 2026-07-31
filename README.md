# Intake

**Asesor de ventas autónomo de WhatsApp** para negocios de servicio (talleres,
oficios y logística). Atiende los mensajes de los clientes, levanta el "intake"
(datos del trabajo) de forma conversacional y —esto es lo que lo distingue de un
recepcionista— **asesora y vende**: entiende qué quiere lograr el cliente, ofrece
los servicios complementarios que apliquen a su caso y busca cerrar la orden de
trabajo más completa y rentable que de verdad le convenga, sin inventar precios
ni presionar. Cuando el trabajo está listo, avisa al dueño con el resumen y los
**extras aceptados** para que cotice todo junto. Trae un panel web para ver
conversaciones, gestionar el pipeline de trabajos y la configuración.

- **Stack:** Node.js 20+, TypeScript (ejecutado con `tsx`, sin paso de build),
  Fastify + Handlebars + HTMX (panel), Prisma 7 + SQLite, Baileys (WhatsApp),
  OpenRouter (LLM + transcripción de audios + descripción de imágenes).

Cuando un cliente envía una **foto**, un modelo de visión genera una descripción
textual (guiada por el contexto del negocio y la conversación) que el agente lee
para razonar sobre ella. Si surge información nueva, el agente puede re-analizar
la foto con otro foco. Se configura en `config.json` →
`media.describeImages` y `media.visionModel`; el foco por vertical vive en
`profiles/<perfil>/prompt-vars.json` (`vars.imageFocus`).

Además, para verticales visuales (ej. **wrapping / estética automotriz**), el
agente puede **generar una previsualización** editando la foto del cliente: sobre
la imagen que envió aplica un cambio (rayas/franjas deportivas, color de wrap,
tono de polarizado, acabado) y le manda de vuelta una vista aproximada de cómo
quedaría. Es opt-in: cada negocio lo activa desde el panel (**Configuración →
Imágenes y audio**, columna `TenantSettings.editImages`); el modelo de edición es
global del deployment (`config.json` → `media.imageEditModel`, requiere un modelo
con salida de imagen, ej. `google/gemini-2.5-flash-image-preview`). La guía de
estilo por vertical vive en `profiles/<perfil>/prompt-vars.json`
(`vars.imageEditGuidance`). La tool `generate_preview` la dispara el agente cuando
aporta a definir o cerrar la venta. La previsualización es **aproximada**, no un
compromiso del acabado final. El costo de cada edición se **contabiliza** en el
gasto del turno (`AgentRun.costUsd`), y tanto las fotos entrantes como las
previsualizaciones se **ven como imagen** en la conversación del panel: la API las
sirve vía `GET /messages/:id/media`, autorizando por tenant y **proxyando** el
archivo al servidor interno del worker (`/internal/media`), que es el dueño del
volumen de media. Así funciona en un solo host (docker-compose) y en despliegues
con servicios separados (ej. Railway), donde un volumen no se comparte entre
servicios y no hace falta object storage externo.

### Venta proactiva

El agente no se limita a levantar el pedido: tras captar lo que el cliente pide,
ofrece los servicios **complementarios** que tengan sentido para su caso,
explicando el beneficio y sin inventar precios ni presionar. El comportamiento
por giro vive en `profiles/<perfil>/prompt-vars.json` (`vars.salesPlaybook`), y
razona sobre un catálogo curado en `business-facts.json` — el agente **solo puede
ofrecer lo que aparezca ahí**, por regla dura. **Todos los perfiles** lo traen
(mecánica, tapicería, cerrajería, plomería, electricista, refrigeración,
paquetería, wrapping y el genérico); el genérico, al ser el fallback de cualquier
giro sin plantilla, se apoya en los servicios que el dueño cargue desde el panel
en vez de un catálogo propio.

Cada movimiento de venta queda **registrado**, no suelto en una nota: la tool
`register_opportunity` guarda en el intake del job (`opportunities`) qué extra se
ofreció y cómo respondió el cliente —`offered`, `accepted` o `declined`—. Eso
cierra el ciclo en tres puntos:

- **En la conversación:** el estado se le muestra al agente en cada turno, así que
  no vuelve a ofrecer algo que el cliente ya rechazó.
- **En el aviso al dueño:** `mark_ready_for_review` manda los extras aceptados en
  una línea aparte del resumen (`Extras aceptados: …`), que es justo lo que se
  suele pasar por alto al cotizar.
- **En el panel:** la ficha del trabajo tiene una sección *Servicios adicionales*
  con los aceptados primero y el aviso de cuántos hay que incluir en la
  cotización.

Los trabajos anteriores a esta función no traen `opportunities` en su JSON y se
siguen leyendo sin problema (la sección aparece vacía).

### Seguimiento proactivo

Ofrecer sin dar seguimiento es media venta: hasta aquí el agente solo actuaba
cuando el cliente escribía (`adapter → coordinator → agente`), así que una oferta
sin contestar se moría en silencio. El **barrido de seguimiento**
(`FollowUpCoordinator`) es el único camino por el que el agente habla **sin
mensaje entrante**: cada `followUp.sweepMinutes` busca trabajos donde hablamos
nosotros al final y el cliente lleva callado más de `followUp.afterHours`, y le
escribe para retomar — recordando lo que quedó ofrecido (`pending_offer`) o
pidiendo el dato que falta (`incomplete_intake`), con la oferta pendiente como
prioridad. El turno usa el mismo agente y las mismas tools, pero en lugar de un
mensaje del cliente lleva una **directiva del sistema** (`TurnContext.systemDirective`).

Es **opt-in por tenant** (`TenantSettings.followUpEnabled`, en **Configuración →
Seguimiento**): son mensajes no solicitados y la decisión —y el riesgo para el
número de WhatsApp del negocio— es del dueño. Además nunca escribe:

- fuera del horario de atención (`config.hours`);
- a quien pausó el bot, fue marcado como spam o está archivado;
- más de `followUp.maxFollowUps` veces por trabajo, ni antes de
  `followUp.minHoursBetween` desde el anterior;
- si el tenant agotó su cuota mensual (un seguimiento gasta un `AgentRun`, y
  responderle a un cliente vale más que nuestra iniciativa);
- si el turno del agente falló — el fallback de error no se manda a alguien que
  no escribió, y el trabajo conserva su seguimiento para el próximo barrido.

### Descubrir antes de proponer

El error que más ventas cuesta es proponer antes de entender. El agente ahora
diagnostica y **guarda lo que descubre** en el intake del job (`diagnosis`), no
solo en la conversación:

- `pain` — el problema en palabras del cliente.
- `implication` — qué le cuesta si NO lo resuelve. Es la pregunta que casi nadie
  hace y la que convierte una reparación pequeña en el trabajo que de verdad
  necesita.
- `urgency` — alta / media / baja.
- `objections` — la fricción que planteó (precio, tiempo, confianza, competencia,
  «lo voy a pensar»), con si quedó **resuelta**. Un upsert por tipo: el cliente que
  vuelve al precio actualiza la objeción, no crea otra.

Se escribe con la tool `register_discovery` y se le muestra al modelo en cada
turno **lo que todavía le falta descubrir**, que es lo que lo frena de saltar al
pitch. Alimenta tres cosas más: el seguimiento proactivo retoma citando lo que el
cliente contó (y la objeción sin resolver, que suele ser el motivo real del
silencio), el dueño lo lee en la ficha del trabajo antes de cotizar, y
`intake_objections_total{type,state}` mide la fricción real.

Las técnicas viven en la biblioteca de skills, no en un prompt monolítico:
`descubrimiento` (SPIN adaptado: una pregunta por mensaje, devolverle lo entendido
antes de proponer, y no interrogar a quien ya decidió), `objeciones` (explorar
**antes** de responder — «¿caro comparado con qué?» — y el diagnóstico de tres vías
para «lo voy a pensar») y `ventas` (complementos y cierre con próximo paso
concreto).

Dos reglas duras acompañan a la venta, porque deben ganar siempre: el agente
**nunca dice ni insinúa que es una persona**, y si lo que el cliente necesita no es
algo que el negocio haga, **lo dice** en vez de seguir tomando datos.

### Transparencia (divulgación de IA)

El AI Act (art. 50, aplicable desde el **2026-08-02**) exige informar a la persona
cuando interactúa con un sistema de IA. El aviso va en el **primer mensaje**
(`buildWelcome`), no en una respuesta del modelo: un aviso que dependa de que el
modelo se acuerde de darlo no es una garantía. No se duplica si el dueño ya lo dice
en su bienvenida.

Es por tenant (`TenantSettings.aiDisclosure`, en **Configuración → Cómo atiende**)
porque depende de su jurisdicción, y viene **activo por defecto**: no informar es
riesgo legal, informar cuesta una línea. El texto es global del deployment
(`config.json` → `disclosure.text`). Independientemente del toggle, la regla dura
de no hacerse pasar por persona aplica siempre.

### Medir la venta

`GET /metrics` expone `intake_opportunities_total{status}` (ofrecidos, aceptados,
rechazados), `intake_followups_total{reason}` e `intake_objections_total{type,state}`. Para cerrar la atribución, el
dueño marca el resultado al cerrar un trabajo: **Cerrar · ganado** o **Cerrar ·
perdido** (`Job.outcome` = `WON`/`LOST`; reabrir un trabajo lo limpia). Con eso
la tasa ofrecido→aceptado→ganado deja de ser una impresión.

### Skills (técnicas reutilizables)

Para enseñarle al modelo **técnicas transversales** —cómo vender mejor, manejar
objeciones, etc.— existe una biblioteca de *skills* en `skills/`. Cada skill es un
cuerpo de instrucciones reutilizable (independiente del giro) en
`skills/<nombre>/skill.json` (`title`, `description`, `instructions`). Un perfil
las adopta listándolas en `prompt-vars.json` → `"skills": ["ventas", ...]`; el
loader las resuelve y se inyectan en el system prompt bajo un bloque de
"HABILIDADES / TÉCNICAS" (son para el comportamiento del modelo, no se mencionan
al cliente y nunca ganan a las reglas duras). Una skill referenciada que falte se
omite con un aviso, sin tumbar al bot. Incluye la skill `ventas` (venta
consultiva: descubrir la necesidad, hablar en beneficios, agrupar servicios,
manejar objeciones y registrar el interés), que **todos** los perfiles adoptan
por defecto — un dueño que prefiera un bot puramente receptivo la apaga desde el
panel.

Cada negocio elige qué skills activar desde el panel (**Configuración → Imágenes y
audio → Habilidades**), que se guarda en `TenantSettings.skills`: una selección
explícita (un arreglo, aunque esté vacío) gana sobre la lista del perfil del giro;
si es `null`, hereda las del perfil. Así el dueño enciende o apaga técnicas sin
tocar archivos.

---

## Requisitos

- **Node.js 20 o superior** — https://nodejs.org
- Una **API key de OpenRouter** — https://openrouter.ai/keys
- Un **teléfono con WhatsApp** para vincular la cuenta del negocio.

---

## Instalación rápida (recomendada)

Desde la carpeta del proyecto:

**Windows (PowerShell):**

```powershell
.\install.ps1
```

Si PowerShell bloquea el script:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

**macOS / Linux:**

```bash
bash install.sh
```

El instalador:

1. Verifica que tengas Node.js 20+.
2. Instala las dependencias (`npm install`).
3. Lanza el setup interactivo, que te pide la API key de OpenRouter y una
   contraseña para el panel, genera los secretos y crea la base de datos.

Al terminar, arranca con:

```bash
npm start
```

---

## Instalación manual (paso a paso)

Si prefieres no usar el script:

```bash
# 1. Dependencias
npm install

# 2. Configuración interactiva (.env + base de datos)
npm run setup
```

`npm run setup` es **reentrante**: puedes correrlo otra vez sin perder lo ya
configurado. Hace lo siguiente:

- Crea `.env` a partir de `.env.example` si no existe.
- Pide `OPENROUTER_API_KEY` si falta.
- Pide una contraseña para el panel y guarda su hash (`PANEL_PASSWORD_HASH`).
- Genera un `PANEL_SESSION_SECRET` estable.
- Crea la base de datos aplicando las migraciones (`prisma migrate deploy`).

Si prefieres configurar el `.env` a mano, copia `.env.example` a `.env` y
rellena los valores. Para generar el hash de la contraseña del panel sin el
asistente:

```bash
npm run panel:hash -- mi-password-segura
# pega el resultado en PANEL_PASSWORD_HASH del .env

npm run db:deploy   # crea la base de datos
```

---

## Primer arranque

```bash
npm start
```

1. La primera vez se imprime un **código QR** en la terminal. Escánealo desde
   WhatsApp en el teléfono del negocio:
   **WhatsApp → Dispositivos vinculados → Vincular un dispositivo.**
2. La sesión queda guardada en `data/baileys-session/`; los siguientes arranques
   reconectan solos, sin QR.
3. Abre el panel en **http://localhost:3000**
   - Usuario: **admin**
   - Contraseña: la que definiste en el setup.

Para detener el proceso: `Ctrl + C`.

---

## Configuración del negocio

- **`config.json`** — comportamiento del asistente: modelo, teléfono del dueño
  (`owner.phoneE164`, en formato E.164, ej. `+5215555555555`), horarios, límites
  de costo, etc.
- **`profiles/tapiceria/`** — el "perfil" del negocio:
  - `intake-schema.json` — qué datos se recogen de cada trabajo.
  - `prompt-vars.json` — variables del prompt (nombre del negocio, tono…).
  - `business-facts.json` — datos del negocio que el asistente puede usar.
  - `welcome.txt` — mensaje de bienvenida.

Edita estos archivos antes de la primera prueba con el cliente para adaptarlo al
negocio. Tras cambiar `config.json` o el perfil, reinicia con `Ctrl + C` y
`npm start`.

### Editar desde el panel

La sección **Configuración** (solo rol `admin`) está pensada para un dueño de
negocio, no para quien conoce el modelo de datos. Está dividida en pestañas:

- **Asistente** — configurarlo conversando en vez de rellenando formularios (ver
  más abajo). Es la pestaña por defecto cuando hay modelo disponible.
- **Tu negocio** — nombre, a qué se dedica y mensaje de bienvenida.
- **Qué datos pides** — las secciones y campos que el asistente va llenando
  conversando. Los tipos se nombran por lo que el cliente responde ("Texto
  corto", "Sí / No", "Lista de opciones"); la clave interna no se muestra y **no
  cambia al renombrar**, porque es la identidad con la que quedaron guardados los
  datos de los trabajos que ya existen. Se guarda en `TenantSettings.intakeSchema`,
  que es la MISMA fila que lee el worker.
- **Lo que debe saber** — los datos del negocio que el asistente puede usar para
  responder (y solo esos: lo que no esté aquí, no lo inventa).
- **Cómo atiende** — tono (con presets), fotos y notas de voz, seguimiento
  proactivo y técnicas de venta.
- **Avanzado** — las instrucciones internas del asistente (`coreInstructions`,
  `hardRules`, los playbooks) tras una advertencia, más el `config.json` global
  cuando el deployment lo expone. Antes se mostraban como campos normales junto al
  nombre del negocio, lo que invitaba a romper el bot sin saberlo.

`multi_enum` no se ofrece como tipo a propósito: el asistente todavía no puede
escribirlo (`bulkUpdate` lo rechaza), así que ofrecerlo sería una trampa.

#### Ayuda del modelo al configurar

Un dueño no sabe qué es un "campo de tipo enum", pero sí sabe qué le pregunta a
sus clientes. `POST /settings/assist` usa el LLM como traductor en ese sentido:

- **Datos del negocio** — pega de corrido lo que le dirías a un cliente ("abrimos
  de 9 a 7, aceptamos tarjeta…") y lo separa por temas.
- **Campos** — describe qué necesitas saber para cotizar y propone las secciones y
  campos con su tipo.
- **Bienvenida** — la redacta con el nombre del negocio y el tono elegido.

La propuesta **nunca se guarda sola**: se aplica al formulario para que el dueño la
revise y decida. Sin `OPENROUTER_API_KEY` el endpoint responde 503, el panel oculta
los botones y los formularios manuales siguen siendo el camino completo. El modelo
se elige con `ASSIST_MODEL` (por defecto `openai/gpt-4o-mini`).

#### Configurarlo conversando

Las ayudas de arriba son de un disparo y por sección: siguen exigiendo que el dueño
sepa en qué pestaña está lo que quiere cambiar. `POST /settings/assist/chat` lleva
el hilo de **todo** el proceso: pregunta una cosa a la vez, sabe qué falta por
cubrir (qué es el negocio → qué necesita saber de cada cliente → qué le preguntan
siempre → cómo quiere que les hable) y va rellenando las demás pestañas.

- El **hilo vive en el navegador** y viaja entero en cada turno; el servidor no
  persiste conversaciones, así que cerrar el panel a media charla no deja nada a
  medias en la base de datos. Se acota a 30 turnos porque cada uno cuesta dinero.
- Cada turno devuelve `{ reply, patch, done }`. El `patch` se aplica al
  **formulario**, se dice en pantalla qué se tocó, y el dueño lo revisa en su
  pestaña antes de pulsar «Guardar todo». Igual que el resto del asistente: nada se
  guarda solo.
- El panel manda también lo que hay **sin guardar** en el formulario, para que el
  asistente no vuelva a proponer lo que él mismo acaba de proponer.
- Las claves de los campos las genera el panel, y **conserva la del dato que ya
  existía con esa etiqueta**: aceptar una propuesta no deja huérfanas las
  respuestas de los trabajos anteriores.

Los cambios del perfil se guardan en la base de datos (recurso compartido entre la
API y el worker) y **aplican en la siguiente conversación**, sin reiniciar.

---

## Variables de entorno (`.env`)

| Variable | Descripción |
| --- | --- |
| `OPENROUTER_API_KEY` | API key de OpenRouter (LLM + transcripción). |
| `PANEL_PASSWORD_HASH` | Hash bcrypt de la contraseña del panel (usuario `admin`). |
| `PANEL_SESSION_SECRET` | Secreto para firmar sesiones del panel. **Debe ser estable** entre reinicios. |
| `PANEL_PORT` | Puerto del panel (por defecto `3000`). |
| `DATABASE_URL` | Ruta de la base de datos SQLite (por defecto `file:./data/intake.db`). |

---

## Comandos útiles

| Comando | Para qué |
| --- | --- |
| `npm start` | Arranca el asistente + panel web. |
| `npm run setup` | Configuración inicial / reconfiguración. |
| `npm run db:deploy` | Aplica migraciones (crea/actualiza la base de datos). |
| `npm run panel:hash -- <password>` | Genera el hash de una contraseña del panel. |
| `npm test` | Corre la batería de pruebas. |
| `npm run typecheck` | Verifica tipos de TypeScript. |
| `npm run prisma:studio` | Explorador visual de la base de datos. |

---

## Datos y copias de seguridad

Todo el estado vive en la carpeta `data/`:

- `data/intake.db` — base de datos (contactos, trabajos, mensajes, costos).
- `data/baileys-session/` — sesión de WhatsApp (no compartir ni versionar).

Para respaldar, copia la carpeta `data/` completa con el proceso detenido.

---

## Solución de problemas

- **El QR no aparece / se desconecta:** borra `data/baileys-session/` y vuelve a
  arrancar para vincular de nuevo.
- **El asistente no responde:** revisa que `OPENROUTER_API_KEY` sea válida y que
  tengas saldo en OpenRouter.
- **No entras al panel:** confirma `PANEL_PASSWORD_HASH` en `.env` (regenera con
  `npm run panel:hash`) y que entras con el usuario `admin`.
- **Te desloguea al reiniciar:** falta un `PANEL_SESSION_SECRET` fijo en `.env`
  (vuelve a correr `npm run setup`).
