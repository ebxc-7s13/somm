/**
 * Import workflow: preview (parse + classify, nothing stored except a short-lived
 * draft) → commit (resolve canonical tracks, create playlist + job) → enrichment
 * progress.
 */
import { z } from 'zod';
import type { ProviderId } from '../../shared/types';
import { classifyEntries, ensureGenre, resolveTrack, type PreviewEntry } from '../catalog';
import { all, get, newId, nowIso, run, tx, type DB } from '../db';
import { ProviderError } from '../http';
import { parseCsv, parseJson, parseM3u, parseManual, parseText, parseXspf } from '../import/adapters/files';
import { parseAppleMusicPlaylist, parseSpotifyPlaylist, parseYouTubePlaylist } from '../import/adapters/urls';
import { ImportError, type RawPlaylist } from '../import/types';
import type { ProviderService } from './providers';

const DRAFT_TTL_MS = 60 * 60 * 1000;

export const previewSchema = z.discriminatedUnion('source', [
  z.object({ source: z.enum(['csv', 'm3u', 'xspf', 'json', 'text']), content: z.string().max(3_000_000), fileName: z.string().max(200).optional(), name: z.string().max(120).optional() }),
  z.object({
    source: z.literal('manual'),
    name: z.string().max(120).optional(),
    entries: z
      .array(z.object({ title: z.string().max(300), artist: z.string().max(300), album: z.string().max(300).optional(), year: z.string().max(10).optional(), genre: z.string().max(200).optional() }))
      .max(500),
  }),
  z.object({ source: z.enum(['spotify', 'youtube', 'apple_music']), playlist: z.string().min(1).max(500) }),
]);
export type PreviewInput = z.infer<typeof previewSchema>;

export const commitSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  visibility: z.enum(['private', 'shared', 'public']).default('private'),
  /** Rows to leave out. Duplicates are skipped unless listed in includeRows. */
  skipRows: z.array(z.number().int()).max(5000).default([]),
  includeRows: z.array(z.number().int()).max(5000).default([]),
});
export type CommitInput = z.infer<typeof commitSchema>;

async function readSource(input: PreviewInput, userId: string, providers: ProviderService): Promise<RawPlaylist> {
  switch (input.source) {
    case 'csv':
      return parseCsv(input.content, input.fileName ?? input.name ?? 'Imported CSV');
    case 'm3u':
      return parseM3u(input.content, input.fileName ?? 'Imported M3U');
    case 'xspf':
      return parseXspf(input.content, input.fileName ?? 'Imported XSPF');
    case 'json':
      return parseJson(input.content, input.fileName ?? 'Imported JSON');
    case 'text':
      return parseText(input.content, input.name ?? 'Pasted list');
    case 'manual':
      return parseManual(input.entries, input.name ?? 'Added manually');
    case 'spotify': {
      const ref = parseSpotifyPlaylist(input.playlist);
      return (await providers.spotifyClient(userId)).getPlaylist(ref.id);
    }
    case 'youtube': {
      const ref = parseYouTubePlaylist(input.playlist);
      return providers.youtubeClient().getPlaylist(ref.id);
    }
    case 'apple_music': {
      const ref = parseAppleMusicPlaylist(input.playlist);
      if (ref.provider !== 'apple_music') throw new ImportError('Unsupported Apple Music link.', 'invalid_input');
      return providers.appleClient(userId).getPlaylist(ref);
    }
  }
}

export interface PreviewResult {
  draftId: string;
  playlist: { name: string; provider: ProviderId; sourceUrl: string | null };
  summary: { total: number; toImport: number; invalid: number; duplicates: number; alternateVersions: number; inLibrary: number; needsReview: number };
  entries: PreviewEntry[];
  errors: { row: number; message: string }[];
  notes: string[];
}

export async function previewImport(db: DB, userId: string, input: PreviewInput, providers: ProviderService): Promise<PreviewResult> {
  let raw: RawPlaylist;
  try {
    raw = await readSource(input, userId, providers);
  } catch (err) {
    if (err instanceof ProviderError) {
      throw new ImportError(
        err.message,
        err.code === 'rate_limited' ? 'rate_limited' : err.code === 'unauthorized' ? 'needs_connection' : err.code === 'forbidden' ? 'not_authorized' : 'provider_unavailable',
        err.code === 'rate_limited' ? 429 : err.code === 'unauthorized' ? 401 : 502,
      );
    }
    throw err;
  }
  const entries = classifyEntries(db, userId, raw.entries);
  const draftId = newId();
  run(db, 'DELETE FROM import_drafts WHERE expires_at < ?', [nowIso()]);
  run(db, 'INSERT INTO import_drafts (id, user_id, provider, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', [
    draftId, userId, raw.provider, JSON.stringify(raw), nowIso(), nowIso(DRAFT_TTL_MS),
  ]);
  const count = (s: PreviewEntry['status']) => entries.filter((e) => e.status === s).length;
  return {
    draftId,
    playlist: { name: raw.name, provider: raw.provider, sourceUrl: raw.sourceUrl ?? null },
    summary: {
      total: raw.entries.length + raw.errors.length,
      toImport: entries.filter((e) => !e.skipByDefault).length,
      invalid: raw.errors.length,
      duplicates: count('duplicate'),
      alternateVersions: count('alternate_version'),
      inLibrary: count('in_library'),
      needsReview: count('review'),
    },
    entries,
    errors: raw.errors,
    notes: raw.notes,
  };
}

export function commitImport(db: DB, userId: string, draftId: string, input: CommitInput): { jobId: string; playlistId: string; imported: number } {
  const draft = get<{ payload: string; expires_at: string }>(db, 'SELECT payload, expires_at FROM import_drafts WHERE id = ? AND user_id = ?', [draftId, userId]);
  if (!draft) throw new ImportError('This import preview was not found. Start the import again.', 'not_found', 404);
  if (draft.expires_at < nowIso()) {
    run(db, 'DELETE FROM import_drafts WHERE id = ?', [draftId]);
    throw new ImportError('This import preview expired. Start the import again.', 'not_found', 410);
  }
  const raw = JSON.parse(draft.payload) as RawPlaylist;
  const classified = classifyEntries(db, userId, raw.entries);
  const skip = new Set(input.skipRows);
  const include = new Set(input.includeRows);
  const selected = raw.entries.filter((e, i) => !skip.has(e.row) && (!classified[i]!.skipByDefault || include.has(e.row)));
  if (selected.length === 0) throw new ImportError('Nothing to import — every row was skipped.', 'empty');

  const playlistId = newId();
  const jobId = newId();
  const now = nowIso();
  let merged = 0;
  tx(db, () => {
    run(
      db,
      `INSERT INTO playlists (id, user_id, name, provider, source_ref, source_url, visibility, track_count, data_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        playlistId, userId, (input.name ?? raw.name).slice(0, 120), raw.provider, raw.sourceRef ?? null, raw.sourceUrl ?? null, input.visibility,
        selected.length, raw.retentionDays ? nowIso(raw.retentionDays * 24 * 3600 * 1000) : null, now, now,
      ],
    );
    selected.forEach((entry, position) => {
      const { trackId, method } = resolveTrack(db, entry);
      if (method !== 'new') merged++;
      // User-typed genres stay on this playlist entry (canonical names), never on the shared track.
      const userGenres =
        entry.genreKind === 'user'
          ? [...new Set((entry.genres ?? []).map((g) => ensureGenre(db, g)?.name).filter((g): g is string => !!g))]
          : [];
      const source = entry.providerIds?.[0];
      run(
        db,
        `INSERT INTO playlist_tracks (id, playlist_id, track_id, position, raw_title, raw_artist, raw_album, source_track_id, source_url,
           match_method, user_genres, user_attributes, user_bpm, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId(), playlistId, trackId, position, entry.title, entry.artists.join('; '), entry.album ?? null,
          source ? `${source.namespace}:${source.value}` : null, entry.sourceUrl ?? source?.url ?? null, method,
          userGenres.length ? JSON.stringify(userGenres) : null, entry.attributes?.length ? JSON.stringify(entry.attributes) : null, entry.bpm ?? null, now,
        ],
      );
    });
    run(
      db,
      `INSERT INTO import_jobs (id, user_id, playlist_id, status, total, skipped, merged, message, errors, created_at, updated_at)
       VALUES (?, ?, ?, 'enriching', ?, ?, ?, ?, ?, ?, ?)`,
      [jobId, userId, playlistId, selected.length, raw.entries.length - selected.length, merged, raw.notes.join(' ') || null, JSON.stringify(raw.errors), now, now],
    );
    run(db, 'DELETE FROM import_drafts WHERE id = ?', [draftId]);
  });
  return { jobId, playlistId, imported: selected.length };
}

export interface JobProgress {
  id: string;
  playlistId: string | null;
  playlistName: string | null;
  status: 'enriching' | 'done' | 'partial' | 'failed';
  total: number;
  skipped: number;
  merged: number;
  counts: { pending: number; done: number; notFound: number; error: number; skipped: number };
  genreCoverage: number;
  errors: { row: number; message: string }[];
  enrichmentErrors: { title: string; message: string }[];
  message: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export function jobProgress(db: DB, userId: string, jobId: string): JobProgress | null {
  const job = get<{ id: string; playlist_id: string | null; status: JobProgress['status']; total: number; skipped: number; merged: number; message: string | null; errors: string | null; created_at: string; finished_at: string | null }>(
    db,
    'SELECT id, playlist_id, status, total, skipped, merged, message, errors, created_at, finished_at FROM import_jobs WHERE id = ? AND user_id = ?',
    [jobId, userId],
  );
  if (!job) return null;
  const counts = { pending: 0, done: 0, notFound: 0, error: 0, skipped: 0 };
  let withGenre = 0;
  let total = 0;
  const enrichmentErrors: JobProgress['enrichmentErrors'] = [];
  let playlistName: string | null = null;
  if (job.playlist_id) {
    playlistName = get<{ name: string }>(db, 'SELECT name FROM playlists WHERE id = ?', [job.playlist_id])?.name ?? null;
    for (const r of all<{ status: string; n: number }>(
      db,
      'SELECT t.enrichment_status AS status, COUNT(*) AS n FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ? GROUP BY t.enrichment_status',
      [job.playlist_id],
    )) {
      const key = r.status === 'not_found' ? 'notFound' : (r.status as keyof typeof counts);
      counts[key] += r.n;
      total += r.n;
    }
    withGenre =
      get<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM playlist_tracks pt WHERE pt.playlist_id = ? AND (pt.user_genres IS NOT NULL OR EXISTS (SELECT 1 FROM track_genres tg WHERE tg.track_id = pt.track_id))`,
        [job.playlist_id],
      )?.n ?? 0;
    for (const r of all<{ title: string; message: string | null }>(
      db,
      "SELECT t.display_title AS title, t.enrichment_error AS message FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ? AND t.enrichment_status = 'error' LIMIT 20",
      [job.playlist_id],
    )) {
      enrichmentErrors.push({ title: r.title, message: r.message ?? 'Unknown error' });
    }
  }
  return {
    id: job.id,
    playlistId: job.playlist_id,
    playlistName,
    status: job.status,
    total: job.total,
    skipped: job.skipped,
    merged: job.merged,
    counts,
    genreCoverage: total ? Math.round((withGenre / total) * 1000) / 1000 : 0,
    errors: job.errors ? (JSON.parse(job.errors) as JobProgress['errors']) : [],
    enrichmentErrors,
    message: job.message,
    createdAt: job.created_at,
    finishedAt: job.finished_at,
  };
}

/** Re-queue tracks in this job's playlist that failed or were skipped (e.g. after configuring MusicBrainz). */
export function retryJob(db: DB, userId: string, jobId: string): number {
  const job = get<{ playlist_id: string | null }>(db, 'SELECT playlist_id FROM import_jobs WHERE id = ? AND user_id = ?', [jobId, userId]);
  if (!job?.playlist_id) throw new ImportError('Import job not found.', 'not_found', 404);
  const r = run(
    db,
    `UPDATE tracks SET enrichment_status = 'pending', enrichment_error = NULL, updated_at = ?
     WHERE enrichment_status IN ('error', 'skipped') AND id IN (SELECT track_id FROM playlist_tracks WHERE playlist_id = ?)`,
    [nowIso(), job.playlist_id],
  );
  if (r.changes > 0) run(db, "UPDATE import_jobs SET status = 'enriching', finished_at = NULL, updated_at = ? WHERE id = ?", [nowIso(), jobId]);
  return r.changes;
}
