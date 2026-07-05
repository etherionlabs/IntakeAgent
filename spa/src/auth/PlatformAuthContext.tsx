import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { platformApi, setPlatformUnauthorizedHandler, type PlatformUser } from '../api/client';

interface PlatformAuthState {
  user: PlatformUser | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const PlatformAuthContext = createContext<PlatformAuthState | null>(null);

function readUser(): PlatformUser | null {
  const raw = localStorage.getItem('intake_platform_user');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('intake_platform_token'));
  const [user, setUser] = useState<PlatformUser | null>(() => readUser());

  function logout() {
    localStorage.removeItem('intake_platform_token');
    localStorage.removeItem('intake_platform_user');
    setToken(null);
    setUser(null);
  }

  async function login(username: string, password: string) {
    const res = await platformApi.login(username, password);
    localStorage.setItem('intake_platform_token', res.token);
    localStorage.setItem('intake_platform_user', JSON.stringify(res.user));
    setToken(res.token);
    setUser(res.user);
  }

  useEffect(() => {
    setPlatformUnauthorizedHandler(() => logout());
  }, []);

  return (
    <PlatformAuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </PlatformAuthContext.Provider>
  );
}

export function usePlatformAuth(): PlatformAuthState {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) throw new Error('usePlatformAuth must be used within PlatformAuthProvider');
  return ctx;
}
