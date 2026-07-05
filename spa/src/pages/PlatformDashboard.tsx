import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ApiError,
  platformApi,
  type PlatformTenant,
  type PlatformTenantUser,
} from '../api/client';

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
    industry: '',
    profileDir: './profiles/tapiceria',
  });
  const [userForm, setUserForm] = useState({
    username: 'admin',
    password: '',
    role: 'admin' as 'admin' | 'viewer',
  });

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

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function createTenant(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const res = await platformApi.createTenant(tenantForm);
      setMessage(`Tenant creado: ${res.tenant.slug}`);
      setTenantForm({ slug: '', name: '', industry: '', profileDir: './profiles/tapiceria' });
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
      setMessage(`Usuario tenant creado: ${res.user.username}`);
      setUserForm({ username: 'admin', password: '', role: 'admin' });
      await loadUsers();
      await loadTenants();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'error al crear usuario');
    }
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
            Industria
            <input
              value={tenantForm.industry}
              onChange={(e) => setTenantForm({ ...tenantForm, industry: e.target.value })}
            />
          </label>
          <label>
            Perfil
            <input
              value={tenantForm.profileDir}
              onChange={(e) => setTenantForm({ ...tenantForm, profileDir: e.target.value })}
            />
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
                  <th>Usuarios</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr key={tenant.id}>
                    <td>{tenant.slug}</td>
                    <td>{tenant.name}</td>
                    <td>{tenant._count?.panelUsers ?? 0}</td>
                    <td>
                      <button type="button" onClick={() => setSelectedTenantId(tenant.id)}>
                        Abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </section>

      {selectedTenant && (
        <section className="settings-section">
          <h2>{selectedTenant.name}</h2>
          <p className="platform-meta">
            {selectedTenant.slug} - {selectedTenant.industry} - {selectedTenant.profileDir}
          </p>

          <form className="platform-user-form" onSubmit={createTenantUser}>
            <label>
              Usuario
              <input value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} />
            </label>
            <label>
              Contrasena
              <input
                type="password"
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
              />
            </label>
            <label>
              Rol
              <select
                value={userForm.role}
                onChange={(e) => setUserForm({ ...userForm, role: e.target.value as 'admin' | 'viewer' })}
              >
                <option value="admin">admin</option>
                <option value="viewer">viewer</option>
              </select>
            </label>
            <button type="submit">Crear usuario</button>
          </form>

          {tenantUsers.length === 0 ? (
            <p>No hay usuarios tenant.</p>
          ) : (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Creado</th>
                </tr>
              </thead>
              <tbody>
                {tenantUsers.map((user) => (
                  <tr key={user.id}>
                    <td>{user.username}</td>
                    <td>{user.role}</td>
                    <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
