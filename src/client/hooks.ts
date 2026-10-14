import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

export interface ApiState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  setData: (updater: (prev: T | null) => T | null) => void;
}

/** GET `path` (null = skip). Aborts on change/unmount; `reload` re-fetches. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api
      .get<T>(path, ctrl.signal)
      .then((d) => {
        if (!ctrl.signal.aborted) setDataState(d);
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError' || ctrl.signal.aborted) return;
        setError(err instanceof ApiError ? err : new ApiError(0, 'unknown', String(err)));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((updater: (prev: T | null) => T | null) => setDataState((prev) => updater(prev)), []);
  return { data, error, loading, reload, setData };
}

/** Poll `fn` every `ms` while `active`. */
export function useInterval(fn: () => void, ms: number, active = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => saved.current(), ms);
    return () => window.clearInterval(id);
  }, [ms, active]);
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · SOMM` : 'SOMM — Sound of My Mind';
  }, [title]);
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setMatches(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return !!matches;
}
