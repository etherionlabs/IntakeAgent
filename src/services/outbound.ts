export interface SentMessage {
  to: string;
  text: string;
}

export interface OutboundSender {
  sendText(toPhoneE164: string, text: string): Promise<void>;
}

export class MemorySender implements OutboundSender {
  readonly sent: SentMessage[] = [];

  async sendText(to: string, text: string): Promise<void> {
    this.sent.push({ to, text });
  }

  clear(): void {
    this.sent.length = 0;
  }
}
