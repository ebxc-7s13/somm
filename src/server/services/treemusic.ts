/**
 * Music shared inside Trees, and Tree chat notifications.
 *
 * Sharing: a member shares one of their own playlists with a Tree; the other
 * members can then open its song list. The playlist's own visibility (private /
 * shared / public, used for matching) never changes, and leaving the Tree
 * removes the member's shares. A chat message announces each share.
 *
 * Notifications: each member has a read marker per Tree (the newest message
 * they have loaded). Unread counts skip their own messages, hidden messages,
 * messages from people they blocked or muted, and anything before they joined.
 */
import { all, get, nowIso, run, type DB } from '../db';
import { ChatError, postMessage, requireMember, type ChatMessage } from './chat';

export interface SharedPlaylist {
  playlistId: string;
  name: string;
  trackCount: number;
  topArtists: string[];
  sharedBy: { handle: string; displayName: string };
  sharedAt: string;
  mine: boolean;
}

export interface SharedTrack {
  id: string;
  title: string;
  version: string | null;
  artist: string;
  album: string | null;
  year: number | null;
}

/** People hidden from a viewer: those they blocked or muted, and those who blocked them. */
const HIDDEN_FOR_VIEWER = `EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id = ? AND b.target_user_id = {author})
  OR (b.user_id = {author} AND b.target_user_id = ? AND b.kind = 'block'))`;
const hiddenFor = (authorColumn: string) => HIDDEN_FOR_VIEWER.replaceAll('{author}', authorColumn);

async function playlistCard(db: DB, playlistId: string): Promise<{ name: string; trackCount: number } | undefined> {
  return get<{ name: string; trackCount: number }>(
    db,
    'SELECT p.name, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS "trackCount" FROM playlists p WHERE p.id = ?',
    [playlistId],
  );
}

export const playlistLabel = (name: string, trackCount: number) => `${name} · ${trackCount} song${trackCount === 1 ? '' : 's'}`;

/** Share one of your playlists with a Tree and announce it in the chat. */
export async function sharePlaylist(db: DB, communityId: string, userId: string, playlistId: string, note: string): Promise<{ message: ChatMessage }> {
  await requireMember(db, communityId, userId);
  const owned = await get(db, 'SELECT 1 FROM playlists WHERE id = ? AND user_id = ?', [playlistId, userId]);
  if (!owned) throw new ChatError('You can only share your own playlists.', 400, 'bad_ref');
  const card = await playlistCard(db, playlistId);
  if (!card || card.trackCount === 0) throw new ChatError('This playlist has no songs to share.', 400, 'empty');
  await run(
    db,
    'INSERT INTO community_shares (community_id, playlist_id, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (community_id, playlist_id) DO UPDATE SET created_at = excluded.created_at',
    [communityId, playlistId, userId, nowIso()],
  );
  const message = await postMessage(db, communityId, userId, { body: note, ref: { type: 'playlist', id: playlistId } });
  return { message };
}

export async function unsharePlaylist(db: DB, communityId: string, userId: string, playlistId: string, isModerator: boolean): Promise<boolean> {
  await requireMember(db, communityId, userId);
  const r = await run(
    db,
    `DELETE FROM community_shares WHERE community_id = ? AND playlist_id = ? ${isModerator ? '' : 'AND user_id = ?'}`,
    isModerator ? [communityId, playlistId] : [communityId, playlistId, userId],
  );
  return r.changes > 0;
}

export async function listShares(db: DB, communityId: string, viewerId: string): Promise<SharedPlaylist[]> {
  await requireMember(db, communityId, viewerId);
  const rows = await all<{ playlist_id: string; name: string; user_id: string; handle: string; display_name: string; created_at: string; track_count: number }>(
    db,
    `SELECT s.playlist_id, p.name, s.user_id, u.handle, u.display_name, s.created_at,
            (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count
     FROM community_shares s JOIN playlists p ON p.id = s.playlist_id JOIN users u ON u.id = s.user_id
     WHERE s.community_id = ? AND NOT ${hiddenFor('s.user_id')}
     ORDER BY s.created_at DESC LIMIT 100`,
    [communityId, viewerId, viewerId],
  );
  return Promise.all(
    rows.map(async (r) => ({
      playlistId: r.playlist_id,
      name: r.name,
      trackCount: r.track_count,
      topArtists: (
        await all<{ name: string }>(
          db,
          `SELECT a.name FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id JOIN artists a ON a.id = t.primary_artist_id
           WHERE pt.playlist_id = ? GROUP BY a.id, a.name ORDER BY COUNT(*) DESC, a.name LIMIT 3`,
          [r.playlist_id],
        )
      ).map((a) => a.name),
      sharedBy: { handle: r.handle, displayName: r.display_name },
      sharedAt: r.created_at,
      mine: r.user_id === viewerId,
    })),
  );
}

/** The songs of a playlist shared with this Tree (members only). */
export async function sharedPlaylistTracks(db: DB, communityId: string, viewerId: string, playlistId: string): Promise<{ playlist: SharedPlaylist; tracks: SharedTrack[] }> {
  const shares = await listShares(db, communityId, viewerId);
  const playlist = shares.find((s) => s.playlistId === playlistId);
  if (!playlist) throw new ChatError('This playlist is not shared with this Tree.', 404, 'not_found');
  const tracks = await all<SharedTrack>(
    db,
    `SELECT t.id, t.title, t.version, a.name AS artist, al.title AS album, t.release_year AS year
     FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id JOIN artists a ON a.id = t.primary_artist_id
     LEFT JOIN albums al ON al.id = t.album_id
     WHERE pt.playlist_id = ? ORDER BY pt.position LIMIT 2000`,
    [playlistId],
  );
  return { playlist, tracks };
}

/** Remove a member's shares when they leave a Tree. */
export async function removeSharesOnLeave(db: DB, communityId: string, userId: string) {
  await run(db, 'DELETE FROM community_shares WHERE community_id = ? AND user_id = ?', [communityId, userId]);
}

// ---------------------------------------------------------------- unread

/** Record that a member has seen messages up to `lastId` (never moves backwards). */
export async function markRead(db: DB, communityId: string, userId: string, lastId: number) {
  if (!Number.isSafeInteger(lastId) || lastId <= 0) return;
  await run(
    db,
    `INSERT INTO community_reads (community_id, user_id, last_read_id, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (community_id, user_id) DO UPDATE SET last_read_id = GREATEST(community_reads.last_read_id, excluded.last_read_id), updated_at = excluded.updated_at`,
    [communityId, userId, lastId, nowIso()],
  );
}

export interface TreeActivity {
  id: string;
  slug: string;
  name: string;
  unread: number;
  lastMessage: { id: number; author: string; excerpt: string; createdAt: string; mine: boolean } | null;
}

/** Unread messages and the latest message in each Tree the user belongs to. */
export async function treeActivity(db: DB, userId: string): Promise<{ trees: TreeActivity[]; totalUnread: number }> {
  const rows = await all<{ id: string; slug: string; name: string; joined_at: string; last_read: number; unread: number }>(
    db,
    `SELECT c.id, c.slug, c.name, m.joined_at, COALESCE(r.last_read_id, 0) AS last_read,
            (SELECT COUNT(*) FROM community_messages x
             WHERE x.community_id = c.id AND x.id > COALESCE(r.last_read_id, 0) AND x.user_id <> m.user_id
               AND x.hidden = 0 AND x.created_at > m.joined_at AND NOT ${hiddenFor('x.user_id')}) AS unread
     FROM community_memberships m JOIN communities c ON c.id = m.community_id
     LEFT JOIN community_reads r ON r.community_id = c.id AND r.user_id = m.user_id
     WHERE m.user_id = ? AND c.status <> 'archived'
     ORDER BY c.name`,
    [userId, userId, userId],
  );
  const trees: TreeActivity[] = [];
  for (const r of rows) {
    const last = await get<{ id: number; body: string; created_at: string; display_name: string; user_id: string; ref_label: string | null }>(
      db,
      `SELECT x.id, x.body, x.created_at, u.display_name, x.user_id, x.ref_label FROM community_messages x JOIN users u ON u.id = x.user_id
       WHERE x.community_id = ? AND x.hidden = 0 AND NOT ${hiddenFor('x.user_id')} ORDER BY x.id DESC LIMIT 1`,
      [r.id, userId, userId],
    );
    const text = last ? (last.body || last.ref_label || '').replace(/\s+/g, ' ').trim() : '';
    trees.push({
      id: r.id,
      slug: r.slug,
      name: r.name,
      unread: r.unread,
      lastMessage: last
        ? { id: last.id, author: last.display_name, excerpt: text.length > 90 ? `${text.slice(0, 88)}…` : text, createdAt: last.created_at, mine: last.user_id === userId }
        : null,
    });
  }
  return { trees, totalUnread: trees.reduce((n, t) => n + t.unread, 0) };
}
