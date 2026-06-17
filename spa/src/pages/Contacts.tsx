import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';

export type Contact = {
  id: string;
  phoneE164: string;
  displayName?: string | null;
  botActive?: boolean;
  flaggedNonIntake?: boolean;
  flaggedReason?: string | null;
  archivedAt?: string | null;
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
  const [showArchived, setShowArchived] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Contact | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getContacts(showArchived);
      setContacts(data.contacts as Contact[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al cargar contactos');
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchLocal = (updated: Contact) =>
    setContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

  const toggle = useCallback(async (contact: Contact) => {
    setBusy(contact.id);
    setError(null);
    try {
      const data = await api.toggleContact(contact.id, !!contact.botActive);
      patchLocal(data.contact as Contact);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al actualizar contacto');
    } finally {
      setBusy(null);
    }
  }, []);

  async function saveName(contact: Contact) {
    setBusy(contact.id);
    setError(null);
    try {
      const data = await api.updateContact(contact.id, { displayName: editName });
      patchLocal(data.contact as Contact);
      setEditId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al guardar nombre');
    } finally {
      setBusy(null);
    }
  }

  async function unflag(contact: Contact) {
    setBusy(contact.id);
    setError(null);
    try {
      const data = await api.updateContact(contact.id, { unflag: true });
      patchLocal(data.contact as Contact);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al quitar marca');
    } finally {
      setBusy(null);
    }
  }

  async function archiveOrRestore(contact: Contact) {
    setBusy(contact.id);
    setError(null);
    try {
      if (contact.archivedAt) await api.restoreContact(contact.id);
      else await api.archiveContact(contact.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al archivar');
    } finally {
      setBusy(null);
    }
  }

  async function doDelete(contact: Contact) {
    setBusy(contact.id);
    setError(null);
    try {
      await api.deleteContact(contact.id);
      setContacts((prev) => prev.filter((c) => c.id !== contact.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al eliminar');
    } finally {
      setBusy(null);
      setConfirmDelete(null);
    }
  }

  return (
    <div className="contacts">
      <div className="contacts-head">
        <h1>Contactos</h1>
        <label>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />{' '}
          Ver archivados
        </label>
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
              const isEditing = editId === contact.id;
              return (
                <tr key={contact.id}>
                  <td>
                    {isEditing ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        aria-label="Nombre"
                      />
                    ) : (
                      contact.displayName ?? contact.phoneE164
                    )}
                  </td>
                  <td>{contact.phoneE164}</td>
                  <td>
                    <span className={`chip ${c.cls}`}>{c.label}</span>
                    {contact.archivedAt && <span className="chip chip-paused">Archivado</span>}
                  </td>
                  <td className="contacts-actions">
                    {isEditing ? (
                      <>
                        <button type="button" onClick={() => void saveName(contact)} disabled={busy === contact.id}>
                          Guardar
                        </button>
                        <button type="button" onClick={() => setEditId(null)}>
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditId(contact.id);
                            setEditName(contact.displayName ?? '');
                          }}
                        >
                          Editar
                        </button>
                        {contact.flaggedNonIntake && (
                          <button type="button" onClick={() => void unflag(contact)} disabled={busy === contact.id}>
                            Quitar spam
                          </button>
                        )}
                        {!contact.flaggedNonIntake && (
                          <button type="button" onClick={() => void toggle(contact)} disabled={busy === contact.id}>
                            {contact.botActive ? 'Pausar' : 'Reanudar'}
                          </button>
                        )}
                        <button type="button" onClick={() => void archiveOrRestore(contact)} disabled={busy === contact.id}>
                          {contact.archivedAt ? 'Restaurar' : 'Archivar'}
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() => setConfirmDelete(contact)}
                          disabled={busy === contact.id}
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Eliminar contacto definitivamente"
        message="Se borrarán el contacto y TODOS sus trabajos y mensajes de forma permanente. Esta acción no se puede deshacer."
        confirmLabel="Eliminar definitivamente"
        danger
        onConfirm={() => confirmDelete && void doDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
