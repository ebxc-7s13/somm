/**
 * Keeps a free Render web service available around the clock.
 *
 * Render spins a free web service down after 15 minutes without inbound traffic,
 * and the next visitor then waits about a minute. While the server runs, it
 * requests its own public URL every 10 minutes; that request leaves Render and
 * comes back through Render's edge, so it counts as inbound traffic. Render's free
 * plan includes 750 instance hours a month, enough for one service full-time.
 *
 * The ping only hits /api/health, which never queries the database, so a
 * serverless database (Neon) can still scale to zero between real visits.
 *
 * On by default on Render (RENDER_EXTERNAL_URL is set there). KEEP_AWAKE=false
 * turns it off; KEEP_AWAKE_URL points it at another https origin.
 */

export const KEEP_AWAKE_INTERVAL_MS = 10 * 60 * 1000;

type Env = Record<string, string | undefined>;

/** The https origin to ping, or null when keep-awake is off or there is nothing to ping. */
export function keepAwakeUrl(env: Env): string | null {
  if ((env.KEEP_AWAKE ?? '').trim().toLowerCase() === 'false') return null;
  const raw = (env.KEEP_AWAKE_URL ?? env.RENDER_EXTERNAL_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** Starts pinging `${origin}/api/health`; returns a function that stops it. Failures are logged, never thrown. */
export function startKeepAwake(
  origin: string,
  options: { intervalMs?: number; fetchImpl?: typeof fetch; log?: (message: string) => void } = {},
): () => void {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? ((message: string) => console.log(message));
  let failing = false;
  const ping = async () => {
    try {
      const res = await fetchImpl(`${origin}/api/health`, {
        headers: { 'user-agent': 'SOMM keep-awake' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (failing) log('[somm] keep-awake ping is working again');
      failing = false;
    } catch (err) {
      // Log the first failure of a run only, so a long outage does not flood the log.
      if (!failing) log(`[somm] keep-awake ping failed: ${err instanceof Error ? err.message : String(err)}`);
      failing = true;
    }
  };
  const timer = setInterval(() => void ping(), options.intervalMs ?? KEEP_AWAKE_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
