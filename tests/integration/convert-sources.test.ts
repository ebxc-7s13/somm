/**
 * Converter sources and song matching: forgiving name lists, track links read
 * through official oEmbed endpoints, YouTube playlists without an account, and
 * MusicBrainz matching that fills only empty fields. All network calls are
 * mocked with fictional data.
 */
import { describe, expect, it } from 'vitest';
import { loadConfig, PROJECT_URL } from '../../src/server/config';
import { SongMatcher } from '../../src/server/enrich/matcher';
import { MusicBrainzClient } from '../../src/server/enrich/musicbrainz';
import { parseNameList } from '../../src/server/import/adapters/files';
import { classifyLink, containsLinks } from '../../src/server/import/adapters/oembed';
import { createTestServer } from '../helpers/server';
import { json, mockFetch, noSleep } from '../helpers/mockfetch';

const credit = (name: string, id = `mb-${name.toLowerCase().replace(/\W+/g, '-')}`) => ({ name, artist: { id, name } });
const release = (title: string, date: string, type = 'Album', secondary: string[] = []) => ({ title, date, 'release-group': { 'primary-type': type, 'secondary-types': secondary } });

/** A fictional MusicBrainz: answers searches by decoding the Lucene query. */
function musicBrainz(opts: { fail?: boolean } = {}) {
  const mock = mockFetch([
    {
      match: /\/ws\/2\/recording\?query=/,
      respond: (url) => {
        if (opts.fail) return json({}, 503);
        const q = decodeURIComponent(new URL(url).searchParams.get('query') ?? '');
        const artist = q.match(/artist:"([^"]+)"/)?.[1] ?? null;
        const title = q.match(/recording:"([^"]+)"/)?.[1] ?? '';
        if (title === 'Glass Orbit' && artist === 'Nova Lattice') {
          return json({
            recordings: [
              { id: 'rec-cover', score: 100, title: 'Glass Orbit', 'artist-credit': [credit('Other Band')], releases: [release('Covers', '2023')] },
              {
                id: 'rec-original',
                score: 100,
                title: 'Glass Orbit',
                'first-release-date': '2019-04-01',
                'artist-credit': [credit('Nova Lattice')],
                releases: [release('Signals (Live)', '2021', 'Album', ['Live']), release('Signals', '2019-04-01'), release('Best Of', '2022', 'Album', ['Compilation'])],
              },
              // Earlier, but a live recording and a music video: not the original.
              { id: 'rec-live', score: 99, title: 'Glass Orbit', disambiguation: 'live, 2018-05-01', 'first-release-date': '2018-05-01', 'artist-credit': [credit('Nova Lattice')], releases: [release('Live 2018', '2018-05-01')] },
              { id: 'rec-video', score: 98, title: 'Glass Orbit', video: true, 'first-release-date': '2017-01-01', 'artist-credit': [credit('Nova Lattice')], releases: [] },
            ],
          });
        }
        if (title === 'Silver Line' && artist === 'Ivy Marlowe') {
          // Mirrors a real case: the later solo re-recording scores highest, the original duet scores 83.
          return json({
            recordings: [
              { id: 'rec-solo-2025', score: 100, title: 'Silver Line', 'first-release-date': '2025-09-01', 'artist-credit': [credit('Ivy Marlowe')], releases: [release('Deluxe', '2025-09-01')] },
              { id: 'rec-duet-live', score: 83, title: 'Silver Line', disambiguation: 'live, 2024-08-27', 'first-release-date': '2024-10-17', 'artist-credit': [credit('Ivy Marlowe'), credit('Kilo Ray')], releases: [] },
              { id: 'rec-duet-instr', score: 78, title: 'Silver Line (instrumental)', 'first-release-date': '2024-08-20', 'artist-credit': [credit('Ivy Marlowe'), credit('Kilo Ray')], releases: [] },
              // A compilation with only a year as its date must not beat the original from the same year.
              { id: 'rec-comp', score: 90, title: 'Silver Line', 'first-release-date': '2024', 'artist-credit': [credit('Ivy Marlowe'), credit('Kilo Ray')], releases: [release('Club Hits Vol. 9', '2024', 'Album')] },
              { id: 'rec-silver', score: 83, title: 'Silver Line', 'first-release-date': '2024-08-16', 'artist-credit': [credit('Ivy Marlowe'), credit('Kilo Ray')], releases: [release('Silver Line', '2024-08-16', 'Single'), release('Hits', '2025', 'Album', ['Compilation'])] },
            ],
          });
        }
        if (title === 'Paper Moons' && artist === 'Ivy Marlowe') {
          return json({
            recordings: [
              {
                id: 'rec-duet',
                score: 100,
                title: 'Paper Moons',
                'artist-credit': [credit('Ivy Marlowe'), credit('Kilo Ray')],
                releases: [release('Best Of Ivy', '2023', 'Album'), release('Moonlight (Original Soundtrack)', '2020', 'Album', ['Soundtrack']), release('Live Duets', '2021', 'Album', ['Live'])],
              },
            ],
          });
        }
        if (title === 'Quiet Engine' && !artist) {
          return json({
            recordings: [
              { id: 'rec-qe1', score: 100, title: 'Quiet Engine', 'artist-credit': [credit('Teo Vance')], releases: [release('Engines', '1964'), release('Jazz Hits', '1990', 'Album', ['Compilation'])] },
              { id: 'rec-qe2', score: 97, title: 'Quiet Engine (Live)', 'artist-credit': [credit('Teo Vance')], releases: [release('Live at Hall', '1966', 'Album', ['Live'])] },
            ],
          });
        }
        if (title === 'Blue Hour' && !artist) {
          return json({
            recordings: [
              { id: 'rec-b1', score: 100, title: 'Blue Hour', 'artist-credit': [credit('Teo Vance')], releases: [] },
              { id: 'rec-b2', score: 100, title: 'Blue Hour', 'artist-credit': [credit('Mira Sol')], releases: [] },
            ],
          });
        }
        return json({ recordings: [] });
      },
    },
    {
      match: /\/ws\/2\/recording\/rec-original/,
      respond: () => json({ id: 'rec-original', title: 'Glass Orbit', 'first-release-date': '2019-04-01', 'artist-credit': [credit('Nova Lattice')], genres: [{ name: 'synthwave', count: 4 }, { name: 'electronic', count: 2 }], tags: [], isrcs: ['QZFAK1900001'], relations: [] }),
    },
    {
      match: /\/ws\/2\/recording\/rec-duet/,
      respond: () => json({ id: 'rec-duet', title: 'Paper Moons', 'first-release-date': '2020', 'artist-credit': [credit('Ivy Marlowe'), credit('Kilo Ray')], genres: [], tags: [], isrcs: [], relations: [] }),
    },
    {
      match: /\/ws\/2\/recording\/rec-silver/,
      respond: () => json({ id: 'rec-silver', title: 'Silver Line', 'first-release-date': '2024-08-16', 'artist-credit': [credit('Ivy Marlowe'), credit('Kilo Ray')], genres: [{ name: 'soul', count: 2 }], tags: [], isrcs: [], relations: [] }),
    },
    {
      match: /\/ws\/2\/recording\/rec-qe1/,
      respond: () => json({ id: 'rec-qe1', title: 'Quiet Engine', 'first-release-date': '1964', 'artist-credit': [credit('Teo Vance')], genres: [{ name: 'hard bop', count: 2 }], tags: [], isrcs: [], relations: [] }),
    },
    { match: /\/ws\/2\/artist\/mb-ivy-marlowe/, respond: () => json({ genres: [{ name: 'indie pop', count: 3 }] }) },
  ]);
  return { ...mock, client: new MusicBrainzClient('test@example.invalid', mock.fetchImpl, { intervalMs: 0, sleep: noSleep }) };
}

const row = (title: string, artist = '', extra: Partial<Record<'album' | 'year' | 'genre' | 'isrc', string>> = {}) => ({ title, artist, album: '', year: '', genre: '', isrc: '', ...extra });

describe('song matching (MusicBrainz)', () => {
  it('matches title + artist, prefers the original release, and fills only empty fields', async () => {
    const { client, calls } = musicBrainz();
    const matcher = new SongMatcher(client);
    const r = await matcher.match(row('Glass Orbit (Official Music Video)', 'Nova Lattice', { genre: 'my own genre' }));
    expect(r.status).toBe('matched');
    expect(r.url).toBe('https://musicbrainz.org/recording/rec-original');
    expect(r.fill).toEqual({ album: 'Signals', year: '2019-04-01', isrc: 'QZFAK1900001' });
    // Cached: the same song again makes no new requests.
    const before = calls.length;
    await matcher.match(row('Glass Orbit', 'Nova Lattice'));
    expect(calls.length).toBe(before);
    expect((await matcher.match(row('Glass Orbit', 'Nova Lattice'))).fill.genre).toBe('synthwave; electronic');
  });

  it('takes the earliest original over later re-recordings, live, instrumental and video versions', async () => {
    const { client } = musicBrainz();
    const r = await new SongMatcher(client).match(row('Silver Line', 'Ivy Marlowe'));
    expect(r.url).toBe('https://musicbrainz.org/recording/rec-silver');
    expect(r.fill).toMatchObject({ album: 'Silver Line', year: '2024-08-16', genre: 'soul' });
  });

  it('tries the first artist of a multi-artist credit and falls back to artist genres', async () => {
    const { client } = musicBrainz();
    const r = await new SongMatcher(client).match(row('Paper Moons', 'Ivy Marlowe, Kilo Ray'));
    expect(r.status).toBe('matched');
    // Film songs: the soundtrack is the original album.
    expect(r.fill).toMatchObject({ album: 'Moonlight (Original Soundtrack)', year: '2020', genre: 'indie pop' });
  });

  it('fills the artist for a title only when one artist owns it, and asks otherwise', async () => {
    const { client } = musicBrainz();
    const matcher = new SongMatcher(client);
    const unique = await matcher.match(row('Quiet Engine'));
    expect(unique.status).toBe('check');
    expect(unique.fill).toMatchObject({ artist: 'Teo Vance', album: 'Engines', year: '1964', genre: 'hard bop' });
    const ambiguous = await matcher.match(row('Blue Hour'));
    expect(ambiguous.status).toBe('needs_artist');
    expect(ambiguous.fill).toEqual({});
    expect(ambiguous.message).toMatch(/Type the artist/);
    expect((await matcher.match(row('Nothing Like This', 'Nobody'))).status).toBe('not_found');
  });

  it('reports a busy MusicBrainz instead of failing', async () => {
    const { client } = musicBrainz({ fail: true });
    const r = await new SongMatcher(client).match(row('Glass Orbit', 'Nova Lattice'));
    expect(r).toMatchObject({ status: 'error', fill: {} });
  });

  it('is available to anonymous converter users, limited to 5 songs a request', async () => {
    const { client } = musicBrainz();
    const { client: http } = await createTestServer({ musicbrainz: client });
    const anon = http();
    const r = await anon.post('/api/convert/match', { rows: [row('Glass Orbit', 'Nova Lattice'), row('Blue Hour')] });
    expect(r.status).toBe(200);
    expect(r.body.results.map((x: any) => x.status)).toEqual(['matched', 'needs_artist']);
    expect(r.body.source.name).toBe('MusicBrainz');
    expect((await anon.post('/api/convert/match', { rows: Array.from({ length: 6 }, () => row('X', 'Y')) })).status).toBe(400);
  });

  it('says so when MusicBrainz is not configured', async () => {
    const { client } = await createTestServer();
    const r = await client().post('/api/convert/match', { rows: [row('Glass Orbit', 'Nova Lattice')] });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('matching_unavailable');
  });

  it('uses the project page as the MusicBrainz contact in production unless one is set', () => {
    const base = { PUBLIC_URL: 'https://somm.example.org' };
    expect(loadConfig({ ...base, NODE_ENV: 'production' } as NodeJS.ProcessEnv).musicbrainz.contact).toBe(PROJECT_URL);
    expect(loadConfig({ ...base, NODE_ENV: 'production', MUSICBRAINZ_CONTACT: 'ops@example.org' } as NodeJS.ProcessEnv).musicbrainz.contact).toBe('ops@example.org');
    expect(loadConfig({ ...base, NODE_ENV: 'development' } as NodeJS.ProcessEnv).musicbrainz.contact).toBeNull();
  });
});

describe('pasted song names and links', () => {
  it('keeps names without artists, cleans video titles and skips copied durations', () => {
    const p = parseNameList(['1. Nova Lattice - Glass Orbit (Official Music Video)', 'Just A Title', '"Stand by Me" by Mono Quartet', '3:45', '12', 'Kilo Ray\tNight Bus'].join('\n'));
    expect(p.entries.map((e) => [e.artists.join('; '), e.title])).toEqual([
      ['Nova Lattice', 'Glass Orbit'],
      ['', 'Just A Title'],
      ['Mono Quartet', 'Stand by Me'],
      ['Night Bus', 'Kilo Ray'],
    ]);
    expect(p.errors).toEqual([]);
  });

  it('recognises track links and explains playlist links', () => {
    expect(classifyLink('https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=abc')).toMatchObject({ service: 'spotify', id: '4uLU6hMCjMI75M1A2tKUQC' });
    expect(classifyLink('https://music.youtube.com/watch?v=abcdefghijk&list=PLx')).toMatchObject({ service: 'youtube', id: 'abcdefghijk' });
    expect(classifyLink('https://youtu.be/abcdefghijk')).toMatchObject({ service: 'youtube' });
    expect(classifyLink('https://soundcloud.com/some-artist/some-track?in=x')).toMatchObject({ service: 'soundcloud', id: 'some-artist/some-track' });
    expect(classifyLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toHaveProperty('unsupported');
    expect(classifyLink('https://www.youtube.com/playlist?list=PL123')).toHaveProperty('unsupported');
    expect(classifyLink('https://soundcloud.com/some-artist/sets/summer')).toHaveProperty('unsupported');
    expect(classifyLink('Nova Lattice - Glass Orbit')).toBeNull();
    expect(containsLinks('Nova Lattice - Glass Orbit\nhttps://youtu.be/abcdefghijk')).toBe(true);
    expect(containsLinks('Nova Lattice - Glass Orbit\nJust A Title')).toBe(false);
  });

  it('turns Spotify, YouTube and SoundCloud links into song names through oEmbed, in order', async () => {
    const { fetchImpl, calls } = mockFetch([
      { match: /open\.spotify\.com\/oembed/, respond: () => json({ title: 'Glass Orbit', provider_name: 'Spotify' }) },
      { match: /youtube\.com\/oembed.*bcdefghijkl/, respond: () => json({}, 404) },
      { match: /youtube\.com\/oembed/, respond: () => json({ title: 'Nova Lattice - Night Drive (Official Video) [4K]', author_name: 'NovaLatticeVEVO' }) },
      { match: /soundcloud\.com\/oembed/, respond: () => json({ title: 'Basement Loop by Kilo Ray', author_name: 'Kilo Ray' }) },
    ]);
    const { client } = await createTestServer({ fetchImpl });
    const content = [
      'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
      'Teo Vance - Blue Hour (Official Audio)',
      'https://www.youtube.com/watch?v=abcdefghijk',
      'https://soundcloud.com/kilo-ray/basement-loop',
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
      'https://youtu.be/bcdefghijkl',
    ].join('\n');
    const r = await client().post('/api/convert', { source: 'text', content, name: 'Links' });
    expect(r.status).toBe(200);
    const p = r.body.playlists[0];
    expect(p.rows.map((x: any) => [x.title, x.artist, x.link])).toEqual([
      ['Glass Orbit', '', 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'],
      // Names and links can be mixed in one list.
      ['Blue Hour', 'Teo Vance', ''],
      ['Night Drive', 'Nova Lattice', 'https://www.youtube.com/watch?v=abcdefghijk'],
      ['Basement Loop', 'Kilo Ray', 'https://soundcloud.com/kilo-ray/basement-loop'],
    ]);
    expect(p.errors).toEqual([
      { row: 5, message: expect.stringMatching(/Ctrl\+A/) },
      { row: 6, message: 'This link is private, removed, or not a song.' },
    ]);
    expect(p.notes.join(' ')).toMatch(/Spotify links give only the song title/);
    expect(calls.every((c) => /oembed/.test(c.url))).toBe(true);
  });

  it('converts a YouTube playlist without an account when the server has an API key', async () => {
    const { fetchImpl } = mockFetch([
      { match: /googleapis\.com\/youtube\/v3\/playlists\?/, respond: () => json({ items: [{ snippet: { title: 'Road Mix' } }] }) },
      {
        match: /googleapis\.com\/youtube\/v3\/playlistItems/,
        respond: () =>
          json({
            items: [{ snippet: { title: 'Nova Lattice - Glass Orbit (Official Video)', position: 0, videoOwnerChannelTitle: 'Nova Lattice', resourceId: { kind: 'youtube#video', videoId: 'abcdefghijk' } }, status: { privacyStatus: 'public' } }],
          }),
      },
    ]);
    const { client } = await createTestServer({ fetchImpl, env: { YOUTUBE_API_KEY: 'test-key-not-real' } });
    const anon = client();
    const r = await anon.post('/api/convert', { source: 'youtube', playlist: 'https://www.youtube.com/playlist?list=PL0123456789abcdefABCDEF' });
    expect(r.status).toBe(200);
    expect(r.body.playlists[0]).toMatchObject({ name: 'Road Mix', rows: [expect.objectContaining({ title: 'Glass Orbit', artist: 'Nova Lattice' })] });
    expect((await anon.post('/api/convert', { source: 'spotify', playlist: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' })).status).toBe(401);
  });
});
