/**
 * Opt-in demo seeding (`npm run seed:demo`). Creates fictional listeners with
 * fictional playlists, lets the real clustering code propose Trees from them,
 * has the demo listeners join, and adds a few clearly fictional chat messages.
 *
 * Demo listeners: is_demo = 2, no password (cannot sign in), discoverable,
 * public profiles, and shown with a "Fictional demo listener" badge.
 */
import { all, get, newId, nowIso, run, tx, type DB, type Param } from '../db';
import type { AppConfig } from '../config';
import { classifyEntries, ensureGenre, resolveTrack } from '../catalog';
import type { RawEntry } from '../import/types';
import { generateProposals, joinCommunity } from '../services/communities';
import { insertMany, recomputeProfile } from '../services/library';
import { pruneOrphans } from '../services/accounts';
import { LISTENERS, listenerTracks } from '../../shared/demoCatalog';

const MESSAGES = [
  'Fictional demo message: this Tree’s shared map is mostly {genre} — what should we listen to next?',
  'Demo note: anyone else keep coming back to {artist}?',
  'Demo note: adding a {genre} deep cut to the shared map this week.',
];

export async function resetDemo(db: DB): Promise<void> {
  await tx(db, async () => {
    await run(db, 'DELETE FROM communities WHERE is_demo = 1');
    await run(db, 'DELETE FROM users WHERE is_demo = 2');
  });
  await pruneOrphans(db);
}

export async function seedDemo(db: DB, config: AppConfig, options: { reset?: boolean } = {}) {
  if (options.reset) await resetDemo(db);
  const existing = (await get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM users WHERE is_demo = 2'))!.n;
  if (existing > 0) return { listeners: 0, trees: 0, skipped: true };

  const ids: string[] = [];
  for (const [index, l] of LISTENERS.entries()) {
    const id = newId();
    ids.push(id);
    const tracks = listenerTracks(l, index);
    await tx(db, async () => {
      await run(
        db,
        `INSERT INTO users (id, handle, display_name, password_hash, is_demo, bio, profile_visibility, discoverable, show_memberships, onboarded, created_at)
         VALUES (?, ?, ?, NULL, 2, ?, 'public', 1, 1, 1, ?)`,
        [id, l.handle, l.displayName, `${l.bio} (Fictional demo listener.)`, nowIso()],
      );
      const playlistId = newId();
      await run(
        db,
        `INSERT INTO playlists (id, user_id, name, provider, visibility, track_count, created_at, updated_at) VALUES (?, ?, ?, 'csv', 'public', ?, ?, ?)`,
        [playlistId, id, `${l.displayName} — demo favourites`, tracks.length, nowIso(), nowIso()],
      );
      const entries: RawEntry[] = tracks.map((t, i) => ({
        row: i + 1,
        title: t.title,
        artists: [t.artist],
        album: t.album,
        releaseDate: String(t.year),
        genres: [t.genre],
        genreKind: 'user',
        attributes: t.attributes,
      }));
      const classified = await classifyEntries(db, id, entries);
      const rows: Param[][] = [];
      for (const [position, entry] of entries.entries()) {
        if (classified[position]!.skipByDefault) continue;
        const { trackId, method } = await resolveTrack(db, entry);
        const genres: string[] = [];
        for (const g of entry.genres ?? []) {
          const name = (await ensureGenre(db, g))?.name;
          if (name) genres.push(name);
        }
        rows.push([newId(), playlistId, trackId, position, entry.title, entry.artists[0]!, entry.album ?? null, method, JSON.stringify(genres), JSON.stringify(entry.attributes ?? []), nowIso()]);
      }
      await insertMany(
        db,
        'playlist_tracks',
        ['id', 'playlist_id', 'track_id', 'position', 'raw_title', 'raw_artist', 'raw_album', 'match_method', 'user_genres', 'user_attributes', 'added_at'],
        rows,
      );
      // Demo tracks are fictional, so there is nothing to look up in MusicBrainz.
      await run(
        db,
        "UPDATE tracks SET enrichment_status = 'skipped', enrichment_error = 'Fictional demo track' WHERE enrichment_status = 'pending' AND id IN (SELECT track_id FROM playlist_tracks WHERE playlist_id = ?)",
        [playlistId],
      );
    });
    await recomputeProfile(db, id, true);
  }

  const { created } = await generateProposals(db, config.matchWeights, { isDemo: true });
  for (const communityId of created) {
    const c = (await get<{ candidate_ids: string | null }>(db, 'SELECT candidate_ids FROM communities WHERE id = ?', [communityId]))!;
    const members = c.candidate_ids ? (JSON.parse(c.candidate_ids) as string[]) : [];
    for (const m of members) await joinCommunity(db, communityId, m);
    await run(db, "UPDATE community_memberships SET role = 'moderator' WHERE community_id = ? AND user_id = ?", [communityId, members[0] ?? '']);
    const profile = (await get<{ profile_json: string | null }>(db, 'SELECT profile_json FROM communities WHERE id = ?', [communityId]))!;
    const display = profile.profile_json ? (JSON.parse(profile.profile_json) as { genres: { label: string }[]; artists: { name: string }[] }) : null;
    for (const [i, template] of MESSAGES.entries()) {
      const author = members[i % Math.max(1, members.length)];
      if (!author) continue;
      const body = template
        .replace('{genre}', display?.genres[i % Math.max(1, display.genres.length)]?.label ?? 'music')
        .replace('{artist}', display?.artists[0]?.name ?? 'the same artists');
      await run(db, 'INSERT INTO community_messages (community_id, user_id, body, created_at) VALUES (?, ?, ?, ?)', [communityId, author, body, nowIso(-((3 - i) * 3600 * 1000))]);
    }
  }
  return {
    listeners: ids.length,
    trees: created.length,
    treeNames: await all<{ name: string; member_count: number }>(db, 'SELECT name, member_count FROM communities WHERE is_demo = 1 ORDER BY member_count DESC, name'),
    skipped: false,
  };
}
