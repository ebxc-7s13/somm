/**
 * Wikidata (CC0 open data) lookups for the converter's song matching: given only a
 * song title, find the best-known song item with exactly that title and its
 * performer. MusicBrainz search cannot do this — it has no popularity ranking —
 * whereas Wikidata's search ranks well-known items first ("Blinding Lights" →
 * "2019 single by The Weeknd").
 *
 * The API is meant for programmatic use; Wikimedia's User-Agent policy asks for a
 * contact, so requests carry the same contact as MusicBrainz and are spaced out.
 */
import { normalizeText } from '../../shared/normalize';
import { fetchJson, type FetchLike, RateLimiter } from '../http';

const API = 'https://www.wikidata.org/w/api.php';
const SONG = /\b(single|song|track)\b/i;
const NOT_SONG = /\b(music video|film|episode|album|painting|series|novel|book|television|video game|musical)\b/i;

interface SearchResponse {
  search?: { id: string; label?: string; description?: string }[];
}
interface EntitiesResponse {
  entities?: Record<
    string,
    {
      claims?: Record<string, { mainsnak?: { datavalue?: { value?: { id?: string } } } }[]>;
      labels?: Record<string, { value?: string }>;
    }
  >;
}

export interface SongHint {
  /** Performer name(s), "; "-separated. */
  performer: string;
  /** Wikidata item, e.g. Q76566134. */
  item: string;
}

export class WikidataClient {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly contact: string,
    private readonly fetchImpl?: FetchLike,
    private readonly options: { intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.limiter = new RateLimiter(options.intervalMs ?? 250, options.sleep);
  }

  private get<T>(params: Record<string, string>): Promise<T> {
    const qs = new URLSearchParams({ format: 'json', ...params });
    return this.limiter.schedule(() =>
      fetchJson<T>(
        `${API}?${qs}`,
        { headers: { 'User-Agent': `SOMM/0.1.0 (${this.contact})`, Accept: 'application/json' } },
        { provider: 'Wikidata', fetchImpl: this.fetchImpl, retries: 1, timeoutMs: 10_000, sleep: this.options.sleep, maxRetryWaitMs: 5_000 },
      ),
    );
  }

  /** The performer of the best-known song titled exactly `title`, or null. */
  async songPerformer(title: string): Promise<SongHint | null> {
    const nt = normalizeText(title);
    if (!nt) return null;
    const found = await this.get<SearchResponse>({ action: 'wbsearchentities', language: 'en', uselang: 'en', type: 'item', limit: '10', search: title.slice(0, 200) });
    const song = (found.search ?? []).find((s) => normalizeText(s.label ?? '') === nt && SONG.test(s.description ?? '') && !NOT_SONG.test(s.description ?? ''));
    if (!song) return null;

    // The description names the main artist first: "2020 single by Dua Lipa featuring DaBaby, …" (the
    // performer claims list featured artists in no particular order). "by" must follow the noun directly,
    // so "1975 Queen song written by Freddie Mercury" (a writer) falls through to the claims.
    const described = (song.description ?? '').match(/\b(?:single|song|track)(?: song)? by ([^,;]+?)(?:\s+(?:featuring|feat\.?|from|for|and)\b|[,;]|$)/i);
    if (described?.[1]) return { performer: described[1].trim(), item: song.id };

    const claims = await this.get<EntitiesResponse>({ action: 'wbgetentities', ids: song.id, props: 'claims' });
    const ids = [
      ...new Set((claims.entities?.[song.id]?.claims?.P175 ?? []).map((c) => c.mainsnak?.datavalue?.value?.id).filter((id): id is string => !!id && /^Q\d+$/.test(id))),
    ].slice(0, 3);
    if (ids.length) {
      const labels = await this.get<EntitiesResponse>({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels', languages: 'en' });
      const names = ids.map((id) => labels.entities?.[id]?.labels?.en?.value?.trim()).filter((n): n is string => !!n);
      if (names.length) return { performer: names.join('; '), item: song.id };
    }
    return null;
  }
}
