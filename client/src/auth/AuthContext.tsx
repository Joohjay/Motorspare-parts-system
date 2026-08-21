import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { authApi } from '@/lib/authApi';
import { setUnauthorizedHandler } from '@/lib/api';
import type { SafeUser } from '@/types/api';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: SafeUser | null;
  login: (email: string, password: string) => Promise<SafeUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  clear: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Restores the session by calling /api/auth/me on mount. The backend is the
 * single source of truth for the authenticated user; the role shown here is
 * for UX only and is never used for authorization decisions.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SafeUser | null>(null);

  const clear = useCallback(() => {
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { user: currentUser } = await authApi.me();
      if (currentUser.status !== 'ACTIVE') {
        clear();
        return;
      }
      setUser(currentUser);
      setStatus('authenticated');
    } catch {
      clear();
    }
  }, [clear]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { user: loggedIn } = await authApi.login(email, password);
      setUser(loggedIn);
      setStatus('authenticated');
      return loggedIn;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      clear();
    }
  }, [clear]);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    void refresh();
    return () => setUnauthorizedHandler(null);
  }, [clear, refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout, refresh, clear }),
    [status, user, login, logout, refresh, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}