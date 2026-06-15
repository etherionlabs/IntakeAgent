import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

export type Contact = {
  id: string;
  phoneE164: string;
  displayName?: string | null;
  botActive?: boolean;
  flaggedNonIntake?: boolean;
  flaggedReason?: string | null;
};

function chip(contact: Contact): { label: string; cls: string } {
  if (contact.flaggedNonIntake) return { label: 'No-intake', cls: 'chip-nointake' };
  if (contact.botActive) return { label: 'Activo', cls: 'chip-active' };
  return { label: 'Pausado', cls: 'chip-paused' };
}

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getContacts();
      setContacts(data.contacts as Contact[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al cargar contactos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(async (contact: Contact) => {
    setBusy(contact.id);
    setError(null);
    try {
      // if currently active → pause (botPaused=true); if paused → resume (botPaused=false)
      const botPaused = !!contact.botActive;
      const data = await api.toggleContact(contact.id, botPaused);
      const updated = data.contact as Contact;
      setContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al actualizar contacto');
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <div className="contacts">
      <div className="contacts-head">
        <h1>Contactos</h1>
        <button type="button" onClick={() => void load()} disabled={loading}>
          Refrescar
        </button>
      </div>

      {loading && <p>Cargando…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && contacts.length === 0 && <p>No hay contactos todavía.</p>}

      {!loading && !error && contacts.length > 0 && (
        <table className="contacts-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Teléfono</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => {
              const c = chip(contact);
              const name = contact.displayName ?? contact.phoneE164;
              return (
                <tr key={contact.id}>
                  <td>{name}</td>
                  <td>{contact.phoneE164}</td>
                  <td>
                    <span className={`chip ${c.cls}`}>{c.label}</span>
                  </td>
                  <td>
                    {!contact.flaggedNonIntake && (
                      <button
                        type="button"
                        onClick={() => void toggle(contact)}
                        disabled={busy === contact.id}
                      >
                        {contact.botActive ? 'Pausar' : 'Reanudar'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
