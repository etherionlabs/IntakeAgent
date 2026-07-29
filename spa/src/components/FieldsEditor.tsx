import { useState } from 'react';
import type { IntakeSection, IntakeField } from '../api/client';

/**
 * Editor de "qué le pregunta el asistente a cada cliente".
 *
 * Está escrito para un dueño de negocio, no para quien conoce el modelo de datos:
 * los tipos se nombran por lo que el cliente responde ("Texto corto", "Sí / No")
 * y la clave interna del campo no se muestra nunca — se deriva de la etiqueta al
 * crearlo y NO cambia al renombrar, porque es la identidad con la que quedaron
 * guardados los datos de los trabajos que ya existen.
 */

/** `multi_enum` queda fuera a propósito: el asistente no puede escribirlo todavía
 *  (bulkUpdate lo rechaza), así que ofrecerlo sería una trampa. */
const TYPES: { value: IntakeField['type']; label: string; help: string }[] = [
  { value: 'string', label: 'Texto corto', help: 'Un nombre, una marca, un color' },
  { value: 'text', label: 'Texto largo', help: 'Una descripción de varias líneas' },
  { value: 'integer', label: 'Número entero', help: 'Cantidad, año, piezas' },
  { value: 'number', label: 'Número', help: 'Admite decimales: metros, kilos' },
  { value: 'currency', label: 'Importe', help: 'Una cantidad de dinero' },
  { value: 'boolean', label: 'Sí / No', help: 'Una respuesta de sí o no' },
  { value: 'enum', label: 'Lista de opciones', help: 'El cliente elige una de las que definas' },
  { value: 'phone', label: 'Teléfono', help: 'Un número de contacto' },
  { value: 'date', label: 'Fecha', help: 'Un día concreto' },
];

/** Deriva una clave válida (`[a-z_][a-z0-9_]*`) de lo que el dueño escribió. */
export function keyFromLabel(label: string, taken: string[]): string {
  const base = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const safe = /^[a-z]/.test(base) ? base : `campo_${base}`;
  if (!taken.includes(safe)) return safe;
  let n = 2;
  while (taken.includes(`${safe}_${n}`)) n += 1;
  return `${safe}_${n}`;
}

export default function FieldsEditor({
  sections,
  onChange,
}: {
  sections: IntakeSection[];
  onChange: (next: IntakeSection[]) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const allKeys = sections.flatMap((s) => s.fields.map((f) => f.key));

  function patchSection(si: number, next: Partial<IntakeSection>) {
    onChange(sections.map((s, i) => (i === si ? { ...s, ...next } : s)));
  }

  function patchField(si: number, fi: number, next: Partial<IntakeField>) {
    patchSection(si, {
      fields: sections[si].fields.map((f, i) => (i === fi ? { ...f, ...next } : f)),
    });
  }

  function addField(si: number) {
    const label = 'Dato nuevo';
    patchSection(si, {
      fields: [
        ...sections[si].fields,
        { key: keyFromLabel(label, allKeys), label, type: 'string', required: false },
      ],
    });
  }

  function removeField(si: number, fi: number) {
    patchSection(si, { fields: sections[si].fields.filter((_, i) => i !== fi) });
    setConfirmRemove(null);
  }

  function moveField(si: number, fi: number, dir: -1 | 1) {
    const fields = [...sections[si].fields];
    const to = fi + dir;
    if (to < 0 || to >= fields.length) return;
    [fields[fi], fields[to]] = [fields[to], fields[fi]];
    patchSection(si, { fields });
  }

  function addSection() {
    const label = 'Grupo nuevo';
    const key = keyFromLabel(label, sections.map((s) => s.key));
    onChange([
      ...sections,
      { key, label, fields: [{ key: keyFromLabel('Dato', allKeys), label: 'Dato', type: 'string', required: false }] },
    ]);
  }

  function removeSection(si: number) {
    onChange(sections.filter((_, i) => i !== si));
    setConfirmRemove(null);
  }

  return (
    <div className="fields-editor">
      {sections.map((section, si) => (
        <fieldset className="fields-group" key={section.key}>
          <legend>
            <input
              className="fields-group-name"
              value={section.label}
              aria-label={`Nombre del grupo ${si + 1}`}
              onChange={(e) => patchSection(si, { label: e.target.value })}
            />
          </legend>

          {section.fields.map((field, fi) => (
            <div className="fe-row" key={field.key}>
              <div className="fe-main">
                <label className="fe-label">
                  <span className="fe-label-text">Qué le pides</span>
                  <input
                    value={field.label}
                    aria-label={`Etiqueta del dato ${fi + 1} de ${section.label}`}
                    onChange={(e) => patchField(si, fi, { label: e.target.value })}
                  />
                </label>

                <label className="fe-label">
                  <span className="fe-label-text">Cómo responde</span>
                  <select
                    value={field.type}
                    aria-label={`Tipo de ${field.label}`}
                    onChange={(e) => {
                      const type = e.target.value as IntakeField['type'];
                      patchField(si, fi, {
                        type,
                        // Una lista sin opciones no es válida: se siembra al elegirla.
                        options: type === 'enum' ? (field.options ?? ['Opción 1', 'Opción 2']) : undefined,
                      });
                    }}
                  >
                    {TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </label>

                <label className="checkbox fe-required">
                  <input
                    type="checkbox"
                    checked={!!field.required}
                    onChange={(e) => patchField(si, fi, { required: e.target.checked })}
                  />
                  Obligatorio
                </label>

                <div className="fe-move">
                  <button type="button" aria-label={`Subir ${field.label}`} onClick={() => moveField(si, fi, -1)} disabled={fi === 0}>↑</button>
                  <button type="button" aria-label={`Bajar ${field.label}`} onClick={() => moveField(si, fi, 1)} disabled={fi === section.fields.length - 1}>↓</button>
                  <button
                    type="button"
                    className="btn-danger"
                    aria-label={`Quitar ${field.label}`}
                    onClick={() => setConfirmRemove(`${si}:${fi}`)}
                  >
                    Quitar
                  </button>
                </div>
              </div>

              {field.type === 'enum' && (
                <label className="fe-label fe-options">
                  <span className="fe-label-text">Opciones (una por línea)</span>
                  <textarea
                    rows={3}
                    value={(field.options ?? []).join('\n')}
                    aria-label={`Opciones de ${field.label}`}
                    onChange={(e) =>
                      patchField(si, fi, {
                        options: e.target.value.split('\n').map((o) => o.trim()).filter(Boolean),
                      })
                    }
                  />
                </label>
              )}

              <label className="fe-label fe-hint">
                <span className="fe-label-text">Ayuda para el asistente (opcional)</span>
                <input
                  value={field.hint ?? ''}
                  placeholder="Ej. si dice «forrar» o «vinil», es un wrap"
                  aria-label={`Ayuda de ${field.label}`}
                  onChange={(e) => patchField(si, fi, { hint: e.target.value || undefined })}
                />
              </label>

              {confirmRemove === `${si}:${fi}` && (
                <div className="fe-confirm" role="alert">
                  <span>
                    Se quitará <strong>{field.label}</strong>. El asistente dejará de pedirlo; lo
                    que ya hayan respondido tus clientes se conserva pero deja de verse.
                  </span>
                  <button type="button" className="btn-danger" onClick={() => removeField(si, fi)}>Quitar</button>
                  <button type="button" onClick={() => setConfirmRemove(null)}>Cancelar</button>
                </div>
              )}
            </div>
          ))}

          <div className="fields-group-actions">
            <button type="button" onClick={() => addField(si)}>+ Añadir dato a «{section.label}»</button>
            {sections.length > 1 && (
              <button type="button" className="link-btn" onClick={() => setConfirmRemove(`s:${si}`)}>
                Quitar el grupo
              </button>
            )}
          </div>

          {confirmRemove === `s:${si}` && (
            <div className="fe-confirm" role="alert">
              <span>
                Se quitará el grupo <strong>{section.label}</strong> con sus {section.fields.length} dato(s).
              </span>
              <button type="button" className="btn-danger" onClick={() => removeSection(si)}>Quitar el grupo</button>
              <button type="button" onClick={() => setConfirmRemove(null)}>Cancelar</button>
            </div>
          )}
        </fieldset>
      ))}

      <button type="button" onClick={addSection}>+ Añadir un grupo</button>
    </div>
  );
}
