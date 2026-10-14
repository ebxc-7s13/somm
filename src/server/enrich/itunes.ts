/**
 * Optional Apple iTunes Search API lookup (verified against
 * performance-partners.apple.com/search-api on 2026-10-13).
 *
 * Public, no key, "approximately 20 calls per minute (subject to change)".
 * Apple's terms limit promotional content (artwork, previews) to promoting store
 * content, so SOMM uses only `primaryGenreName` plus a store link, and never
 * stores or displays iTunes artwork or previews. Disabled by default.
 */
import { normalizeText } from '../../shared/normalize';
import { fetchJson, type FetchLike, RateLimiter } from '../http';

interface ItunesResult {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  artistName?: string;
  primaryGenreName?: string;
  trackViewUrl?: string;
  trackTimeMillis?: number;
}

export class ItunesClient {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly fetchImpl?: FetchLike,
    options: { intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.limiter = new RateLimiter(options.intervalMs ?? 3200, options.sleep);
  }

  async lookupGenre(title: string, artist: string, durationMs: number | null): Promise<{ genre: string; trackId: number; url: string | null } | null> {
    const term = `${artist} ${title}`.slice(0, 200);
    const data = await this.limiter.schedule(() =>
      fetchJson<{ results?: ItunesResult[] }>(
        `https://itunes.apple.com/search?${new URLSearchParams({ term, media: 'music', entity: 'song', limit: '5' })}`,
        {},
        { provider: 'iTunes Search', fetchImpl: this.fetchImpl, retries: 1 },
      ),
    );
    const nt = normalizeText(title);
    const na = normalizeText(artist);
    const hit = (data.results ?? []).find(
      (r) =>
        r.kind === 'song' &&
        r.trackName &&
        normalizeText(r.trackName) === nt &&
        normalizeText(r.artistName ?? '') === na &&
        !(durationMs && r.trackTimeMillis && Math.abs(r.trackTimeMillis - durationMs) > 10_000),
    );
    if (!hit?.primaryGenreName || !hit.trackId || hit.primaryGenreName === 'Music') return null;
    return { genre: hit.primaryGenreName, trackId: hit.trackId, url: hit.trackViewUrl ?? null };
  }
}
