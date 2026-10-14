/**
 * Acceptance workflow (docs/PRODUCT_SPEC.md §Acceptance), exercised end to end
 * through the HTTP API with the fictional demo community seeded.
 */
import { describe, expect, it } from 'vitest';
import { get } from '../../src/server/db';
import { seedDemo } from '../../src/server/seed/demo';
import { createTestServer } from '../helpers/server';

describe('SOMM acceptance workflow', () => {
  it('demo account → import → map → insights → Tree match → join → chat → privacy → deletion', async () => {
    const server = await createTestServer();
    const seeded = await seedDemo(server.ctx.db, server.ctx.config);
    expect(seeded.listeners).toBe(22);
    expect(seeded.trees).toBeGreaterThanOrEqual(5);

    // 1. Explicit demo mode.
    const me = server.client();
    const demo = await me.post('/api/auth/demo');
    expect(demo.status).toBe(201);

    // 2. Import the fictional sample CSV.
    const sample = (await me.get('/api/samples/library')).body;
    expect(sample.note).toMatch(/fictional/);
    const preview = await me.post('/api/imports/preview', { source: 'csv', content: sample.csv, fileName: sample.fileName });
    expect(preview.status).toBe(200);
    expect(preview.body.summary.total).toBe(32);

    // 3. Resolve + deduplicate (a remix stays separate from its original).
    const remix = preview.body.entries.find((e: any) => e.title.includes('Remix'));
    expect(remix.version).toBe('remix');
    const commit = await me.post(`/api/imports/${preview.body.draftId}/commit`, { visibility: 'shared' });
    expect(commit.status).toBe(201);
    await server.ctx.queue.drain();
    const job = (await me.get(`/api/imports/jobs/${commit.body.jobId}`)).body.job;
    expect(job.status).toBe('done');
    // Sample tracks already existed in the (fictional) catalogue via demo listeners → merged.
    expect(job.merged).toBeGreaterThan(20);

    // 4. Inspect metadata.
    const lib = (await me.get('/api/library/tracks?pageSize=100')).body;
    expect(lib.total).toBe(32);
    const detail = (await me.get(`/api/library/tracks/${lib.tracks[0].id}`)).body;
    expect(detail.entries[0].playlist).toBeTruthy();
    expect(Array.isArray(detail.genres)).toBe(true);

    // 5. A real Music Map from computed data.
    const map = (await me.get('/api/profile/map')).body.map;
    expect(map.nodes.find((n: any) => n.id === 'root').trackCount).toBe(32);
    expect(map.nodes.some((n: any) => n.id === 'family:electronic')).toBe(true);
    expect(map.nodes.some((n: any) => n.id === 'family:unknown')).toBe(true);

    // 6. Evidence-backed insights.
    const profile = (await me.get('/api/profile')).body;
    expect(profile.profile.totals.tracks).toBe(32);
    const insightIds = profile.insights.map((i: any) => i.id);
    expect(insightIds).toContain('top-genres');
    expect(insightIds).toContain('missing-genres');
    for (const i of profile.insights) expect(['metadata', 'inferred', 'coverage']).toContain(i.basis);

    // 7–8. Compare with community profiles; explain the scores.
    const recs = (await me.get('/api/trees/recommended')).body.recommendations;
    expect(recs.length).toBeGreaterThanOrEqual(5);
    const best = recs[0];
    expect(best.community.isDemo).toBe(true);
    expect(best.match.score).toBeGreaterThan(recs[recs.length - 1].match.score);
    expect(best.explanation.summary.length).toBeGreaterThan(20);
    const sum = best.match.components.reduce((s: number, c: any) => s + c.contribution, 0);
    expect(sum).toBeCloseTo(best.match.score, 2);

    // 9. Join the best-matching Tree.
    const join = await me.post(`/api/trees/${best.community.slug}/join`);
    expect(join.body.tree.isMember).toBe(true);

    // 10. Text chat.
    const history = (await me.get(`/api/trees/${best.community.slug}/messages`)).body.messages;
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].author.isDemo).toBe(true);
    const sent = await me.post(`/api/trees/${best.community.slug}/messages`, { body: 'Hi from the acceptance test!' });
    expect(sent.status).toBe(201);
    const after = (await me.get(`/api/trees/${best.community.slug}/messages?after=${history[history.length - 1].id}`)).body.messages;
    expect(after.map((m: any) => m.body)).toEqual(['Hi from the acceptance test!']);

    // 11. Visibility control and data removal.
    const playlist = (await me.get('/api/playlists')).body.playlists[0];
    expect((await me.patch(`/api/playlists/${playlist.id}`, { visibility: 'private' })).status).toBe(200);
    const tree = (await me.get(`/api/trees/${best.community.slug}`)).body;
    expect(tree.profile.contributingMembers).toBe(tree.profile.memberCount - 1);
    expect((await me.patch('/api/me', { profileVisibility: 'public', discoverable: false })).body.user.discoverable).toBe(false);
    const removed = await me.del('/api/me/library');
    expect(removed.body.playlistsDeleted).toBe(1);
    expect((await me.get('/api/library/tracks')).body.total).toBe(0);
    // Demo listeners' (fictional) catalogue survives; only this user's data is gone.
    expect((await get<{ n: number }>(server.ctx.db, 'SELECT COUNT(*) AS n FROM tracks'))!.n).toBeGreaterThan(100);
  });

  it('seeding is idempotent, and demo listeners cannot sign in', async () => {
    const server = await createTestServer();
    await seedDemo(server.ctx.db, server.ctx.config);
    expect((await seedDemo(server.ctx.db, server.ctx.config)).skipped).toBe(true);
    const r = await server.client().post('/api/auth/signin', { handle: 'aurora.wave', password: 'anything-at-all' });
    expect(r.status).toBe(401);
    const trees = (await server.client().get('/api/trees')).body.trees;
    expect(trees.every((t: any) => t.isDemo)).toBe(true);
    expect(trees.every((t: any) => t.memberCount >= 2)).toBe(true);
  });
});
