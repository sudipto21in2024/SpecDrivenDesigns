import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, setSessionExpiredHandler } from '../../api/client';
import type { AuthUser } from '../../api/client';
import { tokenStore } from '../../api/tokenStore';

/**
 * Authentication state for the SPA (LOGI-0003 AC-12, ADR-007).
 *
 * Responsibilities, deliberately kept in one place:
 *  - restore a session on start-up (stored tokens + GET /auth/me, so a stale token is caught early
 *    and a role change is picked up from the server rather than trusted from the token);
 *  - sign in / sign out, keeping the token store and the in-memory user in step;
 *  - react to an unrecoverable 401 by dropping to the anonymous state (the API client reports this
 *    through setSessionExpiredHandler once its single refresh attempt has failed).
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** AC-1/AC-2: resolves on success; rejects with ApiError so the login form can show the problem. */
  login: (email: string, password: string) => Promise<void>;
  /** AC-9: best-effort server-side revocation, then always clears local state. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() => (tokenStore.get() === null ? 'anonymous' : 'loading'));
  const [user, setUser] = useState<AuthUser | null>(null);

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setStatus('anonymous');
  }, []);

  // The API client calls this when a 401 survived its refresh-and-retry, i.e. the session is over.
  useEffect(() => {
    setSessionExpiredHandler(clearSession);
    return () => setSessionExpiredHandler(null);
  }, [clearSession]);

  // Restore a stored session once. Any failure (expired token, revoked user, server down) is treated
  // as signed out: the login screen is always a safe landing state.
  useEffect(() => {
    if (status !== 'loading') return;

    let cancelled = false;
    api
      .me()
      .then((identity) => {
        if (cancelled) return;
        setUser(identity);
        setStatus('authenticated');
      })
      .catch(() => {
        if (!cancelled) clearSession();
      });

    return () => {
      cancelled = true;
    };
    // Intentionally runs on mount only — a restored session must not re-run when status changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const tokens = await api.login({ email, password });
    // Store the pair before flipping state: the first authenticated render must already be able to
    // attach the bearer token, otherwise its initial queries would 401.
    tokenStore.set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    setUser(tokens.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = tokenStore.refreshToken;
    clearSession();
    if (refreshToken === null) return;

    try {
      await api.logout(refreshToken);
    } catch {
      // A failed revocation must not trap the user in a signed-in UI. The local session is already
      // gone; the token expires on its own, and the failure is not actionable for the user.
    }
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout }),
    [status, user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Access authentication state. Throws when used outside the provider, which is a wiring bug. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
