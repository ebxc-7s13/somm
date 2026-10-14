import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { normalizeWeights, type MatchWeights } from '../shared/analysis/similarity';

/** Minimal .env loader (no dependency). Existing environment variables win. */
export function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const key = m[1]!;
    let value = m[2] ?? '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

const schema = z.object({
  NODE_ENV: z.string().optional().default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  PUBLIC_URL: optional,
  // Render sets these automatically for web services.
  RENDER_EXTERNAL_URL: optional,
  RENDER_EXTERNAL_HOSTNAME: optional,
  DATABASE_URL: optional,
  PGLITE_DATA_DIR: z.string().default('./data/pglite'),
  TRUST_PROXY: bool(false),
  TOKEN_ENCRYPTION_KEY: optional,
  DEMO_MODE_ENABLED: bool(true),
  ADMIN_HANDLES: optional,
  MUSICBRAINZ_ENABLED: bool(true),
  MUSICBRAINZ_CONTACT: optional,
  ITUNES_LOOKUP_ENABLED: bool(false),
  SPOTIFY_CLIENT_ID: optional,
  SPOTIFY_REDIRECT_URI: optional,
  YOUTUBE_API_KEY: optional,
  APPLE_MUSIC_TEAM_ID: optional,
  APPLE_MUSIC_KEY_ID: optional,
  APPLE_MUSIC_PRIVATE_KEY_PATH: optional,
  CALLS_ENABLED: bool(true),
  STUN_URLS: z.string().optional().default('stun:stun.cloudflare.com:3478'),
  TURN_URLS: optional,
  TURN_USERNAME: optional,
  TURN_CREDENTIAL: optional,
  MATCH_WEIGHTS: optional,
});

export interface AppConfig {
  env: string;
  isProduction: boolean;
  port: number;
  publicUrl: string;
  allowedOrigins: string[];
  /** postgres:// URL (production) or null to use PGlite. */
  databaseUrl: string | null;
  /** PGlite data directory, or "memory://". */
  pgliteDataDir: string;
  /** Trust X-Forwarded-For (set when running behind a proxy such as Render). */
  trustProxy: boolean;
  tokenEncryptionKey: Buffer | null;
  demoModeEnabled: boolean;
  adminHandles: string[];
  musicbrainz: { enabled: boolean; contact: string | null };
  itunesLookupEnabled: boolean;
  spotify: { clientId: string | null; redirectUri: string | null };
  youtube: { apiKey: string | null };
  appleMusic: { teamId: string | null; keyId: string | null; privateKeyPath: string | null };
  calls: { enabled: boolean; iceServers: { urls: string[]; username?: string; credential?: string }[]; hasTurn: boolean };
  matchWeights: MatchWeights;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.parse(env);
  let key: Buffer | null = null;
  if (parsed.TOKEN_ENCRYPTION_KEY) {
    const raw = parsed.TOKEN_ENCRYPTION_KEY;
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) key = decoded;
    else if (raw.length >= 32) key = createHash('sha256').update(raw).digest(); // any long random secret works
    else throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes as base64, or a random string of at least 32 characters.');
  }
  let weights: Partial<MatchWeights> | undefined;
  if (parsed.MATCH_WEIGHTS) {
    try {
      weights = JSON.parse(parsed.MATCH_WEIGHTS) as Partial<MatchWeights>;
    } catch {
      throw new Error('MATCH_WEIGHTS must be valid JSON, e.g. {"tracks":0.4,"artists":0.25,"genres":0.2,"attributes":0.15}');
    }
  }
  const publicUrl = (
    parsed.PUBLIC_URL ??
    parsed.RENDER_EXTERNAL_URL ??
    (parsed.RENDER_EXTERNAL_HOSTNAME ? `https://${parsed.RENDER_EXTERNAL_HOSTNAME}` : 'http://127.0.0.1:5173')
  ).replace(/\/$/, '');
  const origins = new Set([publicUrl]);
  // In development the API is also reachable directly and via the Vite proxy.
  if (parsed.NODE_ENV !== 'production') {
    origins.add(`http://127.0.0.1:${parsed.PORT}`);
    origins.add(`http://localhost:${parsed.PORT}`);
    origins.add('http://127.0.0.1:5173');
    origins.add('http://localhost:5173');
  }
  const iceServers: AppConfig['calls']['iceServers'] = [];
  const stun = parsed.STUN_URLS.split(',').map((s) => s.trim()).filter(Boolean);
  if (stun.length) iceServers.push({ urls: stun });
  const turn = parsed.TURN_URLS ? parsed.TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (turn.length && parsed.TURN_USERNAME && parsed.TURN_CREDENTIAL) {
    iceServers.push({ urls: turn, username: parsed.TURN_USERNAME, credential: parsed.TURN_CREDENTIAL });
  }

  return {
    env: parsed.NODE_ENV,
    isProduction: parsed.NODE_ENV === 'production',
    port: parsed.PORT,
    publicUrl,
    allowedOrigins: [...origins],
    databaseUrl: parsed.DATABASE_URL,
    pgliteDataDir: parsed.PGLITE_DATA_DIR,
    trustProxy: parsed.TRUST_PROXY || !!parsed.RENDER_EXTERNAL_HOSTNAME,
    tokenEncryptionKey: key,
    demoModeEnabled: parsed.DEMO_MODE_ENABLED,
    adminHandles: (parsed.ADMIN_HANDLES ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    musicbrainz: { enabled: parsed.MUSICBRAINZ_ENABLED, contact: parsed.MUSICBRAINZ_CONTACT },
    itunesLookupEnabled: parsed.ITUNES_LOOKUP_ENABLED,
    spotify: { clientId: parsed.SPOTIFY_CLIENT_ID, redirectUri: parsed.SPOTIFY_REDIRECT_URI },
    youtube: { apiKey: parsed.YOUTUBE_API_KEY },
    appleMusic: {
      teamId: parsed.APPLE_MUSIC_TEAM_ID,
      keyId: parsed.APPLE_MUSIC_KEY_ID,
      privateKeyPath: parsed.APPLE_MUSIC_PRIVATE_KEY_PATH,
    },
    calls: { enabled: parsed.CALLS_ENABLED, iceServers, hasTurn: turn.length > 0 && !!parsed.TURN_CREDENTIAL },
    matchWeights: normalizeWeights(weights),
  };
}
