import { useState } from 'react';
import { mediaUrl } from '../api/client';

export type Message = {
  id: string;
  direction: string;
  kind?: string | null;
  body?: string | null;
  mediaPath?: string | null;
  createdAt?: string | null;
};

function formatTime(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

// Etiqueta amigable por tipo de mensaje (para que el dueño vea de un vistazo que
// el bot recibió una foto/nota de voz, y el texto es lo que el asistente entendió).
const KIND_TAG: Record<string, string> = {
  image: '📷 Foto',
  audio: '🎤 Nota de voz',
  sticker: '💬 Sticker',
  location: '📍 Ubicación',
};

export default function MessageList({ messages }: { messages: Message[] }) {
  if (!messages || messages.length === 0) {
    return <p className="messages-empty">No hay mensajes.</p>;
  }

  return (
    <ul className="message-list">
      {messages.map((m) => {
        const inbound = m.direction === 'inbound' || m.direction === 'IN';
        const kind = m.kind ?? 'text';
        const tag = KIND_TAG[kind];
        const text = m.body ?? (tag ? '(sin descripción)' : '(sin texto)');
        const hasImage = kind === 'image' && !!m.mediaPath;
        return (
          <li
            key={m.id}
            className={`message message-${inbound ? 'inbound' : 'outbound'}`}
          >
            {tag && <div className="message-kindtag">{tag}</div>}
            {hasImage && <MessageImage id={m.id} />}
            <div className="message-body">{text}</div>
            <div className="message-meta">
              <time className="message-time">{formatTime(m.createdAt)}</time>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** <img> de un mensaje-imagen; si el archivo no está disponible se oculta. */
function MessageImage({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      className="message-image"
      src={mediaUrl(id)}
      alt="Imagen del mensaje"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
