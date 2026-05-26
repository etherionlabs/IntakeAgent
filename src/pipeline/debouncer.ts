export interface DebouncerOptions {
  debounceMs: number;
  onFlush: (contactId: string, messageIds: string[]) => Promise<void>;
}

interface BufferState {
  messages: string[];
  timer: NodeJS.Timeout | null;
  processing: boolean;
}

export class InboundDebouncer {
  private readonly buffers = new Map<string, BufferState>();

  constructor(private readonly opts: DebouncerOptions) {}

  enqueue(contactId: string, messageId: string): void {
    let buf = this.buffers.get(contactId);
    if (!buf) {
      buf = { messages: [], timer: null, processing: false };
      this.buffers.set(contactId, buf);
    }
    buf.messages.push(messageId);
    if (buf.processing) return;
    this.resetTimer(contactId, buf);
  }

  private resetTimer(contactId: string, buf: BufferState): void {
    if (buf.timer) clearTimeout(buf.timer);
    buf.timer = setTimeout(() => {
      void this.flush(contactId).catch(() => {});
    }, this.opts.debounceMs);
  }

  private async flush(contactId: string): Promise<void> {
    const buf = this.buffers.get(contactId);
    if (!buf) return;
    if (buf.messages.length === 0) return;
    buf.processing = true;
    buf.timer = null;
    const ids = buf.messages.splice(0, buf.messages.length);
    try {
      await this.opts.onFlush(contactId, ids);
    } finally {
      buf.processing = false;
      if (buf.messages.length > 0) {
        this.resetTimer(contactId, buf);
      }
    }
  }

  reset(): void {
    for (const buf of this.buffers.values()) {
      if (buf.timer) clearTimeout(buf.timer);
    }
    this.buffers.clear();
  }
}
