/**
 * Music shared in Trees, unread counts and notifications: what members see, what
 * outsiders cannot, and which messages count as new.
 */
import { describe, expect, it } from 'vitest';
import { run } from '../../src/server/db';
import { createTestServer, electronicCsv, jazzCsv, type TestClient, type TestServer } from '../helpers/server';

async function listener(server: TestServer, handle: string, content: string) {
  const c = server.client();
  await c.signup(handle);
  const imported = await c.importCsv(content, { visibility: 'shared', name: `${handle} favourites` });
  await c.patch('/api/me', { discoverable: true });
  return Object.assign(c, { playlistId: imported.playlistId });
}

async function room() {
  const server = await createTestServer();
  const e1 = await listener(server, 'electro-one', electronicCsv('One', 20));
  const e2 = await listener(server, 'electro-two', electronicCsv('Two', 20));
  const e3 = await listener(server, 'electro-three', electronicCsv('Three', 16));
  const j1 = await listener(server, 'jazz-one', jazzCsv('J1', 15));
  const tree = (await e1.post('/api/trees', { name: 'Shared Garden' })).body.tree;
  await e2.post(`/api/trees/${tree.slug}/join`);
  return { server, e1, e2, e3, j1, slug: tree.slug as string };
}

const say = (c: TestClient, slug: string, body: string) => c.post(`/api/trees/${slug}/messages`, { body });

describe('Music shared in a Tree', () => {
  it('lets members share their own playlists and open the songs, and keeps outsiders out', async () => {
    const { e1, e2, j1, slug } = await room();
    const shared = await e1.post(`/api/trees/${slug}/shares`, { playlistId: e1.playlistId, note: 'Late-night synths' });
    expect(shared.status).toBe(201);
    // The share is announced in the chat with a link to the playlist.
    expect(shared.body.message).toMatchObject({ body: 'Late-night synths', ref: { type: 'playlist', id: e1.playlistId } });
    expect(shared.body.message.ref.label).toMatch(/electro-one favourites · 20 songs/);
    const chat = (await e2.get(`/api/trees/${slug}/messages`)).body.messages;
    expect(chat.at(-1).ref).toMatchObject({ type: 'playlist', id: e1.playlistId });

    const list = (await e2.get(`/api/trees/${slug}/shares`)).body.shares;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ playlistId: e1.playlistId, name: 'electro-one favourites', trackCount: 20, mine: false, sharedBy: { handle: 'electro-one' } });
    expect(list[0].topArtists.length).toBeGreaterThan(0);

    const songs = (await e2.get(`/api/trees/${slug}/shares/${e1.playlistId}`)).body;
    expect(songs.tracks).toHaveLength(20);
    expect(songs.tracks[0]).toMatchObject({ title: 'One 1', artist: expect.any(String) });
    // Sharing never changes the playlist's own privacy setting.
    const own = (await e1.get('/api/playlists')).body.playlists.find((p: { id: string }) => p.id === e1.playlistId);
    expect(own.visibility).toBe('shared');

    // Outsiders see nothing; nobody can share someone else's playlist.
    expect((await j1.get(`/api/trees/${slug}/shares`)).status).toBe(403);
    expect((await j1.get(`/api/trees/${slug}/shares/${e1.playlistId}`)).status).toBe(403);
    expect((await j1.post(`/api/trees/${slug}/shares`, { playlistId: j1.playlistId })).status).toBe(403);
    const stolen = await e2.post(`/api/trees/${slug}/shares`, { playlistId: e1.playlistId });
    expect(stolen.status).toBe(400);
    expect(stolen.body.error.code).toBe('bad_ref');
    // A playlist reference in a chat message must point at a shared playlist.
    expect((await e2.post(`/api/trees/${slug}/messages`, { body: 'look', ref: { type: 'playlist', id: e2.playlistId } })).status).toBe(400);
  });

  it('lets the owner or a moderator remove a share, and removes shares when the owner leaves', async () => {
    const { e1, e2, e3, slug } = await room();
    await e3.post(`/api/trees/${slug}/join`);
    await e2.post(`/api/trees/${slug}/shares`, { playlistId: e2.playlistId });
    await e3.post(`/api/trees/${slug}/shares`, { playlistId: e3.playlistId });
    // Another member cannot remove it; the moderator (Tree creator) can.
    expect((await e3.del(`/api/trees/${slug}/shares/${e2.playlistId}`)).status).toBe(404);
    expect((await e1.del(`/api/trees/${slug}/shares/${e2.playlistId}`)).status).toBe(200);
    expect((await e1.get(`/api/trees/${slug}/shares/${e2.playlistId}`)).status).toBe(404);
    // Leaving the Tree withdraws your shares.
    expect((await e3.post(`/api/trees/${slug}/leave`)).status).toBe(200);
    expect((await e1.get(`/api/trees/${slug}/shares`)).body.shares).toEqual([]);
  });
});

describe('Unread messages and notifications', () => {
  it('counts other members’ new messages until you read them', async () => {
    const { e1, e2, slug } = await room();
    expect((await e1.get('/api/notifications')).body.totalUnread).toBe(0);
    await say(e2, slug, 'first');
    await say(e2, slug, 'second, with more to say');
    await say(e1, slug, 'my own message never counts');

    const n = (await e1.get('/api/notifications')).body;
    expect(n.totalUnread).toBe(2);
    expect(n.trees[0]).toMatchObject({ slug, name: 'Shared Garden', unread: 2, lastMessage: { author: 'electro-one', excerpt: 'my own message never counts', mine: true } });
    expect((await e2.get('/api/notifications')).body.totalUnread).toBe(1);

    const mine = (await e1.get('/api/me/trees')).body;
    expect(mine.totalUnread).toBe(2);
    expect(mine.trees[0]).toMatchObject({ slug, isMember: true, unread: 2 });

    // Opening the chat marks it read.
    await e1.get(`/api/trees/${slug}/messages`);
    expect((await e1.get('/api/notifications')).body.totalUnread).toBe(0);

    // Or explicitly, up to a message id (never backwards).
    const later = (await say(e2, slug, 'third')).body.message;
    await say(e2, slug, 'fourth');
    expect((await e1.post(`/api/trees/${slug}/read`, { lastId: later.id })).status).toBe(200);
    expect((await e1.get('/api/notifications')).body.totalUnread).toBe(1);
    await e1.post(`/api/trees/${slug}/read`, { lastId: 1 });
    expect((await e1.get('/api/notifications')).body.totalUnread).toBe(1);
  });

  it('ignores muted people, hidden messages and anything from before you joined', async () => {
    const { server, e1, e2, e3, slug } = await room();
    await say(e2, slug, 'before electro-three joined');
    await e3.post(`/api/trees/${slug}/join`);
    expect((await e3.get('/api/notifications')).body.totalUnread).toBe(0);

    await e3.post('/api/blocks', { handle: 'electro-two', kind: 'mute' });
    await say(e2, slug, 'muted for electro-three');
    const hidden = (await say(e1, slug, 'soon hidden by a moderator')).body.message;
    await run(server.ctx.db, 'UPDATE community_messages SET hidden = 1 WHERE id = ?', [hidden.id]);
    expect((await e3.get('/api/notifications')).body.totalUnread).toBe(0);

    await say(e1, slug, 'visible to everyone');
    expect((await e3.get('/api/notifications')).body.totalUnread).toBe(1);
  });

  it('requires membership to mark a Tree read and lists only your Trees', async () => {
    const { j1, slug } = await room();
    expect((await j1.post(`/api/trees/${slug}/read`, { lastId: 1 })).status).toBe(403);
    expect((await j1.get('/api/me/trees')).body).toEqual({ trees: [], totalUnread: 0 });
    expect((await j1.get('/api/notifications')).body).toEqual({ trees: [], totalUnread: 0 });
  });
});
