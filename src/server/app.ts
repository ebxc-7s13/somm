import { gunzipSync } from 'node:zlib';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { ZodError } from 'zod';
import type { AppConfig } from './config';
import { ApiError, type AppContext, type Env } from './context';
import { openDatabase, type DB, type OpenOptions } from './db';
import { ItunesClient } from './enrich/itunes';
import { SongMatcher } from './enrich/matcher';
import { MusicBrainzClient } from './enrich/musicbrainz';
import { WikidataClient } from './enrich/wikidata';
import { EnrichmentQueue } from './enrich/queue';
import type { FetchLike } from './http';
import { ImportError } from './import/types';
import { internalRoutes, internalToken } from './routes/internal';
import { SlidingWindowLimiter } from './ratelimit';
import { RealtimeHub } from './realtime/hub';
import { authRoutes } from './routes/auth';
import { importRoutes } from './routes/imports';
import { libraryRoutes } from './routes/library';
import { socialRoutes } from './routes/social';
import { AccountError, SESSION_COOKIE, sessionUser } from './services/accounts';
import { recomputeUserCommunities } from './services/communities';
import { recomputeProfile } from './services/library';
import { ProviderService } from './services/providers';

export interface ContextOptions {
  db?: DB;
  fetchImpl?: FetchLike;
  musicbrainz?: MusicBrainzClient | null;
  /** Converter title lookups; by default created alongside a configured MusicBrainz client. */
  wikidata?: WikidataClient | null;
  itunes?: ItunesClient | null;
  ringTimeoutMs?: number;
  /** Serverless hosts: keep work running after the response (Vercel waitUntil). */
  background?: (work: Promise<unknown>) => void;
  /** Serverless hosts: when the current invocation will be stopped (epoch ms). */
  deadline?: () => number | null;
  /** node-postgres pool hook (Vercel attachDatabasePool). */
  onPool?: OpenOptions['onPool'];
}

export async function createAppContext(config: AppConfig, options: ContextOptions = {}): Promise<AppContext> {
  const db = options.db ?? (await openDatabase({ url: config.databaseUrl, dataDir: config.pgliteDataDir, onPool: options.onPool }));
  const mbConfigured = config.musicbrainz.enabled && !!config.musicbrainz.contact;
  const musicbrainz =
    options.musicbrainz !== undefined ? options.musicbrainz : mbConfigured ? new MusicBrainzClient(config.musicbrainz.contact!, options.fetchImpl) : null;
  // Uses the same contact as MusicBrainz (Wikimedia's User-Agent policy asks for one).
  const wikidata =
    options.wikidata !== undefined ? options.wikidata : options.musicbrainz === undefined && musicbrainz ? new WikidataClient(config.musicbrainz.contact!, options.fetchImpl) : null;
  const itunes = options.itunes !== undefined ? options.itunes : config.itunesLookupEnabled ? new ItunesClient(options.fetchImpl) : null;

  const refreshUsers = async (userIds: string[]) => {
    for (const id of new Set(userIds)) {
      const changed = await recomputeProfile(db, id);
      if (changed.shared) await recomputeUserCommunities(db, id);
    }
  };

  const queue = new EnrichmentQueue(db, {
    musicbrainz,
    itunes,
    disabledReason: musicbrainz
      ? null
      : config.musicbrainz.enabled
        ? 'MusicBrainz enrichment is off until MUSICBRAINZ_CONTACT is set (MusicBrainz requires a contact in the User-Agent).'
        : 'MusicBrainz enrichment is disabled (MUSICBRAINZ_ENABLED=false).',
    onUsersChanged: refreshUsers,
    // A shared database may have several workers (e.g. Render and Vercel); PGlite is always private.
    useLease: db.kind === 'pg',
    background: options.background,
    deadline: options.deadline,
    continueLater: options.background ? () => continueEnrichment(config, options.fetchImpl ?? fetch) : undefined,
  });

  return {
    db,
    config,
    providers: new ProviderService(db, config, options.fetchImpl),
    queue,
    musicbrainz,
    matcher: musicbrainz ? new SongMatcher(musicbrainz, wikidata) : null,
    hub: new RealtimeHub(db, config, options.ringTimeoutMs),
    limiter: new SlidingWindowLimiter(),
    fetchImpl: options.fetchImpl,
    refreshUsers,
  };
}

/** Serverless hand-over: a fresh invocation continues enriching (see routes/internal.ts). */
async function continueEnrichment(config: AppConfig, fetchImpl: FetchLike): Promise<void> {
  const token = internalToken(config);
  if (!token) return;
  await fetchImpl(`${config.publicUrl}/api/internal/enrich`, {
    method: 'POST',
    headers: { 'x-somm-internal': token, origin: config.publicUrl },
    signal: AbortSignal.timeout(15_000),
  });
}

const MAX_BODY_BYTES = 3.5 * 1024 * 1024;
/** The converter accepts Spotify's full-account Playlist1.json (up to 12 MB, sent as a JSON string). */
const MAX_CONVERT_BODY_BYTES = 16 * 1024 * 1024;

export function createApp(ctx: AppContext) {
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    c.set('ctx', ctx);
    await next();
    // Security headers on every response.
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('X-Frame-Options', 'DENY');
    c.header('Cross-Origin-Opener-Policy', 'same-origin');
    c.header('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()');
    c.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'" + (ctx.providers.appleConfigured ? ' https://js-cdn.music.apple.com' : ''),
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https://i.scdn.co https://*.mzstatic.com",
        "font-src 'self'",
        "connect-src 'self' ws: wss:" + (ctx.providers.appleConfigured ? ' https://api.music.apple.com' : ''),
        "media-src 'self' blob:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join('; '),
    );
    if (ctx.config.isProduction) c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });

  // Large uploads may arrive gzip-compressed (serverless hosts cap request size). Inflate them
  // here, before the size and type checks below, which then apply to the real body.
  app.use('/api/*', async (c, next) => {
    if ((c.req.header('content-encoding') ?? '').trim().toLowerCase() === 'gzip') {
      let body: Buffer;
      try {
        body = gunzipSync(Buffer.from(await c.req.raw.arrayBuffer()), { maxOutputLength: MAX_CONVERT_BODY_BYTES });
      } catch (err) {
        const tooLarge = (err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError;
        throw tooLarge ? new ApiError(413, 'too_large', 'Request body too large.') : new ApiError(400, 'bad_encoding', 'The compressed request could not be read.');
      }
      const headers = new Headers(c.req.raw.headers);
      headers.delete('content-encoding');
      headers.set('content-length', String(body.length));
      c.req.raw = new Request(c.req.raw.url, { method: c.req.method, headers, body: new Uint8Array(body) });
    }
    await next();
  });

  // CSRF defence: state-changing requests must be JSON and same-origin.
  app.use('/api/*', async (c, next) => {
    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const origin = c.req.header('origin');
      if (origin && !ctx.config.allowedOrigins.includes(origin)) throw new ApiError(403, 'bad_origin', 'Cross-origin request rejected.');
      const site = c.req.header('sec-fetch-site');
      if (site && site !== 'same-origin' && site !== 'same-site' && site !== 'none') throw new ApiError(403, 'bad_origin', 'Cross-site request rejected.');
      const length = Number(c.req.header('content-length') ?? 0);
      if (length > (c.req.path === '/api/convert' ? MAX_CONVERT_BODY_BYTES : MAX_BODY_BYTES)) throw new ApiError(413, 'too_large', 'Request body too large.');
      const type = c.req.header('content-type') ?? '';
      // A body is present when it has a length or is chunked (no Content-Length).
      const hasBody = length > 0 || !!c.req.header('transfer-encoding');
      if (hasBody && !type.startsWith('application/json')) {
        throw new ApiError(415, 'unsupported_media_type', 'Send JSON.');
      }
    }
    c.set('user', await sessionUser(ctx.db, getCookie(c, SESSION_COOKIE)));
    c.header('Cache-Control', 'no-store');
    await next();
  });

  // `commit` (set by Render or Vercel) shows which revision is live after a deploy.
  const commit = (process.env.RENDER_GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA)?.slice(0, 7) ?? null;
  const host = process.env.VERCEL === '1' ? 'vercel' : process.env.RENDER ? 'render' : 'node';
  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      version: '0.1.0',
      commit,
      host,
      realtime: ctx.config.serverless ? 'poll' : 'ws',
      enrichment: ctx.queue.enabled,
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    }),
  );
  app.route('/api', authRoutes);
  app.route('/api', importRoutes);
  app.route('/api', libraryRoutes);
  app.route('/api', socialRoutes);
  app.route('/api', internalRoutes);
  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message, ...err.extra } }, err.status as 400);
    if (err instanceof ImportError) return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    if (err instanceof AccountError) return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    if (err instanceof ZodError) {
      return c.json({ error: { code: 'invalid_input', message: 'Some fields are missing or invalid.', issues: err.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })) } }, 400);
    }
    if (err instanceof SyntaxError) return c.json({ error: { code: 'bad_json', message: 'Malformed JSON body.' } }, 400);
    console.error('[somm] unhandled error', err instanceof Error ? err.message : err);
    return c.json({ error: { code: 'internal', message: 'Something went wrong on our side.' } }, 500);
  });

  return app;
}
