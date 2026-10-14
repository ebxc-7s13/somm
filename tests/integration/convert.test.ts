/**
 * Playlist → CSV converter: works without an account, splits multi-playlist
 * exports, stores nothing, and the CSV it produces imports the same songs.
 */
import { describe, expect, it } from 'vitest';
import { toSommCsv } from '../../src/shared/csv';
import { get } from '../../src/server/db';
import { createTestServer } from '../helpers/server';

const TAB = '\t';

/** Shape of Spotify's "Download your data" Playlist1.json (fictional content). */
const spotifyExport = JSON.stringify({
  playlists: [
    {
      name: 'Night Drive',
      lastModifiedDate: '2026-01-02',
      items: [
        { track: { trackName: 'Glass Orbit', artistName: 'Nova Lattice', albumName: 'Signals', trackUri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' }, episode: null, localTrack: null, audiobook: null, addedDate: '2026-01-01' },
        { track: null, episode: { episodeName: 'Talk', showName: 'A Show', episodeUri: 'spotify:episode:abc' }, localTrack: null, audiobook: null, addedDate: '2026-01-01' },
        { track: null, episode: null, localTrack: { uri: 'spotify:local:Kilo+Ray:Home+Tapes:Basement+Loop:201' }, audiobook: null, addedDate: '2026-01-01' },
      ],
    },
    {
      name: 'Quiet Hours',
      lastModifiedDate: '2026-01-03',
      items: [{ track: { trackName: 'Blue Hour', artistName: 'Teo Vance', albumName: 'Sessions', trackUri: 'spotify:track:0VjIjW4GlUZAMYd2vXMi3b' }, episode: null, localTrack: null, audiobook: null, addedDate: '2026-01-01' }],
    },
  ],
});

/** Shape of an Apple Music / iTunes "Export Playlist" text file (after UTF-16 decoding; fictional content). */
const appleExport = [
  ['Name', 'Artist', 'Composer', 'Album', 'Genre', 'Time', 'Year', 'Kind', 'Location'].join(TAB),
  ['Harbour Lights', 'Pulse Garden', '', 'Coastline', 'Ambient', '245', '2021', 'Apple Music AAC audio file', ''].join(TAB),
  ['Quiet Engine', 'Mono Quartet', '', 'Engines', 'Jazz', '301', '1964', 'Apple Music AAC audio file', 'C:\\Users\\someone\\Music\\x.m4a'].join(TAB),
].join('\r\n');

describe('playlist converter API', () => {
  it('converts a pasted list without an account and stores nothing', async () => {
    const { client, ctx } = await createTestServer();
    const anon = client();
    const r = await anon.post('/api/convert', { source: 'text', content: 'Nova Lattice - Glass Orbit\nTeo Vance - Blue Hour\nnot a song line', name: 'Pasted' });
    expect(r.status).toBe(200);
    expect(r.body.stored).toBe(false);
    expect(r.body.playlists).toHaveLength(1);
    const p = r.body.playlists[0];
    expect(p.name).toBe('Pasted');
    expect(p.rows.map((x: any) => [x.artist, x.title])).toEqual([
      ['Nova Lattice', 'Glass Orbit'],
      ['Teo Vance', 'Blue Hour'],
    ]);
    expect(p.errors).toHaveLength(1);
    for (const table of ['tracks', 'playlists', 'import_drafts', 'users']) {
      expect((await get<{ n: number }>(ctx.db, `SELECT COUNT(*) AS n FROM ${table}`))!.n).toBe(0);
    }
  });

  it('splits a Spotify data export into one playlist per playlist, skipping episodes', async () => {
    const { client } = await createTestServer();
    const r = await client().post('/api/convert', { source: 'json', content: spotifyExport, fileName: 'Playlist1.json' });
    expect(r.status).toBe(200);
    const [night, quiet] = r.body.playlists;
    expect(night.name).toBe('Night Drive');
    expect(night.rows.map((x: any) => x.title)).toEqual(['Glass Orbit', 'Basement Loop']);
    expect(night.rows[0]).toMatchObject({ artist: 'Nova Lattice', album: 'Signals', link: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' });
    expect(night.rows[1]).toMatchObject({ artist: 'Kilo Ray', album: 'Home Tapes', duration: '3:21' });
    expect(night.errors).toEqual([{ row: 2, message: 'Podcast episodes and audiobooks are not songs.' }]);
    expect(quiet.name).toBe('Quiet Hours');
    expect(quiet.rows).toHaveLength(1);
  });

  it('reads Apple Music / iTunes exported playlists (tab-separated with a header) and ignores file locations', async () => {
    const { client } = await createTestServer();
    const r = await client().post('/api/convert', { source: 'text', content: appleExport, fileName: 'Favourites.txt', name: 'Favourites' });
    expect(r.status).toBe(200);
    const rows = r.body.playlists[0].rows;
    expect(rows).toEqual([
      expect.objectContaining({ title: 'Harbour Lights', artist: 'Pulse Garden', album: 'Coastline', genre: 'Ambient', year: '2021', duration: '4:05' }),
      expect.objectContaining({ title: 'Quiet Engine', artist: 'Mono Quartet', genre: 'Jazz', year: '1964', duration: '5:01', link: '' }),
    ]);
    expect(JSON.stringify(r.body)).not.toContain('someone');
  });

  it('explains why bare Spotify links cannot be converted, and requires sign-in for playlist links', async () => {
    const { client } = await createTestServer();
    const anon = client();
    const links = await anon.post('/api/convert', { source: 'text', content: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC\nhttps://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b' });
    expect(links.status).toBe(400);
    expect(links.body.error.message).toMatch(/Spotify song links.*Download your data/);
    const link = await anon.post('/api/convert', { source: 'youtube', playlist: 'https://www.youtube.com/playlist?list=PL1234567890abcdef' });
    expect(link.status).toBe(401);
  });

  it('rejects invalid requests and rate-limits heavy use', async () => {
    const { client } = await createTestServer();
    const anon = client();
    expect((await anon.post('/api/convert', { source: 'manual', entries: [] })).status).toBe(400);
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await anon.post('/api/convert', { source: 'text', content: 'A - B' })).status;
    expect(last).toBe(429);
  });

  it('imports the converted CSV as the same songs', async () => {
    const { client } = await createTestServer();
    const a = client();
    await a.signup('csv-converter');
    const converted = (await a.post('/api/convert', { source: 'json', content: spotifyExport, fileName: 'Playlist1.json' })).body.playlists[0];
    // The user fixes a row before downloading, exactly as in the editor.
    converted.rows[1].genre = 'lo-fi';
    const csv = toSommCsv(converted.rows);
    const preview = await a.post('/api/imports/preview', { source: 'csv', content: csv, fileName: 'night-drive-somm.csv' });
    expect(preview.status).toBe(200);
    expect(preview.body.summary.total).toBe(2);
    expect(preview.body.entries.map((e: any) => e.title)).toEqual(['Glass Orbit', 'Basement Loop']);
    const commit = await a.post(`/api/imports/${preview.body.draftId}/commit`, { visibility: 'private' });
    expect(commit.status).toBe(201);
    const lib = (await a.get('/api/library/tracks?sort=title')).body.tracks;
    expect(lib.map((t: any) => t.title)).toEqual(['Basement Loop', 'Glass Orbit']);
    const loop = (await a.get(`/api/library/tracks/${lib[0].id}`)).body;
    expect(JSON.stringify(loop)).toContain('lo-fi');
  });
});
