/**
 * Outbound HTTP for provider and metadata APIs: JSON fetch with timeouts,
 * bounded retries for 429/5xx (honouring Retry-After) and typed errors.
 * `fetchImpl` is injectable so tests use deterministic mocks — mocked responses
 * prove our handling, not that a live provider works.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status: number,
    readonly code: 'rate_limited' | 'unauthorized' | 'forbidden' | 'not_found' | 'unavailable' | 'bad_response' | 'network',
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface FetchJsonOptions {
  provider: string;
  fetchImpl?: FetchLike;
  retries?: number;
  timeoutMs?: number;
  /** Upper bound on any single Retry-After wait (ms). */
  maxRetryWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export async function fetchJson<T>(url: string, init: RequestInit, options: FetchJsonOptions): Promise<T> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
  const retries = options.retries ?? 3;
  const sleep = options.sleep ?? defaultSleep;
  const maxWait = options.maxRetryWaitMs ?? 30_000;
  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? 15_000) });
    } catch (err) {
      if (attempt < retries) {
        attempt++;
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new ProviderError(`${options.provider} could not be reached (${(err as Error).message}).`, options.provider, 0, 'network');
    }
    if (res.ok) {
      try {
        return (await res.json()) as T;
      } catch {
        throw new ProviderError(`${options.provider} returned an unreadable response.`, options.provider, res.status, 'bad_response');
      }
    }
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
    const retryable = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
    if (retryable && attempt < retries) {
      const wait = Math.min(maxWait, retryAfter ?? 1000 * 2 ** attempt);
      attempt++;
      await sleep(wait);
      continue;
    }
    // Drain body for diagnostics without leaking tokens into messages.
    await res.text().catch(() => '');
    if (res.status === 429) throw new ProviderError(`${options.provider} rate limit reached. Try again shortly.`, options.provider, 429, 'rate_limited', retryAfter);
    if (res.status === 401) throw new ProviderError(`${options.provider} authorisation expired or was revoked.`, options.provider, 401, 'unauthorized');
    if (res.status === 403) throw new ProviderError(`${options.provider} refused access to this resource.`, options.provider, 403, 'forbidden');
    if (res.status === 404) throw new ProviderError(`${options.provider} could not find this resource.`, options.provider, 404, 'not_found');
    if (res.status >= 500) throw new ProviderError(`${options.provider} is temporarily unavailable.`, options.provider, res.status, 'unavailable', retryAfter);
    throw new ProviderError(`${options.provider} rejected the request (HTTP ${res.status}).`, options.provider, res.status, 'bad_response');
  }
}

/** Serialises calls so they are at least `intervalMs` apart (e.g. MusicBrainz: 1 request/second). */
export class RateLimiter {
  private next = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly intervalMs: number,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly now: () => number = Date.now,
  ) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = this.next - this.now();
      if (wait > 0) await this.sleep(wait);
      this.next = this.now() + this.intervalMs;
    });
    this.chain = run.catch(() => undefined);
    return run.then(fn);
  }

  /** Push the next slot back (e.g. after a 503 from the API). */
  backoff(ms: number) {
    this.next = Math.max(this.next, this.now() + ms);
  }
}
