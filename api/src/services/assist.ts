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

async function complete(
  system: string,
  user: string,
  deps: AssistDeps,
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
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
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
