/**
 * Edita imágenes entrantes para generar una PREVISUALIZACIÓN de un cambio visual
 * (ej. rayas deportivas, color de wrap, tono de polarizado) sobre la foto que el
 * cliente envió.
 *
 * Es el complemento "de salida" del `Describer`: en vez de imagen → texto, hace
 * imagen + instrucción → imagen editada. El agente lo dispara con la tool
 * `generate_preview`; el resultado se envía de vuelta al cliente por WhatsApp.
 */

/** Contexto que guía la edición para que el modelo sepa qué cambio aplicar. */
export interface ImageEditContext {
  businessName: string;
  businessDomain: string;
  /** Guía de estilo del vertical (profile.imageEditGuidance): cómo debe verse la edición. */
  editGuidance: string;
  /** Instrucción concreta del agente: qué cambio visual aplicar. */
  instruction: string;
}

/** Imagen resultante de la edición. */
export interface EditedImage {
  buffer: Buffer;
  mimetype: string;
}

export interface ImageEditor {
  edit(
    source: Buffer,
    sourceMime: string,
    context: ImageEditContext,
  ): Promise<EditedImage | null>;
}

/** No hace nada — degradación cuando no hay API key o el toggle está apagado. */
export class NoopImageEditor implements ImageEditor {
  async edit(
    _source: Buffer,
    _sourceMime: string,
    _context: ImageEditContext,
  ): Promise<EditedImage | null> {
    return null;
  }
}

/** Devuelve imágenes predefinidas en orden. Útil para tests. */
export class ScriptedImageEditor implements ImageEditor {
  private idx = 0;
  constructor(private readonly script: ReadonlyArray<EditedImage | null>) {}

  async edit(
    _source: Buffer,
    _sourceMime: string,
    _context: ImageEditContext,
  ): Promise<EditedImage | null> {
    if (this.idx >= this.script.length) return null;
    return this.script[this.idx++] ?? null;
  }
}

/**
 * Edita imágenes con un modelo de salida de imagen de OpenRouter (ej.
 * `google/gemini-2.5-flash-image-preview`).
 *
 * Usa el endpoint REST de chat completions con `modalities: ['image','text']`,
 * que es el contrato documentado y estable para generación/edición de imágenes.
 * (El `@openrouter/sdk` que usamos para texto/visión no expone una superficie
 * tipada estable para recuperar imágenes generadas, por eso aquí llamamos al
 * REST directamente.)
 */
export class OpenRouterImageEditor implements ImageEditor {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string = 'https://openrouter.ai/api/v1',
  ) {}

  async edit(
    source: Buffer,
    sourceMime: string,
    context: ImageEditContext,
  ): Promise<EditedImage | null> {
    if (!this.apiKey) return null;
    try {
      const dataUrl = `data:${normalizeImageMime(sourceMime)};base64,${source.toString('base64')}`;
      const body = {
        model: this.model,
        modalities: ['image', 'text'],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: buildEditPrompt(context) },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      };

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = await safeText(res);
        console.warn(`[OpenRouterImageEditor] HTTP ${res.status}: ${detail}`);
        return null;
      }

      const json: unknown = await res.json();
      const url = extractImageUrl(json);
      if (!url) {
        console.warn('[OpenRouterImageEditor] respuesta sin imagen');
        return null;
      }
      return dataUrlToImage(url);
    } catch (e) {
      console.warn(
        `[OpenRouterImageEditor] excepción: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }
}

function buildEditPrompt(ctx: ImageEditContext): string {
  const lines: string[] = [];
  lines.push(
    `Eres un editor de imágenes para **${ctx.businessName}**, un negocio de ${ctx.businessDomain}.`,
  );
  if (ctx.editGuidance.trim().length > 0) {
    lines.push(ctx.editGuidance.trim());
  }
  lines.push(`Cambio a aplicar sobre la foto adjunta: ${ctx.instruction.trim()}`);
  lines.push('Devuelve la imagen editada.');
  return lines.join('\n');
}

/** OpenRouter devuelve las imágenes en `choices[].message.images[].image_url.url`. */
function extractImageUrl(json: unknown): string | null {
  const choices = (json as { choices?: unknown[] })?.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = (first as { message?: unknown })?.message as
    | { images?: unknown[]; content?: unknown }
    | undefined;
  const images = message?.images;
  if (Array.isArray(images)) {
    for (const img of images) {
      const url = (img as { image_url?: { url?: unknown } })?.image_url?.url;
      if (typeof url === 'string' && url.startsWith('data:image')) return url;
    }
  }
  return null;
}

function dataUrlToImage(dataUrl: string): EditedImage | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  const mimetype = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) return null;
  return { buffer, mimetype };
}

function normalizeImageMime(mimetype: string): string {
  const m = mimetype.split(';')[0].trim().toLowerCase();
  return m.startsWith('image/') ? m : 'image/jpeg';
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '(sin cuerpo)';
  }
}
