export type Message = {
  id: string;
  direction: string;
  kind?: string | null;
  body?: string | null;
  createdAt?: string | null;
};

function formatTime(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

export default function MessageList({ messages }: { messages: Message[] }) {
  if (!messages || messages.length === 0) {
    return <p className="messages-empty">No hay mensajes.</p>;
  }

  return (
    <ul className="message-list">
      {messages.map((m) => {
        const inbound = m.direction === 'inbound' || m.direction === 'IN';
        const text = m.body ?? `(${m.kind ?? 'sin texto'})`;
        return (
          <li
            key={m.id}
            className={`message message-${inbound ? 'inbound' : 'outbound'}`}
          >
            <div className="message-body">{text}</div>
            <div className="message-meta">
              <span className="message-kind">{m.kind ?? ''}</span>
              <time className="message-time">{formatTime(m.createdAt)}</time>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
