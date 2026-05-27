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

export class WhisperTranscriber implements Transcriber {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string = 'https://openrouter.ai/api/v1',
  ) {}

  async transcribe(buffer: Buffer, mimetype: string): Promise<string | null> {
    if (!this.apiKey) return null;
    try {
      const form = new FormData();
      const uint8 = new Uint8Array(buffer);
      const blob = new Blob([uint8], { type: mimetype });
      form.append('file', blob, `audio.${extFromMime(mimetype)}`);
      form.append('model', this.model);
      form.append('response_format', 'text');

      const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // Log a stderr para diagnóstico — no usar pino aquí para evitar dep ciclo.
        console.warn(
          `[WhisperTranscriber] fallo (${res.status}) en ${this.baseUrl}: ${body.slice(0, 200)}`,
        );
        return null;
      }
      const text = await res.text();
      return text.trim() || null;
    } catch (e) {
      console.warn(
        `[WhisperTranscriber] excepción: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }
}

function extFromMime(mimetype: string): string {
  if (mimetype.includes('ogg')) return 'ogg';
  if (mimetype.includes('mpeg') || mimetype.includes('mp3')) return 'mp3';
  if (mimetype.includes('mp4') || mimetype.includes('m4a')) return 'm4a';
  if (mimetype.includes('wav')) return 'wav';
  if (mimetype.includes('opus')) return 'opus';
  return 'bin';
}
