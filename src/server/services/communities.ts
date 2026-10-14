/**
 * Trees (communities): aggregates, recommendations, creation, membership,
 * name proposals and cluster-based proposals.
 *
 * Privacy rules enforced here:
 * - Aggregates use members' *shared* scope only; private playlists never contribute.
 * - Displayed artists must be held by at least K_ANONYMITY members (and only once
 *   MIN_CONTRIBUTORS_FOR_ARTISTS members contribute), so a Tree page never reveals
 *   what one individual listens to.
 * - Explanations name a shared artist only if it is already in that public list.
 */
import {
  aggregateVectors,
  clusterProfiles,
  CLUSTER_THRESHOLD,
  explainMatch,
  K_ANONYMITY,
  labelTree,
  MIN_CONTRIBUTORS_FOR_ARTISTS,
  MIN_TREE_MEMBERS,
} from '../../shared/analysis/communities';
import { buildAggregateMap, type MusicMap } from '../../shared/analysis/map';
import { compareVectors, type MatchResult, type MatchWeights } from '../../shared/analysis/similarity';
import { cleanDisplayText, slugify } from '../../shared/normalize';
import { FAMILY_COLORS, FAMILY_LABELS, genreDisplayName, genreFamily, type Family } from '../../shared/taxonomy';
import type { MatchVector } from '../../shared/types';
import { all, get, newId, nowIso, run, tx, type DB } from '../db';
import { populationFor, readProfile } from './library';

export interface CommunityDisplayProfile {
  memberCount: number;
  contributingMembers: number;
  trackCount: number;
  families: { family: string; label: string; share: number }[];
  genres: { name: string; label: string; family: string; share: number; members: number }[];
  artists: { id: string; name: string; members: number; genre: string | null; family: string | null }[];
  kAnonymity: number;
  note: string | null;
}

export interface CommunityRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: 'proposed' | 'active' | 'archived';
  origin: 'cluster' | 'member';
  created_by: string | null;
  color: string;
  glyph_seed: string;
  profile_json: string | null;
  vector_json: string | null;
  member_count: number;
  candidate_ids: string | null;
  is_demo: number;
  created_at: string;
  updated_at: string;
}

export function getCommunity(db: DB, slugOrId: string): Promise<CommunityRow | undefined> {
  return get<CommunityRow>(db, 'SELECT * FROM communities WHERE slug = ? OR id = ?', [slugOrId, slugOrId]);
}

export function isMember(db: DB, communityId: string, userId: string): Promise<{ role: 'moderator' | 'member' } | undefined> {
  return get<{ role: 'moderator' | 'member' }>(db, 'SELECT role FROM community_memberships WHERE community_id = ? AND user_id = ?', [communityId, userId]);
}

async function sharedVector(db: DB, userId: string): Promise<MatchVector | null> {
  const p = await readProfile(db, userId, 'shared');
  return p && p.trackCount > 0 ? p.vector : null;
}

async function sharedVectors(db: DB, userIds: string[]): Promise<MatchVector[]> {
  return (await Promise.all(userIds.map((id) => sharedVector(db, id)))).filter((v): v is MatchVector => v !== null);
}

function emptyVector(): MatchVector {
  return { tracks: {}, artists: {}, genres: {}, attributes: {}, attributeEvidence: 0, text: {}, trackCount: 0, genreTrackCount: 0 };
}

/** Recompute a Tree's aggregate vector and its k-anonymised display profile. */
export async function recomputeCommunity(db: DB, communityId: string): Promise<void> {
  const members = (await all<{ user_id: string }>(db, 'SELECT user_id FROM community_memberships WHERE community_id = ?', [communityId])).map((m) => m.user_id);
  const vectors = await sharedVectors(db, members);
  const community = await get<CommunityRow>(db, 'SELECT * FROM communities WHERE id = ?', [communityId]);
  if (!community) return;
  // A proposed Tree with no contributing members keeps its seed vector (the cluster it came from).
  const aggregate = vectors.length > 0 ? aggregateVectors(vectors) : community.vector_json ? (JSON.parse(community.vector_json) as MatchVector) : emptyVector();
  const n = vectors.length;

  const families = Object.entries(aggregate.genres)
    .filter(([k]) => k.startsWith('family:'))
    .map(([k, v]) => ({ family: k.slice(7), v }));
  const familyTotal = families.reduce((s, f) => s + f.v, 0) || 1;
  const memberCounts = (key: string, pick: (v: MatchVector) => Record<string, number>) => vectors.filter((v) => (pick(v)[key] ?? 0) > 0).length;

  const genres = Object.entries(aggregate.genres)
    .filter(([k]) => !k.startsWith('family:'))
    .map(([name, v]) => ({ name, v, members: memberCounts(name, (x) => x.genres) }))
    // Genres are broad, so they may be shown for small Trees; seed-only proposals (n = 0) show the cluster's genres.
    .filter((g) => n === 0 || g.members >= Math.min(K_ANONYMITY, n))
    .sort((a, b) => b.v - a.v || a.name.localeCompare(b.name))
    .slice(0, 15);
  const genreTotal = Object.entries(aggregate.genres).filter(([k]) => !k.startsWith('family:')).reduce((s, [, v]) => s + v, 0) || 1;

  const artistIds = Object.entries(aggregate.artists)
    .map(([id, frac]) => ({ id, members: Math.round(frac * n) }))
    .filter((a) => n >= MIN_CONTRIBUTORS_FOR_ARTISTS && a.members >= K_ANONYMITY)
    .sort((a, b) => b.members - a.members || a.id.localeCompare(b.id))
    .slice(0, 30);
  const artists = await Promise.all(
    artistIds.map(async (a) => {
      const name = (await get<{ name: string }>(db, 'SELECT name FROM artists WHERE id = ?', [a.id]))?.name ?? 'Unknown artist';
      const g = await get<{ name: string; family: string }>(
        db,
        `SELECT g.name, g.family FROM track_genres tg JOIN genres g ON g.id = tg.genre_id JOIN tracks t ON t.id = tg.track_id
         WHERE t.primary_artist_id = ? GROUP BY g.id ORDER BY COUNT(*) DESC, g.name LIMIT 1`,
        [a.id],
      );
      return { id: a.id, name, members: a.members, genre: g?.name ?? null, family: g?.family ?? null };
    }),
  );

  const display: CommunityDisplayProfile = {
    memberCount: members.length,
    contributingMembers: n,
    trackCount: Object.keys(aggregate.tracks).length,
    families: families
      .map((f) => ({ family: f.family, label: FAMILY_LABELS[f.family as Family] ?? f.family, share: Math.round((f.v / familyTotal) * 1000) / 1000 }))
      .sort((a, b) => b.share - a.share || a.family.localeCompare(b.family)),
    genres: genres.map((g) => ({
      name: g.name,
      label: genreDisplayName(g.name),
      family: genreFamily(g.name),
      share: Math.round((g.v / genreTotal) * 1000) / 1000,
      members: g.members,
    })),
    artists,
    kAnonymity: K_ANONYMITY,
    note:
      n < MIN_CONTRIBUTORS_FOR_ARTISTS
        ? `Shared artists appear once at least ${MIN_CONTRIBUTORS_FOR_ARTISTS} members contribute shared playlists (and then only artists held by ${K_ANONYMITY}+ members), so no individual library is exposed.`
        : null,
  };
  const lead = display.families[0]?.family as Family | undefined;
  await run(db, 'UPDATE communities SET profile_json = ?, vector_json = ?, member_count = ?, color = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(display),
    JSON.stringify(aggregate),
    members.length,
    lead ? FAMILY_COLORS[lead] ?? community.color : community.color,
    nowIso(),
    communityId,
  ]);
}

export function communityMap(row: CommunityRow): MusicMap | null {
  if (!row.profile_json) return null;
  const p = JSON.parse(row.profile_json) as CommunityDisplayProfile;
  if (p.genres.length === 0 && p.artists.length === 0) return null;
  return buildAggregateMap(
    {
      families: p.families.map((f) => ({ family: f.family, trackCount: Math.max(1, Math.round(f.share * 100)) })),
      genres: p.genres.map((g) => ({ name: g.name, family: g.family, trackCount: Math.max(1, Math.round(g.share * 100)) })),
      artists: p.artists.map((a) => ({ id: a.id, name: a.name, genre: a.genre, family: a.family, weight: a.members })),
    },
    row.name,
  );
}

export interface TreeMatch {
  community: { id: string; slug: string; name: string; description: string; status: string; memberCount: number; color: string; isDemo: boolean };
  match: MatchResult;
  explanation: { summary: string; points: string[] };
  isMember: boolean;
}

async function artistNameMap(db: DB, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of ids.slice(0, 20)) {
    const r = await get<{ name: string }>(db, 'SELECT name FROM artists WHERE id = ?', [id]);
    if (r) out[id] = r.name;
  }
  return out;
}

/**
 * A Tree's aggregate without one member's contribution. Members are compared with
 * everyone *else* in the Tree; otherwise their own playlists would inflate their score.
 */
export async function aggregateExcluding(db: DB, communityId: string, userId: string): Promise<MatchVector | null> {
  const others = await all<{ user_id: string }>(db, 'SELECT user_id FROM community_memberships WHERE community_id = ? AND user_id <> ?', [communityId, userId]);
  const vectors = await sharedVectors(db, others.map((m) => m.user_id));
  return vectors.length ? aggregateVectors(vectors) : null;
}

/** Rank Trees for a user using their full ('all') profile — visible only to that user. */
export async function recommendTrees(db: DB, userId: string, weights: MatchWeights, limit = 12): Promise<TreeMatch[]> {
  const mine = await readProfile(db, userId, 'all');
  if (!mine || mine.trackCount === 0) return [];
  const rows = await all<CommunityRow>(db, "SELECT * FROM communities WHERE status IN ('active', 'proposed') AND vector_json IS NOT NULL");
  const visible = rows.filter((r) => r.status === 'active' || (r.candidate_ids ? (JSON.parse(r.candidate_ids) as string[]).includes(userId) : false));
  const population = await populationFor(db, [mine.vector]);
  const memberships = new Set((await all<{ community_id: string }>(db, 'SELECT community_id FROM community_memberships WHERE user_id = ?', [userId])).map((m) => m.community_id));
  const results: TreeMatch[] = [];
  for (const r of visible) {
    const vector = (memberships.has(r.id) ? await aggregateExcluding(db, r.id, userId) : null) ?? (JSON.parse(r.vector_json!) as MatchVector);
    const match = compareVectors(mine.vector, vector, { weights, population });
    const display = r.profile_json ? (JSON.parse(r.profile_json) as CommunityDisplayProfile) : null;
    const publicArtists = new Set(display?.artists.map((a) => a.id) ?? []);
    const artistsComponent = match.components.find((c) => c.key === 'artists');
    const nameable = (artistsComponent?.topShared ?? []).filter((id) => publicArtists.has(id));
    const explanation = explainMatch(match, { artists: await artistNameMap(db, nameable) }, r.name);
    // Track IDs are never named for Trees; only counts are shown.
    results.push({
      community: {
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        status: r.status,
        memberCount: r.member_count,
        color: r.color,
        isDemo: r.is_demo === 1,
      },
      match: { ...match, components: match.components.map((c) => ({ ...c, topShared: c.key === 'genres' || c.key === 'attributes' ? c.topShared : [] })) },
      explanation,
      isMember: memberships.has(r.id),
    });
  }
  return results.sort((a, b) => b.match.score - a.match.score || a.community.name.localeCompare(b.community.name)).slice(0, limit);
}

/** Discoverable listeners compatible with `userId` (candidate generation via the inverted indexes). */
export async function compatibleListeners(db: DB, userId: string, weights: MatchWeights, threshold = CLUSTER_THRESHOLD, limit = 50) {
  const mine = await readProfile(db, userId, 'all');
  if (!mine || mine.trackCount === 0) return [];
  const artistIds = Object.keys(mine.vector.artists);
  const genreKeys = Object.keys(mine.vector.genres).filter((k) => !k.startsWith('family:'));
  const candidates = new Set<string>();
  const pick = async (sql: string, keys: string[]) => {
    for (let i = 0; i < keys.length; i += 400) {
      const part = keys.slice(i, i + 400);
      for (const r of await all<{ user_id: string }>(db, sql.replace('%IN%', part.map(() => '?').join(',')), part)) candidates.add(r.user_id);
    }
  };
  await pick('SELECT DISTINCT user_id FROM profile_artists WHERE artist_id IN (%IN%)', artistIds);
  await pick('SELECT DISTINCT user_id FROM profile_genres WHERE genre_key IN (%IN%)', genreKeys);
  candidates.delete(userId);
  const blocked = new Set(
    (
      await all<{ other: string }>(
        db,
        "SELECT target_user_id AS other FROM blocks WHERE user_id = ? AND kind = 'block' UNION SELECT user_id AS other FROM blocks WHERE target_user_id = ? AND kind = 'block'",
        [userId, userId],
      )
    ).map((r) => r.other),
  );
  const out: { userId: string; handle: string; displayName: string; isDemo: boolean; profileVisibility: string; match: MatchResult }[] = [];
  const others: { id: string; vector: MatchVector; handle: string; display_name: string; is_demo: number; profile_visibility: string }[] = [];
  for (const id of [...candidates].sort()) {
    if (blocked.has(id)) continue;
    const u = await get<{ handle: string; display_name: string; discoverable: number; is_demo: number; profile_visibility: string }>(
      db,
      'SELECT handle, display_name, discoverable, is_demo, profile_visibility FROM users WHERE id = ?',
      [id],
    );
    if (!u || u.discoverable !== 1) continue;
    const v = await sharedVector(db, id);
    if (!v) continue;
    others.push({ id, vector: v, ...u });
  }
  const population = await populationFor(db, [mine.vector]);
  for (const o of others) {
    const match = compareVectors(mine.vector, o.vector, { weights, population });
    if (match.score >= threshold) {
      out.push({ userId: o.id, handle: o.handle, displayName: o.display_name, isDemo: o.is_demo === 2, profileVisibility: o.profile_visibility, match });
    }
  }
  return out.sort((a, b) => b.match.score - a.match.score || a.handle.localeCompare(b.handle)).slice(0, limit);
}

export async function creationEligibility(db: DB, userId: string, weights: MatchWeights) {
  const compatible = await compatibleListeners(db, userId, weights);
  const needed = MIN_TREE_MEMBERS - 1;
  return {
    eligible: compatible.length >= needed,
    compatibleCount: compatible.length,
    needed,
    threshold: CLUSTER_THRESHOLD,
    reason:
      compatible.length >= needed
        ? `${compatible.length} discoverable listener${compatible.length === 1 ? ' is' : 's are'} compatible with you (score ≥ ${CLUSTER_THRESHOLD}).`
        : `A new Tree needs at least ${needed} other discoverable listeners with a match score of ${CLUSTER_THRESHOLD} or more; ${compatible.length} found so far. Join an existing Tree instead, or check back as more people arrive.`,
    candidateIds: compatible.map((c) => c.userId),
  };
}

async function uniqueSlug(db: DB, name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; await get(db, 'SELECT 1 FROM communities WHERE slug = ?', [slug]); i++) slug = `${base}-${i}`;
  return slug;
}

export function validateTreeName(raw: string): string {
  const name = cleanDisplayText(raw, 60);
  if (name.length < 3) throw new Error('Tree names need at least 3 characters.');
  if (!/[\p{L}\p{N}]/u.test(name)) throw new Error('Tree names need letters or numbers.');
  return name;
}

export async function createCommunity(
  db: DB,
  opts: { name: string; description: string; createdBy: string | null; origin: 'cluster' | 'member'; status: 'proposed' | 'active'; seedVector?: MatchVector; candidateIds?: string[]; isDemo?: boolean },
): Promise<CommunityRow> {
  const id = newId();
  const name = validateTreeName(opts.name);
  const now = nowIso();
  const lead = opts.seedVector ? labelTree(opts.seedVector).topFamilies[0] : undefined;
  await tx(db, async () => {
    await run(
      db,
      `INSERT INTO communities (id, slug, name, description, status, origin, created_by, color, glyph_seed, vector_json, member_count, candidate_ids, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        id, await uniqueSlug(db, name), name, cleanDisplayText(opts.description, 280), opts.status, opts.origin, opts.createdBy,
        lead ? FAMILY_COLORS[lead as Family] ?? '#1747FF' : '#1747FF', id, opts.seedVector ? JSON.stringify(opts.seedVector) : null,
        opts.candidateIds ? JSON.stringify(opts.candidateIds) : null, opts.isDemo ? 1 : 0, now, now,
      ],
    );
    if (opts.createdBy) {
      await run(db, "INSERT INTO community_memberships (community_id, user_id, role, joined_at) VALUES (?, ?, 'moderator', ?)", [id, opts.createdBy, now]);
    }
  });
  await recomputeCommunity(db, id);
  return (await getCommunity(db, id))!;
}

export async function joinCommunity(db: DB, communityId: string, userId: string): Promise<void> {
  const c = await get<CommunityRow>(db, 'SELECT * FROM communities WHERE id = ?', [communityId]);
  if (!c || c.status === 'archived') throw new Error('This Tree is not open for new members.');
  if (c.status === 'proposed') {
    const candidates = c.candidate_ids ? (JSON.parse(c.candidate_ids) as string[]) : [];
    if (!candidates.includes(userId)) throw new Error('This Tree is still forming and is only open to the listeners it was proposed for.');
  }
  await run(db, "INSERT INTO community_memberships (community_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?) ON CONFLICT DO NOTHING", [communityId, userId, nowIso()]);
  const count = (await get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM community_memberships WHERE community_id = ?', [communityId]))!.n;
  // A proposed Tree becomes public once two people have actually joined.
  if (c.status === 'proposed' && count >= 2) await run(db, "UPDATE communities SET status = 'active' WHERE id = ?", [communityId]);
  await recomputeCommunity(db, communityId);
}

export async function leaveCommunity(db: DB, communityId: string, userId: string): Promise<void> {
  await run(db, 'DELETE FROM community_memberships WHERE community_id = ? AND user_id = ?', [communityId, userId]);
  const c = await get<CommunityRow>(db, 'SELECT * FROM communities WHERE id = ?', [communityId]);
  if (!c) return;
  const count = (await get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM community_memberships WHERE community_id = ?', [communityId]))!.n;
  if (count === 0) {
    // Avoid lingering empty communities: member-created Trees archive; cluster Trees go back to "proposed".
    await run(db, 'UPDATE communities SET status = ? WHERE id = ?', [c.origin === 'member' ? 'archived' : 'proposed', communityId]);
  } else if (!(await get(db, "SELECT 1 FROM community_memberships WHERE community_id = ? AND role = 'moderator'", [communityId]))) {
    // Hand moderation to the longest-standing member.
    await run(
      db,
      "UPDATE community_memberships SET role = 'moderator' WHERE community_id = ? AND user_id = (SELECT user_id FROM community_memberships WHERE community_id = ? ORDER BY joined_at LIMIT 1)",
      [communityId, communityId],
    );
  }
  await recomputeCommunity(db, communityId);
}

export async function relatedCommunities(db: DB, row: CommunityRow, weights: MatchWeights, limit = 4) {
  if (!row.vector_json) return [];
  const mine = JSON.parse(row.vector_json) as MatchVector;
  return (await all<CommunityRow>(db, "SELECT * FROM communities WHERE status = 'active' AND id <> ? AND vector_json IS NOT NULL", [row.id]))
    .map((o) => ({ row: o, score: compareVectors(mine, JSON.parse(o.vector_json!) as MatchVector, { weights }).score }))
    .filter((x) => x.score > 0.05)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
    .slice(0, limit)
    .map((x) => ({ slug: x.row.slug, name: x.row.name, color: x.row.color, memberCount: x.row.member_count, score: x.score }));
}

/**
 * Cluster discoverable listeners into proposed Trees. Users already well served
 * by an existing Tree are skipped, and clusters close to an existing Tree are
 * added to that Tree's candidates instead of creating a near-duplicate.
 */
export async function generateProposals(db: DB, weights: MatchWeights, options: { minSize?: number; isDemo?: boolean } = {}) {
  const users = await all<{ id: string }>(
    db,
    "SELECT u.id FROM users u JOIN music_profiles m ON m.user_id = u.id AND m.scope = 'shared' WHERE u.discoverable = 1 AND m.track_count > 0 ORDER BY u.id",
  );
  const inputs: { id: string; vector: MatchVector }[] = [];
  for (const u of users) {
    const vector = await sharedVector(db, u.id);
    if (vector) inputs.push({ id: u.id, vector });
  }
  const population = await populationFor(db, inputs.map((i) => i.vector));
  const existing = await all<CommunityRow>(db, "SELECT * FROM communities WHERE status IN ('active', 'proposed') AND vector_json IS NOT NULL");
  const served = new Set<string>();
  for (const input of inputs) {
    for (const c of existing) {
      if (compareVectors(input.vector, JSON.parse(c.vector_json!) as MatchVector, { weights, population }).score >= 0.35) served.add(input.id);
    }
  }
  const clusters = clusterProfiles(inputs.filter((i) => !served.has(i.id)), { weights, population, minSize: options.minSize });
  const created: string[] = [];
  const extended: string[] = [];
  for (const cluster of clusters) {
    const aggregate = aggregateVectors(cluster.memberIds.map((id) => inputs.find((i) => i.id === id)!.vector));
    const near = existing.find((c) => compareVectors(aggregate, JSON.parse(c.vector_json!) as MatchVector, { weights }).score >= 0.6);
    if (near) {
      const ids = new Set([...(near.candidate_ids ? (JSON.parse(near.candidate_ids) as string[]) : []), ...cluster.memberIds]);
      await run(db, 'UPDATE communities SET candidate_ids = ?, updated_at = ? WHERE id = ?', [JSON.stringify([...ids]), nowIso(), near.id]);
      extended.push(near.id);
      continue;
    }
    const label = labelTree(aggregate);
    const row = await createCommunity(db, {
      name: label.name,
      description: `${label.description} Proposed from ${cluster.memberIds.length} compatible listeners (cohesion ${cluster.cohesion.toFixed(2)}).`,
      createdBy: null,
      origin: 'cluster',
      status: 'proposed',
      seedVector: aggregate,
      candidateIds: cluster.memberIds,
      isDemo: options.isDemo,
    });
    created.push(row.id);
    existing.push(row);
  }
  return { created, extended, clusters: clusters.length };
}

export async function proposeName(db: DB, communityId: string, userId: string, rawName: string): Promise<string> {
  const name = validateTreeName(rawName);
  const id = newId();
  await run(db, 'INSERT INTO community_name_proposals (id, community_id, user_id, name, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (community_id, name) DO NOTHING', [
    id, communityId, userId, name, nowIso(),
  ]);
  const row = (await get<{ id: string }>(db, 'SELECT id FROM community_name_proposals WHERE community_id = ? AND name = ?', [communityId, name]))!;
  await voteName(db, communityId, row.id, userId);
  return row.id;
}

/** A proposal that wins votes from a majority of members (minimum 2) becomes the Tree's name. */
export async function voteName(db: DB, communityId: string, proposalId: string, userId: string): Promise<{ renamed: boolean }> {
  const proposal = await get<{ id: string; name: string }>(db, 'SELECT id, name FROM community_name_proposals WHERE id = ? AND community_id = ?', [proposalId, communityId]);
  if (!proposal) throw new Error('Unknown name proposal.');
  return tx(db, async () => {
    // One vote per member per Tree: remove the member's other votes first.
    await run(
      db,
      'DELETE FROM community_name_votes WHERE user_id = ? AND proposal_id IN (SELECT id FROM community_name_proposals WHERE community_id = ?)',
      [userId, communityId],
    );
    await run(db, 'INSERT INTO community_name_votes (proposal_id, user_id, created_at) VALUES (?, ?, ?)', [proposalId, userId, nowIso()]);
    const votes = (await get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM community_name_votes WHERE proposal_id = ?', [proposalId]))!.n;
    const members = (await get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM community_memberships WHERE community_id = ?', [communityId]))!.n;
    if (votes >= 2 && votes > members / 2) {
      await run(db, 'UPDATE communities SET name = ?, updated_at = ? WHERE id = ?', [proposal.name, nowIso(), communityId]);
      return { renamed: true };
    }
    return { renamed: false };
  });
}

export async function nameProposals(db: DB, communityId: string, viewerId: string | null) {
  return (
    await all<{ id: string; name: string; votes: number; mine: number | null; created_at: string }>(
      db,
      `SELECT p.id, p.name, p.created_at, COUNT(v.user_id) AS votes, SUM(CASE WHEN v.user_id = ? THEN 1 ELSE 0 END) AS mine
       FROM community_name_proposals p LEFT JOIN community_name_votes v ON v.proposal_id = p.id
       WHERE p.community_id = ? GROUP BY p.id ORDER BY votes DESC, p.created_at`,
      [viewerId ?? '', communityId],
    )
  ).map((p) => ({ id: p.id, name: p.name, votes: p.votes, votedByMe: (p.mine ?? 0) > 0 }));
}

/** Recompute every Tree a user belongs to (after their shared profile changed). */
export async function recomputeUserCommunities(db: DB, userId: string): Promise<void> {
  for (const m of await all<{ community_id: string }>(db, 'SELECT community_id FROM community_memberships WHERE user_id = ?', [userId])) {
    await recomputeCommunity(db, m.community_id);
  }
}
