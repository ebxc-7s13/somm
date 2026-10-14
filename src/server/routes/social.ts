import { Hono } from 'hono';
import { z } from 'zod';
import { explainMatch } from '../../shared/analysis/communities';
import { buildMusicMap } from '../../shared/analysis/map';
import { buildMatchVector, computeProfile } from '../../shared/analysis/profile';
import { compareVectors } from '../../shared/analysis/similarity';
import { normalizeText } from '../../shared/normalize';
import { FAMILY_LABELS, genreDisplayName, type Family } from '../../shared/taxonomy';
import { ApiError, rateLimit, requireUser, type C, type Env } from '../context';
import { all, get, nowIso, run, type DB } from '../db';
import { LIMITS } from '../ratelimit';
import { userByHandle, type SessionUser } from '../services/accounts';
import { ChatError, deleteOwnMessage, fileReport, hideMessage, listMessages, postMessage, requireMember } from '../services/chat';
import {
  communityMap,
  compatibleListeners,
  createCommunity,
  creationEligibility,
  getCommunity,
  isMember,
  joinCommunity,
  leaveCommunity,
  nameProposals,
  proposeName,
  recommendTrees,
  relatedCommunities,
  validateTreeName,
  voteName,
  type CommunityDisplayProfile,
  type CommunityRow,
} from '../services/communities';
import { loadLibraryTracks, populationFor, readProfile } from '../services/library';

function blockedEitherWay(db: DB, a: string, b: string): boolean {
  return !!get(
    db,
    "SELECT 1 FROM blocks WHERE kind = 'block' AND ((user_id = ? AND target_user_id = ?) OR (user_id = ? AND target_user_id = ?))",
    [a, b, b, a],
  );
}

function shareTree(db: DB, a: string, b: string): boolean {
  return !!get(db, 'SELECT 1 FROM community_memberships x JOIN community_memberships y ON x.community_id = y.community_id WHERE x.user_id = ? AND y.user_id = ? LIMIT 1', [a, b]);
}

/** Can `viewer` see `target`'s public profile content? */
function profileVisible(db: DB, viewer: SessionUser | null, target: SessionUser): boolean {
  if (viewer?.id === target.id) return true;
  if (viewer && blockedEitherWay(db, viewer.id, target.id)) return false;
  if (target.profileVisibility === 'public') return true;
  if (target.profileVisibility === 'members') return !!viewer && shareTree(db, viewer.id, target.id);
  return false;
}

function communitySummary(row: CommunityRow, viewerId: string | null, db: DB) {
  const display = row.profile_json ? (JSON.parse(row.profile_json) as CommunityDisplayProfile) : null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    origin: row.origin,
    color: row.color,
    glyphSeed: row.glyph_seed,
    memberCount: row.member_count,
    isDemo: row.is_demo === 1,
    families: display?.families.slice(0, 5) ?? [],
    topGenres: display?.genres.slice(0, 5).map((g) => g.label) ?? [],
    isMember: viewerId ? !!isMember(db, row.id, viewerId) : false,
    createdAt: row.created_at,
  };
}

function loadTree(c: C): CommunityRow {
  const row = getCommunity(c.get('ctx').db, c.req.param('slug') ?? '');
  const user = c.get('user');
  if (!row || row.status === 'archived') throw new ApiError(404, 'not_found', 'Tree not found.');
  if (row.status === 'proposed') {
    const candidates = row.candidate_ids ? (JSON.parse(row.candidate_ids) as string[]) : [];
    if (!user || (!candidates.includes(user.id) && !isMember(c.get('ctx').db, row.id, user.id))) throw new ApiError(404, 'not_found', 'Tree not found.');
  }
  return row;
}

function chatErrors<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ChatError) throw new ApiError(err.status, err.code, err.message);
    if (err instanceof Error && /Tree|name/.test(err.message) && !(err instanceof ApiError)) throw new ApiError(400, 'invalid', err.message);
    throw err;
  }
}

const messageSchema = z.object({
  body: z.string().max(4000).default(''),
  replyToId: z.number().int().positive().nullable().optional(),
  ref: z.object({ type: z.enum(['track', 'artist', 'album']), id: z.string().max(40) }).nullable().optional(),
});

export const socialRoutes = new Hono<Env>()
  // ----------------------------------------------------------------- Trees
  .get('/trees', (c) => {
    const user = c.get('user');
    const { db } = c.get('ctx');
    const q = normalizeText(c.req.query('q') ?? '');
    let rows = all<CommunityRow>(db, "SELECT * FROM communities WHERE status = 'active' ORDER BY member_count DESC, name");
    if (q) {
      rows = rows.filter((r) => normalizeText(`${r.name} ${r.description} ${r.profile_json ?? ''}`).includes(q));
    }
    return c.json({ trees: rows.map((r) => communitySummary(r, user?.id ?? null, db)) });
  })
  .get('/trees/recommended', (c) => {
    const user = requireUser(c);
    const { db, config } = c.get('ctx');
    const recs = recommendTrees(db, user.id, config.matchWeights);
    return c.json({ recommendations: recs, weights: config.matchWeights });
  })
  .get('/trees/eligibility', (c) => {
    const user = requireUser(c);
    const { db, config } = c.get('ctx');
    const e = creationEligibility(db, user.id, config.matchWeights);
    return c.json({ eligible: e.eligible, compatibleCount: e.compatibleCount, needed: e.needed, threshold: e.threshold, reason: e.reason });
  })
  .post('/trees', async (c) => {
    const user = requireUser(c);
    const { db, config } = c.get('ctx');
    const body = z.object({ name: z.string().max(80), description: z.string().max(280).default('') }).parse(await c.req.json());
    const name = chatErrors(() => validateTreeName(body.name));
    const e = creationEligibility(db, user.id, config.matchWeights);
    if (!e.eligible) throw new ApiError(409, 'not_enough_evidence', e.reason, { compatibleCount: e.compatibleCount, needed: e.needed });
    const mine = readProfile(db, user.id, 'shared');
    const row = createCommunity(db, {
      name,
      description: body.description || 'A Tree started by its members.',
      createdBy: user.id,
      origin: 'member',
      status: 'active',
      seedVector: mine?.vector,
      candidateIds: e.candidateIds,
    });
    return c.json({ tree: communitySummary(row, user.id, db) }, 201);
  })
  .get('/trees/:slug', (c) => {
    const user = c.get('user');
    const { db, config } = c.get('ctx');
    const row = loadTree(c);
    const display = row.profile_json ? (JSON.parse(row.profile_json) as CommunityDisplayProfile) : null;
    let match = null;
    if (user) {
      const rec = recommendTrees(db, user.id, config.matchWeights, 500).find((r) => r.community.id === row.id);
      match = rec ? { match: rec.match, explanation: rec.explanation } : null;
    }
    return c.json({
      tree: communitySummary(row, user?.id ?? null, db),
      profile: display,
      map: communityMap(row),
      match,
      membership: user ? isMember(db, row.id, user.id) ?? null : null,
      related: relatedCommunities(db, row, config.matchWeights),
      names: nameProposals(db, row.id, user?.id ?? null),
    });
  })
  .post('/trees/:slug/join', (c) => {
    const user = requireUser(c);
    const row = loadTree(c);
    chatErrors(() => joinCommunity(c.get('ctx').db, row.id, user.id));
    return c.json({ ok: true, tree: communitySummary(getCommunity(c.get('ctx').db, row.id)!, user.id, c.get('ctx').db) });
  })
  .post('/trees/:slug/leave', (c) => {
    const user = requireUser(c);
    const { db, hub } = c.get('ctx');
    const row = loadTree(c);
    leaveCommunity(db, row.id, user.id);
    hub.leaveRoom(user.id, row.id);
    return c.json({ ok: true });
  })
  .get('/trees/:slug/members', (c) => {
    const user = requireUser(c);
    const { db, config, hub } = c.get('ctx');
    const row = loadTree(c);
    chatErrors(() => requireMember(db, row.id, user.id));
    const mine = readProfile(db, user.id, 'all');
    const members = all<{ id: string; handle: string; display_name: string; role: string; joined_at: string; is_demo: number; profile_visibility: string }>(
      db,
      `SELECT u.id, u.handle, u.display_name, m.role, m.joined_at, u.is_demo, u.profile_visibility
       FROM community_memberships m JOIN users u ON u.id = m.user_id WHERE m.community_id = ? ORDER BY m.role = 'moderator' DESC, m.joined_at LIMIT 200`,
      [row.id],
    ).filter((m) => m.id === user.id || !blockedEitherWay(db, user.id, m.id));
    const population = mine ? populationFor(db, [mine.vector]) : undefined;
    return c.json({
      members: members.map((m) => {
        const theirs = m.id === user.id ? null : readProfile(db, m.id, 'shared');
        const score = mine && theirs && theirs.trackCount > 0 ? compareVectors(mine.vector, theirs.vector, { weights: config.matchWeights, population }) : null;
        return {
          id: m.id,
          handle: m.handle,
          displayName: m.display_name,
          role: m.role,
          joinedAt: m.joined_at,
          isDemo: m.is_demo === 2,
          isYou: m.id === user.id,
          online: hub.isOnline(m.id),
          profileVisible: m.profile_visibility !== 'private',
          match: score ? { score: score.score, label: score.label } : null,
        };
      }),
    });
  })
  .get('/trees/:slug/messages', (c) => {
    const user = requireUser(c);
    const row = loadTree(c);
    const q = z
      .object({ before: z.coerce.number().int().optional(), after: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(100).optional() })
      .parse(c.req.query());
    return c.json(chatErrors(() => listMessages(c.get('ctx').db, row.id, user.id, q)));
  })
  .post('/trees/:slug/messages', async (c) => {
    const user = requireUser(c);
    const row = loadTree(c);
    const { db, hub } = c.get('ctx');
    chatErrors(() => requireMember(db, row.id, user.id));
    rateLimit(c, `msg:${user.id}`, LIMITS.messageBurst);
    rateLimit(c, `msgh:${user.id}`, LIMITS.messageHourly);
    const body = messageSchema.parse(await c.req.json());
    const message = chatErrors(() => postMessage(db, row.id, user.id, body));
    hub.broadcastMessage(row.id, message);
    return c.json({ message }, 201);
  })
  .delete('/trees/:slug/messages/:id', (c) => {
    const user = requireUser(c);
    const row = loadTree(c);
    const { db, hub } = c.get('ctx');
    const id = Number(c.req.param('id'));
    if (!deleteOwnMessage(db, row.id, id, user.id)) throw new ApiError(404, 'not_found', 'Message not found or not yours.');
    hub.broadcastRemoved(row.id, id, 'deleted');
    return c.json({ ok: true });
  })
  .post('/trees/:slug/messages/:id/hide', (c) => {
    const user = requireUser(c);
    const row = loadTree(c);
    const { db, hub, config } = c.get('ctx');
    const m = isMember(db, row.id, user.id);
    if (m?.role !== 'moderator' && !config.adminHandles.includes(user.handle)) throw new ApiError(403, 'forbidden', 'Only moderators can hide messages.');
    const id = Number(c.req.param('id'));
    if (!hideMessage(db, row.id, id, `hidden by moderator ${user.handle}`)) throw new ApiError(404, 'not_found', 'Message not found.');
    hub.broadcastRemoved(row.id, id, 'hidden');
    return c.json({ ok: true });
  })
  .post('/trees/:slug/names', async (c) => {
    const user = requireUser(c);
    const row = loadTree(c);
    const { db } = c.get('ctx');
    chatErrors(() => requireMember(db, row.id, user.id));
    const { name } = z.object({ name: z.string().max(80) }).parse(await c.req.json());
    const id = chatErrors(() => proposeName(db, row.id, user.id, name));
    return c.json({ id, names: nameProposals(db, row.id, user.id), tree: communitySummary(getCommunity(db, row.id)!, user.id, db) }, 201);
  })
  .post('/trees/:slug/names/:proposalId/vote', (c) => {
    const user = requireUser(c);
    const row = loadTree(c);
    const { db } = c.get('ctx');
    chatErrors(() => requireMember(db, row.id, user.id));
    const r = chatErrors(() => voteName(db, row.id, c.req.param('proposalId'), user.id));
    return c.json({ ...r, names: nameProposals(db, row.id, user.id), tree: communitySummary(getCommunity(db, row.id)!, user.id, db) });
  })

  // ------------------------------------------------------- people & discovery
  .get('/users/:handle', (c) => {
    const viewer = c.get('user');
    const { db } = c.get('ctx');
    const target = userByHandle(db, c.req.param('handle'));
    if (!target || target.isDemo === 1 || (viewer && viewer.id !== target.id && blockedEitherWay(db, viewer.id, target.id))) {
      throw new ApiError(404, 'not_found', 'Listener not found.');
    }
    const visible = profileVisible(db, viewer, target);
    const base = { handle: target.handle, displayName: target.displayName, isDemo: target.isDemo === 2, isYou: viewer?.id === target.id, visibility: target.profileVisibility };
    if (!visible) return c.json({ user: base, visible: false });
    const { tracks } = loadLibraryTracks(db, target.id, 'public');
    const profile = computeProfile(tracks);
    const playlists = all<{ id: string; name: string; provider: string; track_count: number }>(
      db,
      "SELECT id, name, provider, track_count FROM playlists WHERE user_id = ? AND visibility = 'public' ORDER BY created_at DESC",
      [target.id],
    ).map((p) => ({
      ...p,
      tracks: all<{ id: string; title: string; artist: string }>(
        db,
        `SELECT t.id, t.title, a.name AS artist FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id JOIN artists a ON a.id = t.primary_artist_id
         WHERE pt.playlist_id = ? AND pt.hidden = 0 ORDER BY pt.position LIMIT 100`,
        [p.id],
      ),
    }));
    const memberships = target.showMemberships || viewer?.id === target.id
      ? all<{ slug: string; name: string; color: string }>(
          db,
          "SELECT c.slug, c.name, c.color FROM community_memberships m JOIN communities c ON c.id = m.community_id WHERE m.user_id = ? AND c.status = 'active'",
          [target.id],
        )
      : [];
    return c.json({
      user: { ...base, bio: target.bio },
      visible: true,
      profile: {
        totals: profile.totals,
        families: profile.families.slice(0, 8),
        genres: profile.genres.slice(0, 12).map((g) => ({ name: g.name, label: genreDisplayName(g.name), trackCount: g.trackCount })),
        artists: profile.artists.slice(0, 12).map((a) => ({ name: a.name, trackCount: a.trackCount })),
      },
      map: tracks.length ? buildMusicMap(tracks, profile, { rootLabel: `${target.displayName}’s Music Mind`, maxTracks: 200 }) : null,
      playlists,
      memberships,
    });
  })
  .get('/compare/:handle', (c) => {
    const viewer = requireUser(c);
    const { db, config } = c.get('ctx');
    const target = userByHandle(db, c.req.param('handle'));
    if (!target || target.id === viewer.id || target.isDemo === 1 || blockedEitherWay(db, viewer.id, target.id)) throw new ApiError(404, 'not_found', 'Listener not found.');
    const visible = profileVisible(db, viewer, target);
    if (!target.discoverable && !visible) throw new ApiError(403, 'not_comparable', 'This listener has not made their profile discoverable or visible to you.');
    const mine = readProfile(db, viewer.id, 'all');
    const theirs = readProfile(db, target.id, 'shared');
    if (!mine || mine.trackCount === 0) throw new ApiError(409, 'no_library', 'Import some music first to compare profiles.');
    if (!theirs || theirs.trackCount === 0) throw new ApiError(409, 'no_shared_library', 'This listener has not shared any playlists for matching yet.');
    const match = compareVectors(mine.vector, theirs.vector, { weights: config.matchWeights, population: populationFor(db, [mine.vector, theirs.vector]) });
    // Names are revealed only for items in the other person's *public* playlists.
    const publicTracks = visible ? loadLibraryTracks(db, target.id, 'public').tracks : [];
    const publicVector = buildMatchVector(publicTracks);
    const mineAll = loadLibraryTracks(db, viewer.id, 'all').tracks;
    const artistNames: Record<string, string> = {};
    const trackNames: Record<string, string> = {};
    for (const t of mineAll) {
      if (publicVector.tracks[t.id]) trackNames[t.id] = `${t.title} — ${t.artists[0]?.name ?? ''}`;
      for (const a of t.artists) if (publicVector.artists[a.id]) artistNames[a.id] = a.name;
    }
    const sharedPublic = {
      artists: Object.entries(artistNames).map(([id, name]) => ({ id, name })).slice(0, 30),
      tracks: Object.entries(trackNames).map(([id, label]) => ({ id, label })).slice(0, 30),
    };
    const theirFamilies = visible ? computeProfile(publicTracks).families : theirs.profile.families;
    return c.json({
      target: { handle: target.handle, displayName: target.displayName, isDemo: target.isDemo === 2, profileVisible: visible },
      match: { ...match, components: match.components.map((x) => ({ ...x, topShared: x.key === 'genres' ? x.topShared : [] })) },
      explanation: explainMatch(match, { artists: artistNames, tracks: trackNames }, target.displayName),
      sharedPublic,
      families: {
        mine: mine.profile.families.map((f) => ({ family: f.family, label: FAMILY_LABELS[f.family as Family] ?? f.family, share: f.share })),
        theirs: theirFamilies.map((f) => ({ family: f.family, label: FAMILY_LABELS[f.family as Family] ?? f.family, share: f.share })),
      },
      note: visible
        ? 'Shared artists and tracks are listed only from their public playlists; the score also uses playlists they shared for matching.'
        : 'Their profile is not visible to you, so only the score and its components are shown.',
    });
  })
  .get('/discover', (c) => {
    const viewer = requireUser(c);
    const { db } = c.get('ctx');
    const q = normalizeText(c.req.query('q') ?? '');
    if (q.length < 2) return c.json({ trees: [], listeners: [], library: [] });
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const trees = all<CommunityRow>(db, "SELECT * FROM communities WHERE status = 'active'")
      .filter((r) => normalizeText(`${r.name} ${r.description} ${r.profile_json ?? ''}`).includes(q))
      .slice(0, 12)
      .map((r) => communitySummary(r, viewer.id, db));
    const listeners = all<{ id: string; handle: string; display_name: string; is_demo: number }>(
      db,
      `SELECT DISTINCT u.id, u.handle, u.display_name, u.is_demo FROM users u
       WHERE u.profile_visibility = 'public' AND u.is_demo != 1 AND u.id != ?
         AND (u.handle LIKE ? OR u.display_name LIKE ? OR EXISTS (
           SELECT 1 FROM playlists p JOIN playlist_tracks pt ON pt.playlist_id = p.id JOIN tracks t ON t.id = pt.track_id
           JOIN artists a ON a.id = t.primary_artist_id
           WHERE p.user_id = u.id AND p.visibility = 'public' AND pt.hidden = 0
             AND (a.normalized_name LIKE ? OR t.normalized_title LIKE ? OR EXISTS (
               SELECT 1 FROM track_genres tg JOIN genres g ON g.id = tg.genre_id WHERE tg.track_id = t.id AND g.name LIKE ?))))
       LIMIT 20`,
      [viewer.id, like, like, like, like, like],
    )
      .filter((u) => !blockedEitherWay(db, viewer.id, u.id))
      .map((u) => ({ handle: u.handle, displayName: u.display_name, isDemo: u.is_demo === 2 }));
    const library = all<{ id: string; title: string; artist: string }>(
      db,
      `SELECT t.id, t.title, a.name AS artist FROM tracks t JOIN artists a ON a.id = t.primary_artist_id
       WHERE t.id IN (SELECT pt.track_id FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE p.user_id = ?)
         AND (t.normalized_title LIKE ? OR a.normalized_name LIKE ?) LIMIT 10`,
      [viewer.id, like, like],
    );
    return c.json({ trees, listeners, library });
  })
  .get('/discover/listeners', (c) => {
    const viewer = requireUser(c);
    const { db, config } = c.get('ctx');
    if (!viewer.discoverable) {
      return c.json({ listeners: [], requiresDiscoverable: true, reason: 'Turn on “Discoverable” in Privacy to see similar listeners. Discovery is reciprocal.' });
    }
    const list = compatibleListeners(db, viewer.id, config.matchWeights, 0.15, 30).map((l) => ({
      handle: l.handle,
      displayName: l.displayName,
      isDemo: l.isDemo,
      profileVisible: l.profileVisibility === 'public' || (l.profileVisibility === 'members' && shareTree(db, viewer.id, l.userId)),
      match: { score: l.match.score, label: l.match.label, components: l.match.components.map((x) => ({ key: x.key, label: x.label, score: x.score, available: x.available, sharedCount: x.sharedCount })) },
      explanation: explainMatch(l.match, {}, l.displayName).summary,
    }));
    return c.json({ listeners: list, requiresDiscoverable: false });
  })

  // --------------------------------------------------------------- safety
  .get('/blocks', (c) => {
    const user = requireUser(c);
    return c.json({
      blocks: all(
        c.get('ctx').db,
        'SELECT u.handle, u.display_name AS displayName, b.kind, b.created_at AS createdAt FROM blocks b JOIN users u ON u.id = b.target_user_id WHERE b.user_id = ? ORDER BY b.created_at DESC',
        [user.id],
      ),
    });
  })
  .post('/blocks', async (c) => {
    const user = requireUser(c);
    const { db } = c.get('ctx');
    const body = z.object({ handle: z.string().max(40), kind: z.enum(['block', 'mute']).default('block') }).parse(await c.req.json());
    const target = userByHandle(db, body.handle);
    if (!target || target.id === user.id) throw new ApiError(404, 'not_found', 'Listener not found.');
    run(db, 'INSERT OR IGNORE INTO blocks (user_id, target_user_id, kind, created_at) VALUES (?, ?, ?, ?)', [user.id, target.id, body.kind, nowIso()]);
    return c.json({ ok: true }, 201);
  })
  .delete('/blocks/:handle', (c) => {
    const user = requireUser(c);
    const { db } = c.get('ctx');
    const target = userByHandle(db, c.req.param('handle'));
    if (!target) throw new ApiError(404, 'not_found', 'Listener not found.');
    const kind = c.req.query('kind');
    run(db, `DELETE FROM blocks WHERE user_id = ? AND target_user_id = ? ${kind ? 'AND kind = ?' : ''}`, kind ? [user.id, target.id, kind] : [user.id, target.id]);
    return c.json({ ok: true });
  })
  .post('/reports', async (c) => {
    const user = requireUser(c);
    rateLimit(c, `report:${user.id}`, LIMITS.reports);
    const { db, hub } = c.get('ctx');
    const body = z
      .object({
        targetType: z.enum(['message', 'user', 'community']),
        targetId: z.string().max(60),
        reason: z.enum(['spam', 'harassment', 'hate', 'sexual', 'self_harm', 'copyright', 'other']),
        details: z.string().max(500).optional(),
      })
      .parse(await c.req.json());
    let targetId = body.targetId;
    if (body.targetType === 'user') {
      const u = userByHandle(db, body.targetId) ?? null;
      if (!u) throw new ApiError(404, 'not_found', 'Listener not found.');
      targetId = u.id;
    }
    if (body.targetType === 'community') targetId = getCommunity(db, body.targetId)?.id ?? body.targetId;
    const result = chatErrors(() => fileReport(db, user.id, { type: body.targetType, id: targetId }, body.reason, body.details ?? null));
    if (result.autoHidden) {
      const m = get<{ community_id: string }>(db, 'SELECT community_id FROM community_messages WHERE id = ?', [Number(targetId)]);
      if (m) hub.broadcastRemoved(m.community_id, Number(targetId), 'hidden');
    }
    return c.json(result, 201);
  })
  .get('/moderation/reports', (c) => {
    const user = requireUser(c);
    const { db, config } = c.get('ctx');
    const isAdmin = config.adminHandles.includes(user.handle);
    const rows = all<{ id: string; target_type: string; target_id: string; reason: string; details: string | null; status: string; created_at: string; community_id: string | null; body: string | null; author: string | null }>(
      db,
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at, m.community_id, m.body, u.handle AS author
       FROM reports r LEFT JOIN community_messages m ON r.target_type = 'message' AND m.id = CAST(r.target_id AS INTEGER)
       LEFT JOIN users u ON u.id = m.user_id
       WHERE r.status = 'open' ${isAdmin ? '' : "AND r.target_type = 'message' AND m.community_id IN (SELECT community_id FROM community_memberships WHERE user_id = ? AND role = 'moderator')"}
       ORDER BY r.created_at DESC LIMIT 100`,
      isAdmin ? [] : [user.id],
    );
    return c.json({ reports: rows, scope: isAdmin ? 'all' : 'moderated-trees' });
  })
  .post('/moderation/reports/:id', async (c) => {
    const user = requireUser(c);
    const { db, config, hub } = c.get('ctx');
    const { action } = z.object({ action: z.enum(['hide', 'restore', 'dismiss']) }).parse(await c.req.json());
    const report = get<{ id: string; target_type: string; target_id: string }>(db, 'SELECT id, target_type, target_id FROM reports WHERE id = ?', [c.req.param('id')]);
    if (!report) throw new ApiError(404, 'not_found', 'Report not found.');
    const isAdmin = config.adminHandles.includes(user.handle);
    let communityId: string | null = null;
    if (report.target_type === 'message') {
      communityId = get<{ community_id: string }>(db, 'SELECT community_id FROM community_messages WHERE id = ?', [Number(report.target_id)])?.community_id ?? null;
    }
    const canModerate = isAdmin || (communityId && isMember(db, communityId, user.id)?.role === 'moderator');
    if (!canModerate) throw new ApiError(403, 'forbidden', 'You cannot moderate this report.');
    if (report.target_type === 'message' && communityId) {
      if (action === 'hide') {
        hideMessage(db, communityId, Number(report.target_id), `hidden by moderator ${user.handle}`);
        hub.broadcastRemoved(communityId, Number(report.target_id), 'hidden');
      }
      if (action === 'restore') run(db, 'UPDATE community_messages SET hidden = 0, hidden_reason = NULL WHERE id = ?', [Number(report.target_id)]);
    }
    run(db, "UPDATE reports SET status = ? WHERE target_type = ? AND target_id = ? AND status = 'open'", [
      action === 'dismiss' || action === 'restore' ? 'dismissed' : 'actioned', report.target_type, report.target_id,
    ]);
    return c.json({ ok: true });
  })

  // ---------------------------------------------------------------- calls
  .get('/calls/config', (c) => {
    requireUser(c);
    const { hub } = c.get('ctx');
    const cfg = hub.callConfig();
    return c.json({
      ...cfg,
      limitations: [
        '1:1 calls between members of a shared Tree only; group calls are not offered.',
        cfg.hasTurn
          ? 'A TURN relay is configured for restrictive networks.'
          : 'No TURN relay is configured, so calls may fail on strict NATs, mobile carriers and corporate networks (STUN only).',
        'Media is peer-to-peer and never recorded or stored by SOMM.',
      ],
    });
  });
