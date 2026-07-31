import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import RowMenu from '../components/RowMenu';
import { relativeTime, absoluteTime } from '../lib/time';

export type Contact = {
  id: string;
  phoneE164: string;
  displayName?: string | null;
  botActive?: boolean;
  flaggedNonIntake?: boolean;
  flaggedReason?: string | null;
  archivedAt?: string | null;
  jobCount?: number;
  openJobCount?: number;
  lastMessageAt?: string | null;
  lastJobId?: string | null;
};

type FilterKey = 'all' | 'active' | 'paused' | 'flagged' | 'archived';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'active', label: 'Activos' },
  { key: 'paused', label: 'Pausados' },
  { key: 'flagged', label: 'Spam' },
  { key: 'archived', label: 'Archivados' },
];

function statusChip(contact: Contact): { label: string; cls: string } {
  if (contact.archivedAt) return { label: 'Archivado', cls: 'chip-paused' };
  if (contact.flaggedNonIntake) return { label: 'Spam', cls: 'chip-nointake' };
  if (contact.botActive) return { label: 'Activo', cls: 'chip-active' };
  return { label: 'Pausado', cls: 'chip-paused' };
}

function matchesFilter(contact: Contact, filter: FilterKey): boolean {
  switch (filter) {
    case 'active': return !contact.archivedAt && !contact.flaggedNonIntake && !!contact.botActive;
    case 'paused': return !contact.archivedAt && !contact.flaggedNonIntake && !contact.botActive;
    case 'flagged': return !contact.archivedAt && !!contact.flaggedNonIntake;
    case 'archived': return !!contact.archivedAt;
    default: return true;
  }
}

/** Normaliza para buscar: sin acentos, sin mayúsculas y sin separadores del teléfono. */
function norm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s()-]/g, '');
}

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Contact | null>(null);

  // Los archivados solo se piden al servidor cuando el filtro los incluye.
  const includeArchived = filter === 'archived' || filter === 'all';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getContacts(includeArchived);
      setContacts(data.contacts as Contact[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al cargar contactos');
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => { void load(); }, [load]);

  const patchLocal = (updated: Contact) =>
    setContacts((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));

  async function run(contact: Contact, fn: () => Promise<void>) {
    setBusy(contact.id);
    setError(null);
    try { await fn(); }
    catch (err) { setError(err instanceof Error ? err.message : 'no se pudo completar la acción'); }
    finally { setBusy(null); }
  }

  const toggle = (contact: Contact) => run(contact, async () => {
    const data = await api.toggleContact(contact.id, !!contact.botActive);
    patchLocal(data.contact as Contact);
  });

  const saveName = (contact: Contact) => run(contact, async () => {
    const data = await api.updateContact(contact.id, { displayName: editName });
    patchLocal(data.contact as Contact);
    setEditId(null);
  });

  const unflag = (contact: Contact) => run(contact, async () => {
    const data = await api.updateContact(contact.id, { unflag: true });
    patchLocal(data.contact as Contact);
  });

  const archiveOrRestore = (contact: Contact) => run(contact, async () => {
    if (contact.archivedAt) await api.restoreContact(contact.id);
    else await api.archiveContact(contact.id);
    await load();
  });

  const doDelete = (contact: Contact) => run(contact, async () => {
    await api.deleteContact(contact.id);
    setContacts((prev) => prev.filter((c) => c.id !== contact.id));
    setConfirmDelete(null);
  });

  const visible = useMemo(() => {
    const q = norm(query.trim());
    return contacts
      .filter((c) => matchesFilter(c, filter))
      .filter((c) => q.length === 0 || norm(`${c.displayName ?? ''} ${c.phoneE164}`).includes(q));
  }, [contacts, filter, query]);

  function actionsFor(contact: Contact) {
    const disabled = busy === contact.id;
    return [
      {
        label: 'Editar nombre',
        disabled,
        onSelect: () => { setEditId(contact.id); setEditName(contact.displayName ?? ''); },
      },
      contact.flaggedNonIntake
        ? { label: 'Ya no es spam', disabled, onSelect: () => void unflag(contact) }
        : {
            label: contact.botActive ? 'Pausar el asistente' : 'Reanudar el asistente',
            disabled,
            onSelect: () => void toggle(contact),
          },
      {
        label: contact.archivedAt ? 'Restaurar' : 'Archivar',
        disabled,
        onSelect: () => void archiveOrRestore(contact),
      },
      { label: 'Eliminar…', danger: true, disabled, onSelect: () => setConfirmDelete(contact) },
    ];
  }

  return (
    <div className="contacts">
      <div className="contacts-head">
        <h1>Contactos</h1>
        <button type="button" onClick={() => void load()} disabled={loading}>
          Refrescar
        </button>
      </div>

      <div className="list-toolbar">
        <input
          type="search"
          className="list-search"
          placeholder="Buscar por nombre o teléfono"
          aria-label="Buscar contactos"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="segmented" role="group" aria-label="Filtrar por estado">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={filter === f.key ? 'segment segment-on' : 'segment'}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p>Cargando…</p>}

      {!loading && (
        <p className="list-count">
          {visible.length === contacts.length
            ? `${visible.length} ${visible.length === 1 ? 'contacto' : 'contactos'}`
            : `${visible.length} de ${contacts.length} contactos`}
        </p>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="empty-hint">
          {contacts.length === 0 ? (
            <p>Aún no hay contactos. Aparecerán aquí en cuanto alguien te escriba por WhatsApp.</p>
          ) : (
            <p>Ningún contacto coincide con la búsqueda o el filtro.</p>
          )}
        </div>
      )}

      {!loading && !error && visible.length > 0 && (
        <table className="data-table contacts-table">
          <thead>
            <tr>
              <th>Contacto</th>
              <th>Estado</th>
              <th>Trabajos</th>
              <th>Última actividad</th>
              <th><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((contact) => {
              const chip = statusChip(contact);
              const isEditing = editId === contact.id;
              const name = contact.displayName ?? 'Sin nombre';
              return (
                <tr key={contact.id} className={busy === contact.id ? 'row-busy' : undefined}>
                  <td data-label="Contacto">
                    {isEditing ? (
                      <div className="inline-edit">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          aria-label="Nombre"
                          autoFocus
                        />
                        <button type="button" className="btn-primary" onClick={() => void saveName(contact)} disabled={busy === contact.id}>
                          Guardar
                        </button>
                        <button type="button" onClick={() => setEditId(null)}>Cancelar</button>
                      </div>
                    ) : (
                      <div className="cell-stack">
                        <span className={contact.displayName ? 'cell-title' : 'cell-title cell-muted'}>{name}</span>
                        <span className="cell-sub">{contact.phoneE164}</span>
                      </div>
                    )}
                  </td>
                  <td data-label="Estado">
                    <span className={`chip ${chip.cls}`} title={contact.flaggedReason ?? undefined}>
                      {chip.label}
                    </span>
                  </td>
                  <td data-label="Trabajos">
                    {contact.jobCount ? (
                      <Link to={`/?contact=${contact.id}`} className="cell-link">
                        {contact.jobCount} {contact.jobCount === 1 ? 'trabajo' : 'trabajos'}
                        {!!contact.openJobCount && (
                          <span className="cell-sub"> · {contact.openJobCount} abierto{contact.openJobCount === 1 ? '' : 's'}</span>
                        )}
                      </Link>
                    ) : (
                      <span className="cell-muted">—</span>
                    )}
                  </td>
                  <td data-label="Última actividad" title={absoluteTime(contact.lastMessageAt)}>
                    {contact.lastMessageAt ? (
                      contact.lastJobId ? (
                        <Link to={`/jobs/${contact.lastJobId}`} className="cell-link">
                          {relativeTime(contact.lastMessageAt)}
                        </Link>
                      ) : (
                        relativeTime(contact.lastMessageAt)
                      )
                    ) : (
                      <span className="cell-muted">—</span>
                    )}
                  </td>
                  <td className="cell-actions">
                    <RowMenu label={`Acciones de ${name}`} actions={actionsFor(contact)} />
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
