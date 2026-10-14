import { describe, expect, it } from 'vitest';
import { generateProposals } from '../../src/server/services/communities';
import { createTestServer, csv, electronicCsv, jazzCsv, type TestClient, type TestServer } from '../helpers/server';

async function listener(server: TestServer, handle: string, content: string, opts: { discoverable?: boolean; visibility?: 'private' | 'shared' | 'public' } = {}) {
  const c = server.client();
  await c.signup(handle);
  await c.importCsv(content, { visibility: opts.visibility ?? 'shared' });
  if (opts.discoverable !== false) await c.patch('/api/me', { discoverable: true });
  return c;
}

async function community(server: TestServer) {
  const e1 = await listener(server, 'electro-one', electronicCsv('One', 20));
  const e2 = await listener(server, 'electro-two', electronicCsv('Two', 20));
  const e3 = await listener(server, 'electro-three', electronicCsv('Three', 16));
  const j1 = await listener(server, 'jazz-one', jazzCsv('J1', 15));
  return { e1, e2, e3, j1 };
}

describe('Tree creation and evidence thresholds', () => {
  it('refuses to create a Tree without enough compatible listeners', async () => {
    const server = await createTestServer();
    const lonely = await listener(server, 'lonely-listener', electronicCsv('Solo', 10));
    const e = (await lonely.get('/api/trees/eligibility')).body;
    expect(e.eligible).toBe(false);
    expect(e.reason).toMatch(/at least 2 other discoverable listeners/);
    const r = await lonely.post('/api/trees', { name: 'My Own Tree' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('not_enough_evidence');
  });

  it('allows creation once enough compatible listeners exist, and ignores incompatible ones', async () => {
    const server = await createTestServer();
    const { e1, j1 } = await community(server);
    expect((await j1.get('/api/trees/eligibility')).body.eligible).toBe(false);
    const elig = (await e1.get('/api/trees/eligibility')).body;
    expect(elig.eligible).toBe(true);
    expect(elig.compatibleCount).toBe(2);
    const r = await e1.post('/api/trees', { name: 'Neon Night Gardeners', description: 'Synths after dark' });
    expect(r.status).toBe(201);
    expect(r.body.tree).toMatchObject({ name: 'Neon Night Gardeners', memberCount: 1, isMember: true, status: 'active' });
    expect((await e1.post('/api/trees', { name: '!!' })).status).toBe(400);
  });

  it('proposes Trees from clusters with labels from the data, visible only to candidates until joined', async () => {
    const server = await createTestServer();
    const { e1, e2, j1 } = await community(server);
    const result = await generateProposals(server.ctx.db, server.ctx.config.matchWeights);
    expect(result.created).toHaveLength(1);
    const recs = (await e1.get('/api/trees/recommended')).body.recommendations;
    expect(recs[0].community.status).toBe('proposed');
    expect(recs[0].community.name).toMatch(/Electronic|Ambient|Synthwave|Techno|Sound Explorers|Atmosphere/);
    const slug = recs[0].community.slug;
    // Not a candidate → cannot see or join a proposed Tree.
    expect((await j1.get(`/api/trees/${slug}`)).status).toBe(404);
    expect((await j1.post(`/api/trees/${slug}/join`)).status).toBe(404);
    expect((await j1.get('/api/trees')).body.trees).toEqual([]);
    // Candidates join; at two members it becomes public.
    await e1.post(`/api/trees/${slug}/join`);
    expect((await e1.get(`/api/trees/${slug}`)).body.tree.status).toBe('proposed');
    await e2.post(`/api/trees/${slug}/join`);
    const detail = (await j1.get(`/api/trees/${slug}`)).body;
    expect(detail.tree.status).toBe('active');
    expect(detail.tree.memberCount).toBe(2);
  });
});

describe('Tree recommendations, privacy and membership', () => {
  async function activeTree() {
    const server = await createTestServer();
    const people = await community(server);
    const created = (await people.e1.post('/api/trees', { name: 'Synth Garden' })).body.tree;
    return { server, ...people, slug: created.slug as string, id: created.id as string };
  }

  it('ranks and explains Tree matches with transparent components', async () => {
    const { e2, j1, slug } = await activeTree();
    const rec = (await e2.get('/api/trees/recommended')).body.recommendations.find((r: any) => r.community.slug === slug);
    expect(rec.match.score).toBeGreaterThan(0.3);
    expect(rec.match.components.map((c: any) => c.key)).toEqual(['tracks', 'artists', 'genres', 'attributes', 'text']);
    expect(rec.explanation.summary).toMatch(/because/);
    expect(rec.explanation.points.join(' ')).toMatch(/shared artist/);
    const jazzRec = (await j1.get('/api/trees/recommended')).body.recommendations.find((r: any) => r.community.slug === slug);
    expect(jazzRec.match.score).toBeLessThan(rec.match.score);
    expect(['low', 'possible']).toContain(jazzRec.match.label);
  });

  it('compares members with the other members only, never with their own contribution', async () => {
    const { e2, slug } = await activeTree();
    const before = (await e2.get('/api/trees/recommended')).body.recommendations.find((r: any) => r.community.slug === slug);
    await e2.post(`/api/trees/${slug}/join`);
    const after = (await e2.get('/api/trees/recommended')).body.recommendations.find((r: any) => r.community.slug === slug);
    expect(after.isMember).toBe(true);
    // e2 shares no tracks with e1 (the only other member), so joining must not create "shared tracks".
    expect(after.match.components.find((c: any) => c.key === 'tracks').sharedCount).toBe(0);
    expect(after.match.score).toBeCloseTo(before.match.score, 2);
  });

  it('joins and leaves, archiving member-made Trees when empty', async () => {
    const { e1, e2, slug } = await activeTree();
    expect((await e2.post(`/api/trees/${slug}/join`)).body.tree.isMember).toBe(true);
    expect((await e2.get(`/api/trees/${slug}`)).body.tree.memberCount).toBe(2);
    await e2.post(`/api/trees/${slug}/leave`);
    expect((await e2.get(`/api/trees/${slug}`)).body.tree.isMember).toBe(false);
    await e1.post(`/api/trees/${slug}/leave`);
    expect((await e2.get(`/api/trees/${slug}`)).status).toBe(404);
  });

  it('shows artists only when at least two members share them (k-anonymity)', async () => {
    const { server, e2, slug } = await activeTree();
    let profile = (await e2.get(`/api/trees/${slug}`)).body.profile;
    expect(profile.artists).toEqual([]);
    expect(profile.note).toMatch(/at least 3 members contribute/);
    await e2.post(`/api/trees/${slug}/join`);
    const solo = await listener(server, 'solo-artist-fan', csv([['Unique', 'Only Mine Artist', '', 'techno'], ...Array.from({ length: 5 }, (_, i) => [`Two ${i + 1}`, 'Nova Lattice', '', 'techno'] as [string, string, string, string])]));
    await solo.post(`/api/trees/${slug}/join`);
    profile = (await e2.get(`/api/trees/${slug}`)).body.profile;
    expect(profile.artists.map((a: any) => a.name)).toContain('Nova Lattice');
    expect(profile.artists.map((a: any) => a.name)).not.toContain('Only Mine Artist');
    expect(JSON.stringify((await e2.get(`/api/trees/${slug}`)).body.map)).not.toContain('Only Mine Artist');
  });

  it('never lets a private playlist contribute to a Tree', async () => {
    const { server, e2, slug } = await activeTree();
    await e2.post(`/api/trees/${slug}/join`);
    const priv = server.client();
    await priv.signup('private-person');
    await priv.importCsv(csv(Array.from({ length: 6 }, (_, i) => [`Secret ${i}`, 'Secret Artist', '', 'polka'] as [string, string, string, string])), { visibility: 'private' });
    await priv.post(`/api/trees/${slug}/join`);
    const priv2 = server.client();
    await priv2.signup('private-person-2');
    await priv2.importCsv(csv(Array.from({ length: 6 }, (_, i) => [`Secret ${i}`, 'Secret Artist', '', 'polka'] as [string, string, string, string])), { visibility: 'private' });
    await priv2.post(`/api/trees/${slug}/join`);
    const detail = JSON.stringify((await e2.get(`/api/trees/${slug}`)).body);
    expect(detail).not.toContain('Secret Artist');
    expect(detail).not.toContain('polka');
    expect((await e2.get(`/api/trees/${slug}`)).body.profile.contributingMembers).toBe(2);
  });

  it('handles empty and low-population Trees', async () => {
    const server = await createTestServer();
    const a = await listener(server, 'empty-tree-viewer', electronicCsv('A', 3));
    expect((await a.get('/api/trees')).body.trees).toEqual([]);
    expect((await a.get('/api/trees/recommended')).body.recommendations).toEqual([]);
    expect((await a.get('/api/trees/does-not-exist')).status).toBe(404);
    const noLib = server.client();
    await noLib.signup('no-library-yet');
    expect((await noLib.get('/api/trees/recommended')).body.recommendations).toEqual([]);
  });

  it('lets members propose and vote on names; majority renames the Tree', async () => {
    const { e1, e2, e3, slug } = await activeTree();
    await e2.post(`/api/trees/${slug}/join`);
    await e3.post(`/api/trees/${slug}/join`);
    expect((await e1.post(`/api/trees/${slug}/names`, { name: 'x' })).status).toBe(400);
    const p = (await e1.post(`/api/trees/${slug}/names`, { name: 'Analog Bloom' })).body;
    expect(p.names[0]).toMatchObject({ name: 'Analog Bloom', votes: 1, votedByMe: true });
    expect(p.tree.name).toBe('Synth Garden');
    const v = (await e2.post(`/api/trees/${slug}/names/${p.id}/vote`)).body;
    expect(v.renamed).toBe(true);
    expect(v.tree.name).toBe('Analog Bloom');
  });

  it('restricts the member directory to members and hides blocked users', async () => {
    const { e1, e2, j1, slug } = await activeTree();
    await e2.post(`/api/trees/${slug}/join`);
    expect((await j1.get(`/api/trees/${slug}/members`)).status).toBe(403);
    const members = (await e2.get(`/api/trees/${slug}/members`)).body.members;
    expect(members.map((m: any) => m.handle).sort()).toEqual(['electro-one', 'electro-two']);
    expect(members.find((m: any) => m.handle === 'electro-one').match.score).toBeGreaterThan(0.3);
    await e2.post('/api/blocks', { handle: 'electro-one' });
    expect((await e2.get(`/api/trees/${slug}/members`)).body.members.map((m: any) => m.handle)).toEqual(['electro-two']);
    void e1;
  });
});

describe('Tree chat', () => {
  async function chatRoom() {
    const server = await createTestServer();
    const people = await community(server);
    const tree = (await people.e1.post('/api/trees', { name: 'Chat Garden' })).body.tree;
    await people.e2.post(`/api/trees/${tree.slug}/join`);
    return { server, ...people, slug: tree.slug as string };
  }
  const post = (c: TestClient, slug: string, body: unknown) => c.post(`/api/trees/${slug}/messages`, body);

  it('requires membership to read and post', async () => {
    const { j1, slug } = await chatRoom();
    expect((await j1.get(`/api/trees/${slug}/messages`)).status).toBe(403);
    expect((await post(j1, slug, { body: 'hi' })).status).toBe(403);
  });

  it('stores history with timestamps, replies, song references and safe links', async () => {
    const { e1, e2, slug } = await chatRoom();
    const first = (await post(e1, slug, { body: 'Try this: https://open.spotify.com/track/abc123?si=x. Also javascript:alert(1)' })).body.message;
    expect(first.link).toEqual({ url: 'https://open.spotify.com/track/abc123?si=x', provider: 'Spotify' });
    expect(first.author.handle).toBe('electro-one');
    expect(Date.parse(first.createdAt)).not.toBeNaN();
    const myTrack = (await e2.get('/api/library/tracks')).body.tracks[0];
    const reply = (await post(e2, slug, { body: 'Love it — mine:', replyToId: first.id, ref: { type: 'track', id: myTrack.id } })).body.message;
    expect(reply.replyTo).toMatchObject({ id: first.id, author: 'electro-one' });
    expect(reply.ref).toMatchObject({ type: 'track', id: myTrack.id });
    expect(reply.ref.label).toContain(myTrack.title);
    // You cannot share a track that is not in your library.
    expect((await post(e1, slug, { body: 'x', ref: { type: 'track', id: myTrack.id } })).status).toBe(400);
    const history = (await e1.get(`/api/trees/${slug}/messages`)).body;
    expect(history.messages.map((m: any) => m.id)).toEqual([first.id, reply.id]);
    expect(history.messages[0].mine).toBe(true);
    expect((await e1.get(`/api/trees/${slug}/messages?after=${first.id}`)).body.messages.map((m: any) => m.id)).toEqual([reply.id]);
  });

  it('validates input', async () => {
    const { e1, slug } = await chatRoom();
    expect((await post(e1, slug, { body: '   ' })).body.error.code).toBe('empty');
    expect((await post(e1, slug, { body: 'x'.repeat(1001) })).body.error.code).toBe('too_long');
    expect((await post(e1, slug, { body: 'hi', replyToId: 99999 })).body.error.code).toBe('bad_reply');
    const clean = (await post(e1, slug, { body: 'a\u202Eb\u0000c\n\n\n\nd' })).body.message;
    expect(clean.body).toBe('abc\n\nd');
  });

  it('paginates history', async () => {
    const { server, e1, slug } = await chatRoom();
    for (let i = 0; i < 4; i++) {
      server.ctx.limiter.reset();
      await post(e1, slug, { body: `m${i}` });
    }
    const page1 = (await e1.get(`/api/trees/${slug}/messages?limit=2`)).body;
    expect(page1.messages.map((m: any) => m.body)).toEqual(['m2', 'm3']);
    expect(page1.hasMore).toBe(true);
    const page2 = (await e1.get(`/api/trees/${slug}/messages?limit=2&before=${page1.messages[0].id}`)).body;
    expect(page2.messages.map((m: any) => m.body)).toEqual(['m0', 'm1']);
    expect(page2.hasMore).toBe(false);
  });

  it('rate-limits bursts of messages', async () => {
    const { e1, slug } = await chatRoom();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await post(e1, slug, { body: `spam ${i}` })).status);
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses[5]).toBe(429);
  });

  it('hides messages from blocked and muted users for the viewer only', async () => {
    const { server, e1, e2, e3, slug } = await chatRoom();
    await e3.post(`/api/trees/${slug}/join`);
    await post(e1, slug, { body: 'from one' });
    server.ctx.limiter.reset();
    await post(e2, slug, { body: 'from two' });
    await e3.post('/api/blocks', { handle: 'electro-one', kind: 'mute' });
    expect((await e3.get(`/api/trees/${slug}/messages`)).body.messages.map((m: any) => m.body)).toEqual(['from two']);
    expect((await e2.get(`/api/trees/${slug}/messages`)).body.messages).toHaveLength(2);
    await e2.post('/api/blocks', { handle: 'electro-one', kind: 'block' });
    expect((await e2.get(`/api/trees/${slug}/messages`)).body.messages.map((m: any) => m.body)).toEqual(['from two']);
    // A block also hides the blocker's messages from the blocked person.
    expect((await e1.get(`/api/trees/${slug}/messages`)).body.messages.map((m: any) => m.body)).toEqual(['from one']);
  });

  it('auto-hides a message after three reports and supports moderator actions', async () => {
    const { server, e1, e2, e3, slug } = await chatRoom();
    await e3.post(`/api/trees/${slug}/join`);
    const extra = await listener(server, 'electro-four', electronicCsv('Four', 10));
    await extra.post(`/api/trees/${slug}/join`);
    const bad = (await post(e2, slug, { body: 'buy followers at spam.example' })).body.message;
    expect((await e2.post('/api/reports', { targetType: 'message', targetId: String(bad.id), reason: 'spam' })).status).toBe(400);
    for (const reporter of [e1, e3]) await reporter.post('/api/reports', { targetType: 'message', targetId: String(bad.id), reason: 'spam' });
    // Duplicate reports from the same person do not count twice.
    await e3.post('/api/reports', { targetType: 'message', targetId: String(bad.id), reason: 'spam' });
    expect((await e1.get(`/api/trees/${slug}/messages`)).body.messages[0].hidden).toBe(false);
    const third = (await extra.post('/api/reports', { targetType: 'message', targetId: String(bad.id), reason: 'spam' })).body;
    expect(third.autoHidden).toBe(true);
    const hidden = (await e1.get(`/api/trees/${slug}/messages`)).body.messages[0];
    expect(hidden).toMatchObject({ hidden: true, body: null, link: null });
    // e1 created the Tree, so e1 moderates it.
    const queue = (await e1.get('/api/moderation/reports')).body;
    expect(queue.scope).toBe('moderated-trees');
    expect(queue.reports.length).toBeGreaterThanOrEqual(3);
    expect((await e2.post(`/api/moderation/reports/${queue.reports[0].id}`, { action: 'restore' })).status).toBe(403);
    expect((await e1.post(`/api/moderation/reports/${queue.reports[0].id}`, { action: 'restore' })).status).toBe(200);
    expect((await e1.get(`/api/trees/${slug}/messages`)).body.messages[0].hidden).toBe(false);
    server.ctx.limiter.reset();
    const msg = (await post(e2, slug, { body: 'another' })).body.message;
    expect((await e2.post(`/api/trees/${slug}/messages/${msg.id}/hide`)).status).toBe(403);
    expect((await e1.post(`/api/trees/${slug}/messages/${msg.id}/hide`)).status).toBe(200);
    expect((await e1.del(`/api/trees/${slug}/messages/${bad.id}`)).status).toBe(404);
    expect((await e2.del(`/api/trees/${slug}/messages/${bad.id}`)).status).toBe(200);
  });

  it('validates report input', async () => {
    const { e1 } = await chatRoom();
    expect((await e1.post('/api/reports', { targetType: 'message', targetId: '999999', reason: 'spam' })).status).toBe(404);
    expect((await e1.post('/api/reports', { targetType: 'user', targetId: 'electro-two', reason: 'nope' })).status).toBe(400);
    expect((await e1.post('/api/reports', { targetType: 'user', targetId: 'electro-two', reason: 'harassment', details: 'x'.repeat(400) })).status).toBe(201);
  });
});
