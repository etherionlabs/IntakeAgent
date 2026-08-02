import { z } from 'zod';

/**
 * Asistente de configuración: convierte lo que el dueño sabe decir en lo que el
 * sistema necesita.
 *
 * Un dueño de taller no sabe qué es un "campo de tipo enum", pero sí sabe qué le
 * pregunta a sus clientes y a qué hora abre. Aquí el modelo hace de traductor en
 * ese sentido, y SIEMPRE devuelve una propuesta que el dueño revisa y edita antes
 * de guardar: nada de esto escribe en la configuración por su cuenta.
 *
 * Degrada de forma limpia: sin API key o si el modelo falla, devuelve null y el
 * panel sigue funcionando con los formularios manuales de siempre.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** Barato y suficiente: son extracciones cortas y estructuradas, no razonamiento. */
const DEFAULT_MODEL = process.env.ASSIST_MODEL ?? 'openai/gpt-4o-mini';

export interface AssistContext {
  businessName: string;
  businessDomain: string;
}

const FactZ = z.object({
  topic: z.string().min(1).max(60),
  answer: z.string().min(1).max(600),
});

const FactsResultZ = z.object({ facts: z.array(FactZ).max(20) });

const FieldZ = z.object({
  label: z.string().min(1).max(60),
  type: z.enum(['string', 'text', 'integer', 'number', 'currency', 'boolean', 'enum', 'phone', 'date']),
  required: z.boolean().default(false),
  hint: z.string().max(200).optional(),
  options: z.array(z.string().min(1).max(60)).max(12).optional(),
});

const FieldsResultZ = z.object({
  sections: z
    .array(z.object({ label: z.string().min(1).max(60), fields: z.array(FieldZ).min(1).max(12) }))
    .min(1)
    .max(5),
});

const WelcomeResultZ = z.object({ welcome: z.string().min(10).max(400) });

export type SuggestedFacts = z.infer<typeof FactsResultZ>;
export type SuggestedFields = z.infer<typeof FieldsResultZ>;
export type SuggestedWelcome = z.infer<typeof WelcomeResultZ>;

export interface AssistDeps {
  apiKey?: string;
  model?: string;
  fetcher?: typeof fetch;
}

/** ¿Está disponible el asistente? Sin key el panel oculta los botones. */
export function assistAvailable(deps: AssistDeps = {}): boolean {
  return !!(deps.apiKey ?? process.env.OPENROUTER_API_KEY);
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function completeChat(
  messages: ChatMessage[],
  deps: AssistDeps,
  temperature = 0.2,
): Promise<unknown | null> {
  const apiKey = deps.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const doFetch = deps.fetcher ?? fetch;

  let res: Response;
  try {
    res = await doFetch(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: deps.model ?? DEFAULT_MODEL,
        temperature,
        response_format: { type: 'json_object' },
        messages,
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  try {
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    return content ? JSON.parse(content) : null;
  } catch {
    return null;
  }
}

async function complete(
  system: string,
  user: string,
  deps: AssistDeps,
): Promise<unknown | null> {
  return completeChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    deps,
  );
}

const COMMON_RULES =
  'Responde SOLO con JSON válido, sin texto alrededor. Escribe en español de México, ' +
  'claro y sin tecnicismos. NUNCA inventes datos que el usuario no haya dado: si algo ' +
  'no lo dijo, omítelo en vez de suponerlo.';

/**
 * Texto libre → datos del negocio estructurados. El dueño escribe como habla
 * ("abrimos de 9 a 7, aceptamos tarjeta") y sale la tabla que el asistente
 * consulta cuando un cliente pregunta.
 */
export async function suggestFacts(
  text: string,
  ctx: AssistContext,
  deps: AssistDeps = {},
): Promise<SuggestedFacts | null> {
  const raw = await complete(
    `Extraes datos de un negocio para que un asistente de WhatsApp pueda responder ` +
      `preguntas de clientes. Devuelve {"facts":[{"topic":"...","answer":"..."}]}. ` +
      `El "topic" es el tema en una o dos palabras en minúsculas (ubicación, horarios, ` +
      `métodos de pago, garantía, servicios…). El "answer" es la respuesta lista para ` +
      `decírsela a un cliente, en primera persona del negocio. Un tema por dato; no ` +
      `repitas temas. ${COMMON_RULES}`,
    `Negocio: ${ctx.businessName} (${ctx.businessDomain}).\n\nLo que cuenta el dueño:\n${text}`,
    deps,
  );
  if (!raw) return null;
  const parsed = FactsResultZ.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Descripción del negocio → campos del intake. Traduce "necesito saber la marca y
 * el año del coche" a campos con su tipo, que es justo el salto que un usuario no
 * técnico no puede dar solo.
 */
export async function suggestFields(
  text: string,
  ctx: AssistContext,
  deps: AssistDeps = {},
): Promise<SuggestedFields | null> {
  const raw = await complete(
    `Diseñas el formulario que un asistente de WhatsApp va llenando conversando con ` +
      `un cliente. Devuelve {"sections":[{"label":"...","fields":[{"label":"...",` +
      `"type":"...","required":true|false,"hint":"...","options":["..."]}]}]}. ` +
      `Tipos permitidos: string (texto corto), text (texto largo), integer, number, ` +
      `currency, boolean (sí/no), enum (lista cerrada; SIEMPRE con "options"), phone, date. ` +
      `Agrupa en 2 o 3 secciones como mucho (por ejemplo datos del cliente y datos del ` +
      `trabajo). Marca required solo lo que de verdad haga falta para poder cotizar: ` +
      `un formulario largo hace que el cliente abandone la conversación. Máximo 6 campos ` +
      `por sección. ${COMMON_RULES}`,
    `Negocio: ${ctx.businessName} (${ctx.businessDomain}).\n\nLo que necesita saber de cada cliente:\n${text}`,
    deps,
  );
  if (!raw) return null;
  const parsed = FieldsResultZ.safeParse(raw);
  if (!parsed.success) return null;
  // Un enum sin opciones no pasa la validación del schema: se descarta el campo
  // en vez de guardar algo que reventaría al guardar.
  const sections = parsed.data.sections
    .map((s) => ({
      ...s,
      fields: s.fields.filter((f) => f.type !== 'enum' || (f.options?.length ?? 0) > 0),
    }))
    .filter((s) => s.fields.length > 0);
  return sections.length > 0 ? { sections } : null;
}

// ---- Asistente conversacional de configuración ----

/**
 * Lo que hay AHORA MISMO en el formulario del panel (no lo guardado en la base):
 * si el dueño ya aceptó una propuesta y no ha guardado, el asistente tiene que
 * verla, o volvería a proponer lo mismo en el turno siguiente.
 */
export const ConfigSnapshotZ = z.object({
  businessName: z.string().max(120).default(''),
  businessDomain: z.string().max(200).default(''),
  welcome: z.string().max(1000).default(''),
  tone: z.string().max(1000).default(''),
  freeContext: z.string().max(4000).default(''),
  facts: z.array(z.object({ topic: z.string().max(60), answer: z.string().max(600) })).max(40).default([]),
  sections: z
    .array(
      z.object({
        label: z.string().max(60),
        fields: z
          .array(z.object({ label: z.string().max(60), type: z.string().max(20), required: z.boolean().optional() }))
          .max(20),
      }),
    )
    .max(10)
    .default([]),
});
export type ConfigSnapshot = z.infer<typeof ConfigSnapshotZ>;

/** Historial de la conversación. Vive en el panel: el servidor no guarda hilos. */
export const ChatTurnZ = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(2000),
});
export type ChatTurn = z.infer<typeof ChatTurnZ>;

/**
 * Lo que el asistente propone cambiar. Todo es opcional: en un turno normal
 * solo toca lo que el dueño acaba de contar. El panel lo aplica al FORMULARIO.
 */
const ConfigPatchZ = z.object({
  businessName: z.string().min(1).max(80).optional(),
  businessDomain: z.string().min(1).max(120).optional(),
  welcome: z.string().min(10).max(400).optional(),
  tone: z.string().min(10).max(400).optional(),
  freeContext: z.string().min(1).max(2000).optional(),
  facts: z.array(FactZ).max(20).optional(),
  sections: z
    .array(z.object({ label: z.string().min(1).max(60), fields: z.array(FieldZ).min(1).max(12) }))
    .min(1)
    .max(5)
    .optional(),
});
export type ConfigPatch = z.infer<typeof ConfigPatchZ>;

const ChatResultZ = z.object({
  reply: z.string().min(1).max(1500),
  patch: ConfigPatchZ.nullish(),
  done: z.boolean().default(false),
});

export interface ConfigChatResult {
  reply: string;
  /** null cuando el turno solo pregunta o aclara: no todo turno cambia algo. */
  patch: ConfigPatch | null;
  /** El asistente considera cubiertas las cuatro áreas. El panel lo usa para
   *  ofrecer guardar; NO guarda por sí solo. */
  done: boolean;
}

/** Las cuatro áreas que el asistente tiene que cubrir, en orden de utilidad. */
const CHAT_SYSTEM =
  `Ayudas al DUEÑO de un negocio pequeño a configurar el asistente de WhatsApp que ` +
  `atenderá a sus clientes. Hablas como un colega que sabe del oficio, no como un ` +
  `formulario: una sola pregunta por turno, en español de México, sin tecnicismos. ` +
  `Nunca digas "campo", "enum", "schema" ni "configuración": di "lo que le pides al ` +
  `cliente", "una lista de opciones", "lo que tu asistente debe saber".\n\n` +
  `Cubres cuatro cosas, en este orden, y solo pasas a la siguiente cuando la anterior ` +
  `está razonablemente cubierta:\n` +
  `1. Qué es el negocio (nombre y a qué se dedica).\n` +
  `2. Qué necesita saber de cada cliente para poder cotizarle.\n` +
  `3. Qué preguntan los clientes una y otra vez (horarios, ubicación, pagos, garantía…).\n` +
  `4. Cómo quiere que les hable, y el primer mensaje que reciben.\n\n` +
  `Devuelve SIEMPRE {"reply":"...","patch":{...}|null,"done":true|false}.\n` +
  `- "reply": lo que le dices al dueño. Máximo 3 frases. Si propusiste algo, dilo en ` +
  `una línea y termina con la siguiente pregunta.\n` +
  `- "patch": SOLO lo que puedas deducir de lo que el dueño ACABA DE DECIR. Claves ` +
  `posibles: businessName, businessDomain, welcome, tone, freeContext, facts, sections. ` +
  `Omite el patch (null) si el turno solo fue una pregunta o una aclaración.\n` +
  `- "facts": [{"topic":"tema en una o dos palabras","answer":"respuesta lista para un cliente"}]. ` +
  `Manda SOLO los datos nuevos de este turno: se añaden a los que ya hay.\n` +
  `- "sections": la lista COMPLETA de lo que se le pide al cliente, agrupada en 2 o 3 ` +
  `bloques, con {"label","type","required","hint","options"}. Tipos: string, text, ` +
  `integer, number, currency, boolean, enum (SIEMPRE con "options"), phone, date. ` +
  `Máximo 6 por bloque; marca required solo lo imprescindible para cotizar, porque un ` +
  `interrogatorio hace que el cliente abandone. Si solo cambia un dato, reenvía igual ` +
  `la lista completa con ese cambio.\n` +
  `- "done": true solo cuando las cuatro áreas están cubiertas.\n` +
  `Cuando propongas algo, deja claro que no se guarda hasta que él lo revise. ` +
  `${COMMON_RULES}`;

const truncar = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max)}…`);

/** Resumen del formulario para el modelo: qué hay puesto y qué falta. */
function snapshotForPrompt(snap: ConfigSnapshot): string {
  const fields = snap.sections
    .map((s) => `  ${s.label}: ${s.fields.map((f) => `${f.label} (${f.type}${f.required ? ', obligatorio' : ''})`).join(', ')}`)
    .join('\n');
  return [
    `Negocio: ${snap.businessName || '(sin poner)'}`,
    `Se dedica a: ${snap.businessDomain || '(sin poner)'}`,
    `Bienvenida: ${snap.welcome || '(sin poner)'}`,
    `Tono: ${snap.tone || '(sin poner)'}`,
    `Datos que pide al cliente:\n${fields || '  (ninguno)'}`,
    // Con el tema solo no se puede EDITAR: para cambiar un horario hay que ver
    // el que está puesto. Se recorta la respuesta porque el resumen viaja en
    // cada turno y algunos negocios cargan datos largos.
    `Lo que ya sabe responder:\n${
      snap.facts.map((f) => `  ${f.topic}: ${truncar(f.answer, 140)}`).join('\n') || '  (nada)'
    }`,
    `Notas libres: ${snap.freeContext || '(ninguna)'}`,
  ].join('\n');
}

/**
 * Un turno de la conversación de configuración.
 *
 * A diferencia de las ayudas por sección (que son un disparo suelto), aquí el
 * asistente lleva el hilo de todo el proceso: sabe qué falta, pregunta por ello y
 * va proponiendo cambios sobre el formulario. El hilo lo guarda el panel y lo
 * manda entero en cada turno — el servidor no persiste conversaciones, así que
 * cerrar el panel no deja nada a medias en la base de datos.
 *
 * Igual que el resto del asistente: NADA se guarda solo. Devuelve una propuesta.
 */
export async function configChat(
  history: ChatTurn[],
  snapshot: ConfigSnapshot,
  deps: AssistDeps = {},
): Promise<ConfigChatResult | null> {
  const raw = await completeChat(
    [
      { role: 'system', content: CHAT_SYSTEM },
      { role: 'system', content: `Así está ahora mismo el panel del dueño:\n${snapshotForPrompt(snapshot)}` },
      ...history,
    ],
    deps,
    0.3,
  );
  if (!raw) return null;
  const parsed = ChatResultZ.safeParse(raw);
  if (!parsed.success) return null;

  let patch = parsed.data.patch ?? null;
  if (patch) {
    // Mismo criterio que suggestFields: una lista sin opciones no pasa la
    // validación al guardar, así que se cae aquí y no delante del dueño.
    if (patch.sections) {
      const sections = patch.sections
        .map((s) => ({ ...s, fields: s.fields.filter((f) => f.type !== 'enum' || (f.options?.length ?? 0) > 0) }))
        .filter((s) => s.fields.length > 0);
      patch = sections.length > 0 ? { ...patch, sections } : { ...patch, sections: undefined };
    }
    // Un patch que se quedó sin nada tras la limpieza es ruido: el panel no debe
    // anunciar cambios que no existen.
    if (Object.values(patch).every((v) => v === undefined)) patch = null;
  }

  return { reply: parsed.data.reply, patch, done: parsed.data.done };
}

/** Mensaje de bienvenida a partir del negocio y el tono que eligió el dueño. */
export async function suggestWelcome(
  tone: string,
  ctx: AssistContext,
  deps: AssistDeps = {},
): Promise<SuggestedWelcome | null> {
  const raw = await complete(
    `Escribes el primer mensaje que un negocio manda por WhatsApp a un cliente nuevo. ` +
      `Devuelve {"welcome":"..."}. Máximo 2 frases. Saluda, di de qué negocio eres y ` +
      `haz UNA pregunta de apertura para que el cliente empiece a contar qué necesita. ` +
      `No prometas precios, tiempos ni promociones. ${COMMON_RULES}`,
    `Negocio: ${ctx.businessName} (${ctx.businessDomain}).\nTono deseado: ${tone || 'cercano y profesional'}.`,
    deps,
  );
  if (!raw) return null;
  const parsed = WelcomeResultZ.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
