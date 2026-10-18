/**
 * What the server supports, fetched once (/api/client-config): WebSocket push or
 * polling (serverless hosts), whether calls are available, and how large uploads
 * must be sent. Servers without the endpoint get the defaults.
 */
import { useEffect, useState } from 'react';

export interface ClientConfig {
  realtime: 'ws' | 'poll';
  calls: boolean;
  /** Request bodies larger than this are sent gzip-compressed; null = never. */
  compressAboveBytes: number | null;
  /** Largest request the host accepts (after compression); null = no extra limit. */
  maxRequestBytes: number | null;
}

export const DEFAULT_CLIENT_CONFIG: ClientConfig = { realtime: 'ws', calls: true, compressAboveBytes: null, maxRequestBytes: null };

let cached: Promise<ClientConfig> | null = null;
let current: ClientConfig | null = null;

export function loadClientConfig(): Promise<ClientConfig> {
  cached ??= fetch('/api/client-config', { credentials: 'same-origin' })
    .then(async (r) => (r.ok ? ({ ...DEFAULT_CLIENT_CONFIG, ...((await r.json()) as Partial<ClientConfig>) } as ClientConfig) : DEFAULT_CLIENT_CONFIG))
    .catch(() => {
      cached = null; // offline: ask again next time
      return DEFAULT_CLIENT_CONFIG;
    })
    .then((cfg) => (current = cfg));
  return cached;
}

/** The config once loaded (null until then). */
export function useClientConfig(): ClientConfig | null {
  const [cfg, setCfg] = useState<ClientConfig | null>(current);
  useEffect(() => {
    let alive = true;
    void loadClientConfig().then((c) => alive && setCfg(c));
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}

/** Tests: forget the cached config. */
export function resetClientConfig() {
  cached = null;
  current = null;
}
