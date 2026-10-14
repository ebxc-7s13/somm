/**
 * Tree chat: members-only history and posting, song/artist/album references,
 * safe link handling, block/mute filtering and community moderation.
 */
import { cleanDisplayText } from '../../shared/normalize';
import { all, get, newId, nowIso, run, type DB } from '../db';
import { isMember } from './communities';

export const MESSAGE_MAX_LENGTH = 1000;
export const AUTO_HIDE_REPORTS = 3;

export interface ChatMessage {
  id: number;
  communityId: string;
  author: { id: string; handle: string; displayName: string; isDemo: boolean };
  body: string | null;
  hidden: boolean;
  replyTo: { id: number; author: string; excerpt: string | null } | null;
  ref: { type: 'track' | 'artist' | 'album'; id: string; label: string } | null;
  link: { url: string; provider: string | null } | null;
  createdAt: string;
  mine: boolean;
}

export class ChatError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

const LINK_PROVIDERS: [RegExp, string][] = [
  [/^(open|play)\.spotify\.com$/, 'Spotify'],
  [/^(www\.|m\.|music\.)?youtube\.com$|^youtu\.be$/, 'YouTube'],
  [/^music\.apple\.com$/, 'Apple Music'],
  [/\.bandcamp\.com$|^bandcamp\.com$/, 'Bandcamp'],
  [/^(www\.)?soundcloud\.com$/, 'SoundCloud'],
  [/^(www\.)?musicbrainz\.org$/, 'MusicBrainz'],
  [/^(www\.)?tidal\.com$|^listen\.tidal\.com$/, 'TIDAL'],
  [/^(www\.)?deezer\.com$/, 'Deezer'],
];

/** Extract the first http(s) link; anything else (javascript:, data:, …) is never linked. */
export function extractLink(body: string): { url: string; provider: string | null } | null {
  const m = body.match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  try {
    const url = new URL(m[0].replace(/[),.!?]+$/, ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    const provider = LINK_PROVIDERS.find(([re]) => re.test(url.hostname))?.[1] ?? null;
    return { url: url.toString().slice(0, 500), provider };
  } catch {
    return null;
  }
}

export function sanitizeBody(raw: string): string {
  const normalized = raw
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized;
}

/** Users hidden from `viewerId`: people they blocked or muted, and people who blocked them. */
export async function hiddenAuthors(db: DB, viewerId: string): Promise<Set<string>> {
  return new Set(
    (
      await all<{ id: string }>(
        db,
        "SELECT target_user_id AS id FROM blocks WHERE user_id = ? UNION SELECT user_id AS id FROM blocks WHERE target_user_id = ? AND kind = 'block'",
        [viewerId, viewerId],
      )
    ).map((r) => r.id),
  );
}

function messageId(raw: string | number): number | null {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

interface MessageRow {
  id: number;
  community_id: string;
  user_id: string;
  handle: string;
  display_name: string;
  is_demo: number;
  body: string;
  hidden: number;
  reply_to_id: number | null;
  reply_author: string | null;
  reply_body: string | null;
  reply_hidden: number | null;
  ref_type: 'track' | 'artist' | 'album' | null;
  ref_id: string | null;
  ref_label: string | null;
  link_url: string | null;
  link_provider: string | null;
  created_at: string;
}

const SELECT_MESSAGES = `
  SELECT m.id, m.community_id, m.user_id, u.handle, u.display_name, u.is_demo, m.body, m.hidden, m.reply_to_id,
         ru.display_name AS reply_author, r.body AS reply_body, r.hidden AS reply_hidden,
         m.ref_type, m.ref_id, m.ref_label, m.link_url, m.link_provider, m.created_at
  FROM community_messages m
  JOIN users u ON u.id = m.user_id
  LEFT JOIN community_messages r ON r.id = m.reply_to_id
  LEFT JOIN users ru ON ru.id = r.user_id`;

export function toMessage(row: MessageRow, viewerId: string): ChatMessage {
  return {
    id: row.id,
    communityId: row.community_id,
    author: { id: row.user_id, handle: row.handle, displayName: row.display_name, isDemo: row.is_demo === 2 },
    body: row.hidden ? null : row.body,
    hidden: row.hidden === 1,
    replyTo: row.reply_to_id
      ? { id: row.reply_to_id, author: row.reply_author ?? 'deleted', excerpt: row.reply_hidden ? null : row.reply_body?.slice(0, 120) ?? null }
      : null,
    ref: row.ref_type && row.ref_id ? { type: row.ref_type, id: row.ref_id, label: row.ref_label ?? '' } : null,
    link: row.link_url && !row.hidden ? { url: row.link_url, provider: row.link_provider } : null,
    createdAt: row.created_at,
    mine: row.user_id === viewerId,
  };
}

export async function requireMember(db: DB, communityId: string, userId: string) {
  const m = await isMember(db, communityId, userId);
  if (!m) throw new ChatError('Join this Tree to read and post in its chat.', 403, 'not_member');
  return m;
}

export async function listMessages(
  db: DB,
  communityId: string,
  viewerId: string,
  opts: { before?: number; after?: number; limit?: number },
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  await requireMember(db, communityId, viewerId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const hide = await hiddenAuthors(db, viewerId);
  let rows: MessageRow[];
  if (opts.after !== undefined) {
    rows = await all<MessageRow>(db, `${SELECT_MESSAGES} WHERE m.community_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`, [communityId, opts.after, limit + 1]);
    const hasMore = rows.length > limit;
    return { messages: rows.slice(0, limit).filter((r) => !hide.has(r.user_id)).map((r) => toMessage(r, viewerId)), hasMore };
  }
  rows = await all<MessageRow>(
    db,
    `${SELECT_MESSAGES} WHERE m.community_id = ? ${opts.before !== undefined ? 'AND m.id < ?' : ''} ORDER BY m.id DESC LIMIT ?`,
    opts.before !== undefined ? [communityId, opts.before, limit + 1] : [communityId, limit + 1],
  );
  const hasMore = rows.length > limit;
  return {
    messages: rows
      .slice(0, limit)
      .reverse()
      .filter((r) => !hide.has(r.user_id))
      .map((r) => toMessage(r, viewerId)),
    hasMore,
  };
}

export async function getMessage(db: DB, id: number, viewerId: string): Promise<ChatMessage | null> {
  const row = await get<MessageRow>(db, `${SELECT_MESSAGES} WHERE m.id = ?`, [id]);
  return row ? toMessage(row, viewerId) : null;
}

export interface PostInput {
  body: string;
  replyToId?: number | null;
  ref?: { type: 'track' | 'artist' | 'album'; id: string } | null;
}

export async function postMessage(db: DB, communityId: string, userId: string, input: PostInput): Promise<ChatMessage> {
  await requireMember(db, communityId, userId);
  const body = sanitizeBody(input.body ?? '');
  if (!body && !input.ref) throw new ChatError('Messages cannot be empty.', 400, 'empty');
  if (body.length > MESSAGE_MAX_LENGTH) throw new ChatError(`Messages are limited to ${MESSAGE_MAX_LENGTH} characters.`, 400, 'too_long');

  let replyTo: number | null = null;
  if (input.replyToId) {
    const parent = await get<{ community_id: string }>(db, 'SELECT community_id FROM community_messages WHERE id = ?', [input.replyToId]);
    if (!parent || parent.community_id !== communityId) throw new ChatError('The message you replied to is not in this Tree.', 400, 'bad_reply');
    replyTo = input.replyToId;
  }

  let ref: { type: string; id: string; label: string } | null = null;
  if (input.ref) {
    if (input.ref.type === 'track') {
      // You can only share tracks from your own library.
      const t = await get<{ title: string; version: string | null; artist: string }>(
        db,
        `SELECT t.title, t.version, a.name AS artist FROM tracks t JOIN artists a ON a.id = t.primary_artist_id
         WHERE t.id = ? AND EXISTS (SELECT 1 FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE pt.track_id = t.id AND p.user_id = ?)`,
        [input.ref.id, userId],
      );
      if (!t) throw new ChatError('You can only share tracks from your own library.', 400, 'bad_ref');
      ref = { type: 'track', id: input.ref.id, label: `${t.title}${t.version ? ` (${t.version})` : ''} — ${t.artist}` };
    } else if (input.ref.type === 'artist') {
      const a = await get<{ name: string }>(db, 'SELECT name FROM artists WHERE id = ?', [input.ref.id]);
      if (!a) throw new ChatError('Unknown artist.', 400, 'bad_ref');
      ref = { type: 'artist', id: input.ref.id, label: a.name };
    } else {
      const al = await get<{ title: string; artist: string | null }>(
        db,
        'SELECT al.title, a.name AS artist FROM albums al LEFT JOIN artists a ON a.id = al.primary_artist_id WHERE al.id = ?',
        [input.ref.id],
      );
      if (!al) throw new ChatError('Unknown album.', 400, 'bad_ref');
      ref = { type: 'album', id: input.ref.id, label: `${al.title}${al.artist ? ` — ${al.artist}` : ''}` };
    }
  }

  const link = extractLink(body);
  const inserted = await get<{ id: number }>(
    db,
    `INSERT INTO community_messages (community_id, user_id, body, reply_to_id, ref_type, ref_id, ref_label, link_url, link_provider, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [communityId, userId, body, replyTo, ref?.type ?? null, ref?.id ?? null, ref ? cleanDisplayText(ref.label, 200) : null, link?.url ?? null, link?.provider ?? null, nowIso()],
  );
  return (await getMessage(db, inserted!.id, userId))!;
}

export async function deleteOwnMessage(db: DB, communityId: string, id: number, userId: string): Promise<boolean> {
  if (!messageId(id)) return false;
  return (await run(db, 'DELETE FROM community_messages WHERE id = ? AND community_id = ? AND user_id = ?', [id, communityId, userId])).changes > 0;
}

export async function hideMessage(db: DB, communityId: string, id: number, reason: string): Promise<boolean> {
  if (!messageId(id)) return false;
  return (await run(db, 'UPDATE community_messages SET hidden = 1, hidden_reason = ? WHERE id = ? AND community_id = ?', [reason, id, communityId])).changes > 0;
}

export type ReportReason = 'spam' | 'harassment' | 'hate' | 'sexual' | 'self_harm' | 'copyright' | 'other';

/** File a report. Messages reported by AUTO_HIDE_REPORTS distinct members are hidden pending review. */
export async function fileReport(
  db: DB,
  reporterId: string,
  target: { type: 'message' | 'user' | 'community'; id: string },
  reason: ReportReason,
  details: string | null,
): Promise<{ id: string; autoHidden: boolean }> {
  if (target.type === 'message') {
    const mid = messageId(target.id);
    const m = mid ? await get<{ community_id: string; user_id: string }>(db, 'SELECT community_id, user_id FROM community_messages WHERE id = ?', [mid]) : undefined;
    if (!m) throw new ChatError('Message not found.', 404, 'not_found');
    await requireMember(db, m.community_id, reporterId);
    if (m.user_id === reporterId) throw new ChatError('You cannot report your own message.', 400, 'self_report');
  } else if (target.type === 'user') {
    if (!(await get(db, 'SELECT 1 FROM users WHERE id = ?', [target.id]))) throw new ChatError('User not found.', 404, 'not_found');
    if (target.id === reporterId) throw new ChatError('You cannot report yourself.', 400, 'self_report');
  } else if (!(await get(db, 'SELECT 1 FROM communities WHERE id = ?', [target.id]))) {
    throw new ChatError('Tree not found.', 404, 'not_found');
  }
  const id = newId();
  const inserted = (
    await run(
      db,
      'INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
      [id, reporterId, target.type, target.id, reason, details ? cleanDisplayText(details, 500) : null, nowIso()],
    )
  ).changes;
  let autoHidden = false;
  if (target.type === 'message') {
    const n = (await get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM reports WHERE target_type = 'message' AND target_id = ? AND status = 'open'", [target.id]))!.n;
    if (n >= AUTO_HIDE_REPORTS) {
      await run(db, "UPDATE community_messages SET hidden = 1, hidden_reason = 'reported' WHERE id = ?", [messageId(target.id)]);
      autoHidden = true;
    }
  }
  if (inserted) return { id, autoHidden };
  const existing = await get<{ id: string }>(db, 'SELECT id FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ?', [reporterId, target.type, target.id]);
  return { id: existing!.id, autoHidden };
}
