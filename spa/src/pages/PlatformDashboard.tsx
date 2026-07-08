import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  api,
  platformApi,
  type PlatformTenant,
  type PlatformTenantUser,
} from '../api/client';

// Fallback si el catálogo del backend no responde.
const FALLBACK_TEMPLATES = [{ value: 'generico', label: 'Otro / Servicios' }];

export default function PlatformDashboard() {
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [tenantUsers, setTenantUsers] = useState<PlatformTenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tenantForm, setTenantForm] = useState({
    slug: '',
    name: '',
    industry: 'generico',
    profileDir: './profiles/generico',
  });
  const [templates, setTemplates] = useState(FALLBACK_TEMPLATES);
  const [userForm, setUserForm] = useState({ username: 'dueno', email: '', password: '' });
  // Modal de borrado: exige escribir el slug del tenant.
  const [deleting, setDeleting] = useState<PlatformTenant | null>(null);
  const [deleteSlug, setDeleteSlug] = useState('');
  // Edición inline del dueño (email + reset de contraseña).
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editUserForm, setEditUserForm] = useState({ email: '', password: '' });

  const loadTenants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await platformApi.getTenants();
      setTenants(data.tenants);
      setSelectedTenantId((current) => current ?? data.tenants[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al cargar tenants');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    if (!selectedTenantId) {
      setTenantUsers([]);
      return;
    }
    try {
      const data = await platformApi.getTenantUsers(selectedTenantId);
      setTenantUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al cargar usuarios');
    }
  }, [selectedTenantId]);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  // Catálogo de plantillas/giros (público). Alimenta el selector del form.
  useEffect(() => {
    api.getIndustries()
      .then((r) => { if (r.industries?.length) setTemplates(r.industries); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  /** Ejecuta una acción de plataforma, muestra resultado y recarga tenants + usuarios. */
  const act = useCallback(
    async (fn: () => Promise<unknown>, okMsg = 'Listo.') => {
      setError(null);
      setMessage(null);
      try {
        await fn();
        setMessage(okMsg);
        await loadTenants();
        await loadUsers();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'error en la acción');
      }
    },
    [loadTenants, loadUsers],
  );

  async function createTenant(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const res = await platformApi.createTenant(tenantForm);
      setMessage(`Tenant creado: ${res.tenant.slug}`);
      setTenantForm({ slug: '', name: '', industry: 'generico', profileDir: './profiles/generico' });
      await loadTenants();
      setSelectedTenantId(res.tenant.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'error al crear tenant');
    }
  }

  async function createTenantUser(e: FormEvent) {
    e.preventDefault();
    if (!selectedTenantId) return;
    setError(null);
    setMessage(null);
    try {
      const res = await platformApi.createTenantUser(selectedTenantId, userForm);
      setMessage(`Dueño creado: ${res.user.email ?? res.user.username}`);
      setUserForm({ username: 'dueno', email: '', password: '' });
      await loadUsers();
      await loadTenants();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'error al crear dueño');
    }
  }

  async function confirmDelete() {
    if (!deleting || deleteSlug !== deleting.slug) return;
    const id = deleting.id;
    await act(() => platformApi.deleteTenant(id, deleteSlug), 'Tenant eliminado.');
    setDeleting(null);
    setDeleteSlug('');
  }

  function startEditUser(user: PlatformTenantUser) {
    setEditUserId(user.id);
    setEditUserForm({ email: user.email ?? '', password: '' });
  }

  async function saveEditUser() {
    if (!selectedTenantId || !editUserId) return;
    const payload: { email?: string; password?: string } = {};
    if (editUserForm.email) payload.email = editUserForm.email;
    if (editUserForm.password) payload.password = editUserForm.password;
    await act(() => platformApi.updateTenantUser(selectedTenantId, editUserId, payload), 'Dueño actualizado.');
    setEditUserId(null);
  }

  const selectedTenant = tenants.find((t) => t.id === selectedTenantId) ?? null;

  return (
    <div className="platform">
      <div className="dashboard-head">
        <h1>Plataforma</h1>
        <button type="button" onClick={() => void loadTenants()} disabled={loading}>
          Refrescar
        </button>
      </div>

      {loading && <p>Cargando...</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="settings-msg">{message}</p>}

      <section className="platform-grid">
        <form className="settings-section" onSubmit={createTenant}>
          <h2>Crear tenant</h2>
          <label>
            Slug
            <input value={tenantForm.slug} onChange={(e) => setTenantForm({ ...tenantForm, slug: e.target.value })} />
          </label>
          <label>
            Nombre
            <input value={tenantForm.name} onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })} />
          </label>
          <label>
            Plantilla / Giro
            <select
              value={tenantForm.industry}
              onChange={(e) => setTenantForm({ ...tenantForm, industry: e.target.value, profileDir: `./profiles/${e.target.value}` })}
            >
              {templates.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <button type="submit">Crear tenant</button>
        </form>

        <section className="settings-section">
          <h2>Tenants</h2>
          {tenants.length === 0 ? (
            <p>No hay tenants.</p>
          ) : (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Slug</th>
                  <th>Nombre</th>
                  <th>Estado</th>
                  <th>Uso mes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr key={tenant.id}>
                    <td>{tenant.slug}</td>
                    <td>{tenant.name}</td>
                    <td><span className={`badge badge-${tenant.approvalStatus}`}>{tenant.approvalStatus}</span></td>
                    <td>{tenant.monthUsed}{tenant.monthlyRunLimit !== null ? ` / ${tenant.monthlyRunLimit}` : ''}</td>
                    <td className="platform-actions">
                      <button type="button" onClick={() => setSelectedTenantId(tenant.id)}>Abrir</button>
                      {tenant.approvalStatus === 'pending' && (
                        <>
                          <button type="button" onClick={() => void act(() => platformApi.approveTenant(tenant.id), 'Aprobado.')}>Aprobar</button>
                          <button type="button" onClick={() => void act(() => platformApi.rejectTenant(tenant.id), 'Rechazado.')}>Rechazar</button>
                        </>
                      )}
                      <button type="button" onClick={() => void act(() => platformApi.suspendTenant(tenant.id), 'Suspendido.')}>Suspender</button>
                      <button type="button" onClick={() => void act(() => platformApi.reactivateTenant(tenant.id), 'Reactivado.')}>Reactivar</button>
                      <button type="button" onClick={() => { setDeleting(tenant); setDeleteSlug(''); }}>Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </section>

      {deleting && (
        <div className="platform-modal" role="dialog" aria-label="Confirmar eliminación">
          <p>
            Esto elimina <strong>{deleting.name}</strong> y todos sus datos de forma irreversible.
            Escribe el slug <code>{deleting.slug}</code> para confirmar.
          </p>
          <input
            placeholder={`escribe el slug (${deleting.slug})`}
            value={deleteSlug}
            onChange={(e) => setDeleteSlug(e.target.value)}
          />
          <button type="button" onClick={() => void confirmDelete()} disabled={deleteSlug !== deleting.slug}>
            Confirmar
          </button>
          <button type="button" onClick={() => { setDeleting(null); setDeleteSlug(''); }}>Cancelar</button>
        </div>
      )}

      {selectedTenant && (
        <section className="settings-section">
          <h2>{selectedTenant.name}</h2>
          <p className="platform-meta">
            {selectedTenant.slug} - {selectedTenant.industry} - {selectedTenant.profileDir}
          </p>

          <form className="platform-user-form" onSubmit={createTenantUser}>
            <h3>Crear dueño</h3>
            <label>
              Usuario
              <input value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} />
            </label>
            <label>
              Email
              <input
                type="email"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
              />
            </label>
            <label>
              Contraseña
              <input
                type="password"
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
              />
            </label>
            <button type="submit">Crear dueño</button>
          </form>

          {tenantUsers.length === 0 ? (
            <p>No hay usuarios.</p>
          ) : (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Email</th>
                  <th>Creado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tenantUsers.map((user) => (
                  <tr key={user.id}>
                    <td>{user.username}</td>
                    <td>{user.email ?? '—'}</td>
                    <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                    <td className="platform-actions">
                      <button type="button" onClick={() => startEditUser(user)}>Editar</button>
                      <button type="button" onClick={() => void act(() => platformApi.deleteTenantUser(selectedTenant.id, user.id), 'Dueño eliminado.')}>Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {editUserId && (
            <div className="platform-edit-user">
              <h3>Editar dueño</h3>
              <label>
                Email
                <input
                  type="email"
                  value={editUserForm.email}
                  onChange={(e) => setEditUserForm({ ...editUserForm, email: e.target.value })}
                />
              </label>
              <label>
                Nueva contraseña (opcional)
                <input
                  type="password"
                  value={editUserForm.password}
                  onChange={(e) => setEditUserForm({ ...editUserForm, password: e.target.value })}
                />
              </label>
              <button type="button" onClick={() => void saveEditUser()}>Guardar</button>
              <button type="button" onClick={() => setEditUserId(null)}>Cancelar</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
