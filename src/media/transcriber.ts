export interface Transcriber {
  transcribe(buffer: Buffer, mimetype: string): Promise<string | null>;
}

export class NoopTranscriber implements Transcriber {
  async transcribe(_buffer: Buffer, _mimetype: string): Promise<string | null> {
    return null;
  }
}

export class ScriptedTranscriber implements Transcriber {
  private idx = 0;
  constructor(private readonly script: ReadonlyArray<string | null>) {}

  async transcribe(_buffer: Buffer, _mimetype: string): Promise<string | null> {
    if (this.idx >= this.script.length) return null;
    return this.script[this.idx++] ?? null;
  }
}

/**
 * Transcriber que usa el endpoint STT de OpenRouter vía `@openrouter/sdk`.
 *
 * Modelos soportados: cualquier modelo de transcripción listado por OpenRouter.
 * Ejemplos comunes: `openai/whisper-1`, `openai/whisper-large-v3`.
 *
 * El SDK es ESM-only — usamos `await import` perezoso.
 */
export class WhisperTranscriber implements Transcriber {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async transcribe(buffer: Buffer, mimetype: string): Promise<string | null> {
    if (!this.apiKey) return null;
    try {
      const { OpenRouter } = await import('@openrouter/sdk');
      const sdk = new OpenRouter({ apiKey: this.apiKey });
      const response = await sdk.stt.createTranscription({
        sttRequest: {
          inputAudio: {
            data: buffer.toString('base64'),
            format: formatFromMime(mimetype),
          },
          model: this.model,
        },
      });
      const text = response.text?.trim();
      return text ? text : null;
    } catch (e) {
      // Log a stderr para diagnóstico — no usamos pino aquí para evitar
      // dependencia cruzada con el logger.
      console.warn(
        `[WhisperTranscriber] excepción: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }
}

/**
 * Mapea un mimetype a uno de los formatos aceptados por el SDK
 * (`wav | mp3 | flac | m4a | ogg | webm | aac`).
 */
function formatFromMime(mimetype: string): string {
  const m = mimetype.toLowerCase();
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  if (m.includes('wav')) return 'wav';
  if (m.includes('webm')) return 'webm';
  if (m.includes('flac')) return 'flac';
  if (m.includes('aac')) return 'aac';
  // Default razonable para WhatsApp (notas de voz son OGG/opus).
  return 'ogg';
}
