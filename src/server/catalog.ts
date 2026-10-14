/**
 * Canonical catalogue: artists, albums, tracks, external IDs, genres and
 * attributes with provenance — plus identity resolution for imported entries.
 *
 * Identity resolution order (first hit wins):
 *   1. provider-namespaced ID (spotify:track, apple_music:song, youtube:video, …)
 *   2. ISRC (identifies a recording)
 *   3. normalised base title + primary artist + version label, accepted only when
 *      nothing conflicts (durations within 10 s when both known, ISRCs equal when
 *      both known). A remix/live/acoustic version is never merged with the original.
 *   4. otherwise a new canonical track is created.
 */
import { cleanDisplayText, fallbackTrackKey, normalizeText, parseTitle } from '../shared/normalize';
import { canonicalGenre, genreFamily } from '../shared/taxonomy';
import type { AttributeCategory, MetadataKind } from '../shared/types';
import { all, get, newId, nowIso, run, type DB } from './db';
import type { RawEntry } from './import/types';

export const DURATION_TOLERANCE_MS = 10_000;

export type MatchMethod = 'provider_id' | 'isrc' | 'title_artist' | 'new';

interface TrackRow {
  id: string;
  duration_ms: number | null;
  isrc: string | null;
  album_id: string | null;
  release_date: string | null;
  release_year: number | null;
  explicit: number | null;
}

export async function ensureArtist(db: DB, name: string, externalId?: { namespace: string; value: string }): Promise<string> {
  const clean = cleanDisplayText(name, 200);
  if (externalId) {
    const hit = await get<{ entity_id: string }>(db, "SELECT entity_id FROM external_ids WHERE namespace = ? AND value = ? AND entity_type = 'artist'", [externalId.namespace, externalId.value]);
    if (hit) return hit.entity_id;
  }
  const normalized = normalizeText(clean);
  // Without an external ID, artists are identified by normalised name. Two
  // different artists with the same name will share a record; documented limitation.
  const existing = await get<{ id: string }>(db, 'SELECT id FROM artists WHERE normalized_name = ? ORDER BY created_at LIMIT 1', [normalized]);
  const id = existing?.id ?? newId();
  if (!existing) await run(db, 'INSERT INTO artists (id, name, normalized_name, created_at) VALUES (?, ?, ?, ?)', [id, clean, normalized, nowIso()]);
  if (externalId) {
    await run(db, "INSERT INTO external_ids (namespace, value, entity_type, entity_id, created_at) VALUES (?, ?, 'artist', ?, ?) ON CONFLICT DO NOTHING", [
      externalId.namespace, externalId.value, id, nowIso(),
    ]);
  }
  return id;
}

export async function ensureAlbum(db: DB, title: string, primaryArtistId: string, releaseDate: string | null, artworkUrl: string | null): Promise<string> {
  const clean = cleanDisplayText(title, 200);
  const normalized = normalizeText(clean);
  const existing = await get<{ id: string; release_date: string | null; artwork_url: string | null }>(
    db,
    'SELECT id, release_date, artwork_url FROM albums WHERE normalized_title = ? AND primary_artist_id = ? LIMIT 1',
    [normalized, primaryArtistId],
  );
  if (existing) {
    if ((!existing.release_date && releaseDate) || (!existing.artwork_url && artworkUrl)) {
      await run(db, 'UPDATE albums SET release_date = COALESCE(release_date, ?), artwork_url = COALESCE(artwork_url, ?) WHERE id = ?', [releaseDate, artworkUrl, existing.id]);
    }
    return existing.id;
  }
  const id = newId();
  await run(db, 'INSERT INTO albums (id, title, normalized_title, primary_artist_id, release_date, artwork_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    id, clean, normalized, primaryArtistId, releaseDate, artworkUrl, nowIso(),
  ]);
  return id;
}

export async function ensureGenre(db: DB, raw: string): Promise<{ id: number; name: string; family: string } | null> {
  const name = canonicalGenre(raw);
  if (!name) return null;
  const existing = await get<{ id: number; family: string }>(db, 'SELECT id, family FROM genres WHERE name = ?', [name]);
  if (existing) return { id: existing.id, name, family: existing.family };
  const family = genreFamily(name);
  const row = await get<{ id: number; family: string }>(
    db,
    'INSERT INTO genres (name, family) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET name = excluded.name RETURNING id, family',
    [name, family],
  );
  return { id: row!.id, name, family: row!.family };
}

export async function addTrackGenre(db: DB, trackId: string, raw: string, source: string, kind: Exclude<MetadataKind, 'user'>, confidence: number) {
  const g = await ensureGenre(db, raw);
  if (!g) return;
  await run(
    db,
    `INSERT INTO track_genres (track_id, genre_id, source, kind, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (track_id, genre_id, source) DO UPDATE SET confidence = GREATEST(track_genres.confidence, excluded.confidence)`,
    [trackId, g.id, source, kind, Math.round(confidence * 1000) / 1000, nowIso()],
  );
}

export async function addTrackAttribute(
  db: DB,
  trackId: string,
  a: { category: AttributeCategory; value: string; source: string; kind: Exclude<MetadataKind, 'user'>; confidence: number; evidence?: string },
) {
  await run(
    db,
    `INSERT INTO track_attributes (track_id, category, value, source, kind, confidence, evidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (track_id, category, value, source) DO UPDATE SET confidence = GREATEST(track_attributes.confidence, excluded.confidence),
       evidence = COALESCE(excluded.evidence, track_attributes.evidence)`,
    [trackId, a.category, a.value.slice(0, 60), a.source, a.kind, Math.round(a.confidence * 1000) / 1000, a.evidence?.slice(0, 200) ?? null, nowIso()],
  );
}

export async function addExternalId(db: DB, entityType: 'track' | 'artist' | 'album', entityId: string, namespace: string, value: string, url?: string | null) {
  await run(db, 'INSERT INTO external_ids (namespace, value, entity_type, entity_id, url, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', [
    namespace, value, entityType, entityId, url ?? null, nowIso(),
  ]);
}

function yearOf(date: string | null | undefined): number | null {
  const m = date?.match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

/** Artists for an entry: credited artists plus anyone named in "(feat. …)". */
export function entryArtists(entry: RawEntry): { names: string[]; base: string; version: string | null; versionDetail: string | null } {
  const parsed = parseTitle(entry.title);
  const names = [...entry.artists];
  const seen = new Set(names.map(normalizeText));
  for (const f of parsed.featuring) {
    if (!seen.has(normalizeText(f))) {
      names.push(f);
      seen.add(normalizeText(f));
    }
  }
  return { names, base: parsed.baseTitle, version: parsed.version, versionDetail: parsed.versionDetail };
}

export function entryFallbackKey(entry: RawEntry): string {
  const { names, base, version } = entryArtists(entry);
  return fallbackTrackKey(base, names[0] ?? '', version);
}

function compatible(row: TrackRow, entry: RawEntry): boolean {
  if (row.duration_ms && entry.durationMs && Math.abs(row.duration_ms - entry.durationMs) > DURATION_TOLERANCE_MS) return false;
  if (row.isrc && entry.isrc && row.isrc !== entry.isrc) return false;
  return true;
}

/** Find an existing canonical track for an entry without creating anything. */
export async function findExistingTrack(db: DB, entry: RawEntry): Promise<{ trackId: string; method: MatchMethod } | null> {
  for (const pid of entry.providerIds ?? []) {
    const hit = await get<{ entity_id: string }>(db, "SELECT entity_id FROM external_ids WHERE namespace = ? AND value = ? AND entity_type = 'track'", [pid.namespace, pid.value]);
    if (hit) return { trackId: hit.entity_id, method: 'provider_id' };
  }
  const key = entryFallbackKey(entry);
  if (entry.isrc) {
    const rows = await all<{ id: string; fallback_key: string }>(db, 'SELECT id, fallback_key FROM tracks WHERE isrc = ? ORDER BY created_at', [entry.isrc]);
    const best = rows.find((r) => r.fallback_key === key) ?? rows[0];
    if (best) return { trackId: best.id, method: 'isrc' };
  }
  const candidates = await all<TrackRow>(db, 'SELECT id, duration_ms, isrc, album_id, release_date, release_year, explicit FROM tracks WHERE fallback_key = ? ORDER BY created_at', [key]);
  const match = candidates.find((c) => compatible(c, entry));
  return match ? { trackId: match.id, method: 'title_artist' } : null;
}

/** Resolve an entry to a canonical track, creating it when needed, and merge any new facts. */
export async function resolveTrack(db: DB, entry: RawEntry): Promise<{ trackId: string; method: MatchMethod }> {
  const { names, base, version, versionDetail } = entryArtists(entry);
  const existing = await findExistingTrack(db, entry);
  const now = nowIso();
  let trackId: string;
  let method: MatchMethod;

  if (existing) {
    trackId = existing.trackId;
    method = existing.method;
    // Non-destructive merge: only fill fields that are still unknown.
    const row = (await get<TrackRow & { primary_artist_id: string }>(
      db,
      'SELECT id, duration_ms, isrc, album_id, release_date, release_year, explicit, primary_artist_id FROM tracks WHERE id = ?',
      [trackId],
    ))!;
    let albumId = row.album_id;
    if (!albumId && entry.album) albumId = await ensureAlbum(db, entry.album, row.primary_artist_id, entry.releaseDate ?? null, entry.artworkUrl ?? null);
    await run(
      db,
      `UPDATE tracks SET duration_ms = COALESCE(duration_ms, ?), isrc = COALESCE(isrc, ?), album_id = COALESCE(album_id, ?),
         release_date = COALESCE(release_date, ?), release_year = COALESCE(release_year, ?), explicit = COALESCE(explicit, ?), updated_at = ?
       WHERE id = ?`,
      [entry.durationMs ?? null, entry.isrc ?? null, albumId, entry.releaseDate ?? null, yearOf(entry.releaseDate), entry.explicit == null ? null : entry.explicit ? 1 : 0, now, trackId],
    );
  } else {
    method = 'new';
    trackId = newId();
    const artistIds: string[] = [];
    for (let i = 0; i < names.length; i++) {
      artistIds.push(await ensureArtist(db, names[i]!, i < (entry.artistIds?.length ?? 0) ? entry.artistIds![i] : undefined));
    }
    const primary = artistIds[0]!;
    const albumId = entry.album ? await ensureAlbum(db, entry.album, primary, entry.releaseDate ?? null, entry.artworkUrl ?? null) : null;
    await run(
      db,
      `INSERT INTO tracks (id, title, display_title, normalized_title, version, version_detail, primary_artist_id, album_id, duration_ms,
         release_date, release_year, isrc, explicit, fallback_key, enrichment_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        trackId, cleanDisplayText(base, 300), cleanDisplayText(entry.title, 300), normalizeText(base), version, versionDetail, primary, albumId,
        entry.durationMs ?? null, entry.releaseDate ?? null, yearOf(entry.releaseDate), entry.isrc ?? null,
        entry.explicit == null ? null : entry.explicit ? 1 : 0, fallbackTrackKey(base, names[0] ?? '', version), now, now,
      ],
    );
    const seen = new Set<string>();
    for (let i = 0; i < artistIds.length; i++) {
      const aid = artistIds[i]!;
      if (seen.has(aid)) continue;
      seen.add(aid);
      await run(db, 'INSERT INTO track_artists (track_id, artist_id, role, position) VALUES (?, ?, ?, ?)', [trackId, aid, i === 0 ? 'primary' : 'featured', i]);
    }
  }

  for (const pid of entry.providerIds ?? []) await addExternalId(db, 'track', trackId, pid.namespace, pid.value, pid.url);
  if (entry.isrc) await addExternalId(db, 'track', trackId, 'isrc', entry.isrc);
  if (entry.genreKind === 'provider' && entry.genres?.length) {
    const source = entry.genreSource ?? 'provider';
    // Spotify genres are artist-level, so they get lower confidence than per-track catalogue genres.
    const confidence = source.startsWith('spotify') ? 0.6 : 0.75;
    for (const g of entry.genres) await addTrackGenre(db, trackId, g, source, 'provided', confidence);
  }
  return { trackId, method };
}

export type PreviewStatus = 'new' | 'in_library' | 'duplicate' | 'alternate_version' | 'review';

export interface PreviewEntry {
  row: number;
  title: string;
  artists: string[];
  album: string | null;
  version: string | null;
  status: PreviewStatus;
  duplicateOf: number | null;
  notes: string[];
  skipByDefault: boolean;
}

/**
 * Classify entries for the import preview: duplicates inside this import,
 * alternate versions, tracks already in the user's library and low-confidence parses.
 * Read-only — nothing is created.
 */
export async function classifyEntries(db: DB, userId: string, entries: RawEntry[]): Promise<PreviewEntry[]> {
  const byProvider = new Map<string, number>();
  const byIsrc = new Map<string, number>();
  const byKey = new Map<string, { row: number; durationMs: number | null; isrc: string | null }[]>();
  const byBase = new Map<string, { row: number; version: string | null }[]>();
  const libraryTracks = new Set(
    (await all<{ track_id: string }>(db, 'SELECT DISTINCT pt.track_id FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE p.user_id = ?', [userId])).map(
      (r) => r.track_id,
    ),
  );

  const out: PreviewEntry[] = [];
  for (const entry of entries) {
    const { names, base, version } = entryArtists(entry);
    const notes: string[] = [...(entry.warnings ?? [])];
    let duplicateOf: number | null = null;

    for (const pid of entry.providerIds ?? []) {
      const k = `${pid.namespace}:${pid.value}`;
      if (byProvider.has(k)) duplicateOf = byProvider.get(k)!;
      else byProvider.set(k, entry.row);
    }
    if (duplicateOf === null && entry.isrc) {
      if (byIsrc.has(entry.isrc)) duplicateOf = byIsrc.get(entry.isrc)!;
      else byIsrc.set(entry.isrc, entry.row);
    }
    const key = fallbackTrackKey(base, names[0] ?? '', version);
    if (duplicateOf === null) {
      const prior = byKey.get(key) ?? [];
      const hit = prior.find(
        (p) =>
          !(p.durationMs && entry.durationMs && Math.abs(p.durationMs - entry.durationMs) > DURATION_TOLERANCE_MS) &&
          !(p.isrc && entry.isrc && p.isrc !== entry.isrc),
      );
      if (hit) {
        duplicateOf = hit.row;
      } else if (prior.length > 0) {
        notes.push('Same title and artist as another row but a different length or ISRC — kept as a separate recording.');
      }
      prior.push({ row: entry.row, durationMs: entry.durationMs ?? null, isrc: entry.isrc ?? null });
      byKey.set(key, prior);
    }

    const baseKey = `${normalizeText(base)}|${normalizeText(names[0] ?? '')}`;
    const siblings = byBase.get(baseKey) ?? [];
    const otherVersion = siblings.find((s) => s.version !== version);
    siblings.push({ row: entry.row, version });
    byBase.set(baseKey, siblings);

    let status: PreviewStatus = 'new';
    if (duplicateOf !== null) {
      status = 'duplicate';
      notes.push(`Duplicate of row ${duplicateOf}.`);
    } else {
      const existing = await findExistingTrack(db, entry);
      if (existing && libraryTracks.has(existing.trackId)) {
        status = 'in_library';
        notes.push('Already in your library — it will also be added to this playlist.');
      } else if (otherVersion) {
        status = 'alternate_version';
        notes.push(`A different version (${version ?? 'original'}) of the song in row ${otherVersion.row}; kept separately.`);
      } else if (entry.parseConfidence === 'low') {
        status = 'review';
      }
    }
    out.push({
      row: entry.row,
      title: entry.title,
      artists: names,
      album: entry.album ?? null,
      version,
      status,
      duplicateOf,
      notes,
      skipByDefault: status === 'duplicate',
    });
  }
  return out;
}
