import { useState } from 'react';
import { api } from '../api/client';

export type IntakeField = {
  key: string;
  label: string;
  type: 'string' | 'text' | 'phone' | 'integer' | 'enum' | 'boolean' | string;
  required?: boolean;
  options?: string[];
  hint?: string;
  min?: number;
};

export type IntakeSection = {
  key: string;
  label: string;
  fields: IntakeField[];
};

export type IntakeSchema = {
  sections: IntakeSection[];
};

type FieldEntry = {
  value?: unknown;
  declined?: boolean;
  declined_reason?: string;
};

export type Intake = Record<string, Record<string, FieldEntry>>;

type FieldStatus = { state: 'saving' | 'saved' | 'error'; message?: string };

function initialValue(entry?: FieldEntry): string {
  if (!entry || entry.value === null || entry.value === undefined) return '';
  if (typeof entry.value === 'boolean') return entry.value ? 'true' : 'false';
  return String(entry.value);
}

export default function IntakeForm({
  jobId,
  schema,
  intake,
  onChanged,
}: {
  jobId: string;
  schema: IntakeSchema;
  intake: Intake;
  onChanged?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const section of schema.sections ?? []) {
      for (const field of section.fields ?? []) {
        const path = `${section.key}.${field.key}`;
        init[path] = initialValue(intake?.[section.key]?.[field.key]);
      }
    }
    return init;
  });
  const [status, setStatus] = useState<Record<string, FieldStatus>>({});

  function coerce(field: IntakeField, raw: string): unknown {
    if (raw === '') return null;
    if (field.type === 'integer') {
      const n = Number(raw);
      return Number.isNaN(n) ? raw : n;
    }
    if (field.type === 'boolean') return raw === 'true';
    return raw;
  }

  async function save(path: string, field: IntakeField, raw: string) {
    setStatus((s) => ({ ...s, [path]: { state: 'saving' } }));
    try {
      await api.patchIntake(jobId, { path, value: coerce(field, raw) });
      setStatus((s) => ({ ...s, [path]: { state: 'saved' } }));
      onChanged?.();
    } catch (err) {
      setStatus((s) => ({
        ...s,
        [path]: {
          state: 'error',
          message: err instanceof Error ? err.message : 'error al guardar',
        },
      }));
    }
  }

  async function decline(path: string) {
    const reason = window.prompt('Motivo (opcional):') ?? '';
    setStatus((s) => ({ ...s, [path]: { state: 'saving' } }));
    try {
      await api.patchIntake(jobId, {
        path,
        declined: true,
        declined_reason: reason,
      });
      setStatus((s) => ({ ...s, [path]: { state: 'saved' } }));
      onChanged?.();
    } catch (err) {
      setStatus((s) => ({
        ...s,
        [path]: {
          state: 'error',
          message: err instanceof Error ? err.message : 'error al declinar',
        },
      }));
    }
  }

  return (
    <div className="intake-form">
      {(schema.sections ?? []).map((section) => (
        <fieldset className="intake-section" key={section.key}>
          <legend>{section.label}</legend>
          {(section.fields ?? []).map((field) => {
            const path = `${section.key}.${field.key}`;
            const entry = intake?.[section.key]?.[field.key];
            const declined = entry?.declined === true;
            const value = values[path] ?? '';
            const st = status[path];
            const fieldId = `f-${path}`;

            const onChange = (
              v: string,
            ) => setValues((vs) => ({ ...vs, [path]: v }));

            return (
              <div
                className={`intake-field${declined ? ' intake-field-declined' : ''}`}
                key={path}
              >
                <label htmlFor={fieldId}>
                  {field.label}
                  {field.required && <span className="required">*</span>}
                </label>

                {field.type === 'text' ? (
                  <textarea
                    id={fieldId}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={() => void save(path, field, value)}
                  />
                ) : field.type === 'enum' ? (
                  <select
                    id={fieldId}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={() => void save(path, field, value)}
                  >
                    <option value="">—</option>
                    {(field.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'boolean' ? (
                  <select
                    id={fieldId}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={() => void save(path, field, value)}
                  >
                    <option value="">—</option>
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                ) : (
                  <input
                    id={fieldId}
                    type={field.type === 'integer' ? 'number' : 'text'}
                    min={field.type === 'integer' ? field.min : undefined}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={() => void save(path, field, value)}
                  />
                )}

                {field.hint && <small className="field-hint">{field.hint}</small>}

                <div className="field-row">
                  {!field.required && (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => void decline(path)}
                    >
                      Declinar
                    </button>
                  )}
                  {declined && (
                    <span className="declined-tag">
                      Declinado{entry?.declined_reason ? `: ${entry.declined_reason}` : ''}
                    </span>
                  )}
                  {st?.state === 'saving' && (
                    <span className="field-status">guardando…</span>
                  )}
                  {st?.state === 'saved' && (
                    <span className="field-status field-ok">guardado</span>
                  )}
                  {st?.state === 'error' && (
                    <span className="field-status error" role="alert">
                      {st.message}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
