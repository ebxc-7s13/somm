import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { MeResponse } from './types';

interface AuthState {
  me: MeResponse | null;
  loading: boolean;
  /** Network failure while checking the session (not "signed out"). */
  offline: boolean;
  refresh: () => Promise<MeResponse | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({ me: null, loading: true, offline: false, refresh: async () => null, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<MeResponse>('/api/me');
      setMe(r);
      setOffline(false);
      return r;
    } catch (err) {
      if (err instanceof ApiError && err.isNetwork) setOffline(true);
      else setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.post('/api/auth/signout').catch(() => undefined);
    setMe(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ me, loading, offline, refresh, signOut }), [me, loading, offline, refresh, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

const ToastContext = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" data-kind={t.kind}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
