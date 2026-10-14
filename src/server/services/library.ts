/**
 * Library loading and profile computation.
 *
 * Two scopes per user:
 *   - 'all'    — every playlist; used for the owner's own map, insights and Tree
 *                recommendations. Never shown to anyone else.
 *   - 'shared' — only playlists marked shared/public (minus hidden entries); used
 *                when other people are compared with this user and for Tree aggregates.
 */
import { generateInsights } from '../../shared/analysis/insights';
import { buildMusicMap, type MusicMap } from '../../shared/analysis/map';
import { buildMatchVector, computeProfile, libraryInputHash } from '../../shared/analysis/profile';
import type { PopulationStats } from '../../shared/analysis/similarity';
import { canonicalGenre, genreFamily } from '../../shared/taxonomy';
import type { AttributeCategory, GenreAssignment, Insight, LibraryTrack, MatchVector, MusicProfile } from '../../shared/types';
import { all, get, nowIso, run, tx, type DB } from '../db';

export type Scope = 'all' | 'shared';
/** 'public' is computed on demand for public profile pages and is never stored. */
export type LoadScope = Scope | 'public';

function scopeFilter(scope: LoadScope): string {
  if (scope === 'shared') return "AND p.visibility IN ('shared', 'public') AND pt.hidden = 0";
  if (scope === 'public') return "AND p.visibility = 'public' AND pt.hidden = 0";
  return '';
}

const LIB = (scope: LoadScope) => `
  SELECT pt.track_id FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id
  WHERE p.user_id = :uid ${scopeFilter(scope)}`;

export function loadLibraryTracks(db: DB, userId: string, scope: LoadScope): { tracks: LibraryTrack[]; tags: Record<string, string[]> } {
  const lib = LIB(scope);
  const p = { uid: userId };
  const rows = all<{
    id: string;
    title: string;
    version: string | null;
    album_id: string | null;
    album_title: string | null;
    release_year: number | null;
    duration_ms: number | null;
    explicit: number | null;
    tempo_bpm: number | null;
  }>(
    db,
    `SELECT t.id, t.title, t.version, t.album_id, al.title AS album_title, t.release_year, t.duration_ms, t.explicit, t.tempo_bpm
     FROM tracks t LEFT JOIN albums al ON al.id = t.album_id WHERE t.id IN (${lib})`,
    p,
  );
  const tracks = new Map<string, LibraryTrack>();
  for (const r of rows) {
    tracks.set(r.id, {
      id: r.id,
      title: r.title,
      version: r.version,
      artists: [],
      album: r.album_id ? { id: r.album_id, title: r.album_title ?? '' } : null,
      releaseYear: r.release_year,
      durationMs: r.duration_ms,
      explicit: r.explicit === null ? null : r.explicit === 1,
      genres: [],
      attributes: [],
      tempoBpm: r.tempo_bpm,
    });
  }
  for (const a of all<{ track_id: string; id: string; name: string; role: 'primary' | 'featured' }>(
    db,
    `SELECT ta.track_id, a.id, a.name, ta.role FROM track_artists ta JOIN artists a ON a.id = ta.artist_id
     WHERE ta.track_id IN (${lib}) ORDER BY ta.track_id, ta.position`,
    p,
  )) {
    tracks.get(a.track_id)?.artists.push({ id: a.id, name: a.name, role: a.role });
  }
  for (const g of all<{ track_id: string; name: string; family: string; source: string; kind: GenreAssignment['kind']; confidence: number }>(
    db,
    `SELECT tg.track_id, g.name, g.family, tg.source, tg.kind, tg.confidence FROM track_genres tg JOIN genres g ON g.id = tg.genre_id
     WHERE tg.track_id IN (${lib})`,
    p,
  )) {
    tracks.get(g.track_id)?.genres.push({ name: g.name, family: g.family, source: g.source, kind: g.kind, confidence: g.confidence });
  }
  for (const a of all<{ track_id: string; category: AttributeCategory; value: string; source: string; kind: GenreAssignment['kind']; confidence: number; evidence: string | null }>(
    db,
    `SELECT track_id, category, value, source, kind, confidence, evidence FROM track_attributes WHERE track_id IN (${lib})`,
    p,
  )) {
    tracks.get(a.track_id)?.attributes.push({
      category: a.category, value: a.value, source: a.source, kind: a.kind, confidence: a.confidence, evidence: a.evidence ?? undefined,
    });
  }
  // The user's own metadata from their files (never shared with other users' copies of the track).
  for (const e of all<{ track_id: string; user_genres: string | null; user_attributes: string | null; user_bpm: number | null }>(
    db,
    `SELECT pt.track_id, pt.user_genres, pt.user_attributes, pt.user_bpm FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id
     WHERE p.user_id = :uid ${scopeFilter(scope)}
       AND (pt.user_genres IS NOT NULL OR pt.user_attributes IS NOT NULL OR pt.user_bpm IS NOT NULL)`,
    p,
  )) {
    const t = tracks.get(e.track_id);
    if (!t) continue;
    for (const raw of e.user_genres ? (JSON.parse(e.user_genres) as string[]) : []) {
      const name = canonicalGenre(raw);
      if (name && !t.genres.some((g) => g.name === name && g.kind === 'user')) {
        t.genres.push({ name, family: genreFamily(name), source: 'your file', kind: 'user', confidence: 1 });
      }
    }
    for (const a of e.user_attributes ? (JSON.parse(e.user_attributes) as { category: AttributeCategory; value: string }[]) : []) {
      if (!t.attributes.some((x) => x.category === a.category && x.value === a.value && x.kind === 'user')) {
        t.attributes.push({ category: a.category, value: a.value, source: 'your file', kind: 'user', confidence: 1, evidence: 'listed in your import file' });
      }
    }
    if (e.user_bpm && !t.tempoBpm) t.tempoBpm = e.user_bpm;
  }
  const tags: Record<string, string[]> = {};
  for (const t of all<{ track_id: string; tag: string }>(db, `SELECT track_id, tag FROM track_tags WHERE track_id IN (${lib})`, p)) {
    (tags[t.track_id] ??= []).push(t.tag);
  }
  return { tracks: [...tracks.values()].sort((a, b) => a.id.localeCompare(b.id)), tags };
}

export interface StoredProfile {
  profile: MusicProfile;
  insights: Insight[];
  vector: MatchVector;
  inputHash: string;
  computedAt: string;
  trackCount: number;
}

export function readProfile(db: DB, userId: string, scope: Scope): StoredProfile | null {
  const row = get<{ profile_json: string; insights_json: string | null; vector_json: string; input_hash: string; computed_at: string; track_count: number }>(
    db,
    'SELECT profile_json, insights_json, vector_json, input_hash, computed_at, track_count FROM music_profiles WHERE user_id = ? AND scope = ?',
    [userId, scope],
  );
  if (!row) return null;
  return {
    profile: JSON.parse(row.profile_json) as MusicProfile,
    insights: row.insights_json ? (JSON.parse(row.insights_json) as Insight[]) : [],
    vector: JSON.parse(row.vector_json) as MatchVector,
    inputHash: row.input_hash,
    computedAt: row.computed_at,
    trackCount: row.track_count,
  };
}

export function readMap(db: DB, userId: string): MusicMap | null {
  const row = get<{ map_json: string | null }>(db, "SELECT map_json FROM music_profiles WHERE user_id = ? AND scope = 'all'", [userId]);
  return row?.map_json ? (JSON.parse(row.map_json) as MusicMap) : null;
}

/** Recompute both scopes when their input changed. Returns which scopes changed. */
export function recomputeProfile(db: DB, userId: string, force = false): { all: boolean; shared: boolean } {
  const changed = { all: false, shared: false };
  for (const scope of ['all', 'shared'] as const) {
    const { tracks, tags } = loadLibraryTracks(db, userId, scope);
    const inputHash = libraryInputHash(tracks);
    const existing = get<{ input_hash: string }>(db, 'SELECT input_hash FROM music_profiles WHERE user_id = ? AND scope = ?', [userId, scope]);
    if (!force && existing?.input_hash === inputHash) continue;
    const profile = computeProfile(tracks);
    const insights = generateInsights(profile);
    const vector = buildMatchVector(tracks, tags);
    const map = scope === 'all' ? buildMusicMap(tracks, profile) : null;
    tx(db, () => {
      run(
        db,
        `INSERT INTO music_profiles (user_id, scope, input_hash, track_count, profile_json, map_json, insights_json, vector_json, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, scope) DO UPDATE SET input_hash = excluded.input_hash, track_count = excluded.track_count,
           profile_json = excluded.profile_json, map_json = excluded.map_json, insights_json = excluded.insights_json,
           vector_json = excluded.vector_json, computed_at = excluded.computed_at`,
        [userId, scope, inputHash, tracks.length, JSON.stringify(profile), map ? JSON.stringify(map) : null, JSON.stringify(insights), JSON.stringify(vector), nowIso()],
      );
      if (scope === 'shared') {
        run(db, 'DELETE FROM profile_artists WHERE user_id = ?', [userId]);
        run(db, 'DELETE FROM profile_tracks WHERE user_id = ?', [userId]);
        run(db, 'DELETE FROM profile_genres WHERE user_id = ?', [userId]);
        for (const [artistId, weight] of Object.entries(vector.artists)) {
          run(db, 'INSERT INTO profile_artists (user_id, artist_id, weight) VALUES (?, ?, ?)', [userId, artistId, weight]);
        }
        for (const trackId of Object.keys(vector.tracks)) run(db, 'INSERT INTO profile_tracks (user_id, track_id) VALUES (?, ?)', [userId, trackId]);
        for (const key of Object.keys(vector.genres)) run(db, 'INSERT INTO profile_genres (user_id, genre_key) VALUES (?, ?)', [userId, key]);
      }
    });
    changed[scope] = true;
  }
  return changed;
}

function chunks<T>(items: T[], size = 400): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Document frequencies for the keys being compared, from the shared-scope
 * inverted indexes. Only the needed keys are counted, so this stays cheap as
 * the population grows.
 */
export function populationFor(db: DB, vectors: MatchVector[]): PopulationStats {
  const size = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM music_profiles WHERE scope = 'shared' AND track_count > 0")?.n ?? 0;
  const df: PopulationStats['df'] = { tracks: {}, artists: {}, genres: {} };
  const keys = (pick: (v: MatchVector) => Record<string, number>) => [...new Set(vectors.flatMap((v) => Object.keys(pick(v))))];
  const fill = (table: string, column: string, target: Record<string, number>, list: string[]) => {
    for (const part of chunks(list)) {
      const placeholders = part.map(() => '?').join(',');
      for (const r of all<{ k: string; n: number }>(db, `SELECT ${column} AS k, COUNT(*) AS n FROM ${table} WHERE ${column} IN (${placeholders}) GROUP BY ${column}`, part)) {
        target[r.k] = r.n;
      }
    }
  };
  fill('profile_tracks', 'track_id', df.tracks!, keys((v) => v.tracks));
  fill('profile_artists', 'artist_id', df.artists!, keys((v) => v.artists));
  fill('profile_genres', 'genre_key', df.genres!, keys((v) => v.genres));
  return { size, df };
}
