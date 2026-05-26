import type { BatchMessage } from './types';

export function renderUserMessage(batch: BatchMessage[]): string {
  if (batch.length === 0) {
    throw new Error('renderUserMessage: batch vacío');
  }
  const parts: string[] = [];
  batch.forEach((m, idx) => {
    const n = idx + 1;
    switch (m.kind) {
      case 'text':
        parts.push(`[mensaje ${n} — texto]\n${m.body ?? ''}`);
        break;
      case 'image':
        parts.push(
          `[mensaje ${n} — foto recibida]\n(imagen guardada en ${m.mediaPath ?? 'desconocido'})`,
        );
        break;
      case 'audio':
        parts.push(
          `[mensaje ${n} — audio transcrito]\n${m.body ?? '(sin transcripción)'}\n(archivo: ${m.mediaPath ?? 'desconocido'})`,
        );
        break;
      case 'sticker':
      case 'location':
      case 'other':
      default:
        parts.push(`[mensaje ${n} — ${m.kind} no soportado]\n${m.body ?? ''}`);
        break;
    }
  });
  return parts.join('\n\n');
}
