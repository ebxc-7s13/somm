/**
 * Song matching for the playlist converter: completes rows from MusicBrainz,
 * the open music database. It fills only empty fields and says how sure it is.
 *
 * Title + artist matches are reliable. A title alone is ambiguous (popular songs
 * have hundreds of covers, and MusicBrainz search has no popularity ranking), so
 * an artist is only filled in when every strong match agrees on one artist.
 *
 * Lookups are cached in memory only — nothing a listener converts is stored.
 */
import { normalizeText, parseTitle } from '../../shared/normalize';
import { ProviderError } from '../http';
import { type ExtractedRecording, MusicBrainzClient, type MbRecordingSummary, weightGenres } from './musicbrainz';

export interface MatchInput {
  title: string;
  artist: string;
  album: string;
  year: string;
  genre: string;
  isrc: string;
}

export type MatchStatus = 'matched' | 'check' | 'needs_artist' | 'not_found' | 'error';
export type MatchFill = Partial<Record<'artist' | 'album' | 'year' | 'genre' | 'isrc', string>>;

export interface MatchResult {
  status: MatchStatus;
  fill: MatchFill;
  /** MusicBrainz page of the matched recording. */
  url: string | null;
  message: string;
}

interface SearchHit extends MbRecordingSummary {
  /** MusicBrainz marks music-video recordings. */
  video?: boolean;
  /** e.g. "live, 2024-08-27: Dolby Live" */
  disambiguation?: string;
  isrcs?: string[];
  releases?: { title: string; date?: string; 'release-group'?: { 'primary-type'?: string; 'secondary-types'?: string[] } }[];
}

const CACHE_LIMIT = 3000;
/** Title-only search: only strong hits count as evidence of who owns a title. */
const MIN_SCORE = 85;
/**
 * Title + artist: SOMM verifies both itself, so weaker search scores are fine — a
 * duet credited "A & B" scores lower than A's solo re-recording when searching for A.
 */
const MIN_SCORE_WITH_ARTIST = 50;
const VARIANT = /\b(live|demo|remix|mix|acoustic|instrumental|karaoke|edit|session|rehearsal|cover|sped up|slowed|reprise|a cappella)\b/i;

export class SongMatcher {
  private cache = new Map<string, Promise<unknown>>();

  constructor(private readonly mb: MusicBrainzClient) {}

  /** Memoise a lookup; failed lookups are not cached. */
  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit as Promise<T>;
    }
    const p = load();
    this.cache.set(key, p);
    p.catch(() => this.cache.delete(key));
    while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    return p;
  }

  private search(title: string, artist: string | null): Promise<SearchHit[]> {
    const key = `s:${normalizeText(title)}|${normalizeText(artist ?? '')}`;
    return this.cached(key, async () =>
      // Classic songs have hundreds of recordings (live, remasters, compilations); 100 is MusicBrainz's maximum per request.
      artist ? ((await this.mb.searchRecording(title, artist, 100)) as SearchHit[]) : ((await this.mb.searchTitle(title, 25)) as SearchHit[]),
    );
  }

  private recording(id: string): Promise<ExtractedRecording> {
    return this.cached(`r:${id}`, () => this.mb.getRecording(id));
  }

  private artistGenres(id: string): Promise<{ name: string; count: number }[]> {
    return this.cached(`a:${id}`, () => this.mb.getArtistGenres(id));
  }

  async match(row: MatchInput): Promise<MatchResult> {
    const title = parseTitle(row.title).baseTitle || row.title.trim();
    if (!title) return { status: 'not_found', fill: {}, url: null, message: 'This row has no title.' };
    const primaryArtist = row.artist.split(';')[0]?.trim() ?? '';
    const nt = normalizeText(title);
    const wantVersion = parseTitle(row.title).version;
    const sameTitle = (hits: SearchHit[], minScore: number) =>
      hits.filter((h) => (h.score ?? 100) >= minScore && normalizeText(parseTitle(h.title).baseTitle || h.title) === nt);
    try {
      let pick: SearchHit | null = null;
      let status: MatchStatus = 'matched';
      if (primaryArtist) {
        // "Lady Gaga, Bruno Mars" (common in video titles): try the whole credit, then its first name.
        const first = primaryArtist.split(/\s*(?:,|&|\sx\s|\sand\s)\s*/i)[0]?.trim() ?? '';
        for (const artist of [...new Set([primaryArtist, first].filter(Boolean))]) {
          const na = normalizeText(artist);
          const byArtist = sameTitle(await this.search(title, artist), MIN_SCORE_WITH_ARTIST).filter((h) =>
            (h['artist-credit'] ?? []).some((c) => normalizeText(c.name) === na || normalizeText(c.artist.name) === na || normalizeText(creditName(h)) === na),
          );
          pick = original(byArtist, wantVersion);
          if (pick) break;
        }
        if (!pick) return { status: 'not_found', fill: {}, url: null, message: `MusicBrainz has no “${title}” by ${primaryArtist}. Check the spelling of both.` };
      } else {
        const candidates = sameTitle(await this.search(title, null), MIN_SCORE).filter((h) => !h.video);
        const artists = new Set(candidates.map((h) => normalizeText(creditName(h))));
        if (candidates.length === 0) return { status: 'not_found', fill: {}, url: null, message: `No song called “${title}” was found. Add the artist and try again.` };
        if (artists.size > 1) {
          return { status: 'needs_artist', fill: {}, url: null, message: `${artists.size}+ artists have a song called “${title}”. Type the artist, then find details again.` };
        }
        pick = original(candidates, wantVersion);
        status = 'check';
      }
      if (!pick) return { status: 'not_found', fill: {}, url: null, message: 'No match found.' };

      const rec = await this.recording(pick.id);
      let genres = weightGenres(rec.genres);
      if (genres.length === 0 && rec.artistMbids[0]) genres = weightGenres(await this.artistGenres(rec.artistMbids[0].id));

      const fill: MatchFill = {};
      const set = (key: keyof MatchFill, value: string | null | undefined) => {
        if (value && !(row[key] ?? '').trim()) fill[key] = value;
      };
      if (!primaryArtist) set('artist', creditName(pick, '; '));
      set('album', albumOf(pick));
      set('year', rec.firstReleaseDate ?? pick['first-release-date'] ?? null);
      set('genre', genres.map((g) => g.name).join('; '));
      set('isrc', rec.isrcs[0] ?? pick.isrcs?.[0] ?? null);
      const found = genres.length ? `genre: ${genres.map((g) => g.name).join(', ')}` : 'no genre recorded yet';
      return {
        status,
        fill,
        url: `https://musicbrainz.org/recording/${pick.id}`,
        message: status === 'check' ? `Artist guessed as ${creditName(pick)} (the only artist with this title) — please check. ${found}.` : `Matched in MusicBrainz — ${found}.`,
      };
    } catch (err) {
      const busy = err instanceof ProviderError && (err.code === 'rate_limited' || err.code === 'unavailable' || err.code === 'network');
      return { status: 'error', fill: {}, url: null, message: busy ? 'MusicBrainz is busy right now. Try again in a minute.' : 'Could not look this song up.' };
    }
  }
}

function creditName(h: MbRecordingSummary, joiner = ', '): string {
  return (h['artist-credit'] ?? []).map((c) => c.name).join(joiner);
}

/**
 * The original recording among one artist's recordings of a title: leave out music
 * videos, other versions (live, remix, acoustic, instrumental…) unless the listener's
 * title names one, then take the earliest release year (re-recordings and deluxe
 * masters come later); within a year, the recording found on the most releases —
 * year-only dates on obscure compilations would otherwise sort before full dates.
 */
function original(hits: SearchHit[], wantVersion: string | null): SearchHit | null {
  const audio = hits.filter((h) => !h.video);
  const sameVersion = audio.filter((h) => parseTitle(h.title).version === wantVersion);
  const versioned = sameVersion.length ? sameVersion : audio;
  const plain = versioned.filter((h) => !VARIANT.test(h.disambiguation ?? ''));
  const pool = plain.length ? plain : versioned;
  const year = (h: SearchHit) => (h['first-release-date'] || '9999').slice(0, 4);
  return (
    [...pool].sort(
      (a, b) =>
        year(a).localeCompare(year(b)) ||
        (b.releases?.length ?? 0) - (a.releases?.length ?? 0) ||
        (a['first-release-date'] || '9999').localeCompare(b['first-release-date'] || '9999') ||
        a.id.localeCompare(b.id),
    )[0] ?? null
  );
}

/** Prefer the earliest album, single, EP or soundtrack (film songs live on soundtracks) over compilations and live releases. */
function albumOf(h: SearchHit): string | null {
  const releases = h.releases ?? [];
  const studio = releases.filter(
    (r) =>
      ['Album', 'Single', 'EP'].includes(r['release-group']?.['primary-type'] ?? '') &&
      (r['release-group']?.['secondary-types'] ?? []).every((t) => t === 'Soundtrack'),
  );
  const pool = studio.length ? studio : releases;
  return [...pool].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))[0]?.title ?? null;
}
