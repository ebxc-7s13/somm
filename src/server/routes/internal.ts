/**
 * Runtime capabilities for the client, and the internal endpoints serverless hosts
 * use instead of a long-running process:
 *
 *   GET  /api/client-config    what this server supports (WebSocket push or polling, calls)
 *   POST /api/internal/enrich  a fresh invocation continues metadata enrichment (hand-over)
 *   GET  /api/internal/cron    daily housekeeping (Vercel Cron), plus an enrichment burst
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { AppConfig } from '../config';
import { ApiError, rateLimit, type Env } from '../context';
import { housekeeping } from '../services/accounts';

/** Request bodies above this go to a serverless host compressed (Vercel accepts 4.5 MB per request). */
export const SERVERLESS_BODY_LIMIT = 4 * 1024 * 1024;

/**
 * Shared secret for the enrichment hand-over, derived from a server-only secret: the
 * encryption key when set, else the database URL (always set on serverless hosts).
 */
export function internalToken(config: AppConfig): string | null {
  const secret = config.tokenEncryptionKey ?? (config.databaseUrl ? Buffer.from(config.databaseUrl) : null);
  if (!secret) return null;
  return createHmac('sha256', secret).update('somm-internal-enrich').digest('base64url');
}

function sameSecret(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const internalRoutes = new Hono<Env>()
  .get('/client-config', (c) => {
    const { config } = c.get('ctx');
    return c.json({
      realtime: config.serverless ? 'poll' : 'ws',
      calls: config.calls.enabled,
      // Larger uploads are gzip-compressed by the client on serverless hosts.
      compressAboveBytes: config.serverless ? 1024 * 1024 : null,
      maxRequestBytes: config.serverless ? SERVERLESS_BODY_LIMIT : null,
    });
  })
  .post('/internal/enrich', (c) => {
    const { config, queue } = c.get('ctx');
    const token = internalToken(config);
    if (!token || !sameSecret(c.req.header('x-somm-internal'), token)) throw new ApiError(403, 'forbidden', 'Not allowed.');
    queue.kick();
    return c.json({ ok: true }, 202);
  })
  .get('/internal/cron', async (c) => {
    const { config, db, queue, refreshUsers } = c.get('ctx');
    if (config.cronSecret) {
      if (!sameSecret(c.req.header('authorization'), `Bearer ${config.cronSecret}`)) throw new ApiError(403, 'forbidden', 'Not allowed.');
    } else {
      // Without CRON_SECRET anyone could call this; the work is idempotent, so just keep it rare.
      rateLimit(c, 'internal-cron', { limit: 4, windowMs: 3_600_000 });
    }
    const result = await housekeeping(db);
    if (result.expiredPlaylists.length) await refreshUsers(result.expiredPlaylists);
    queue.kick();
    return c.json({ ok: true, demoAccountsRemoved: result.demoAccounts, expiredPlaylists: result.expiredPlaylists.length });
  });
