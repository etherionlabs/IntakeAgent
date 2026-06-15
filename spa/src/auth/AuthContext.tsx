import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from '../api/client';

interface AuthState {
  user: any | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function readUser(): any | null {
  const raw = localStorage.getItem('intake_user');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('intake_token'));
  const [user, setUser] = useState<any | null>(() => readUser());

  function logout() {
    localStorage.removeItem('intake_token');
    localStorage.removeItem('intake_user');
    setToken(null);
    setUser(null);
  }

  async function login(username: string, password: string) {
    const res = await api.login(username, password);
    localStorage.setItem('intake_token', res.token);
    localStorage.setItem('intake_user', JSON.stringify(res.user));
    setToken(res.token);
    setUser(res.user);
  }

  useEffect(() => {
    setUnauthorizedHandler(() => logout());
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
