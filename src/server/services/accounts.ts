/**
 * Accounts: pseudonymous handle + password, or a temporary demo account.
 * No email, legal name, birth date, contacts or demographics are collected.
 */
import { randomBytes } from 'node:crypto';
import { cleanDisplayText } from '../../shared/normalize';
import { all, get, newId, nowIso, run, tx, type DB } from '../db';
import { hashPassword, newSessionToken, sha256, verifyPassword } from '../security';
import { recomputeCommunity } from './communities';

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export const DEMO_TTL_MS = 24 * 3600 * 1000;
export const SESSION_COOKIE = 'somm_session';

const RESERVED = new Set(['admin', 'administrator', 'root', 'somm', 'support', 'moderator', 'mod', 'system', 'api', 'help', 'staff', 'official', 'null', 'undefined']);

export interface SessionUser {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  isDemo: 0 | 1 | 2;
  profileVisibility: 'private' | 'members' | 'public';
  discoverable: boolean;
  showMemberships: boolean;
  onboarded: boolean;
  createdAt: string;
  expiresAt: string | null;
}

interface UserRow {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  is_demo: number;
  profile_visibility: SessionUser['profileVisibility'];
  discoverable: number;
  show_memberships: number;
  onboarded: number;
  created_at: string;
  expires_at: string | null;
  password_hash: string | null;
}

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export function toSessionUser(r: UserRow): SessionUser {
  return {
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    bio: r.bio,
    isDemo: r.is_demo as SessionUser['isDemo'],
    profileVisibility: r.profile_visibility,
    discoverable: r.discoverable === 1,
    showMemberships: r.show_memberships === 1,
    onboarded: r.onboarded === 1,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };
}

export function validateHandle(raw: string): string {
  const handle = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,23}$/.test(handle)) {
    throw new AccountError('Handles are 3–24 characters: letters, numbers, dot, dash or underscore, starting with a letter or number.', 400, 'invalid_handle');
  }
  if (RESERVED.has(handle) || handle.startsWith('demo-')) throw new AccountError('That handle is reserved.', 400, 'reserved_handle');
  return handle;
}

export function validatePassword(raw: string): string {
  if (typeof raw !== 'string' || raw.length < 10) throw new AccountError('Passwords need at least 10 characters.', 400, 'weak_password');
  if (raw.length > 200) throw new AccountError('Passwords are limited to 200 characters.', 400, 'invalid_password');
  return raw;
}

export function userById(db: DB, id: string): SessionUser | null {
  const r = get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', [id]);
  return r ? toSessionUser(r) : null;
}

export function userByHandle(db: DB, handle: string): SessionUser | null {
  const r = get<UserRow>(db, 'SELECT * FROM users WHERE handle = ?', [handle.trim().toLowerCase()]);
  return r ? toSessionUser(r) : null;
}

export function createSession(db: DB, userId: string, ttlMs = SESSION_TTL_MS): string {
  const token = newSessionToken();
  run(db, 'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [sha256(token), userId, nowIso(), nowIso(ttlMs)]);
  return token;
}

export function sessionUser(db: DB, token: string | undefined | null): SessionUser | null {
  if (!token || token.length > 100) return null;
  const row = get<UserRow & { session_expires: string }>(
    db,
    'SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
    [sha256(token)],
  );
  if (!row) return null;
  const now = nowIso();
  if (row.session_expires < now || (row.expires_at && row.expires_at < now)) {
    run(db, 'DELETE FROM sessions WHERE id = ?', [sha256(token)]);
    return null;
  }
  return toSessionUser(row);
}

export function destroySession(db: DB, token: string | undefined | null) {
  if (token) run(db, 'DELETE FROM sessions WHERE id = ?', [sha256(token)]);
}

export async function signup(db: DB, rawHandle: string, rawPassword: string, displayName?: string): Promise<SessionUser> {
  const handle = validateHandle(rawHandle);
  const password = validatePassword(rawPassword);
  if (get(db, 'SELECT 1 FROM users WHERE handle = ?', [handle])) throw new AccountError('That handle is taken.', 409, 'handle_taken');
  const id = newId();
  const hash = await hashPassword(password);
  run(db, 'INSERT INTO users (id, handle, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', [
    id, handle, cleanDisplayText(displayName || handle, 40) || handle, hash, nowIso(),
  ]);
  return userById(db, id)!;
}

// A fixed dummy hash so failed lookups take as long as real verifications.
let dummyHash: Promise<string> | null = null;

export async function signin(db: DB, rawHandle: string, password: string): Promise<SessionUser> {
  const row = get<UserRow>(db, 'SELECT * FROM users WHERE handle = ? AND is_demo = 0', [String(rawHandle).trim().toLowerCase()]);
  dummyHash ??= hashPassword('not-a-real-password');
  const ok = row?.password_hash ? await verifyPassword(String(password), row.password_hash) : (await verifyPassword(String(password), await dummyHash), false);
  if (!row || !ok) throw new AccountError('Handle or password is incorrect.', 401, 'bad_credentials');
  return toSessionUser(row);
}

/** Temporary demo visitor: no password, deleted automatically after 24 hours. */
export function createDemoAccount(db: DB): SessionUser {
  const id = newId();
  const handle = `demo-${randomBytes(3).toString('hex')}`;
  run(db, 'INSERT INTO users (id, handle, display_name, is_demo, created_at, expires_at) VALUES (?, ?, ?, 1, ?, ?)', [
    id, handle, 'Demo listener', nowIso(), nowIso(DEMO_TTL_MS),
  ]);
  return userById(db, id)!;
}

/** Remove catalogue rows no longer referenced by any library (keeps the shared catalogue minimal). */
export function pruneOrphans(db: DB): { tracks: number; artists: number; albums: number } {
  return tx(db, () => {
    const orphanTracks = all<{ id: string }>(
      db,
      'SELECT t.id FROM tracks t WHERE NOT EXISTS (SELECT 1 FROM playlist_tracks pt WHERE pt.track_id = t.id)',
    ).map((r) => r.id);
    for (const id of orphanTracks) {
      run(db, "DELETE FROM external_ids WHERE entity_type = 'track' AND entity_id = ?", [id]);
      run(db, 'UPDATE community_messages SET ref_type = NULL, ref_id = NULL WHERE ref_type = ? AND ref_id = ?', ['track', id]);
      run(db, 'DELETE FROM tracks WHERE id = ?', [id]);
    }
    const albums = run(db, 'DELETE FROM albums WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = albums.id)').changes;
    const orphanArtists = all<{ id: string }>(
      db,
      'SELECT a.id FROM artists a WHERE NOT EXISTS (SELECT 1 FROM track_artists ta WHERE ta.artist_id = a.id) AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.primary_artist_id = a.id) AND NOT EXISTS (SELECT 1 FROM albums al WHERE al.primary_artist_id = a.id)',
    ).map((r) => r.id);
    for (const id of orphanArtists) {
      run(db, "DELETE FROM external_ids WHERE entity_type = 'artist' AND entity_id = ?", [id]);
      run(db, 'DELETE FROM artists WHERE id = ?', [id]);
    }
    return { tracks: orphanTracks.length, artists: orphanArtists.length, albums };
  });
}

/** Delete every playlist and derived profile for a user, keeping the account. */
export function deleteLibrary(db: DB, userId: string): number {
  const communities = all<{ community_id: string }>(db, 'SELECT community_id FROM community_memberships WHERE user_id = ?', [userId]);
  const removed = tx(db, () => {
    const n = run(db, 'DELETE FROM playlists WHERE user_id = ?', [userId]).changes;
    run(db, 'DELETE FROM music_profiles WHERE user_id = ?', [userId]);
    run(db, 'DELETE FROM profile_artists WHERE user_id = ?', [userId]);
    run(db, 'DELETE FROM profile_tracks WHERE user_id = ?', [userId]);
    run(db, 'DELETE FROM profile_genres WHERE user_id = ?', [userId]);
    run(db, 'DELETE FROM music_matches WHERE user_id = ?', [userId]);
    run(db, 'DELETE FROM import_jobs WHERE user_id = ?', [userId]);
    run(db, 'DELETE FROM import_drafts WHERE user_id = ?', [userId]);
    return n;
  });
  for (const c of communities) recomputeCommunity(db, c.community_id);
  pruneOrphans(db);
  return removed;
}

/** Permanently delete the account and everything it owns (cascades), then refresh affected Trees. */
export function deleteAccount(db: DB, userId: string): void {
  const communities = all<{ community_id: string }>(db, 'SELECT community_id FROM community_memberships WHERE user_id = ?', [userId]);
  tx(db, () => {
    run(db, 'DELETE FROM reports WHERE target_type = ? AND target_id = ?', ['user', userId]);
    run(db, 'UPDATE communities SET created_by = NULL WHERE created_by = ?', [userId]);
    run(db, 'DELETE FROM users WHERE id = ?', [userId]);
  });
  for (const c of communities) {
    const left = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM community_memberships WHERE community_id = ?', [c.community_id])!.n;
    if (left === 0) {
      const origin = get<{ origin: string }>(db, 'SELECT origin FROM communities WHERE id = ?', [c.community_id])?.origin;
      run(db, 'UPDATE communities SET status = ? WHERE id = ?', [origin === 'member' ? 'archived' : 'proposed', c.community_id]);
    }
    recomputeCommunity(db, c.community_id);
  }
  pruneOrphans(db);
}

/** Everything SOMM stores about a user, as JSON (provider tokens excluded). */
export function exportAccount(db: DB, userId: string) {
  const user = get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return null;
  const { password_hash: _ignored, ...account } = user;
  void _ignored;
  return {
    exportedAt: nowIso(),
    format: 'somm-export-v1',
    account,
    connections: all(db, 'SELECT provider, scope, created_at, updated_at FROM provider_connections WHERE user_id = ?', [userId]),
    playlists: all<{ id: string; name: string; provider: string; visibility: string; source_url: string | null; created_at: string }>(
      db,
      'SELECT id, name, provider, visibility, source_url, created_at FROM playlists WHERE user_id = ?',
      [userId],
    ).map((p) => ({
      ...p,
      tracks: all(
        db,
        `SELECT pt.position, pt.raw_title AS title, pt.raw_artist AS artist, pt.raw_album AS album, pt.source_url, pt.match_method, pt.hidden,
                pt.user_genres, pt.user_attributes, pt.user_bpm, t.isrc, t.release_year, t.duration_ms
         FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ? ORDER BY pt.position`,
        [p.id],
      ),
    })),
    memberships: all(db, 'SELECT c.name, c.slug, m.role, m.joined_at FROM community_memberships m JOIN communities c ON c.id = m.community_id WHERE m.user_id = ?', [userId]),
    messages: all(db, 'SELECT c.slug AS tree, m.body, m.created_at FROM community_messages m JOIN communities c ON c.id = m.community_id WHERE m.user_id = ? ORDER BY m.id', [userId]),
    blocks: all(db, 'SELECT u.handle, b.kind, b.created_at FROM blocks b JOIN users u ON u.id = b.target_user_id WHERE b.user_id = ?', [userId]),
    reportsFiled: all(db, 'SELECT target_type, reason, status, created_at FROM reports WHERE reporter_id = ?', [userId]),
  };
}

/** Periodic housekeeping: expired sessions, demo accounts, drafts, cache and time-limited provider data. */
export function housekeeping(db: DB) {
  const now = nowIso();
  run(db, 'DELETE FROM sessions WHERE expires_at < ?', [now]);
  run(db, 'DELETE FROM import_drafts WHERE expires_at < ?', [now]);
  run(db, 'DELETE FROM lookup_cache WHERE expires_at < ?', [now]);
  run(db, 'DELETE FROM oauth_states WHERE created_at < ?', [nowIso(-15 * 60 * 1000)]);
  const expiredDemo = all<{ id: string }>(db, 'SELECT id FROM users WHERE is_demo = 1 AND expires_at < ?', [now]);
  for (const u of expiredDemo) deleteAccount(db, u.id);
  // YouTube API data must be refreshed or deleted within 30 days.
  const expiredPlaylists = all<{ id: string; user_id: string }>(db, 'SELECT id, user_id FROM playlists WHERE data_expires_at IS NOT NULL AND data_expires_at < ?', [now]);
  for (const p of expiredPlaylists) run(db, 'DELETE FROM playlists WHERE id = ?', [p.id]);
  if (expiredPlaylists.length) pruneOrphans(db);
  return { demoAccounts: expiredDemo.length, expiredPlaylists: expiredPlaylists.map((p) => p.user_id) };
}
