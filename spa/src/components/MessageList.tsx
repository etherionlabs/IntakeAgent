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

// El producto está en español; heredar el locale del navegador mezclaba fechas
// en inglés con los tiempos relativos ("hace 2 h"), que sí están traducidos.
const LOCALE = 'es-MX';

/** Hora corta ("14:32"). La fecha va en el separador de día, no en cada burbuja. */
function formatClock(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

/** Etiqueta del separador: "Hoy", "Ayer" o la fecha larga. */
function dayLabel(value: string, now: Date = new Date()): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
}

function dayKey(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toDateString();
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

  let lastDay = '';

  return (
    <ul className="message-list">
      {messages.map((m) => {
        const inbound = m.direction === 'inbound' || m.direction === 'IN';
        const kind = m.kind ?? 'text';
        const tag = KIND_TAG[kind];
        const text = m.body ?? (tag ? '(sin descripción)' : '(sin texto)');
        const hasImage = kind === 'image' && !!m.mediaPath;

        // Separador cuando cambia el día: da orden a una conversación larga sin
        // repetir la fecha completa en cada mensaje.
        const key = dayKey(m.createdAt);
        const showDay = !!key && key !== lastDay;
        if (showDay) lastDay = key;

        return (
          <li key={m.id} className="message-row">
            {showDay && (
              <div className="message-day">
                <span>{dayLabel(m.createdAt!)}</span>
              </div>
            )}
            <div className={`message message-${inbound ? 'inbound' : 'outbound'}`}>
              <div className="message-who">{inbound ? 'Cliente' : 'Asistente'}</div>
              {tag && <div className="message-kindtag">{tag}</div>}
              {hasImage && <MessageImage id={m.id} />}
              <div className="message-body">{text}</div>
              <div className="message-meta">
                <time className="message-time">{formatClock(m.createdAt)}</time>
              </div>
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
