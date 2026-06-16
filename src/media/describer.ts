/**
 * Describe imágenes entrantes convirtiéndolas en texto, de modo que el agente
 * principal razone sobre una DESCRIPCIÓN (no sobre los bytes).
 *
 * Es el análogo visual del `Transcriber` de audio: en vez de pasarle la imagen
 * al modelo en cada turno, generamos una descripción guiada por el contexto del
 * negocio y de la conversación, y esa descripción es lo que ve el agente. Si más
 * tarde hace falta otro foco, el agente re-dispara el análisis con contexto extra
 * (tool `reanalyze_image`).
 */

/** Contexto que guía la descripción para que el modelo sepa en qué fijarse. */
export interface DescribeContext {
  businessName: string;
  businessDomain: string;
  /** Instrucciones de foco específicas del vertical (profile.imageFocus). */
  focusInstructions: string;
  /** Resumen de la conversación reciente + texto del batch actual. */
  conversationContext: string;
  /** Caption que el cliente envió junto a la foto. */
  caption: string | null;
  /** Foco adicional pedido por el agente al re-analizar (tool). */
  extraFocus?: string | null;
}

export interface Describer {
  describe(buffer: Buffer, mimetype: string, context: DescribeContext): Promise<string | null>;
}

/** No hace nada — degradación cuando no hay API key o está desactivado. */
export class NoopDescriber implements Describer {
  async describe(
    _buffer: Buffer,
    _mimetype: string,
    _context: DescribeContext,
  ): Promise<string | null> {
    return null;
  }
}

/** Devuelve descripciones predefinidas en orden. Útil para tests. */
export class ScriptedDescriber implements Describer {
  private idx = 0;
  constructor(private readonly script: ReadonlyArray<string | null>) {}

  async describe(
    _buffer: Buffer,
    _mimetype: string,
    _context: DescribeContext,
  ): Promise<string | null> {
    if (this.idx >= this.script.length) return null;
    return this.script[this.idx++] ?? null;
  }
}

/**
 * Describe imágenes con un modelo de visión vía `@openrouter/sdk` (callModel).
 *
 * El SDK es ESM-only — usamos `await import` perezoso, igual que el resto de
 * factories del proyecto.
 */
export class VisionDescriber implements Describer {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async describe(
    buffer: Buffer,
    mimetype: string,
    context: DescribeContext,
  ): Promise<string | null> {
    if (!this.apiKey) return null;
    try {
      const { OpenRouter } = await import('@openrouter/sdk');
      const sdk = new OpenRouter({ apiKey: this.apiKey });

      const dataUrl = `data:${normalizeMime(mimetype)};base64,${buffer.toString('base64')}`;

      // OpenResponses API: content como array con texto + imagen.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input: any = [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: buildUserPrompt(context) },
            { type: 'input_image', detail: 'auto', imageUrl: dataUrl },
          ],
        },
      ];

      const result = sdk.callModel({
        model: this.model,
        input,
        instructions: buildInstructions(context),
      });
      const text = (await result.getText())?.trim();
      return text ? text : null;
    } catch (e) {
      console.warn(
        `[VisionDescriber] excepción: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }
}

function buildInstructions(ctx: DescribeContext): string {
  const lines = [
    `Eres un asistente de intake para **${ctx.businessName}**, un negocio de ${ctx.businessDomain}.`,
    'El cliente envió una FOTO por WhatsApp. Tu trabajo es describirla de forma concreta y útil',
    'para levantar el trabajo: enfócate en lo que el negocio necesita saber.',
  ];
  if (ctx.focusInstructions.trim().length > 0) {
    lines.push('', 'Fíjate especialmente en:', ctx.focusInstructions.trim());
  }
  lines.push(
    '',
    'Reglas: describe SOLO lo que se ve (no inventes datos que no aparecen en la imagen).',
    'Responde en español, en texto plano, 2 a 5 frases. No saludes ni hagas preguntas.',
  );
  return lines.join('\n');
}

function buildUserPrompt(ctx: DescribeContext): string {
  const lines: string[] = [];
  if (ctx.conversationContext.trim().length > 0) {
    lines.push('Contexto de la conversación hasta ahora:');
    lines.push(ctx.conversationContext.trim());
    lines.push('');
  }
  if (ctx.caption && ctx.caption.trim().length > 0) {
    lines.push(`El cliente escribió junto a la foto: "${ctx.caption.trim()}"`);
    lines.push('');
  }
  if (ctx.extraFocus && ctx.extraFocus.trim().length > 0) {
    lines.push(`Enfócate ahora en: ${ctx.extraFocus.trim()}`);
    lines.push('');
  }
  lines.push('Describe la imagen adjunta.');
  return lines.join('\n');
}

function normalizeMime(mimetype: string): string {
  const m = mimetype.split(';')[0].trim().toLowerCase();
  if (m.startsWith('image/')) return m;
  return 'image/jpeg';
}

/** Deriva un mimetype de imagen a partir de la extensión del archivo guardado. */
export function imageMimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'jpg':
    case 'jpeg':
    default:
      return 'image/jpeg';
  }
}
