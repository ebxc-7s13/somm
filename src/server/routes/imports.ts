import { Hono } from 'hono';
import { z } from 'zod';
import { normalizeText } from '../../shared/normalize';
import { ApiError, clientIp, rateLimit, requireUser, type Env } from '../context';
import { all } from '../db';
import { ImportError } from '../import/types';
import { LIMITS } from '../ratelimit';
import { sampleLibraryCsv } from '../../shared/demoCatalog';
import { commitImport, commitSchema, convertPlaylists, convertSchema, jobProgress, previewImport, previewSchema, retryJob } from '../services/imports';

export const importRoutes = new Hono<Env>()
  // ------------------------------------------------------------ providers
  .get('/providers', async (c) => {
    const user = c.get('user');
    const { providers, queue } = c.get('ctx');
    return c.json({
      providers: await providers.statuses(user?.id ?? null),
      enrichment: { enabled: queue.enabled, reason: queue.disabledReason },
      tokenStorage: providers.vault ? (providers.vaultIsEphemeral ? 'ephemeral (development: set TOKEN_ENCRYPTION_KEY)' : 'encrypted') : 'unavailable',
    });
  })
  .get('/providers/spotify/authorize', async (c) => {
    const user = requireUser(c);
    return c.json({ url: await c.get('ctx').providers.spotifyAuthorize(user.id) });
  })
  .get('/providers/spotify/callback', async (c) => {
    const { config, providers } = c.get('ctx');
    const back = new URL('/import', config.publicUrl);
    back.searchParams.set('provider', 'spotify');
    const user = c.get('user');
    const error = c.req.query('error');
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!user) back.searchParams.set('error', 'Sign in to SOMM before connecting Spotify.');
    else if (error) back.searchParams.set('error', error === 'access_denied' ? 'Spotify access was not granted.' : 'Spotify sign-in failed.');
    else if (!code || !state) back.searchParams.set('error', 'Spotify did not return an authorisation code.');
    else {
      try {
        await providers.spotifyCallback(user.id, code, state);
        back.searchParams.set('connected', '1');
      } catch (err) {
        back.searchParams.set('error', err instanceof ImportError ? err.message : 'Could not complete the Spotify connection.');
      }
    }
    return c.redirect(back.toString(), 302);
  })
  .get('/providers/spotify/playlists', async (c) => {
    const user = requireUser(c);
    const client = await c.get('ctx').providers.spotifyClient(user.id);
    return c.json({ playlists: await client.listPlaylists() });
  })
  .get('/providers/apple_music/developer-token', (c) => {
    requireUser(c);
    return c.json({ token: c.get('ctx').providers.appleDeveloperToken() });
  })
  .post('/providers/apple_music/user-token', async (c) => {
    const user = requireUser(c);
    const { musicUserToken } = z.object({ musicUserToken: z.string().min(10).max(4000) }).parse(await c.req.json());
    await c.get('ctx').providers.storeTokens(user.id, 'apple_music', musicUserToken, null, null, 'library-read');
    return c.json({ ok: true });
  })
  .get('/providers/apple_music/playlists', async (c) => {
    const user = requireUser(c);
    return c.json({ playlists: await (await c.get('ctx').providers.appleClient(user.id)).listLibraryPlaylists() });
  })
  .delete('/providers/:provider', async (c) => {
    const user = requireUser(c);
    const provider = c.req.param('provider');
    if (!['spotify', 'apple_music'].includes(provider)) throw new ApiError(404, 'unknown_provider', 'Unknown provider.');
    return c.json({ disconnected: await c.get('ctx').providers.disconnect(user.id, provider) });
  })

  // ------------------------------------------------------------ converter
  // Playlist → SOMM CSV. Works without an account for files and pasted lists; nothing is stored.
  .post('/convert', async (c) => {
    const user = c.get('user');
    rateLimit(c, `convert:${user?.id ?? clientIp(c)}`, LIMITS.convert);
    const parsed = convertSchema.safeParse(await c.req.json());
    if (!parsed.success) throw new ApiError(400, 'invalid_input', 'The conversion request is not valid.', { issues: parsed.error.issues.slice(0, 5) });
    const playlists = await convertPlaylists(parsed.data, user?.id ?? null, c.get('ctx').providers);
    return c.json({ playlists, stored: false });
  })

  // -------------------------------------------------------------- imports
  .post('/imports/preview', async (c) => {
    const user = requireUser(c);
    rateLimit(c, `preview:${user.id}`, LIMITS.importPreview);
    const parsed = previewSchema.safeParse(await c.req.json());
    if (!parsed.success) throw new ApiError(400, 'invalid_input', 'The import request is not valid.', { issues: parsed.error.issues.slice(0, 5) });
    const { db, providers } = c.get('ctx');
    return c.json(await previewImport(db, user.id, parsed.data, providers));
  })
  .post('/imports/:draftId/commit', async (c) => {
    const user = requireUser(c);
    const input = commitSchema.parse(await c.req.json());
    const { db, queue, refreshUsers } = c.get('ctx');
    const result = await commitImport(db, user.id, c.req.param('draftId'), input);
    // Compute a first map straight away from the metadata we already have.
    await refreshUsers([user.id]);
    queue.kick();
    return c.json(result, 201);
  })
  .get('/imports/jobs', async (c) => {
    const user = requireUser(c);
    const { db } = c.get('ctx');
    const ids = await all<{ id: string }>(db, 'SELECT id FROM import_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [user.id]);
    return c.json({ jobs: await Promise.all(ids.map((j) => jobProgress(db, user.id, j.id))) });
  })
  .get('/imports/jobs/:id', async (c) => {
    const user = requireUser(c);
    const { db, queue } = c.get('ctx');
    const job = await jobProgress(db, user.id, c.req.param('id'));
    if (!job) throw new ApiError(404, 'not_found', 'Import job not found.');
    return c.json({ job, enrichment: { enabled: queue.enabled, reason: queue.disabledReason } });
  })
  .post('/imports/jobs/:id/retry', async (c) => {
    const user = requireUser(c);
    const { db, queue } = c.get('ctx');
    const requeued = await retryJob(db, user.id, c.req.param('id'));
    queue.kick();
    return c.json({ requeued });
  })

  .get('/samples/library', (c) =>
    c.json({
      name: 'SOMM fictional sample library',
      fileName: 'somm-sample-library.csv',
      note: 'Every artist and title in this file is fictional. It overlaps with the fictional demo listeners so you can see matching work.',
      csv: sampleLibraryCsv(),
    }),
  )

  // ------------------------------------------------- catalogue song search
  .get('/catalog/search', async (c) => {
    const user = requireUser(c);
    rateLimit(c, `catalog:${user.id}`, LIMITS.catalogSearch);
    const raw = (c.req.query('q') ?? '').slice(0, 120);
    const q = normalizeText(raw);
    if (q.length < 2) return c.json({ library: [], musicbrainz: [], musicbrainzEnabled: !!c.get('ctx').musicbrainz });
    const { db, musicbrainz } = c.get('ctx');
    // Only the user's own library is searched locally. SOMM's shared catalogue is
    // never searched directly, because a hit would reveal that someone imported a track.
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const library = await all<{ id: string; title: string; version: string | null; artist: string; album: string | null; year: number | null }>(
      db,
      `SELECT t.id, t.title, t.version, a.name AS artist, al.title AS album, t.release_year AS year
       FROM tracks t JOIN artists a ON a.id = t.primary_artist_id LEFT JOIN albums al ON al.id = t.album_id
       WHERE t.id IN (SELECT pt.track_id FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE p.user_id = ?)
         AND (t.normalized_title LIKE ? OR a.normalized_name LIKE ?) ORDER BY t.title LIMIT 10`,
      [user.id, like, like],
    );
    let mb: { mbid: string; title: string; artist: string; album: string | null; year: string | null }[] = [];
    let mbError: string | null = null;
    if (musicbrainz && c.req.query('external') !== '0') {
      try {
        const results = await musicbrainz.searchFreeText(raw, 8);
        mb = results.map((r) => ({
          mbid: r.id,
          title: r.title,
          artist: (r['artist-credit'] ?? []).map((a) => a.name).join(', '),
          album: r.releases?.[0]?.title ?? null,
          year: r['first-release-date']?.slice(0, 4) ?? null,
        }));
      } catch (err) {
        mbError = err instanceof Error ? err.message : 'MusicBrainz search failed.';
      }
    }
    return c.json({ library, musicbrainz: mb, musicbrainzEnabled: !!musicbrainz, musicbrainzError: mbError });
  });
