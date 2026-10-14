import { Hono } from 'hono';
import { z } from 'zod';
import { effectiveAttributes } from '../../shared/analysis/profile';
import { normalizeText } from '../../shared/normalize';
import { FAMILY_LABELS, GENRE_IMPLIED_ATTRIBUTES, genreDisplayName, genreFamily, type Family } from '../../shared/taxonomy';
import { ApiError, requireUser, type Env } from '../context';
import { all, get, nowIso, run, type DB, type Params } from '../db';
import { pruneOrphans } from '../services/accounts';
import { loadLibraryTracks, readMap, readProfile, recomputeProfile } from '../services/library';

const listQuery = z.object({
  q: z.string().max(120).optional(),
  genre: z.string().max(80).optional(),
  family: z.string().max(40).optional(),
  artist: z.string().max(40).optional(),
  attribute: z.string().max(80).optional(),
  playlist: z.string().max(40).optional(),
  source: z.string().max(20).optional(),
  unknownGenre: z.enum(['1', 'true']).optional(),
  sort: z.enum(['title', 'artist', 'year', 'source', 'added']).default('added'),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

function genresImplying(attribute: string): string[] {
  return Object.entries(GENRE_IMPLIED_ATTRIBUTES)
    .filter(([, list]) => list.some((a) => `${a.category}:${a.value}` === attribute))
    .map(([g]) => g);
}

// The user's own genres/attributes are stored as JSON text on playlist entries.
const USER_GENRES = "jsonb_array_elements_text(COALESCE(lib.user_genres, '[]')::jsonb) AS j(value)";
const USER_ATTRIBUTES = "jsonb_array_elements(COALESCE(lib.user_attributes, '[]')::jsonb) AS j(value)";

function buildFilters(userId: string, q: z.infer<typeof listQuery>) {
  const where: string[] = [];
  const params: Record<string, string | number> = { uid: userId };
  if (q.q) {
    params.q = `%${normalizeText(q.q).replace(/[%_]/g, '')}%`;
    where.push(`(t.normalized_title LIKE :q OR a.normalized_name LIKE :q OR al.normalized_title LIKE :q
      OR EXISTS (SELECT 1 FROM track_artists ta2 JOIN artists a2 ON a2.id = ta2.artist_id WHERE ta2.track_id = t.id AND a2.normalized_name LIKE :q)
      OR EXISTS (SELECT 1 FROM track_genres tg JOIN genres g ON g.id = tg.genre_id WHERE tg.track_id = t.id AND g.name LIKE :q))`);
  }
  if (q.genre) {
    params.genre = q.genre;
    where.push(`(EXISTS (SELECT 1 FROM track_genres tg JOIN genres g ON g.id = tg.genre_id WHERE tg.track_id = t.id AND g.name = :genre)
      OR EXISTS (SELECT 1 FROM ${USER_GENRES} WHERE j.value = :genre))`);
  }
  if (q.family) {
    params.family = q.family;
    where.push(`(EXISTS (SELECT 1 FROM track_genres tg JOIN genres g ON g.id = tg.genre_id WHERE tg.track_id = t.id AND g.family = :family)
      OR EXISTS (SELECT 1 FROM ${USER_GENRES} JOIN genres g ON g.name = j.value WHERE g.family = :family))`);
  }
  if (q.artist) {
    params.artist = q.artist;
    where.push('(t.primary_artist_id = :artist OR EXISTS (SELECT 1 FROM track_artists ta WHERE ta.track_id = t.id AND ta.artist_id = :artist))');
  }
  if (q.attribute) {
    const [category, value] = q.attribute.split(':');
    params.cat = category ?? '';
    params.val = value ?? '';
    const implied = genresImplying(q.attribute);
    const list = implied.map((_, i) => `:ig${i}`).join(',');
    const impliedSql = implied.length
      ? ` OR EXISTS (SELECT 1 FROM track_genres tg JOIN genres g ON g.id = tg.genre_id WHERE tg.track_id = t.id AND g.name IN (${list}))
          OR EXISTS (SELECT 1 FROM ${USER_GENRES} WHERE j.value IN (${list}))`
      : '';
    implied.forEach((g, i) => (params[`ig${i}`] = g));
    where.push(`(EXISTS (SELECT 1 FROM track_attributes x WHERE x.track_id = t.id AND x.category = :cat AND x.value = :val)
      OR EXISTS (SELECT 1 FROM ${USER_ATTRIBUTES} WHERE j.value->>'category' = :cat AND j.value->>'value' = :val)${impliedSql})`);
  }
  if (q.source) {
    params.source = `%${q.source}%`;
    where.push('lib.providers LIKE :source');
  }
  if (q.unknownGenre) {
    where.push("NOT EXISTS (SELECT 1 FROM track_genres tg WHERE tg.track_id = t.id) AND (lib.user_genres IS NULL OR lib.user_genres = '[]')");
  }
  if (q.playlist) params.playlist = q.playlist;
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function libCte(playlist: boolean) {
  return `WITH lib AS (
    SELECT pt.track_id, MIN(pt.added_at) AS added_at, string_agg(DISTINCT p.provider, ',') AS providers,
           MAX(pt.user_genres) AS user_genres, MAX(pt.user_attributes) AS user_attributes
    FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id
    WHERE p.user_id = :uid ${playlist ? 'AND p.id = :playlist' : ''}
    GROUP BY pt.track_id)`;
}

const SORTS: Record<string, string> = {
  title: 't.normalized_title',
  artist: 'a.normalized_name',
  year: 't.release_year',
  source: 'lib.providers',
  added: 'lib.added_at',
};

interface LibraryRow {
  id: string;
  title: string;
  version: string | null;
  duration_ms: number | null;
  release_year: number | null;
  explicit: number | null;
  enrichment_status: string;
  artist_id: string;
  artist: string;
  album_id: string | null;
  album: string | null;
  providers: string;
  added_at: string;
  genres: string | null;
  user_genres: string | null;
  featured: string | null;
}

async function libraryPage(db: DB, userId: string, q: z.infer<typeof listQuery>) {
  const { where, params } = buildFilters(userId, q);
  const cte = libCte(!!q.playlist);
  const from = `FROM lib JOIN tracks t ON t.id = lib.track_id JOIN artists a ON a.id = t.primary_artist_id LEFT JOIN albums al ON al.id = t.album_id`;
  const total = (await get<{ n: number }>(db, `${cte} SELECT COUNT(*) AS n ${from} ${where}`, params as Params))?.n ?? 0;
  const dir = q.dir ?? (q.sort === 'added' ? 'desc' : 'asc');
  const order = `${SORTS[q.sort]} ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, t.normalized_title ASC, t.id ASC`;
  const rows = await all<LibraryRow>(
    db,
    `${cte} SELECT t.id, t.title, t.version, t.duration_ms, t.release_year, t.explicit, t.enrichment_status,
       a.id AS artist_id, a.name AS artist, al.id AS album_id, al.title AS album, lib.providers, lib.added_at, lib.user_genres,
       (SELECT string_agg(DISTINCT g.name, ',') FROM track_genres tg JOIN genres g ON g.id = tg.genre_id WHERE tg.track_id = t.id) AS genres,
       (SELECT string_agg(a3.name, '; ' ORDER BY ta3.position) FROM track_artists ta3 JOIN artists a3 ON a3.id = ta3.artist_id
         WHERE ta3.track_id = t.id AND ta3.role = 'featured') AS featured
     ${from} ${where} ORDER BY ${order} LIMIT :limit OFFSET :offset`,
    { ...params, limit: q.pageSize, offset: (q.page - 1) * q.pageSize } as Params,
  );
  return {
    total,
    page: q.page,
    pageSize: q.pageSize,
    tracks: rows.map((r) => {
      const genres = [...new Set([...(r.genres ? r.genres.split(',') : []), ...(r.user_genres ? (JSON.parse(r.user_genres) as string[]) : [])])];
      return {
        id: r.id,
        title: r.title,
        version: r.version,
        artist: { id: r.artist_id, name: r.artist },
        featured: r.featured ? r.featured.split('; ') : [],
        album: r.album_id ? { id: r.album_id, title: r.album } : null,
        year: r.release_year,
        durationMs: r.duration_ms,
        explicit: r.explicit === null ? null : r.explicit === 1,
        genres: genres.map((g) => ({ name: g, label: genreDisplayName(g), family: genreFamily(g) })),
        providers: r.providers.split(','),
        addedAt: r.added_at,
        enrichment: r.enrichment_status,
        coverage: {
          genre: genres.length > 0,
          year: r.release_year !== null,
          album: r.album_id !== null,
          duration: r.duration_ms !== null,
        },
      };
    }),
  };
}

async function ownsTrack(db: DB, userId: string, trackId: string): Promise<boolean> {
  return !!(await get(db, 'SELECT 1 FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE p.user_id = ? AND pt.track_id = ?', [userId, trackId]));
}

export const libraryRoutes = new Hono<Env>()
  .get('/library/tracks', async (c) => {
    const user = requireUser(c);
    const q = listQuery.parse(c.req.query());
    return c.json(await libraryPage(c.get('ctx').db, user.id, q));
  })
  .get('/library/facets', async (c) => {
    const user = requireUser(c);
    const { db } = c.get('ctx');
    const [p, providers, enrichment] = await Promise.all([
      readProfile(db, user.id, 'all'),
      all<{ provider: string; n: number }>(
        db,
        'SELECT p.provider, COUNT(DISTINCT pt.track_id) AS n FROM playlists p JOIN playlist_tracks pt ON pt.playlist_id = p.id WHERE p.user_id = ? GROUP BY p.provider ORDER BY n DESC',
        [user.id],
      ),
      all<{ status: string; n: number }>(
        db,
        `SELECT t.enrichment_status AS status, COUNT(*) AS n FROM tracks t
         WHERE t.id IN (SELECT pt.track_id FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE p.user_id = ?) GROUP BY t.enrichment_status`,
        [user.id],
      ),
    ]);
    return c.json({
      genres: (p?.profile.genres ?? []).slice(0, 60).map((g) => ({ name: g.name, label: genreDisplayName(g.name), family: g.family, count: g.trackCount })),
      families: (p?.profile.families ?? []).map((f) => ({ family: f.family, label: FAMILY_LABELS[f.family as Family] ?? f.family, count: f.trackCount })),
      artists: (p?.profile.artists ?? []).slice(0, 60).map((a) => ({ id: a.id, name: a.name, count: a.trackCount })),
      providers,
      coverage: p?.profile.coverage ?? null,
      totals: p?.profile.totals ?? null,
      unknownGenreCount: p?.profile.unknownGenreCount ?? 0,
      enrichment: Object.fromEntries(enrichment.map((e) => [e.status, e.n])),
    });
  })
  .get('/library/tracks/:id', async (c) => {
    const user = requireUser(c);
    const { db } = c.get('ctx');
    const id = c.req.param('id');
    // Authorisation: only tracks in your own library are visible here.
    if (!(await ownsTrack(db, user.id, id))) throw new ApiError(404, 'not_found', 'Track not found in your library.');
    const [t, artists, genres, entries, links, library] = await Promise.all([
      get<{
        id: string; title: string; display_title: string; version: string | null; version_detail: string | null; duration_ms: number | null;
        release_date: string | null; release_year: number | null; isrc: string | null; explicit: number | null; tempo_bpm: number | null;
        enrichment_status: string; enrichment_error: string | null; enriched_at: string | null; album_id: string | null; album: string | null; artwork_url: string | null;
      }>(db, `SELECT t.*, al.title AS album, al.artwork_url FROM tracks t LEFT JOIN albums al ON al.id = t.album_id WHERE t.id = ?`, [id]),
      all<{ id: string; name: string; role: string }>(
        db,
        'SELECT a.id, a.name, ta.role FROM track_artists ta JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = ? ORDER BY ta.position',
        [id],
      ),
      all<{ name: string; family: string; source: string; kind: string; confidence: number }>(
        db,
        'SELECT g.name, g.family, tg.source, tg.kind, tg.confidence FROM track_genres tg JOIN genres g ON g.id = tg.genre_id WHERE tg.track_id = ? ORDER BY tg.confidence DESC, g.name',
        [id],
      ),
      all<{ playlist_id: string; playlist: string; provider: string; raw_title: string; raw_artist: string; raw_album: string | null; source_url: string | null; match_method: string; hidden: number; user_genres: string | null; user_attributes: string | null; user_bpm: number | null; added_at: string }>(
        db,
        `SELECT pt.playlist_id, p.name AS playlist, p.provider, pt.raw_title, pt.raw_artist, pt.raw_album, pt.source_url, pt.match_method, pt.hidden,
                pt.user_genres, pt.user_attributes, pt.user_bpm, pt.added_at
         FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE p.user_id = ? AND pt.track_id = ? ORDER BY pt.added_at`,
        [user.id, id],
      ),
      all<{ namespace: string; value: string; url: string | null }>(
        db,
        "SELECT namespace, value, url FROM external_ids WHERE entity_type = 'track' AND entity_id = ? ORDER BY namespace",
        [id],
      ),
      loadLibraryTracks(db, user.id, 'all'),
    ]);
    const track = t!;
    const lib = library.tracks.find((x) => x.id === id);
    const attributes = lib ? effectiveAttributes(lib) : [];
    const userGenres = [...new Set(entries.flatMap((e) => (e.user_genres ? (JSON.parse(e.user_genres) as string[]) : [])))];
    return c.json({
      track: {
        id: track.id,
        title: track.title,
        displayTitle: track.display_title,
        version: track.version,
        versionDetail: track.version_detail,
        artists,
        album: track.album_id ? { id: track.album_id, title: track.album, artworkUrl: track.artwork_url } : null,
        durationMs: track.duration_ms,
        releaseDate: track.release_date,
        releaseYear: track.release_year,
        isrc: track.isrc,
        explicit: track.explicit === null ? null : track.explicit === 1,
        tempoBpm: track.tempo_bpm ?? entries.find((e) => e.user_bpm)?.user_bpm ?? null,
        tempoSource: track.tempo_bpm ? 'catalogue' : entries.some((e) => e.user_bpm) ? 'your file' : null,
        enrichment: { status: track.enrichment_status, error: track.enrichment_error, at: track.enriched_at },
      },
      genres: [
        ...genres.map((g) => ({ ...g, label: genreDisplayName(g.name) })),
        ...userGenres.map((g) => ({ name: g, label: genreDisplayName(g), family: genreFamily(g), source: 'your file', kind: 'user', confidence: 1 })),
      ],
      attributes,
      links,
      entries: entries.map((e) => ({ ...e, hidden: e.hidden === 1, user_genres: undefined, user_attributes: e.user_attributes ? JSON.parse(e.user_attributes) : [] })),
    });
  })
  .get('/playlists', async (c) => {
    const user = requireUser(c);
    const { db } = c.get('ctx');
    return c.json({
      playlists: await all<{ id: string; name: string; provider: string; visibility: string; track_count: number; source_url: string | null; data_expires_at: string | null; created_at: string }>(
        db,
        'SELECT id, name, provider, visibility, track_count, source_url, data_expires_at, created_at FROM playlists WHERE user_id = ? ORDER BY created_at DESC',
        [user.id],
      ),
    });
  })
  .patch('/playlists/:id', async (c) => {
    const user = requireUser(c);
    const { db, refreshUsers } = c.get('ctx');
    const body = z.object({ name: z.string().min(1).max(120).optional(), visibility: z.enum(['private', 'shared', 'public']).optional() }).parse(await c.req.json());
    const owned = await get(db, 'SELECT 1 FROM playlists WHERE id = ? AND user_id = ?', [c.req.param('id'), user.id]);
    if (!owned) throw new ApiError(404, 'not_found', 'Playlist not found.');
    if (body.name) await run(db, 'UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?', [body.name.trim(), nowIso(), c.req.param('id')]);
    if (body.visibility) {
      await run(db, 'UPDATE playlists SET visibility = ?, updated_at = ? WHERE id = ?', [body.visibility, nowIso(), c.req.param('id')]);
      await refreshUsers([user.id]);
    }
    return c.json({ ok: true });
  })
  .delete('/playlists/:id', async (c) => {
    const user = requireUser(c);
    const { db, refreshUsers } = c.get('ctx');
    const r = await run(db, 'DELETE FROM playlists WHERE id = ? AND user_id = ?', [c.req.param('id'), user.id]);
    if (r.changes === 0) throw new ApiError(404, 'not_found', 'Playlist not found.');
    await pruneOrphans(db);
    await refreshUsers([user.id]);
    return c.json({ ok: true });
  })
  .patch('/playlists/:id/tracks/:trackId', async (c) => {
    const user = requireUser(c);
    const { db, refreshUsers } = c.get('ctx');
    const { hidden } = z.object({ hidden: z.boolean() }).parse(await c.req.json());
    const r = await run(
      db,
      'UPDATE playlist_tracks SET hidden = ? WHERE playlist_id = ? AND track_id = ? AND playlist_id IN (SELECT id FROM playlists WHERE user_id = ?)',
      [hidden ? 1 : 0, c.req.param('id'), c.req.param('trackId'), user.id],
    );
    if (r.changes === 0) throw new ApiError(404, 'not_found', 'Playlist entry not found.');
    await refreshUsers([user.id]);
    return c.json({ ok: true });
  })
  .get('/profile', async (c) => {
    const user = requireUser(c);
    const { db } = c.get('ctx');
    const [mine, shared, pending] = await Promise.all([
      readProfile(db, user.id, 'all'),
      readProfile(db, user.id, 'shared'),
      get<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM tracks t WHERE t.enrichment_status = 'pending'
         AND t.id IN (SELECT pt.track_id FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE p.user_id = ?)`,
        [user.id],
      ),
    ]);
    return c.json({
      profile: mine?.profile ?? null,
      insights: mine?.insights ?? [],
      computedAt: mine?.computedAt ?? null,
      inputHash: mine?.inputHash ?? null,
      sharedTrackCount: shared?.trackCount ?? 0,
      pendingEnrichment: pending?.n ?? 0,
    });
  })
  .get('/profile/map', async (c) => {
    const user = requireUser(c);
    return c.json({ map: await readMap(c.get('ctx').db, user.id) });
  })
  .post('/profile/regenerate', async (c) => {
    const user = requireUser(c);
    const { db, refreshUsers } = c.get('ctx');
    const changed = await recomputeProfile(db, user.id, true);
    await refreshUsers([user.id]);
    return c.json({ ok: true, changed });
  });
