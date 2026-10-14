/**
 * Provider adapters against hand-written mocks shaped like the documented API
 * responses. These prove SOMM's handling (pagination, retries, errors, field
 * mapping) — not that a live provider integration works.
 */
import { describe, expect, it } from 'vitest';
import { fetchJson, parseRetryAfter, ProviderError, RateLimiter } from '../../src/server/http';
import { AppleMusicClient } from '../../src/server/import/adapters/applemusic';
import { SpotifyClient, spotifyAuthorizeUrl } from '../../src/server/import/adapters/spotify';
import { parseAppleMusicPlaylist, parseSpotifyPlaylist, parseYouTubePlaylist } from '../../src/server/import/adapters/urls';
import { YouTubeClient } from '../../src/server/import/adapters/youtube';
import { ImportError } from '../../src/server/import/types';
import { json, mockFetch, noSleep } from '../helpers/mockfetch';

const spotifyTrack = (id: string, name: string, artist: string, extra: Record<string, unknown> = {}) => ({
  type: 'track',
  id,
  name,
  artists: [{ id: `ar-${artist}`, name: artist }],
  album: { id: 'al1', name: 'Neon Tides', release_date: '2019-04-01', images: [{ url: 'https://i.scdn.co/image/abc', width: 300 }] },
  duration_ms: 252000,
  explicit: false,
  external_ids: { isrc: 'QZFAK1900001' },
  external_urls: { spotify: `https://open.spotify.com/track/${id}` },
  ...extra,
});

describe('http helpers', () => {
  it('retries 429 using Retry-After, then succeeds', async () => {
    const waits: number[] = [];
    const { fetchImpl, calls } = mockFetch([
      { match: /example/, respond: (_u, _i, n) => (n === 1 ? json({}, 429, { 'Retry-After': '2' }) : json({ ok: true })) },
    ]);
    const r = await fetchJson<{ ok: boolean }>('https://api.example/x', {}, { provider: 'Test', fetchImpl, sleep: async (ms) => void waits.push(ms) });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2000]);
  });

  it('gives up after bounded retries with a typed error', async () => {
    const { fetchImpl, calls } = mockFetch([{ match: /example/, respond: () => json({}, 503) }]);
    await expect(fetchJson('https://api.example/x', {}, { provider: 'Test', fetchImpl, retries: 2, sleep: noSleep })).rejects.toMatchObject({ code: 'unavailable', status: 503 });
    expect(calls).toHaveLength(3);
  });

  it('maps 401/403/404 to error codes without retrying', async () => {
    for (const [status, code] of [[401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found']] as const) {
      const { fetchImpl, calls } = mockFetch([{ match: /example/, respond: () => json({ error: 'x' }, status) }]);
      await expect(fetchJson('https://api.example/x', {}, { provider: 'Test', fetchImpl, sleep: noSleep })).rejects.toMatchObject({ code });
      expect(calls).toHaveLength(1);
    }
  });

  it('handles network failures', async () => {
    const fetchImpl = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(fetchJson('https://api.example/x', {}, { provider: 'Test', fetchImpl, retries: 1, sleep: noSleep })).rejects.toMatchObject({ code: 'network' });
  });

  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(3000);
  });

  it('spaces rate-limited calls', async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = new RateLimiter(1000, async (ms) => {
      waits.push(ms);
      now += ms;
    }, () => now);
    await Promise.all([limiter.schedule(async () => 1), limiter.schedule(async () => 2), limiter.schedule(async () => 3)]);
    expect(waits).toEqual([1000, 1000]);
  });
});

describe('playlist URL validation', () => {
  it('accepts official Spotify playlist references only', () => {
    expect(parseSpotifyPlaylist('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc')).toEqual({ provider: 'spotify', id: '37i9dQZF1DXcBWIGoYBM5M' });
    expect(parseSpotifyPlaylist('https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M').id).toBe('37i9dQZF1DXcBWIGoYBM5M');
    expect(parseSpotifyPlaylist('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M').id).toBe('37i9dQZF1DXcBWIGoYBM5M');
    expect(() => parseSpotifyPlaylist('https://evil.example/playlist/37i9dQZF1DXcBWIGoYBM5M')).toThrow(ImportError);
    expect(() => parseSpotifyPlaylist('https://open.spotify.com/album/37i9dQZF1DXcBWIGoYBM5M')).toThrow(ImportError);
  });

  it('accepts YouTube and YouTube Music playlist links and rejects unreadable lists', () => {
    expect(parseYouTubePlaylist('https://music.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG').id).toBe('PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
    expect(parseYouTubePlaylist('https://www.youtube.com/watch?v=abc&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG').id).toBe('PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG');
    expect(() => parseYouTubePlaylist('https://www.youtube.com/playlist?list=RDCLAK5uy_kmPRjHDECIcuVwnKsx')).toThrow(/Mix/);
    expect(() => parseYouTubePlaylist('https://www.youtube.com/playlist?list=LL')).toThrow();
    expect(() => parseYouTubePlaylist('https://youtube.evil.example/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG')).toThrow(ImportError);
    expect(() => parseYouTubePlaylist('javascript:alert(1)')).toThrow(ImportError);
  });

  it('distinguishes Apple Music catalogue and library playlists', () => {
    expect(parseAppleMusicPlaylist('https://music.apple.com/us/playlist/neon-tides/pl.u-abc123')).toEqual({ provider: 'apple_music', storefront: 'us', id: 'pl.u-abc123', library: false });
    expect(parseAppleMusicPlaylist('https://music.apple.com/gb/playlist/p.AbCdEf12')).toMatchObject({ library: true });
    expect(() => parseAppleMusicPlaylist('https://itunes.apple.com/us/playlist/x')).toThrow(ImportError);
  });
});

describe('Spotify adapter', () => {
  it('builds a PKCE authorisation URL with minimal scopes', () => {
    const { url, verifier } = spotifyAuthorizeUrl('client123', 'http://127.0.0.1:8787/api/providers/spotify/callback', 'state-xyz');
    const u = new URL(url);
    expect(u.hostname).toBe('accounts.spotify.com');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toBe('playlist-read-private playlist-read-collaborative');
    expect(u.searchParams.has('client_secret')).toBe(false);
    expect(verifier.length).toBeGreaterThan(40);
  });

  it('paginates /playlists/{id}/items, reads `item`, skips local files and episodes', async () => {
    const { fetchImpl, calls } = mockFetch([
      { match: /\/playlists\/PL1\?fields/, respond: () => json({ name: 'Neon Mix', external_urls: { spotify: 'https://open.spotify.com/playlist/PL1' } }) },
      {
        match: /\/playlists\/PL1\/items\?limit=50/,
        respond: () =>
          json({
            items: [
              { item: spotifyTrack('t1', 'Glass Orbit', 'Nova Lattice') },
              { is_local: true, item: { ...spotifyTrack('t2', 'Local', 'Me'), id: null, is_local: true } },
              { item: { type: 'episode', id: 'e1', name: 'Podcast', artists: [] } },
            ],
            next: 'https://api.spotify.com/v1/playlists/PL1/items?offset=50&limit=50',
            total: 4,
          }),
      },
      { match: /\/playlists\/PL1\/items\?offset=50/, respond: () => json({ items: [{ track: spotifyTrack('t3', 'Paper Comets', 'Nova Lattice') }], next: null, total: 4 }) },
      { match: /\/artists\/ar-Nova%20Lattice|\/artists\/ar-Nova Lattice/, respond: () => json({ genres: ['synthwave', 'retrowave'] }) },
    ]);
    const p = await new SpotifyClient('token', fetchImpl, noSleep).getPlaylist('PL1');
    expect(p.name).toBe('Neon Mix');
    expect(p.entries.map((e) => e.title)).toEqual(['Glass Orbit', 'Paper Comets']);
    expect(p.entries[0]).toMatchObject({
      isrc: 'QZFAK1900001',
      durationMs: 252000,
      providerIds: [{ namespace: 'spotify:track', value: 't1' }],
      genres: ['synthwave', 'retrowave'],
      genreKind: 'provider',
      genreSource: 'spotify:artist',
    });
    expect(p.notes.join(' ')).toMatch(/local file/);
    expect(p.notes.join(' ')).toMatch(/podcast episode/);
    expect(p.notes.join(' ')).toMatch(/deprecated/);
    expect(calls.every((c) => (c.init?.headers as Record<string, string>).Authorization === 'Bearer token')).toBe(true);
  });

  it('explains the owner/collaborator restriction on 403', async () => {
    const { fetchImpl } = mockFetch([
      { match: /\/playlists\/PL2\?fields/, respond: () => json({ name: 'Editorial' }) },
      { match: /\/playlists\/PL2\/items/, respond: () => json({ error: { status: 403 } }, 403) },
    ]);
    const err = await new SpotifyClient('token', fetchImpl, noSleep).getPlaylist('PL2').catch((e) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err.code).toBe('not_authorized');
    expect(err.message).toMatch(/own or collaborate/);
    expect(err.message).toMatch(/Exportify/);
  });

  it('flags which playlists are importable', async () => {
    const { fetchImpl } = mockFetch([
      { match: /\/me$/, respond: () => json({ id: 'me', display_name: 'Me' }) },
      {
        match: /\/me\/playlists/,
        respond: () =>
          json({
            items: [
              { id: 'a', name: 'Mine', collaborative: false, owner: { id: 'me' }, items: { total: 10 } },
              { id: 'b', name: 'Shared with me', collaborative: true, owner: { id: 'friend' } },
              { id: 'c', name: 'Followed editorial', collaborative: false, owner: { id: 'spotify' } },
            ],
            next: null,
            total: 3,
          }),
      },
    ]);
    const list = await new SpotifyClient('token', fetchImpl, noSleep).listPlaylists();
    expect(list.map((p) => [p.name, p.importable])).toEqual([
      ['Mine', true],
      ['Shared with me', true],
      ['Followed editorial', false],
    ]);
  });

  it('surfaces rate limiting after retries', async () => {
    const { fetchImpl } = mockFetch([{ match: /spotify/, respond: () => json({}, 429, { 'Retry-After': '1' }) }]);
    await expect(new SpotifyClient('token', fetchImpl, noSleep).getPlaylist('PL3')).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('YouTube adapter', () => {
  it('parses video titles, skips private/deleted videos and sets 30-day retention', async () => {
    const { fetchImpl, calls } = mockFetch([
      { match: /\/playlists\?/, respond: () => json({ items: [{ snippet: { title: 'Late Night Synths' } }] }) },
      {
        match: /\/playlistItems\?/,
        respond: (url) =>
          url.includes('pageToken=P2')
            ? json({ items: [{ snippet: { title: 'Glass Orbit', position: 2, videoOwnerChannelTitle: 'Nova Lattice - Topic', resourceId: { kind: 'youtube#video', videoId: 'vid00000003' } } }] })
            : json({
                nextPageToken: 'P2',
                items: [
                  { snippet: { title: 'Kilo Ray - Midnight Relay (Official Video)', position: 0, videoOwnerChannelTitle: 'KiloRayVEVO', resourceId: { kind: 'youtube#video', videoId: 'vid00000001' } } },
                  { snippet: { title: 'Private video', position: 1, resourceId: { kind: 'youtube#video', videoId: 'vid00000002' } }, status: { privacyStatus: 'private' } },
                ],
              }),
      },
    ]);
    const p = await new YouTubeClient('key', fetchImpl, noSleep).getPlaylist('PLtest123456');
    expect(p.name).toBe('Late Night Synths');
    expect(p.entries.map((e) => `${e.artists[0]} — ${e.title}`)).toEqual(['Kilo Ray — Midnight Relay', 'Nova Lattice — Glass Orbit']);
    expect(p.retentionDays).toBe(30);
    expect(p.notes.join(' ')).toMatch(/1 private, deleted/);
    expect(calls[1]?.url).toContain('maxResults=50');
    expect(p.entries[0]?.genres).toBeUndefined();
  });

  it('reports private or missing playlists honestly', async () => {
    const { fetchImpl } = mockFetch([{ match: /\/playlists\?/, respond: () => json({ items: [] }) }]);
    await expect(new YouTubeClient('key', fetchImpl, noSleep).getPlaylist('PLmissing1234')).rejects.toMatchObject({ code: 'not_found' });
    const forbidden = mockFetch([{ match: /\/playlists\?/, respond: () => json({}, 403) }]);
    await expect(new YouTubeClient('key', forbidden.fetchImpl, noSleep).getPlaylist('PLprivate1234')).rejects.toMatchObject({ code: 'not_authorized' });
  });
});

describe('Apple Music adapter', () => {
  it('maps catalogue songs with genreNames and drops the generic "Music" genre', async () => {
    const { fetchImpl, calls } = mockFetch([
      { match: /\/catalog\/us\/playlists\/pl\.abc$/, respond: () => json({ data: [{ attributes: { name: 'Harbour Haze' } }] }) },
      {
        match: /\/catalog\/us\/playlists\/pl\.abc\/tracks/,
        respond: () =>
          json({
            data: [
              { id: '111', type: 'songs', attributes: { name: 'Harbour Lights', artistName: 'Ivy Marlowe', albumName: 'Salt & Signal', durationInMillis: 211000, isrc: 'QZFAK2100003', releaseDate: '2021-05-01', genreNames: ['Indie Folk', 'Music'], contentRating: 'explicit', url: 'https://music.apple.com/us/song/111' } },
              { id: 'mv1', type: 'music-videos', attributes: { name: 'Video', artistName: 'X' } },
            ],
          }),
      },
    ]);
    const p = await new AppleMusicClient('dev', null, fetchImpl, noSleep).getPlaylist({ id: 'pl.abc', storefront: 'us', library: false });
    expect(p.entries).toHaveLength(1);
    expect(p.entries[0]).toMatchObject({ title: 'Harbour Lights', genres: ['Indie Folk'], genreKind: 'provider', explicit: true, isrc: 'QZFAK2100003' });
    expect((calls[0]?.init?.headers as Record<string, string>)['Music-User-Token']).toBeUndefined();
  });

  it('requires a Music User Token for library playlists', async () => {
    const { fetchImpl } = mockFetch([]);
    await expect(new AppleMusicClient('dev', null, fetchImpl).getPlaylist({ id: 'p.x', storefront: 'us', library: true })).rejects.toMatchObject({ code: 'needs_connection' });
  });
});
