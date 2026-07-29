import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type ProfileSettings,
  type ConfigSettings,
  type MediaSettings,
  type BusinessFact,
  type SkillInfo,
  type IntakeSection,
} from '../api/client';
import FieldsEditor, { keyFromLabel } from '../components/FieldsEditor';
import AssistBox from '../components/AssistBox';

type TabKey = 'negocio' | 'datos' | 'saber' | 'atiende' | 'avanzado';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'negocio', label: 'Tu negocio' },
  { key: 'datos', label: 'Qué datos pides' },
  { key: 'saber', label: 'Lo que debe saber' },
  { key: 'atiende', label: 'Cómo atiende' },
  { key: 'avanzado', label: 'Avanzado' },
];

// `tone` es lo único de `vars` que un dueño puede tocar sin romper nada. El resto
// son instrucciones internas del asistente (cómo usa sus herramientas, sus reglas
// duras, cómo vende) y viven en "Avanzado" tras una advertencia: enseñarlas como
// campos normales invitaba a romper el bot sin saberlo.
const OWNER_VARS = ['tone'];

const TONE_PRESETS: { label: string; value: string }[] = [
  {
    label: 'Cercano y sencillo',
    value: 'Español neutro de México, cálido y cercano. Usa «tú». Mensajes cortos (1-3 frases), sin tecnicismos.',
  },
  {
    label: 'Profesional y directo',
    value: 'Español neutro de México, profesional y directo. Usa «tú». Mensajes breves y concretos, sin rodeos.',
  },
  {
    label: 'Formal (de usted)',
    value: 'Español neutro de México, formal y respetuoso. Trata de «usted». Mensajes claros y corteses.',
  },
  {
    label: 'Entusiasta',
    value: 'Español neutro de México, cálido y entusiasta por el oficio, sin ser insistente. Usa «tú». Mensajes cortos.',
  },
];

export default function Settings() {
  const [tab, setTab] = useState<TabKey>('negocio');
  const [profile, setProfile] = useState<ProfileSettings | null>(null);
  const [config, setConfig] = useState<ConfigSettings | null>(null);
  const [media, setMedia] = useState<MediaSettings | null>(null);
  const [fields, setFields] = useState<IntakeSection[]>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);
  const [assistOn, setAssistOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ where: string; text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSettings();
      setProfile(data.profile);
      setConfig(data.config);
      setMedia(data.media);
      setFields(data.fields ?? []);
      setAvailableSkills(data.availableSkills ?? []);
      // Si no hay modelo configurado el panel no ofrece las ayudas y no pasa nada.
      api.assistStatus().then((s) => setAssistOn(s.available)).catch(() => setAssistOn(false));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al cargar configuración');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(where: string, fn: () => Promise<void>, okText: string) {
    setSaving(where);
    setMsg(null);
    try {
      await fn();
      setMsg({ where, text: okText, ok: true });
    } catch (err) {
      setMsg({ where, text: err instanceof Error ? err.message : 'no se pudo guardar', ok: false });
    } finally {
      setSaving(null);
    }
  }

  const saveProfile = (where: string) =>
    save(where, async () => {
      const data = await api.updateProfileSettings(profile!);
      setProfile(data.profile);
    }, 'Guardado. Se aplica en la próxima conversación.');

  const saveFields = () =>
    save('datos', async () => {
      const data = await api.updateFieldsSettings(fields);
      setFields(data.fields);
    }, 'Guardado. El asistente empezará a pedir estos datos en la próxima conversación.');

  const saveMedia = () =>
    save('atiende', async () => {
      const data = await api.updateMediaSettings(media!);
      setMedia(data.media);
    }, 'Guardado. Aplica en la siguiente conversación.');

  const saveConfig = () =>
    save('sistema', async () => {
      const data = await api.updateConfigSettings(config!);
      setConfig(data.config);
    }, 'Guardado.');

  if (loading) return <p>Cargando…</p>;
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!profile) return null;

  const feedback = (where: string) =>
    msg?.where === where ? (
      <span className={msg.ok ? 'settings-msg' : 'error'} role={msg.ok ? undefined : 'alert'}>
        {msg.text}
      </span>
    ) : null;

  const saveBar = (where: string, onSave: () => void, label: string) => (
    <div className="settings-actions">
      <button type="button" className="btn-primary" onClick={onSave} disabled={saving === where}>
        {saving === where ? 'Guardando…' : label}
      </button>
      {feedback(where)}
    </div>
  );

  return (
    <div className="settings">
      <h1>Configuración</h1>
      <p className="settings-lead">
        Aquí defines cómo trabaja tu asistente. Los cambios aplican en la siguiente
        conversación; las que ya están en curso siguen con lo anterior.
      </p>

      <div className="segmented settings-tabs" role="tablist" aria-label="Secciones de configuración">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'segment segment-on' : 'segment'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ---------------- Tu negocio ---------------- */}
      {tab === 'negocio' && (
        <section className="settings-section">
          <h2>Tu negocio</h2>

          <label>
            Nombre del negocio
            <input
              value={profile.businessName}
              onChange={(e) => setProfile({ ...profile, businessName: e.target.value })}
            />
            <span className="settings-hint">Así se presenta el asistente con tus clientes.</span>
          </label>

          <label>
            A qué se dedica
            <input
              value={profile.businessDomain}
              onChange={(e) => setProfile({ ...profile, businessDomain: e.target.value })}
            />
            <span className="settings-hint">Ej. tapicería de muebles, taller mecánico, cerrajería.</span>
          </label>

          <label>
            Mensaje de bienvenida
            <textarea
              rows={3}
              value={profile.welcome}
              onChange={(e) => setProfile({ ...profile, welcome: e.target.value })}
            />
            <span className="settings-hint">
              Lo primero que lee un cliente que te escribe por primera vez.
            </span>
          </label>

          {assistOn && (
            <AssistBox<{ welcome: string }>
              action="welcome"
              title="¿Te escribo uno?"
              hint="Redacto una bienvenida con el nombre de tu negocio y el tono que elegiste."
              placeholder=""
              cta="Proponer bienvenida"
              onSuggestion={(s) => setProfile({ ...profile, welcome: s.welcome })}
            />
          )}

          {saveBar('negocio', () => void saveProfile('negocio'), 'Guardar')}
        </section>
      )}

      {/* ---------------- Qué datos pides ---------------- */}
      {tab === 'datos' && (
        <section className="settings-section">
          <h2>Qué datos pides</h2>
          <p className="settings-hint">
            El asistente va llenando esta lista conversando, sin interrogar al cliente. Marca
            como obligatorio solo lo que necesitas para cotizar: entre menos preguntes, más
            gente termina.
          </p>

          {assistOn && (
            <AssistBox<{ sections: { label: string; fields: any[] }[] }>
              action="fields"
              title="Dime qué necesitas saber y te armo la lista"
              hint="Escríbelo como se lo explicarías a un empleado nuevo."
              placeholder="Para cotizar necesito saber qué mueble es, de qué material está, las medidas y si tiene daños. También su nombre y de qué zona es."
              cta="Proponer campos"
              onSuggestion={(s) => {
                // Las claves se generan aquí, no las inventa el modelo: son la
                // identidad con la que se guardan las respuestas. Secciones y campos
                // llevan listas de ocupadas separadas (viven en espacios distintos).
                const sectionKeys: string[] = [];
                const fieldKeys: string[] = [];
                setFields(
                  s.sections.map((sec) => {
                    const sectionKey = keyFromLabel(sec.label, sectionKeys);
                    sectionKeys.push(sectionKey);
                    return {
                      key: sectionKey,
                      label: sec.label,
                      fields: sec.fields.map((f) => {
                        const key = keyFromLabel(f.label, fieldKeys);
                        fieldKeys.push(key);
                        return { ...f, key };
                      }),
                    };
                  }),
                );
              }}
            />
          )}

          <FieldsEditor sections={fields} onChange={setFields} />

          <p className="settings-hint">
            Si añades un dato obligatorio, el asistente empezará a pedirlo también en los
            trabajos que ya están abiertos.
          </p>

          {saveBar('datos', () => void saveFields(), 'Guardar los datos que pides')}
        </section>
      )}

      {/* ---------------- Lo que debe saber ---------------- */}
      {tab === 'saber' && (
        <section className="settings-section">
          <h2>Lo que debe saber de tu negocio</h2>
          <p className="settings-hint">
            El asistente solo responde con lo que pongas aquí. Si algo no está, dice que lo
            consultará contigo en vez de inventarlo.
          </p>

          {assistOn && (
            <AssistBox<{ facts: BusinessFact[] }>
              action="facts"
              title="Cuéntamelo y yo lo ordeno"
              hint="Escribe de corrido lo que le dirías a un cliente nuevo; lo separo por temas."
              placeholder="Abrimos de lunes a viernes de 9 a 7 y sábados hasta las 2. Estamos en Reforma 123. Aceptamos efectivo, transferencia y tarjeta, con 50% de anticipo. Los trabajos tardan de 5 a 10 días."
              cta="Ordenar en datos"
              onSuggestion={(s) =>
                setProfile({
                  ...profile,
                  businessFacts: {
                    ...profile.businessFacts,
                    // Se añaden a lo que ya hay: nunca se pisa lo que el dueño escribió.
                    facts: [
                      ...profile.businessFacts.facts,
                      ...s.facts.map((f) => ({ topic: f.topic, aliases: [], answer: f.answer })),
                    ],
                  },
                })
              }
            />
          )}

          {profile.businessFacts.facts.length === 0 && (
            <p className="settings-hint">Todavía no has cargado ningún dato.</p>
          )}

          {profile.businessFacts.facts.map((fact, idx) => (
            <div key={idx} className="fact-row">
              <input
                aria-label={`Tema ${idx + 1}`}
                placeholder="Tema (horarios, ubicación…)"
                value={fact.topic}
                onChange={(e) => updateFact(idx, { ...fact, topic: e.target.value })}
              />
              <input
                aria-label={`Respuesta ${idx + 1}`}
                placeholder="Lo que el asistente debe contestar"
                value={fact.answer}
                onChange={(e) => updateFact(idx, { ...fact, answer: e.target.value })}
              />
              <button type="button" onClick={() => removeFact(idx)}>Quitar</button>
            </div>
          ))}
          <button type="button" onClick={addFact}>+ Añadir dato</button>

          <label>
            Cualquier otra cosa que deba saber
            <textarea
              rows={4}
              value={profile.businessFacts.freeContext}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  businessFacts: { ...profile.businessFacts, freeContext: e.target.value },
                })
              }
            />
            <span className="settings-hint">
              Qué servicios ofreces, cuáles se complementan, qué NO haces.
            </span>
          </label>

          {saveBar('saber', () => void saveProfile('saber'), 'Guardar')}
        </section>
      )}

      {/* ---------------- Cómo atiende ---------------- */}
      {tab === 'atiende' && (
        <section className="settings-section">
          <h2>Cómo atiende</h2>

          <h3>Tono</h3>
          <div className="tone-presets">
            {TONE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={profile.vars.tone === p.value ? 'segment segment-on' : 'segment'}
                onClick={() => setProfile({ ...profile, vars: { ...profile.vars, tone: p.value } })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label>
            <span className="sr-only">Tono personalizado</span>
            <textarea
              rows={2}
              value={profile.vars.tone ?? ''}
              aria-label="Tono personalizado"
              onChange={(e) => setProfile({ ...profile, vars: { ...profile.vars, tone: e.target.value } })}
            />
            <span className="settings-hint">Elige uno de arriba o descríbelo con tus palabras.</span>
          </label>

          {saveBar('atiende-tono', () => void saveProfile('atiende-tono'), 'Guardar el tono')}

          {media && (
            <>
              <h3>Fotos y notas de voz</h3>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={media.describeImages}
                  onChange={(e) => setMedia({ ...media, describeImages: e.target.checked })}
                />
                Entender las fotos que manda el cliente
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={media.transcribeAudio}
                  onChange={(e) => setMedia({ ...media, transcribeAudio: e.target.checked })}
                />
                Escuchar las notas de voz
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={media.editImages}
                  onChange={(e) => setMedia({ ...media, editImages: e.target.checked })}
                />
                Mostrarle al cliente cómo quedaría (edita su foto). Cuesta más por conversación.
              </label>

              <h3>Seguimiento</h3>
              <p className="settings-hint">
                Cuando un cliente deja de responder, el asistente le escribe para retomar:
                recuerda lo que le ofreciste o pide el dato que falta. Máximo 2 mensajes por
                trabajo, solo en tu horario, y nunca a quien ya dijo que no.
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={media.followUpEnabled}
                  onChange={(e) => setMedia({ ...media, followUpEnabled: e.target.checked })}
                />
                Dar seguimiento a los clientes que no contestan
              </label>

              {availableSkills.length > 0 && (
                <>
                  <h3>Técnicas de venta</h3>
                  <p className="settings-hint">
                    Cómo trabaja el asistente al conversar. No se las menciona al cliente.
                  </p>
                  {availableSkills.map((s) => (
                    <label className="checkbox" key={s.name}>
                      <input
                        type="checkbox"
                        checked={media.skills.includes(s.name)}
                        onChange={(e) =>
                          setMedia({
                            ...media,
                            skills: e.target.checked
                              ? [...media.skills, s.name]
                              : media.skills.filter((n) => n !== s.name),
                          })
                        }
                      />
                      <span>
                        {s.title}
                        {s.description && <span className="settings-hint"> — {s.description}</span>}
                      </span>
                    </label>
                  ))}
                </>
              )}

              {saveBar('atiende', () => void saveMedia(), 'Guardar')}
            </>
          )}
        </section>
      )}

      {/* ---------------- Avanzado ---------------- */}
      {tab === 'avanzado' && (
        <section className="settings-section">
          <h2>Avanzado</h2>
          <div className="settings-warning" role="note">
            <strong>Esto cambia cómo razona el asistente.</strong> Son las instrucciones que
            sigue por dentro: cómo usa sus herramientas, qué tiene prohibido y cómo ofrece
            servicios. Si no estás seguro, no las toques — todo lo del día a día se
            configura en las otras pestañas.
          </div>

          {Object.entries(profile.vars)
            .filter(([key]) => !OWNER_VARS.includes(key))
            .map(([key, value]) => (
              <label key={key}>
                {key}
                <textarea
                  rows={6}
                  value={value}
                  onChange={(e) =>
                    setProfile({ ...profile, vars: { ...profile.vars, [key]: e.target.value } })
                  }
                />
              </label>
            ))}

          {saveBar('avanzado', () => void saveProfile('avanzado'), 'Guardar instrucciones')}

          {config && (
            <>
              <h3>Sistema</h3>
              <label>
                Modelo
                <input value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })} />
              </label>
              <label>
                Temperatura (0–2)
                <input
                  type="number" step="0.1" min={0} max={2}
                  value={config.temperature}
                  onChange={(e) => setConfig({ ...config, temperature: Number(e.target.value) })}
                />
              </label>
              <label>
                Pasos máximos
                <input
                  type="number" min={1}
                  value={config.maxSteps}
                  onChange={(e) => setConfig({ ...config, maxSteps: Number(e.target.value) })}
                />
              </label>

              <h3>Horario</h3>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={config.hours.enabled}
                  onChange={(e) => setConfig({ ...config, hours: { ...config.hours, enabled: e.target.checked } })}
                />
                Aplicar horario de atención
              </label>
              <label>
                Zona horaria
                <input
                  value={config.hours.timezone}
                  onChange={(e) => setConfig({ ...config, hours: { ...config.hours, timezone: e.target.value } })}
                />
              </label>
              <label>
                Aviso fuera de horario
                <textarea
                  rows={2}
                  value={config.hours.outOfHoursNotice}
                  onChange={(e) => setConfig({ ...config, hours: { ...config.hours, outOfHoursNotice: e.target.value } })}
                />
              </label>

              <h3>Avisos al dueño</h3>
              <label>
                Teléfono del dueño (E.164)
                <input
                  value={config.owner.phoneE164}
                  onChange={(e) => setConfig({ ...config, owner: { ...config.owner, phoneE164: e.target.value } })}
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={config.owner.notifyOnReady}
                  onChange={(e) => setConfig({ ...config, owner: { ...config.owner, notifyOnReady: e.target.checked } })}
                />
                Avisar cuando un trabajo esté listo
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={config.owner.notifyOnDisconnect}
                  onChange={(e) => setConfig({ ...config, owner: { ...config.owner, notifyOnDisconnect: e.target.checked } })}
                />
                Avisar si WhatsApp se desconecta
              </label>

              <h3>Límites de costo</h3>
              <label>
                Costo mensual máximo (USD)
                <input
                  type="number" min={1}
                  value={config.limits.monthlyCostUsd}
                  onChange={(e) => setConfig({ ...config, limits: { ...config.limits, monthlyCostUsd: Number(e.target.value) } })}
                />
              </label>
              <label>
                Alertar a partir de (USD)
                <input
                  type="number" min={1}
                  value={config.limits.alertOnCostUsd}
                  onChange={(e) => setConfig({ ...config, limits: { ...config.limits, alertOnCostUsd: Number(e.target.value) } })}
                />
              </label>

              {saveBar('sistema', () => void saveConfig(), 'Guardar sistema')}
            </>
          )}
        </section>
      )}
    </div>
  );

  function updateFact(idx: number, next: BusinessFact) {
    if (!profile) return;
    const facts = profile.businessFacts.facts.map((f, i) => (i === idx ? next : f));
    setProfile({ ...profile, businessFacts: { ...profile.businessFacts, facts } });
  }
  function removeFact(idx: number) {
    if (!profile) return;
    const facts = profile.businessFacts.facts.filter((_, i) => i !== idx);
    setProfile({ ...profile, businessFacts: { ...profile.businessFacts, facts } });
  }
  function addFact() {
    if (!profile) return;
    const facts = [...profile.businessFacts.facts, { topic: '', aliases: [], answer: '' }];
    setProfile({ ...profile, businessFacts: { ...profile.businessFacts, facts } });
  }
}
