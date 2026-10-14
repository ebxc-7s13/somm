/**
 * MusicBrainz Web Service v2 client (verified against musicbrainz.org on 2026-10-13).
 *
 * - Rate limit: on average 1 request per second per source IP; exceeding it
 *   yields 503 for everything until the rate drops. SOMM spaces requests by 1.1 s
 *   and backs off on 503.
 * - Every request carries a User-Agent with application name, version and a
 *   maintainer contact (required). Enrichment is disabled until one is configured.
 * - Licensing: core data (recordings, artists, relationships incl. instrument
 *   credits) is CC0. Tags and genre associations are "supplementary data" under
 *   CC BY-NC-SA 3.0 — SOMM attributes them in the UI, and commercial use needs a
 *   separate arrangement with MetaBrainz (see docs/MUSIC_IMPORTS.md).
 */
import { normalizeText } from '../../shared/normalize';
import { fetchJson, type FetchLike, ProviderError, RateLimiter } from '../http';

const BASE = 'https://musicbrainz.org/ws/2';

export interface MbCredit {
  name: string;
  artist: { id: string; name: string };
}

export interface MbRecordingSummary {
  id: string;
  score?: number;
  title: string;
  length?: number | null;
  'artist-credit'?: MbCredit[];
  'first-release-date'?: string;
}

export interface MbRecordingDetail extends MbRecordingSummary {
  genres?: { name: string; count: number }[];
  tags?: { name: string; count: number }[];
  isrcs?: string[];
  relations?: {
    type: string;
    'target-type'?: string;
    attributes?: string[];
    artist?: { id: string; name: string };
  }[];
}

export interface ExtractedRecording {
  mbid: string;
  title: string;
  lengthMs: number | null;
  firstReleaseDate: string | null;
  artistMbids: { id: string; name: string }[];
  genres: { name: string; count: number }[];
  tags: { name: string; count: number }[];
  instruments: { instrument: string; artist: string }[];
  isrcs: string[];
}

function luceneEscape(s: string): string {
  return s.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');
}

export function userAgentFor(contact: string): string {
  return `SOMM/0.1.0 ( ${contact} )`;
}

export class MusicBrainzClient {
  readonly limiter: RateLimiter;

  constructor(
    private readonly contact: string,
    private readonly fetchImpl?: FetchLike,
    options: { intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.limiter = new RateLimiter(options.intervalMs ?? 1100, options.sleep);
    this.sleep = options.sleep;
  }

  private readonly sleep?: (ms: number) => Promise<void>;

  private get<T>(path: string): Promise<T> {
    return this.limiter.schedule(async () => {
      try {
        return await fetchJson<T>(
          `${BASE}${path}${path.includes('?') ? '&' : '?'}fmt=json`,
          { headers: { 'User-Agent': userAgentFor(this.contact), Accept: 'application/json' } },
          { provider: 'MusicBrainz', fetchImpl: this.fetchImpl, retries: 2, sleep: this.sleep, maxRetryWaitMs: 10_000 },
        );
      } catch (err) {
        if (err instanceof ProviderError && (err.status === 503 || err.status === 429)) this.limiter.backoff(5000);
        throw err;
      }
    });
  }

  async searchRecording(title: string, artist: string, limit = 5): Promise<MbRecordingSummary[]> {
    const query = `recording:"${luceneEscape(title)}" AND artist:"${luceneEscape(artist)}"`;
    const data = await this.get<{ recordings?: MbRecordingSummary[] }>(`/recording?query=${encodeURIComponent(query)}&limit=${limit}`);
    return data.recordings ?? [];
  }

  /** Free-text recording search for the manual "add a song" flow. */
  async searchFreeText(text: string, limit = 8): Promise<(MbRecordingSummary & { releases?: { title: string }[] })[]> {
    const query = luceneEscape(text.trim()).slice(0, 200);
    if (!query) return [];
    const data = await this.get<{ recordings?: (MbRecordingSummary & { releases?: { title: string }[] })[] }>(
      `/recording?query=${encodeURIComponent(query)}&limit=${limit}`,
    );
    return (data.recordings ?? []).filter((r) => (r.score ?? 0) >= 60);
  }

  async lookupIsrc(isrc: string): Promise<MbRecordingSummary[]> {
    try {
      const data = await this.get<{ recordings?: MbRecordingSummary[] }>(`/isrc/${encodeURIComponent(isrc)}?inc=artist-credits`);
      return data.recordings ?? [];
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'not_found') return [];
      throw err;
    }
  }

  async getRecording(mbid: string): Promise<ExtractedRecording> {
    const r = await this.get<MbRecordingDetail>(`/recording/${encodeURIComponent(mbid)}?inc=artist-credits+genres+tags+isrcs+artist-rels`);
    return {
      mbid: r.id,
      title: r.title,
      lengthMs: r.length ?? null,
      firstReleaseDate: r['first-release-date'] || null,
      artistMbids: (r['artist-credit'] ?? []).map((c) => ({ id: c.artist.id, name: c.artist.name })),
      genres: (r.genres ?? []).map((g) => ({ name: g.name, count: g.count })),
      tags: (r.tags ?? []).map((t) => ({ name: t.name, count: t.count })),
      instruments: (r.relations ?? [])
        .filter((rel) => rel.type === 'instrument' && rel['target-type'] !== 'work')
        .flatMap((rel) => (rel.attributes ?? []).map((instrument) => ({ instrument, artist: rel.artist?.name ?? 'unknown performer' }))),
      isrcs: r.isrcs ?? [],
    };
  }

  async getArtistGenres(mbid: string): Promise<{ name: string; count: number }[]> {
    const a = await this.get<{ genres?: { name: string; count: number }[] }>(`/artist/${encodeURIComponent(mbid)}?inc=genres`);
    return (a.genres ?? []).map((g) => ({ name: g.name, count: g.count }));
  }
}

/** Pick the best search result: high score, same normalised title and artist, compatible length. */
export function pickRecording(
  results: MbRecordingSummary[],
  title: string,
  artist: string,
  durationMs: number | null,
  minScore = 85,
): MbRecordingSummary | null {
  const nt = normalizeText(title);
  const na = normalizeText(artist);
  const candidates = results.filter((r) => {
    if ((r.score ?? 100) < minScore) return false;
    if (normalizeText(r.title) !== nt) return false;
    const credits = (r['artist-credit'] ?? []).flatMap((c) => [normalizeText(c.name), normalizeText(c.artist.name)]);
    if (!credits.includes(na)) return false;
    if (durationMs && r.length && Math.abs(r.length - durationMs) > 10_000) return false;
    return true;
  });
  candidates.sort((a, b) => (b.score ?? 100) - (a.score ?? 100) || (a['first-release-date'] ?? '9999').localeCompare(b['first-release-date'] ?? '9999') || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

/** Genre votes → confidence. Keeps the top genres that have meaningful support. */
export function weightGenres(genres: { name: string; count: number }[], max = 3): { name: string; confidence: number }[] {
  if (genres.length === 0) return [];
  const top = Math.max(...genres.map((g) => g.count));
  return genres
    .filter((g) => g.count >= Math.max(1, top * 0.34))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, max)
    .map((g) => ({
      name: g.name,
      confidence: Math.round(Math.min(0.9, Math.max(0.4, 0.45 + 0.1 * Math.min(g.count, 4) + 0.15 * (g.count / top))) * 100) / 100,
    }));
}
