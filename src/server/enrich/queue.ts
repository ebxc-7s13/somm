/**
 * Background metadata enrichment. One in-process worker walks canonical tracks
 * with enrichment_status = 'pending' (each track is enriched once, then shared
 * by every user who imports it), respecting provider rate limits, and marks
 * affected users' profiles for recomputation.
 */
import { normalizeText, parseTitle } from '../../shared/normalize';
import { canonicalGenre, normalizeInstrument, tagToAttribute } from '../../shared/taxonomy';
import { addExternalId, addTrackAttribute, addTrackGenre } from '../catalog';
import { all, get, nowIso, run, tx, type DB } from '../db';
import { ProviderError } from '../http';
import type { ItunesClient } from './itunes';
import { pickRecording, weightGenres, type ExtractedRecording, type MusicBrainzClient } from './musicbrainz';

const DAY = 24 * 3600 * 1000;
const JUNK_TAGS = new Set(['seen live', 'favorites', 'favourite', 'favorite', 'my favorite', 'awesome', 'love', 'beautiful', 'cool', 'good', 'best', 'albums i own', 'spotify']);

async function cacheGet<T>(db: DB, key: string): Promise<T | undefined> {
  const row = await get<{ result: string; expires_at: string }>(db, 'SELECT result, expires_at FROM lookup_cache WHERE key = ?', [key]);
  if (!row || row.expires_at < nowIso()) return undefined;
  return JSON.parse(row.result) as T;
}

async function cacheSet(db: DB, key: string, source: string, value: unknown, ttlMs: number) {
  await run(
    db,
    `INSERT INTO lookup_cache (key, source, result, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET result = excluded.result, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    [key, source, JSON.stringify(value), nowIso(), nowIso(ttlMs)],
  );
}

export interface EnrichmentDeps {
  musicbrainz: MusicBrainzClient | null;
  itunes: ItunesClient | null;
  /** Why enrichment is unavailable, shown to users when musicbrainz is null. */
  disabledReason: string | null;
  onUsersChanged: (userIds: string[]) => Promise<void>;
  /** How long the idle worker sleeps before checking again without a kick() (default 6 hours). */
  idleCheckMs?: number;
}

/** Idle safety check: imports call kick(), so this only catches tracks queued some other way. */
const IDLE_CHECK_MS = 6 * 3600 * 1000;
/** After an error (e.g. the database waking up), retry soon, backing off to at most 5 minutes. */
const retryDelay = (failures: number) => Math.min(5 * 60 * 1000, 5000 * 2 ** Math.min(failures - 1, 6));

interface PendingTrack {
  id: string;
  title: string;
  display_title: string;
  duration_ms: number | null;
  isrc: string | null;
  release_year: number | null;
  artist_name: string;
  fallback_key: string;
}

export type EnrichOutcome = 'done' | 'not_found' | 'error' | 'skipped';

export class EnrichmentQueue {
  private running = false;
  private wake: (() => void) | null = null;
  private loop: Promise<void> | null = null;
  private dirtyUsers = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DB,
    private readonly deps: EnrichmentDeps,
  ) {}

  get enabled(): boolean {
    return this.deps.musicbrainz !== null;
  }

  get disabledReason(): string | null {
    return this.deps.disabledReason;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  async stop() {
    this.running = false;
    this.wake?.();
    await this.loop;
    await this.flush();
  }

  /** Signal that new pending tracks exist. */
  kick() {
    this.wake?.();
  }

  /**
   * The worker sleeps while nothing is pending and wakes on kick() — it does not poll.
   * Polling every few seconds would keep a serverless database (Neon) from ever
   * scaling to zero, which matters once the server itself stays awake.
   */
  private async run() {
    let failures = 0;
    while (this.running) {
      let processed = false;
      try {
        processed = await this.processNext();
        failures = 0;
      } catch (err) {
        failures++;
        console.error('[somm] enrichment worker error:', err instanceof Error ? err.message : err);
      }
      if (!processed) {
        await this.flush().catch(() => undefined);
        const wait = failures > 0 ? retryDelay(failures) : (this.deps.idleCheckMs ?? IDLE_CHECK_MS);
        await new Promise<void>((resolve) => {
          this.wake = resolve;
          setTimeout(resolve, wait).unref?.();
        });
        this.wake = null;
      }
    }
  }

  /** Process all pending tracks (used by tests and CLI scripts). */
  async drain(max = 10_000): Promise<number> {
    let n = 0;
    while (n < max && (await this.processNext())) n++;
    await this.flush();
    return n;
  }

  /** Enrich the oldest pending track. Returns false when nothing is pending. */
  async processNext(): Promise<boolean> {
    const track = await get<PendingTrack>(
      this.db,
      `SELECT t.id, t.title, t.display_title, t.duration_ms, t.isrc, t.release_year, t.fallback_key, a.name AS artist_name
       FROM tracks t JOIN artists a ON a.id = t.primary_artist_id
       WHERE t.enrichment_status = 'pending' ORDER BY t.created_at, t.id LIMIT 1`,
    );
    if (!track) return false;
    let outcome: EnrichOutcome;
    let message: string | null = null;
    if (!this.deps.musicbrainz) {
      outcome = 'skipped';
      message = this.deps.disabledReason;
    } else {
      try {
        outcome = await this.enrich(track);
      } catch (err) {
        // Provider failures are recorded so the job can finish as "partial";
        // the user can re-queue failed tracks from the import screen.
        outcome = 'error';
        message = err instanceof ProviderError ? err.message : 'Unexpected enrichment error.';
      }
    }
    await run(this.db, 'UPDATE tracks SET enrichment_status = ?, enrichment_error = ?, enriched_at = ?, updated_at = ? WHERE id = ?', [
      outcome, message, nowIso(), nowIso(), track.id,
    ]);
    await this.markDirty(track.id);
    return true;
  }

  private async markDirty(trackId: string) {
    for (const r of await all<{ user_id: string }>(
      this.db,
      'SELECT DISTINCT p.user_id FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE pt.track_id = ?',
      [trackId],
    )) {
      this.dirtyUsers.add(r.user_id);
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush().catch(() => undefined), 3000);
      this.flushTimer.unref?.();
    }
  }

  /** Recompute profiles for affected users and close finished jobs. */
  async flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    await this.updateJobs();
    if (this.dirtyUsers.size === 0) return;
    const users = [...this.dirtyUsers];
    this.dirtyUsers.clear();
    await this.deps.onUsersChanged(users);
  }

  async updateJobs() {
    const jobs = await all<{ id: string; playlist_id: string }>(this.db, "SELECT id, playlist_id FROM import_jobs WHERE status = 'enriching'");
    for (const job of jobs) {
      const counts = await get<{ pending: number | null; errors: number | null }>(
        this.db,
        `SELECT SUM(CASE WHEN t.enrichment_status = 'pending' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN t.enrichment_status = 'error' THEN 1 ELSE 0 END) AS errors
         FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ?`,
        [job.playlist_id],
      );
      if (counts && (counts.pending ?? 0) === 0) {
        await run(this.db, 'UPDATE import_jobs SET status = ?, updated_at = ?, finished_at = ? WHERE id = ?', [
          (counts.errors ?? 0) > 0 ? 'partial' : 'done', nowIso(), nowIso(), job.id,
        ]);
      }
    }
  }

  private async findRecording(track: PendingTrack): Promise<string | null> {
    const mb = this.deps.musicbrainz!;
    const known = await get<{ value: string }>(
      this.db,
      "SELECT value FROM external_ids WHERE entity_type = 'track' AND entity_id = ? AND namespace = 'musicbrainz:recording'",
      [track.id],
    );
    if (known) return known.value;
    if (track.isrc) {
      const key = `mb:isrc:${track.isrc}`;
      let hit = await cacheGet<{ mbid: string | null }>(this.db, key);
      if (!hit) {
        const results = await mb.lookupIsrc(track.isrc);
        const best = pickRecording(results, track.title, track.artist_name, track.duration_ms, 0) ?? (results.length === 1 ? results[0]! : null);
        hit = { mbid: best?.id ?? null };
        await cacheSet(this.db, key, 'musicbrainz', hit, hit.mbid ? 30 * DAY : 7 * DAY);
      }
      if (hit.mbid) return hit.mbid;
    }
    const key = `mb:search:${track.fallback_key}:${track.duration_ms ? Math.round(track.duration_ms / 10_000) : ''}`;
    let cached = await cacheGet<{ mbid: string | null }>(this.db, key);
    if (!cached) {
      // Search with the full display title first (keeps "(Live)"/"(Remix)" distinct), then the base title.
      const parsed = parseTitle(track.display_title);
      let best = pickRecording(await mb.searchRecording(track.display_title, track.artist_name), track.display_title, track.artist_name, track.duration_ms);
      if (!best && parsed.version === null && normalizeText(track.display_title) !== normalizeText(track.title)) {
        best = pickRecording(await mb.searchRecording(track.title, track.artist_name), track.title, track.artist_name, track.duration_ms);
      }
      cached = { mbid: best?.id ?? null };
      await cacheSet(this.db, key, 'musicbrainz', cached, cached.mbid ? 30 * DAY : 7 * DAY);
    }
    return cached.mbid;
  }

  private async enrich(track: PendingTrack): Promise<EnrichOutcome> {
    const mb = this.deps.musicbrainz!;
    const mbid = await this.findRecording(track);
    if (!mbid) {
      await this.tryItunes(track);
      return 'not_found';
    }
    let rec = await cacheGet<ExtractedRecording>(this.db, `mb:rec:${mbid}`);
    if (!rec) {
      rec = await mb.getRecording(mbid);
      await cacheSet(this.db, `mb:rec:${mbid}`, 'musicbrainz', rec, 30 * DAY);
    }
    // Artist-level genres are a fallback when the recording itself has no genre votes.
    let artistGenres: { name: string; count: number }[] = [];
    if (rec.genres.length === 0 && rec.artistMbids[0]) {
      const key = `mb:artist-genres:${rec.artistMbids[0].id}`;
      let cached = await cacheGet<{ name: string; count: number }[]>(this.db, key);
      if (!cached) {
        cached = await mb.getArtistGenres(rec.artistMbids[0].id);
        await cacheSet(this.db, key, 'musicbrainz', cached, 30 * DAY);
      }
      artistGenres = cached;
    }
    const recording = rec;

    await tx(this.db, async () => {
      await addExternalId(this.db, 'track', track.id, 'musicbrainz:recording', recording.mbid, `https://musicbrainz.org/recording/${recording.mbid}`);
      const primaryArtist = await get<{ primary_artist_id: string }>(this.db, 'SELECT primary_artist_id FROM tracks WHERE id = ?', [track.id]);
      const firstCredit = recording.artistMbids[0];
      if (primaryArtist && firstCredit && normalizeText(firstCredit.name) === normalizeText(track.artist_name)) {
        await addExternalId(this.db, 'artist', primaryArtist.primary_artist_id, 'musicbrainz:artist', firstCredit.id, `https://musicbrainz.org/artist/${firstCredit.id}`);
      }
      const genreNames = new Set<string>();
      for (const g of weightGenres(recording.genres)) {
        await addTrackGenre(this.db, track.id, g.name, 'musicbrainz', 'community', g.confidence);
        const c = canonicalGenre(g.name);
        if (c) genreNames.add(c);
      }
      for (const g of weightGenres(artistGenres)) {
        await addTrackGenre(this.db, track.id, g.name, 'musicbrainz:artist', 'community', Math.round(g.confidence * 0.8 * 100) / 100);
        const c = canonicalGenre(g.name);
        if (c) genreNames.add(c);
      }
      for (const credit of recording.instruments.slice(0, 20)) {
        await addTrackAttribute(this.db, track.id, {
          category: 'instrument',
          value: normalizeInstrument(credit.instrument),
          source: 'musicbrainz',
          kind: 'credited',
          confidence: 0.95,
          evidence: `credit: ${credit.artist} – ${credit.instrument}`,
        });
      }
      for (const tag of recording.tags) {
        const name = normalizeText(tag.name);
        const canonical = canonicalGenre(tag.name);
        if (!name || JUNK_TAGS.has(name) || /^\d{2,4}s?$/.test(name) || (canonical && genreNames.has(canonical))) continue;
        const mapped = tagToAttribute(tag.name);
        if (mapped) {
          await addTrackAttribute(this.db, track.id, {
            ...mapped,
            source: 'musicbrainz',
            kind: 'community',
            confidence: Math.min(0.9, 0.4 + 0.1 * tag.count),
            evidence: `MusicBrainz tag “${tag.name}” (${tag.count} vote${tag.count === 1 ? '' : 's'})`,
          });
        } else if (name.length >= 3 && name.length <= 30) {
          await run(this.db, 'INSERT INTO track_tags (track_id, tag, source, votes) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [track.id, name, 'musicbrainz', tag.count]);
        }
      }
      const year = recording.firstReleaseDate?.match(/^(\d{4})/)?.[1];
      await run(
        this.db,
        `UPDATE tracks SET release_year = COALESCE(release_year, ?), release_date = COALESCE(release_date, ?),
           duration_ms = COALESCE(duration_ms, ?), isrc = COALESCE(isrc, ?), updated_at = ? WHERE id = ?`,
        [year ? Number(year) : null, recording.firstReleaseDate, recording.lengthMs, recording.isrcs.length === 1 ? recording.isrcs[0]! : null, nowIso(), track.id],
      );
    });

    if (recording.genres.length === 0 && artistGenres.length === 0) await this.tryItunes(track);
    return 'done';
  }

  private async tryItunes(track: PendingTrack) {
    if (!this.deps.itunes) return;
    try {
      const hit = await this.deps.itunes.lookupGenre(track.title, track.artist_name, track.duration_ms);
      if (!hit) return;
      await tx(this.db, async () => {
        await addTrackGenre(this.db, track.id, hit.genre, 'itunes', 'provided', 0.6);
        await addExternalId(this.db, 'track', track.id, 'itunes:track', String(hit.trackId), hit.url);
      });
    } catch {
      // Optional source; failures never block enrichment.
    }
  }
}
