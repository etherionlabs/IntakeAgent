/**
 * Describe imágenes entrantes (fotos del cliente) usando un modelo de visión.
 *
 * El SDK del agente es text-only (`sendSync(string)`), así que en vez de pasarle
 * los píxeles en cada turno, convertimos la foto a una descripción en texto y la
 * persistimos en el `body` del mensaje. Así el agente la "razona" igual que un
 * mensaje de texto, queda en el historial y se muestra en el panel — y solo
 * pagamos la llamada de visión una vez por foto.
 */
/**
 * Contexto que enfoca la descripción de la foto en lo importante para ESTE
 * negocio y ESTA conversación. Todos los campos son opcionales: si no llegan,
 * el describer usa un prompt genérico (retrocompatible).
 */
export interface DescribeContext {
  /** Texto que el cliente mandó junto a la foto. */
  caption?: string | null;
  /** Nombre del negocio (ej. "Tapicería Demo"). */
  businessName?: string;
  /** Giro/dominio (ej. "tapicería de muebles"). */
  businessDomain?: string;
  /** Qué datos recoge el negocio de cada trabajo (enfoque del negocio). */
  collects?: string;
  /** Contexto libre del negocio (business-facts.freeContext). */
  businessContext?: string;
  /** Estado de la sesión: qué ya sabemos y qué falta del intake. */
  sessionState?: string;
  /** Conversación reciente para saber de qué se está hablando. */
  recentConversation?: string;
}

export interface Describer {
  /**
   * Devuelve una descripción en español de la imagen, o null si no se pudo
   * generar (sin API key, error de red, modelo sin visión, etc.).
   */
  describe(
    buffer: Buffer,
    mimetype: string,
    context?: DescribeContext,
  ): Promise<string | null>;
}

export class NoopDescriber implements Describer {
  async describe(): Promise<string | null> {
    return null;
  }
}

export class ScriptedDescriber implements Describer {
  private idx = 0;
  constructor(private readonly script: ReadonlyArray<string | null>) {}

  async describe(): Promise<string | null> {
    if (this.idx >= this.script.length) return null;
    return this.script[this.idx++] ?? null;
  }
}

/**
 * Construye las instrucciones (system prompt) del modelo de visión inyectando
 * el contexto del negocio y de la sesión, para que se enfoque en las partes
 * relevantes de la imagen. Es una función pura para poder testearla.
 */
export function buildVisionInstructions(ctx?: DescribeContext): string {
  const parts: string[] = [
    'Eres un asistente que describe fotos enviadas por clientes de un negocio, ' +
      'para ayudar a levantar un trabajo (intake).',
  ];

  if (ctx?.businessName) {
    parts.push(
      `Negocio: ${ctx.businessName}${ctx.businessDomain ? ` — ${ctx.businessDomain}` : ''}.`,
    );
  } else if (ctx?.businessDomain) {
    parts.push(`Giro del negocio: ${ctx.businessDomain}.`);
  }

  if (ctx?.businessContext) {
    parts.push(`Sobre el negocio: ${ctx.businessContext}`);
  }

  if (ctx?.collects) {
    parts.push(
      'El negocio recoge estos datos de cada trabajo; enfócate en lo que la foto ' +
        `aporte para ellos:\n${ctx.collects}`,
    );
  }

  if (ctx?.sessionState) {
    parts.push(`Estado actual de este trabajo: ${ctx.sessionState}`);
  }

  if (ctx?.recentConversation) {
    parts.push(`Conversación reciente: ${ctx.recentConversation}`);
  }

  parts.push(
    'Describe en español, en 1-3 frases, de forma objetiva y útil. Prioriza los ' +
      'aspectos relevantes para los datos anteriores (tipo de objeto/mueble, material ' +
      'o tela aparente, color, estado o daños visibles, cantidad). No inventes datos ' +
      'que no aparezcan en la imagen ni hagas suposiciones de precio o tiempos. Si la ' +
      'foto no es relevante (p. ej. una captura de pantalla o un texto), dilo brevemente.',
  );

  return parts.join('\n\n');
}

/**
 * Describer que usa el endpoint de visión de OpenRouter vía `@openrouter/sdk`
 * (`callModel` con un content part `input_image` en data URL).
 *
 * El SDK es ESM-only — usamos `await import` perezoso, igual que el transcriber.
 */
export class OpenRouterImageDescriber implements Describer {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async describe(
    buffer: Buffer,
    mimetype: string,
    context?: DescribeContext,
  ): Promise<string | null> {
    if (!this.apiKey) return null;
    try {
      const { OpenRouter } = await import('@openrouter/sdk');
      const sdk = new OpenRouter({ apiKey: this.apiKey });

      const instructions = buildVisionInstructions(context);
      const caption = context?.caption?.trim();
      const userText = caption
        ? `El cliente envió esta foto con el texto: "${caption}". Descríbela.`
        : 'El cliente envió esta foto. Descríbela.';
      const dataUrl = `data:${mimetype || 'image/jpeg'};base64,${buffer.toString('base64')}`;

      // El SDK tipa el input de forma estricta; casteamos como el sdk-factory.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input: any = [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: userText },
            { type: 'input_image', detail: 'auto', imageUrl: dataUrl },
          ],
        },
      ];

      const result = sdk.callModel({
        model: this.model,
        instructions,
        input,
      });
      const text = (await result.getText())?.trim();
      return text ? text : null;
    } catch (e) {
      // Log a stderr para diagnóstico — sin pino para evitar dependencia cruzada.
      console.warn(
        `[OpenRouterImageDescriber] excepción: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }
}
