/**
 * Describe imágenes entrantes (fotos del cliente) usando un modelo de visión.
 *
 * El SDK del agente es text-only (`sendSync(string)`), así que en vez de pasarle
 * los píxeles en cada turno, convertimos la foto a una descripción en texto y la
 * persistimos en el `body` del mensaje. Así el agente la "razona" igual que un
 * mensaje de texto, queda en el historial y se muestra en el panel — y solo
 * pagamos la llamada de visión una vez por foto.
 */
export interface Describer {
  /**
   * Devuelve una descripción en español de la imagen, o null si no se pudo
   * generar (sin API key, error de red, modelo sin visión, etc.).
   */
  describe(
    buffer: Buffer,
    mimetype: string,
    opts?: { caption?: string | null },
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
 * Prompt de sistema para el modelo de visión. Orientado a intake de taller:
 * pedimos una descripción objetiva y útil, sin inventar datos que no se ven.
 */
const SYSTEM_PROMPT =
  'Eres un asistente que describe fotos enviadas por clientes de un taller. ' +
  'Describe en español, en 1-3 frases, lo que se ve de forma objetiva y útil para ' +
  'levantar un trabajo: tipo de objeto/mueble, material o tela aparente, color, ' +
  'estado o daños visibles, y cantidad si se aprecia. No inventes datos que no ' +
  'aparezcan en la imagen ni hagas suposiciones de precio o tiempos. Si la foto no ' +
  'es relevante (p. ej. una captura de pantalla o un texto), dilo brevemente.';

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
    opts?: { caption?: string | null },
  ): Promise<string | null> {
    if (!this.apiKey) return null;
    try {
      const { OpenRouter } = await import('@openrouter/sdk');
      const sdk = new OpenRouter({ apiKey: this.apiKey });

      const caption = opts?.caption?.trim();
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
        instructions: SYSTEM_PROMPT,
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
