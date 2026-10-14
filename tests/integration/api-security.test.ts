import { describe, expect, it } from 'vitest';
import { ORIGIN, createTestServer, csv, electronicCsv } from '../helpers/server';

describe('accounts', () => {
  it('signs up, signs in and out with pseudonymous handles only', async () => {
    const { client } = createTestServer();
    const a = client();
    const signup = await a.post('/api/auth/signup', { handle: 'Nova_Fan', password: 'correct-horse-battery' });
    expect(signup.status).toBe(201);
    expect(signup.body.user.handle).toBe('nova_fan');
    expect(signup.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(signup.headers.get('set-cookie')).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(signup.body)).not.toMatch(/password|hash|email/i);
    expect((await a.get('/api/me')).body.user.handle).toBe('nova_fan');
    await a.post('/api/auth/signout');
    expect((await a.get('/api/me')).status).toBe(401);
    const b = client();
    expect((await b.post('/api/auth/signin', { handle: 'nova_fan', password: 'wrong-password-123' })).status).toBe(401);
    expect((await b.post('/api/auth/signin', { handle: 'NOVA_FAN', password: 'correct-horse-battery' })).status).toBe(200);
  });

  it('validates handles and passwords', async () => {
    const { client } = createTestServer();
    const a = client();
    expect((await a.post('/api/auth/signup', { handle: 'ab', password: 'correct-horse-battery' })).body.error.code).toBe('invalid_handle');
    expect((await a.post('/api/auth/signup', { handle: 'admin', password: 'correct-horse-battery' })).body.error.code).toBe('reserved_handle');
    expect((await a.post('/api/auth/signup', { handle: 'demo-xyz', password: 'correct-horse-battery' })).body.error.code).toBe('reserved_handle');
    expect((await a.post('/api/auth/signup', { handle: 'shortpass', password: 'short' })).body.error.code).toBe('weak_password');
    expect((await a.post('/api/auth/signup', { handle: '<script>', password: 'correct-horse-battery' })).status).toBe(400);
    await a.signup('taken-handle');
    expect((await client().post('/api/auth/signup', { handle: 'taken-handle', password: 'correct-horse-battery' })).status).toBe(409);
  });

  it('offers an explicit, expiring demo mode', async () => {
    const { client } = createTestServer();
    const a = client();
    const r = await a.post('/api/auth/demo');
    expect(r.status).toBe(201);
    expect(r.body.user.handle).toMatch(/^demo-[0-9a-f]{6}$/);
    expect(r.body.user.isDemo).toBe(1);
    expect(new Date(r.body.user.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const off = createTestServer({ env: { DEMO_MODE_ENABLED: 'false' } });
    expect((await off.client().post('/api/auth/demo')).status).toBe(403);
  });

  it('rate-limits sign-in attempts', async () => {
    const { client } = createTestServer();
    const a = client();
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await a.post('/api/auth/signin', { handle: 'nobody', password: 'wrong-password-1' })).status;
    expect(last).toBe(429);
  });
});

describe('CSRF and input hardening', () => {
  it('rejects cross-origin and non-JSON state changes', async () => {
    const { app } = createTestServer();
    const cross = await app.request('/api/auth/demo', { method: 'POST', headers: { Origin: 'https://evil.example' } });
    expect(cross.status).toBe(403);
    const form = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': '19' },
      body: 'handle=x&password=y',
    });
    expect(form.status).toBe(415);
    const chunked = await app.request('/api/auth/signup', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain', 'Transfer-Encoding': 'chunked' }, body: 'x' });
    expect(chunked.status).toBe(415);
    const site = await app.request('/api/auth/demo', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(site.status).toBe(403);
    const bad = await app.request('/api/auth/signup', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{not json' });
    expect(bad.status).toBe(400);
  });

  it('sets security headers', async () => {
    const { app } = createTestServer();
    const r = await app.request('/api/health');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
  });
});

describe('cross-user data isolation', () => {
  async function twoUsers() {
    const server = createTestServer();
    const a = server.client();
    const b = server.client();
    await a.signup('alice-listener');
    await b.signup('bruno-listener');
    const imported = await a.importCsv(electronicCsv('Alice', 12), { name: 'Alice private' });
    await server.ctx.queue.drain();
    return { ...server, a, b, imported };
  }

  it('never shows one user’s library, tracks, jobs or profile to another', async () => {
    const { a, b, imported } = await twoUsers();
    const aTrack = (await a.get('/api/library/tracks')).body.tracks[0];
    expect((await b.get('/api/library/tracks')).body.total).toBe(0);
    expect((await b.get(`/api/library/tracks/${aTrack.id}`)).status).toBe(404);
    expect((await b.get('/api/playlists')).body.playlists).toEqual([]);
    expect((await b.get(`/api/imports/jobs/${imported.jobId}`)).status).toBe(404);
    expect((await b.get('/api/profile')).body.profile).toBeNull();
    expect((await b.get('/api/profile/map')).body.map).toBeNull();
    expect((await b.get('/api/library/tracks?playlist=' + imported.playlistId)).body.total).toBe(0);
  });

  it('prevents changing another user’s playlists and entries', async () => {
    const { a, b, imported } = await twoUsers();
    const aTrack = (await a.get('/api/library/tracks')).body.tracks[0];
    expect((await b.patch(`/api/playlists/${imported.playlistId}`, { visibility: 'public', name: 'pwned' })).status).toBe(404);
    expect((await b.del(`/api/playlists/${imported.playlistId}`)).status).toBe(404);
    expect((await b.patch(`/api/playlists/${imported.playlistId}/tracks/${aTrack.id}`, { hidden: true })).status).toBe(404);
    const mine = (await a.get('/api/playlists')).body.playlists[0];
    expect(mine).toMatchObject({ name: 'Alice private', visibility: 'private' });
  });

  it('keeps private playlists out of public profiles, comparisons and matching', async () => {
    const { a, b, ctx } = await twoUsers();
    await a.patch('/api/me', { profileVisibility: 'public', discoverable: true });
    const profile = (await b.get('/api/users/alice-listener')).body;
    expect(profile.visible).toBe(true);
    expect(profile.profile.totals.tracks).toBe(0);
    expect(profile.playlists).toEqual([]);
    const shared = ctx.db.prepare("SELECT track_count FROM music_profiles WHERE user_id = ? AND scope = 'shared'").get(a.user!.id) as { track_count: number };
    expect(shared.track_count).toBe(0);
    await b.importCsv(electronicCsv('Bruno', 10));
    const compare = await b.get('/api/compare/alice-listener');
    expect(compare.status).toBe(409);
    expect(compare.body.error.code).toBe('no_shared_library');
  });

  it('lists public playlists, and reveals shared names only from public playlists', async () => {
    const { a, b } = await twoUsers();
    await a.patch('/api/me', { profileVisibility: 'public', discoverable: true });
    const pub = await a.importCsv(csv([['Glass Orbit', 'Nova Lattice', '', 'synthwave'], ['Paper Comets', 'Nova Lattice', '', 'synthwave'], ['Fern Circuit', 'Pulse Garden', '', 'techno']]), {
      name: 'Alice public',
      visibility: 'public',
    });
    await a.importCsv(csv([['Secret Song', 'Hidden Artist', '', 'synthwave']]), { name: 'Alice shared-only', visibility: 'shared' });
    void pub;
    await b.importCsv(csv([['Glass Orbit', 'Nova Lattice', '', 'synthwave'], ['Secret Song', 'Hidden Artist', '', 'synthwave'], ['Other', 'Pulse Garden', '', 'techno']]));
    const profile = (await b.get('/api/users/alice-listener')).body;
    expect(profile.playlists.map((p: any) => p.name)).toEqual(['Alice public']);
    expect(JSON.stringify(profile)).not.toContain('Secret Song');
    expect(JSON.stringify(profile)).not.toContain('Alice private');
    const compare = (await b.get('/api/compare/alice-listener')).body;
    expect(compare.match.components.find((c: any) => c.key === 'tracks').sharedCount).toBe(2);
    expect(compare.sharedPublic.tracks.map((t: any) => t.label)).toEqual(['Glass Orbit — Nova Lattice']);
    expect(JSON.stringify(compare.sharedPublic)).not.toContain('Hidden Artist');
    expect(JSON.stringify(compare.explanation)).not.toContain('Hidden Artist');
  });

  it('hides private profiles and supports members-only visibility', async () => {
    const { a, b } = await twoUsers();
    const r = (await b.get('/api/users/alice-listener')).body;
    expect(r.visible).toBe(false);
    expect(r.profile).toBeUndefined();
    await a.patch('/api/me', { profileVisibility: 'members' });
    expect((await b.get('/api/users/alice-listener')).body.visible).toBe(false);
  });

  it('respects blocks for profiles and comparison', async () => {
    const { a, b } = await twoUsers();
    await a.patch('/api/me', { profileVisibility: 'public', discoverable: true });
    await a.post('/api/blocks', { handle: 'bruno-listener', kind: 'block' });
    expect((await b.get('/api/users/alice-listener')).status).toBe(404);
    expect((await b.get('/api/compare/alice-listener')).status).toBe(404);
    expect((await a.get('/api/blocks')).body.blocks[0].handle).toBe('bruno-listener');
    await a.del('/api/blocks/bruno-listener');
    expect((await b.get('/api/users/alice-listener')).status).toBe(200);
  });

  it('requires reciprocity for listener discovery', async () => {
    const { b } = await twoUsers();
    const r = (await b.get('/api/discover/listeners')).body;
    expect(r.requiresDiscoverable).toBe(true);
    expect(r.listeners).toEqual([]);
  });
});

describe('data control and deletion', () => {
  it('deletes imported music data on request and prunes the catalogue', async () => {
    const { client, ctx } = createTestServer();
    const a = client();
    await a.signup('deleter');
    await a.importCsv(electronicCsv('Gone', 6));
    expect((await a.get('/api/library/tracks')).body.total).toBe(6);
    const r = await a.del('/api/me/library');
    expect(r.body.playlistsDeleted).toBe(1);
    expect((await a.get('/api/library/tracks')).body.total).toBe(0);
    expect((await a.get('/api/profile')).body.profile.totals.tracks).toBe(0);
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n).toBe(0);
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM artists').get() as { n: number }).n).toBe(0);
  });

  it('deletes the account and everything it owns after explicit confirmation', async () => {
    const { client, ctx } = createTestServer();
    const a = client();
    const user = await a.signup('leaving-soon');
    await a.importCsv(electronicCsv('Bye', 4));
    expect((await a.del('/api/me', { confirmHandle: 'someone-else' })).status).toBe(400);
    expect((await a.del('/api/me', { confirmHandle: 'leaving-soon' })).status).toBe(200);
    expect((await a.get('/api/me')).status).toBe(401);
    for (const table of ['users', 'sessions', 'playlists', 'music_profiles', 'profile_artists', 'import_jobs']) {
      const n = (ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'users' ? 'id' : 'user_id'} = ?`).get(user.id) as { n: number }).n;
      expect(n, table).toBe(0);
    }
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM tracks').get() as { n: number }).n).toBe(0);
  });

  it('exports the user’s data without secrets', async () => {
    const { client, ctx } = createTestServer();
    const a = client();
    const user = await a.signup('exporter');
    await a.importCsv(csv([['Glass Orbit', 'Nova Lattice']]));
    ctx.providers.storeTokens(user.id, 'spotify', 'secret-access-token-value', 'secret-refresh-token-value', null, 'playlist-read-private');
    const r = await a.get('/api/me/export');
    expect(r.headers.get('content-disposition')).toContain('somm-export-exporter.json');
    const text = JSON.stringify(r.body);
    expect(r.body.playlists[0].tracks[0].title).toBe('Glass Orbit');
    expect(r.body.connections[0].provider).toBe('spotify');
    expect(text).not.toContain('secret-access-token-value');
    expect(text).not.toContain('secret-refresh-token-value');
    expect(text).not.toContain('password_hash');
    expect(text).not.toContain('scrypt$');
  });

  it('stores provider tokens encrypted and never returns them', async () => {
    const { client, ctx } = createTestServer();
    const a = client();
    const user = await a.signup('token-owner');
    ctx.providers.storeTokens(user.id, 'spotify', 'plain-access-token', null, null, null);
    const row = ctx.db.prepare('SELECT access_token_enc FROM provider_connections WHERE user_id = ?').get(user.id) as { access_token_enc: string };
    expect(row.access_token_enc).not.toContain('plain-access-token');
    expect(row.access_token_enc.startsWith('v1.')).toBe(true);
    const providers = await a.get('/api/providers');
    expect(JSON.stringify(providers.body)).not.toContain('plain-access-token');
    expect(providers.body.providers.find((p: any) => p.id === 'spotify').state).toBe('needs_credentials');
    expect((await a.del('/api/providers/spotify')).body.disconnected).toBe(true);
  });

  it('expires demo accounts and YouTube-derived data in housekeeping', async () => {
    const { client, ctx } = createTestServer();
    const { housekeeping } = await import('../../src/server/services/accounts');
    const a = client();
    const demo = (await a.post('/api/auth/demo')).body.user;
    await a.importCsv(csv([['Glass Orbit', 'Nova Lattice']]));
    ctx.db.prepare('UPDATE users SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', demo.id);
    const b = client();
    await b.signup('yt-user');
    await b.importCsv(csv([['Echo', 'Mira Sol']]));
    ctx.db.prepare("UPDATE playlists SET data_expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?").run(b.user!.id);
    const r = housekeeping(ctx.db);
    expect(r.demoAccounts).toBe(1);
    expect(r.expiredPlaylists).toEqual([b.user!.id]);
    expect(ctx.db.prepare('SELECT 1 FROM users WHERE id = ?').get(demo.id)).toBeUndefined();
    expect((await b.get('/api/playlists')).body.playlists).toEqual([]);
  });
});

describe('library browsing', () => {
  it('searches, filters, sorts and paginates', async () => {
    const { client, ctx } = createTestServer();
    const a = client();
    await a.signup('browser');
    await a.importCsv(
      csv([
        ['Glass Orbit', 'Nova Lattice', 'Neon Tides', 'synthwave', '2019'],
        ['Quiet Engine', 'Teo Vance', 'Night Shift', 'hard bop', '1964'],
        ['Harbour Lights', 'Ivy Marlowe', 'Salt', '', '2021'],
        ['Fern Circuit', 'Pulse Garden', 'Moss', 'techno', '2016'],
        ['A'.repeat(280), 'Long Name Artist '.repeat(10), '', 'ambient', '2001'],
      ]),
    );
    await ctx.queue.drain();
    expect((await a.get('/api/library/tracks?q=orbit')).body.tracks.map((t: any) => t.title)).toEqual(['Glass Orbit']);
    expect((await a.get('/api/library/tracks?q=teo')).body.total).toBe(1);
    expect((await a.get('/api/library/tracks?q=neon')).body.total).toBe(1);
    expect((await a.get('/api/library/tracks?genre=hard%20bop')).body.tracks[0].title).toBe('Quiet Engine');
    expect((await a.get('/api/library/tracks?family=electronic')).body.total).toBe(2);
    expect((await a.get('/api/library/tracks?unknownGenre=1')).body.tracks.map((t: any) => t.title)).toEqual(['Harbour Lights']);
    expect((await a.get('/api/library/tracks?sort=year&dir=asc')).body.tracks.map((t: any) => t.year)).toEqual([1964, 2001, 2016, 2019, 2021]);
    const page = (await a.get('/api/library/tracks?sort=title&pageSize=2&page=2')).body;
    expect(page.total).toBe(5);
    expect(page.tracks).toHaveLength(2);
    expect((await a.get('/api/library/tracks?pageSize=500')).status).toBe(400);
    const long = (await a.get('/api/library/tracks?q=long%20name')).body.tracks[0];
    expect(long.title.length).toBeLessThanOrEqual(300);
    expect(long.coverage).toEqual({ genre: true, year: true, album: false, duration: false });
    const facets = (await a.get('/api/library/facets')).body;
    expect(facets.totals.tracks).toBe(5);
    expect(facets.unknownGenreCount).toBe(1);
    expect(facets.providers).toEqual([{ provider: 'csv', n: 5 }]);
    const artistId = (await a.get('/api/library/tracks?q=nova')).body.tracks[0].artist.id;
    expect((await a.get(`/api/library/tracks?artist=${artistId}`)).body.total).toBe(1);
  });

  it('filters by inferred attributes via their source genres', async () => {
    const { client } = createTestServer();
    const a = client();
    await a.signup('attr-filter');
    await a.importCsv(csv([['Glass Orbit', 'Nova Lattice', '', 'synthwave'], ['Quiet Engine', 'Teo Vance', '', 'hard bop']]));
    const r = (await a.get('/api/library/tracks?attribute=instrument%3Asynthesizer')).body;
    expect(r.tracks.map((t: any) => t.title)).toEqual(['Glass Orbit']);
  });

  it('regenerates the map after importing more music', async () => {
    const { client } = createTestServer();
    const a = client();
    await a.signup('mapper');
    await a.importCsv(csv([['Glass Orbit', 'Nova Lattice', '', 'synthwave']]));
    const m1 = (await a.get('/api/profile/map')).body.map;
    await a.importCsv(jazzRows());
    const m2 = (await a.get('/api/profile/map')).body.map;
    expect(m2.nodes.length).toBeGreaterThan(m1.nodes.length);
    expect(m2.nodes.map((n: any) => n.id)).toContain('family:jazz');
    const again = await a.post('/api/profile/regenerate');
    expect(again.body.ok).toBe(true);
    expect((await a.get('/api/profile/map')).body.map).toEqual(m2);
  });
});

function jazzRows() {
  return csv([
    ['Quiet Engine', 'Teo Vance', '', 'hard bop', '1964'],
    ['Blue Hour', 'Blue Lantern', '', 'cool jazz', '1959'],
  ]);
}
