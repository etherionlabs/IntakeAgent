import { useCallback, useEffect, useState } from 'react';
import { api, type ProfileSettings, type ConfigSettings, type BusinessFact } from '../api/client';

export default function Settings() {
  const [profile, setProfile] = useState<ProfileSettings | null>(null);
  const [config, setConfig] = useState<ConfigSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [configMsg, setConfigMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSettings();
      setProfile(data.profile);
      setConfig(data.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al cargar configuración');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProfile = useCallback(async () => {
    if (!profile) return;
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const data = await api.updateProfileSettings(profile);
      setProfile(data.profile);
      setProfileMsg('Guardado. Reinicia el worker para aplicar los cambios.');
    } catch (err) {
      setProfileMsg(err instanceof Error ? err.message : 'error al guardar perfil');
    } finally {
      setSavingProfile(false);
    }
  }, [profile]);

  const saveConfig = useCallback(async () => {
    if (!config) return;
    setSavingConfig(true);
    setConfigMsg(null);
    try {
      const data = await api.updateConfigSettings(config);
      setConfig(data.config);
      setConfigMsg('Guardado. Reinicia el worker para aplicar los cambios.');
    } catch (err) {
      setConfigMsg(err instanceof Error ? err.message : 'error al guardar config');
    } finally {
      setSavingConfig(false);
    }
  }, [config]);

  if (loading) return <p>Cargando…</p>;
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!profile || !config) return null;

  return (
    <div className="settings">
      <h1>Configuración</h1>

      {/* ---------- Perfil del negocio ---------- */}
      <section className="settings-section">
        <h2>Negocio</h2>

        <label>
          Nombre del negocio
          <input
            value={profile.businessName}
            onChange={(e) => setProfile({ ...profile, businessName: e.target.value })}
          />
        </label>

        <label>
          Giro / dominio
          <input
            value={profile.businessDomain}
            onChange={(e) => setProfile({ ...profile, businessDomain: e.target.value })}
          />
        </label>

        <label>
          Mensaje de bienvenida
          <textarea
            rows={3}
            value={profile.welcome}
            onChange={(e) => setProfile({ ...profile, welcome: e.target.value })}
          />
        </label>

        <h3>Variables del asistente</h3>
        {Object.entries(profile.vars).map(([key, value]) => (
          <label key={key}>
            {key}
            <textarea
              rows={key === 'tone' ? 2 : 4}
              value={value}
              onChange={(e) => setProfile({ ...profile, vars: { ...profile.vars, [key]: e.target.value } })}
            />
          </label>
        ))}

        <h3>Datos del negocio</h3>
        {profile.businessFacts.facts.map((fact, idx) => (
          <div key={idx} className="fact-row">
            <input
              aria-label={`Tema ${idx + 1}`}
              placeholder="tema"
              value={fact.topic}
              onChange={(e) => updateFact(idx, { ...fact, topic: e.target.value })}
            />
            <input
              aria-label={`Respuesta ${idx + 1}`}
              placeholder="respuesta"
              value={fact.answer}
              onChange={(e) => updateFact(idx, { ...fact, answer: e.target.value })}
            />
            <button type="button" onClick={() => removeFact(idx)}>
              Quitar
            </button>
          </div>
        ))}
        <button type="button" onClick={addFact}>
          Añadir dato
        </button>

        <label>
          Contexto general
          <textarea
            rows={3}
            value={profile.businessFacts.freeContext}
            onChange={(e) =>
              setProfile({
                ...profile,
                businessFacts: { ...profile.businessFacts, freeContext: e.target.value },
              })
            }
          />
        </label>

        <div className="settings-actions">
          <button type="button" onClick={() => void saveProfile()} disabled={savingProfile}>
            {savingProfile ? 'Guardando…' : 'Guardar negocio'}
          </button>
          {profileMsg && <span className="settings-msg">{profileMsg}</span>}
        </div>
      </section>

      {/* ---------- Configuración del sistema ---------- */}
      <section className="settings-section">
        <h2>Sistema</h2>

        <label>
          Modelo
          <input value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })} />
        </label>

        <label>
          Temperatura (0–2)
          <input
            type="number"
            step="0.1"
            min={0}
            max={2}
            value={config.temperature}
            onChange={(e) => setConfig({ ...config, temperature: Number(e.target.value) })}
          />
        </label>

        <label>
          Pasos máximos
          <input
            type="number"
            min={1}
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
            onChange={(e) =>
              setConfig({ ...config, hours: { ...config.hours, outOfHoursNotice: e.target.value } })
            }
          />
        </label>

        <h3>Dueño / notificaciones</h3>
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
            onChange={(e) =>
              setConfig({ ...config, owner: { ...config.owner, notifyOnReady: e.target.checked } })
            }
          />
          Avisar cuando un trabajo esté listo
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={config.owner.notifyOnDisconnect}
            onChange={(e) =>
              setConfig({ ...config, owner: { ...config.owner, notifyOnDisconnect: e.target.checked } })
            }
          />
          Avisar si WhatsApp se desconecta
        </label>

        <h3>Límites de costo</h3>
        <label>
          Costo mensual máximo (USD)
          <input
            type="number"
            min={1}
            value={config.limits.monthlyCostUsd}
            onChange={(e) =>
              setConfig({ ...config, limits: { ...config.limits, monthlyCostUsd: Number(e.target.value) } })
            }
          />
        </label>
        <label>
          Alertar a partir de (USD)
          <input
            type="number"
            min={1}
            value={config.limits.alertOnCostUsd}
            onChange={(e) =>
              setConfig({ ...config, limits: { ...config.limits, alertOnCostUsd: Number(e.target.value) } })
            }
          />
        </label>

        <div className="settings-actions">
          <button type="button" onClick={() => void saveConfig()} disabled={savingConfig}>
            {savingConfig ? 'Guardando…' : 'Guardar sistema'}
          </button>
          {configMsg && <span className="settings-msg">{configMsg}</span>}
        </div>
      </section>
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
