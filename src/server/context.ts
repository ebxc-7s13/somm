import type { Context } from 'hono';
import type { AppConfig } from './config';
import type { DB } from './db';
import type { MusicBrainzClient } from './enrich/musicbrainz';
import type { EnrichmentQueue } from './enrich/queue';
import type { FetchLike } from './http';
import { SlidingWindowLimiter } from './ratelimit';
import type { RealtimeHub } from './realtime/hub';
import type { SessionUser } from './services/accounts';
import type { ProviderService } from './services/providers';

export interface AppContext {
  db: DB;
  config: AppConfig;
  providers: ProviderService;
  queue: EnrichmentQueue;
  musicbrainz: MusicBrainzClient | null;
  hub: RealtimeHub;
  limiter: SlidingWindowLimiter;
  fetchImpl?: FetchLike;
  /** Recompute profiles + Tree aggregates for users whose libraries changed. */
  refreshUsers: (userIds: string[]) => void;
}

export type Env = { Variables: { user: SessionUser | null; ctx: AppContext } };

export type C = Context<Env>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function requireUser(c: C): SessionUser {
  const user = c.get('user');
  if (!user) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  return user;
}

export function clientIp(c: C): string {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'local';
}

export function rateLimit(c: C, key: string, rule: { limit: number; windowMs: number }) {
  const wait = c.get('ctx').limiter.check(key, rule.limit, rule.windowMs);
  if (wait > 0) {
    c.header('Retry-After', String(Math.ceil(wait / 1000)));
    throw new ApiError(429, 'rate_limited', `Too many requests. Try again in ${Math.ceil(wait / 1000)} s.`, { retryAfterMs: wait });
  }
}

export { SlidingWindowLimiter };
