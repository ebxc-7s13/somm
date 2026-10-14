import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { cleanDisplayText } from '../../shared/normalize';
import { ApiError, clientIp, rateLimit, requireUser, type C, type Env } from '../context';
import { get, run } from '../db';
import { LIMITS } from '../ratelimit';
import {
  createDemoAccount,
  createSession,
  DEMO_TTL_MS,
  deleteAccount,
  deleteLibrary,
  destroySession,
  exportAccount,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  signin,
  signup,
  userById,
} from '../services/accounts';
import { recomputeProfile } from '../services/library';
import { recomputeUserCommunities } from '../services/communities';

function setSessionCookie(c: C, token: string, maxAgeMs: number) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: c.get('ctx').config.isProduction,
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  });
}

const credentials = z.object({ handle: z.string().max(40), password: z.string().max(200), displayName: z.string().max(60).optional() });

const settingsSchema = z.object({
  displayName: z.string().min(1).max(40).optional(),
  bio: z.string().max(280).optional(),
  profileVisibility: z.enum(['private', 'members', 'public']).optional(),
  discoverable: z.boolean().optional(),
  showMemberships: z.boolean().optional(),
  onboarded: z.boolean().optional(),
});

export function meSummary(c: C) {
  const user = requireUser(c);
  const { db } = c.get('ctx');
  const counts = get<{ playlists: number; tracks: number }>(
    db,
    'SELECT (SELECT COUNT(*) FROM playlists WHERE user_id = ?) AS playlists, (SELECT COUNT(DISTINCT pt.track_id) FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE p.user_id = ?) AS tracks',
    [user.id, user.id],
  )!;
  const memberships = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM community_memberships WHERE user_id = ?', [user.id])!.n;
  return { user, counts: { ...counts, memberships }, isAdmin: c.get('ctx').config.adminHandles.includes(user.handle) };
}

export const authRoutes = new Hono<Env>()
  .post('/auth/signup', async (c) => {
    rateLimit(c, `auth:${clientIp(c)}`, LIMITS.auth);
    const body = credentials.parse(await c.req.json());
    const user = await signup(c.get('ctx').db, body.handle, body.password, body.displayName);
    setSessionCookie(c, createSession(c.get('ctx').db, user.id), SESSION_TTL_MS);
    return c.json({ user }, 201);
  })
  .post('/auth/signin', async (c) => {
    rateLimit(c, `auth:${clientIp(c)}`, LIMITS.auth);
    const body = credentials.parse(await c.req.json());
    const user = await signin(c.get('ctx').db, body.handle, body.password);
    setSessionCookie(c, createSession(c.get('ctx').db, user.id), SESSION_TTL_MS);
    return c.json({ user });
  })
  .post('/auth/demo', (c) => {
    const { config, db } = c.get('ctx');
    if (!config.demoModeEnabled) throw new ApiError(403, 'demo_disabled', 'Demo mode is disabled on this server.');
    rateLimit(c, `auth:${clientIp(c)}`, LIMITS.auth);
    const user = createDemoAccount(db);
    setSessionCookie(c, createSession(db, user.id, DEMO_TTL_MS), DEMO_TTL_MS);
    return c.json({ user }, 201);
  })
  .post('/auth/signout', (c) => {
    destroySession(c.get('ctx').db, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  })
  .get('/me', (c) => c.json(meSummary(c)))
  .patch('/me', async (c) => {
    const user = requireUser(c);
    const { db, refreshUsers } = c.get('ctx');
    const body = settingsSchema.parse(await c.req.json());
    if (body.displayName !== undefined) {
      const name = cleanDisplayText(body.displayName, 40);
      if (!name) throw new ApiError(400, 'invalid_name', 'Display names cannot be empty.');
      run(db, 'UPDATE users SET display_name = ? WHERE id = ?', [name, user.id]);
    }
    if (body.bio !== undefined) run(db, 'UPDATE users SET bio = ? WHERE id = ?', [cleanDisplayText(body.bio, 280), user.id]);
    if (body.profileVisibility) run(db, 'UPDATE users SET profile_visibility = ? WHERE id = ?', [body.profileVisibility, user.id]);
    if (body.discoverable !== undefined) run(db, 'UPDATE users SET discoverable = ? WHERE id = ?', [body.discoverable ? 1 : 0, user.id]);
    if (body.showMemberships !== undefined) run(db, 'UPDATE users SET show_memberships = ? WHERE id = ?', [body.showMemberships ? 1 : 0, user.id]);
    if (body.onboarded !== undefined) run(db, 'UPDATE users SET onboarded = ? WHERE id = ?', [body.onboarded ? 1 : 0, user.id]);
    if (body.discoverable !== undefined) refreshUsers([user.id]);
    return c.json({ user: userById(db, user.id) });
  })
  .get('/me/export', (c) => {
    const user = requireUser(c);
    c.header('Content-Disposition', `attachment; filename="somm-export-${user.handle}.json"`);
    return c.json(exportAccount(c.get('ctx').db, user.id));
  })
  .delete('/me/library', (c) => {
    const user = requireUser(c);
    const { db } = c.get('ctx');
    const playlists = deleteLibrary(db, user.id);
    recomputeProfile(db, user.id, true);
    recomputeUserCommunities(db, user.id);
    return c.json({ ok: true, playlistsDeleted: playlists });
  })
  .delete('/me', async (c) => {
    const user = requireUser(c);
    const body = z.object({ confirmHandle: z.string() }).parse(await c.req.json());
    if (body.confirmHandle.trim().toLowerCase() !== user.handle) {
      throw new ApiError(400, 'confirmation_mismatch', 'Type your handle exactly to confirm deletion.');
    }
    const { db, hub } = c.get('ctx');
    deleteAccount(db, user.id);
    hub.sendToUser(user.id, { type: 'account_deleted' });
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });
