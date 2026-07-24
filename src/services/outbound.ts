export interface SentMessage {
  to: string;
  text: string;
}

export interface SentImage {
  to: string;
  imagePath: string;
  caption: string | null;
}

export interface OutboundSender {
  sendText(toPhoneE164: string, text: string): Promise<void>;
  /**
   * Envía una imagen (desde una ruta absoluta en disco) con caption opcional.
   * Opcional en la interfaz: canales que aún no soportan media pueden omitirlo;
   * el pipeline verifica su presencia antes de usarlo.
   */
  sendImage?(toPhoneE164: string, imagePath: string, caption?: string | null): Promise<void>;
}

export class MemorySender implements OutboundSender {
  readonly sent: SentMessage[] = [];
  readonly sentImages: SentImage[] = [];

  async sendText(to: string, text: string): Promise<void> {
    this.sent.push({ to, text });
  }

  async sendImage(to: string, imagePath: string, caption?: string | null): Promise<void> {
    this.sentImages.push({ to, imagePath, caption: caption ?? null });
  }

  clear(): void {
    this.sent.length = 0;
    this.sentImages.length = 0;
  }
}
