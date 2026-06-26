import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from '../api/client';
import { setTenantTag, clearTenantTag } from '../lib/sentry';

interface AuthState {
  user: any | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // El estado de auth vive SOLO en memoria; la sesión persiste en la cookie
  // HttpOnly (inaccesible a JS). Al montar se rehidrata vía /auth/me.
  const [user, setUser] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  async function login(email: string, password: string) {
    const res = await api.login(email, password);
    setUser(res.user);
    if (res.user?.tenantId) setTenantTag(res.user.tenantId);
  }

  async function logout() {
    try { await api.logout(); } finally { setUser(null); clearTenantTag(); }
  }

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api.me()
      .then((res) => { setUser(res.user); if (res.user?.tenantId) setTenantTag(res.user.tenantId); })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
