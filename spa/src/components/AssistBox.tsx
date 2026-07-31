import { useState } from 'react';
import { api } from '../api/client';

/**
 * "Escríbelo como lo dirías y yo lo ordeno."
 *
 * Es el puente entre lo que un dueño sabe expresar y lo que el sistema necesita.
 * La propuesta NUNCA se guarda sola: se aplica al formulario para que él la revise,
 * la edite y decida guardarla. Si no hay modelo disponible, el componente no se
 * muestra y el formulario manual sigue siendo el camino completo.
 */
export default function AssistBox<T>({
  action,
  title,
  hint,
  placeholder,
  cta,
  onSuggestion,
}: {
  action: 'facts' | 'fields' | 'welcome';
  title: string;
  hint: string;
  placeholder: string;
  cta: string;
  onSuggestion: (suggestion: T) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.assistSettings(action, text);
      onSuggestion(res.suggestion as T);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'no se pudo generar una propuesta');
    } finally {
      setBusy(false);
    }
  }

  // 'welcome' se genera con el contexto que ya tiene el negocio: no exige escribir.
  const canRun = action === 'welcome' || text.trim().length >= 10;

  return (
    <div className="assist-box">
      <h4>{title}</h4>
      <p className="settings-hint">{hint}</p>
      {action !== 'welcome' && (
        <textarea
          rows={4}
          value={text}
          placeholder={placeholder}
          aria-label={title}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      <div className="assist-actions">
        <button type="button" onClick={() => void run()} disabled={busy || !canRun}>
          {busy ? 'Pensando…' : cta}
        </button>
        <span className="settings-hint">Revisa la propuesta antes de guardar.</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
