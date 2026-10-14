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

export async function meSummary(c: C) {
  const user = requireUser(c);
  const { db } = c.get('ctx');
  const counts = (await get<{ playlists: number; tracks: number }>(
    db,
    'SELECT (SELECT COUNT(*) FROM playlists WHERE user_id = ?) AS playlists, (SELECT COUNT(DISTINCT pt.track_id) FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE p.user_id = ?) AS tracks',
    [user.id, user.id],
  ))!;
  const memberships = (await get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM community_memberships WHERE user_id = ?', [user.id]))!.n;
  return { user, counts: { ...counts, memberships }, isAdmin: c.get('ctx').config.adminHandles.includes(user.handle) };
}

export const authRoutes = new Hono<Env>()
  .post('/auth/signup', async (c) => {
    rateLimit(c, `auth:${clientIp(c)}`, LIMITS.auth);
    const body = credentials.parse(await c.req.json());
    const { db } = c.get('ctx');
    const user = await signup(db, body.handle, body.password, body.displayName);
    setSessionCookie(c, await createSession(db, user.id), SESSION_TTL_MS);
    return c.json({ user }, 201);
  })
  .post('/auth/signin', async (c) => {
    rateLimit(c, `auth:${clientIp(c)}`, LIMITS.auth);
    const body = credentials.parse(await c.req.json());
    const { db } = c.get('ctx');
    const user = await signin(db, body.handle, body.password);
    setSessionCookie(c, await createSession(db, user.id), SESSION_TTL_MS);
    return c.json({ user });
  })
  .post('/auth/demo', async (c) => {
    const { config, db } = c.get('ctx');
    if (!config.demoModeEnabled) throw new ApiError(403, 'demo_disabled', 'Demo mode is disabled on this server.');
    rateLimit(c, `auth:${clientIp(c)}`, LIMITS.auth);
    const user = await createDemoAccount(db);
    setSessionCookie(c, await createSession(db, user.id, DEMO_TTL_MS), DEMO_TTL_MS);
    return c.json({ user }, 201);
  })
  .post('/auth/signout', async (c) => {
    await destroySession(c.get('ctx').db, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  })
  .get('/me', async (c) => c.json(await meSummary(c)))
  .patch('/me', async (c) => {
    const user = requireUser(c);
    const { db, refreshUsers } = c.get('ctx');
    const body = settingsSchema.parse(await c.req.json());
    if (body.displayName !== undefined) {
      const name = cleanDisplayText(body.displayName, 40);
      if (!name) throw new ApiError(400, 'invalid_name', 'Display names cannot be empty.');
      await run(db, 'UPDATE users SET display_name = ? WHERE id = ?', [name, user.id]);
    }
    if (body.bio !== undefined) await run(db, 'UPDATE users SET bio = ? WHERE id = ?', [cleanDisplayText(body.bio, 280), user.id]);
    if (body.profileVisibility) await run(db, 'UPDATE users SET profile_visibility = ? WHERE id = ?', [body.profileVisibility, user.id]);
    if (body.discoverable !== undefined) await run(db, 'UPDATE users SET discoverable = ? WHERE id = ?', [body.discoverable ? 1 : 0, user.id]);
    if (body.showMemberships !== undefined) await run(db, 'UPDATE users SET show_memberships = ? WHERE id = ?', [body.showMemberships ? 1 : 0, user.id]);
    if (body.onboarded !== undefined) await run(db, 'UPDATE users SET onboarded = ? WHERE id = ?', [body.onboarded ? 1 : 0, user.id]);
    if (body.discoverable !== undefined) await refreshUsers([user.id]);
    return c.json({ user: await userById(db, user.id) });
  })
  .get('/me/export', async (c) => {
    const user = requireUser(c);
    c.header('Content-Disposition', `attachment; filename="somm-export-${user.handle}.json"`);
    return c.json(await exportAccount(c.get('ctx').db, user.id));
  })
  .delete('/me/library', async (c) => {
    const user = requireUser(c);
    const { db } = c.get('ctx');
    const playlists = await deleteLibrary(db, user.id);
    await recomputeProfile(db, user.id, true);
    await recomputeUserCommunities(db, user.id);
    return c.json({ ok: true, playlistsDeleted: playlists });
  })
  .delete('/me', async (c) => {
    const user = requireUser(c);
    const body = z.object({ confirmHandle: z.string() }).parse(await c.req.json());
    if (body.confirmHandle.trim().toLowerCase() !== user.handle) {
      throw new ApiError(400, 'confirmation_mismatch', 'Type your handle exactly to confirm deletion.');
    }
    const { db, hub } = c.get('ctx');
    await deleteAccount(db, user.id);
    hub.sendToUser(user.id, { type: 'account_deleted' });
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });
