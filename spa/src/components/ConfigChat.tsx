import { useEffect, useRef, useState } from 'react';
import { api, type ChatTurn, type ConfigPatch, type ConfigSnapshot } from '../api/client';

/**
 * El asistente que acompaña TODA la configuración, no una casilla suelta.
 *
 * Un dueño que entra al panel por primera vez ve cinco pestañas y no sabe cuál
 * mira primero. Aquí solo tiene que contestar preguntas sobre su propio negocio
 * — que es lo único que sabe hacer sin ayuda — y el asistente va llenando las
 * pestañas por él.
 *
 * Dos reglas que no se rompen:
 * - Nada se guarda solo. Cada propuesta se aplica al FORMULARIO y el dueño la ve,
 *   la corrige en su pestaña si quiere, y decide guardar.
 * - El hilo vive aquí, en el navegador. El servidor no persiste conversaciones,
 *   así que cerrar el panel a media charla no deja nada a medias.
 */

/** Cuántos turnos viajan al modelo. Cada uno cuesta: el hilo se recorta. */
const MAX_TURNS = 30;

type Msg = ChatTurn & {
  /** Resumen de lo que ese turno cambió en el formulario, para que no sea magia. */
  applied?: string[];
};

/** Qué tocó el parche, en el idioma del dueño (y no en el de la base de datos). */
function describePatch(patch: ConfigPatch): string[] {
  const out: string[] = [];
  if (patch.businessName !== undefined) out.push('el nombre del negocio');
  if (patch.businessDomain !== undefined) out.push('a qué se dedica');
  if (patch.welcome !== undefined) out.push('el mensaje de bienvenida');
  if (patch.tone !== undefined) out.push('el tono');
  if (patch.freeContext !== undefined) out.push('las notas de tu negocio');
  if (patch.facts?.length) {
    out.push(patch.facts.length === 1 ? '1 dato que ya sabe responder' : `${patch.facts.length} datos que ya sabe responder`);
  }
  if (patch.sections?.length) {
    const n = patch.sections.reduce((acc, s) => acc + s.fields.length, 0);
    out.push(`lo que le pide al cliente (${n} dato${n === 1 ? '' : 's'})`);
  }
  return out;
}

function greeting(businessName: string): string {
  return businessName
    ? `Hola. Vamos a repasar cómo atiende el asistente de ${businessName}. Cuéntame a qué se dedica el negocio y qué es lo que más te preguntan tus clientes.`
    : 'Hola. Te acompaño a dejar listo tu asistente sin que tengas que pelearte con formularios. Para empezar: ¿cómo se llama tu negocio y a qué se dedica?';
}

export default function ConfigChat({
  snapshot,
  onPatch,
  onSaveAll,
  saving,
  dirty,
}: {
  snapshot: ConfigSnapshot;
  onPatch: (patch: ConfigPatch) => void;
  onSaveAll: () => void;
  saving: boolean;
  /** Hay cambios aplicados al formulario sin guardar. */
  dirty: boolean;
}) {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: greeting(snapshot.businessName) },
  ]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // El turno nuevo aparece abajo: sin esto el dueño se queda mirando el principio
  // de la conversación mientras la respuesta cae fuera de la vista.
  useEffect(() => {
    // jsdom no implementa scrollIntoView: se comprueba antes de llamarlo para que
    // los tests no revienten por algo que solo es comodidad visual.
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messages, busy]);

  async function send(history: Msg[]) {
    setBusy(true);
    setError(null);
    try {
      const turns: ChatTurn[] = history
        .slice(-MAX_TURNS)
        .map(({ role, content }) => ({ role, content }));
      const res = await api.assistChat(turns, snapshot);
      const applied = res.patch ? describePatch(res.patch) : [];
      if (res.patch) onPatch(res.patch);
      setMessages([...history, { role: 'assistant', content: res.reply, applied: applied.length ? applied : undefined }]);
      setDone(res.done);
    } catch (err) {
      // El turno del dueño se queda en pantalla: reintentar es un clic, no
      // volver a escribirlo.
      setError(err instanceof Error ? err.message : 'no se pudo continuar la conversación');
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setText('');
    void send(next);
  }

  // El último turno es del dueño = la respuesta se perdió por un error.
  const canRetry = !busy && !!error && messages[messages.length - 1]?.role === 'user';

  return (
    <div className="config-chat">
      <div className="chat-log" role="log" aria-label="Conversación de configuración">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'chat-turn chat-mine' : 'chat-turn chat-theirs'}>
            <p>{m.content}</p>
            {m.applied && (
              <p className="chat-applied">
                Apliqué {m.applied.join(', ')} al formulario. Revísalo y guárdalo cuando estés de acuerdo.
              </p>
            )}
          </div>
        ))}
        {busy && <p className="chat-typing">Pensando…</p>}
        <div ref={endRef} />
      </div>

      {error && (
        <p className="error" role="alert">
          {error}{' '}
          {canRetry && (
            <button type="button" className="link-btn" onClick={() => void send(messages)}>
              Reintentar
            </button>
          )}
        </p>
      )}

      <div className="chat-compose">
        <textarea
          rows={2}
          value={text}
          aria-label="Escríbele a tu asistente"
          placeholder="Escríbelo como se lo contarías a un empleado nuevo…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter envía; Shift+Enter hace párrafo. Lo que espera cualquiera que
            // haya usado WhatsApp, que es de donde viene este usuario.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="btn-primary" onClick={submit} disabled={busy || !text.trim()}>
          Enviar
        </button>
      </div>

      {done && !dirty && (
        <p className="settings-msg">Con esto tu asistente ya puede atender. Puedes seguir afinando cuando quieras.</p>
      )}

      {dirty && (
        <div className="chat-save">
          <p className="settings-hint">
            Hay cambios propuestos sin guardar. Puedes revisarlos en las otras pestañas antes
            de aplicarlos.
          </p>
          <button type="button" className="btn-primary" onClick={onSaveAll} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar todo'}
          </button>
        </div>
      )}
    </div>
  );
}
