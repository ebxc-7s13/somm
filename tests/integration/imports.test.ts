import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvRows, parseDuration, parseJson, parseM3u, parseText, parseXspf } from '../../src/server/import/adapters/files';
import { ImportError } from '../../src/server/import/types';
import { createTestServer, csv } from '../helpers/server';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

describe('file adapters', () => {
  it('parses CSV with quotes, BOM, semicolons and header aliases', () => {
    expect(parseCsvRows('\uFEFFa,b\n"x, y","say ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(parseCsvRows('title;artist\nOne;Two')).toEqual([['title', 'artist'], ['One', 'Two']]);
    const p = parseCsv('Track Name,Artist Name(s),Album Name,Track Duration (ms),ISRC,Artist Genres\nGlass Orbit,"Nova Lattice,Ivy Marlowe",Neon Tides,252000,QZFAK1900001,"synthwave,retrowave"');
    expect(p.entries[0]).toMatchObject({ title: 'Glass Orbit', artists: ['Nova Lattice', 'Ivy Marlowe'], durationMs: 252000, isrc: 'QZFAK1900001', genreKind: 'provider' });
    expect(p.notes[0]).toMatch(/Exportify/);
  });

  it('reports invalid rows without failing the whole file', () => {
    const p = parseCsv(fixture('neon-tides.csv'), 'neon-tides.csv');
    expect(p.name).toBe('neon-tides');
    expect(p.entries).toHaveLength(8);
    expect(p.errors).toEqual([
      { row: 9, message: 'Missing title.' },
      { row: 10, message: 'Missing artist.' },
    ]);
    expect(p.entries[1]?.genres).toEqual(['synthwave', 'dream pop']);
    expect(p.entries[6]?.attributes).toEqual([
      { category: 'instrument', value: 'piano' },
      { category: 'instrument', value: 'saxophone' },
    ]);
    expect(p.entries[0]?.durationMs).toBe(252000);
  });

  it('keeps known attribute vocabulary in its real category', () => {
    const p = parseCsv('title,artist,instruments,tags,mood\nA,B,instrumental;Piano;theremin,atmospheric;seen live,Calm');
    expect(p.entries[0]?.attributes).toEqual([
      { category: 'vocal', value: 'instrumental' },
      { category: 'instrument', value: 'piano' },
      { category: 'instrument', value: 'theremin' },
      { category: 'mood', value: 'calm' },
      { category: 'texture', value: 'atmospheric' },
    ]);
  });

  it('rejects empty and header-only files and files without required columns', () => {
    expect(() => parseCsv('')).toThrow(ImportError);
    expect(() => parseCsv('title,artist\n')).toThrow(/no tracks/);
    expect(() => parseCsv('foo,bar\n1,2')).toThrow(/title and an artist column/);
    expect(() => parseCsv(',Missing\nx,')).toThrow();
  });

  it('enforces size and row limits', () => {
    const big = 'title,artist\n' + 'x,y\n'.repeat(5001);
    expect(() => parseCsv(big)).toThrow(/limited to 5000/);
    expect(() => parseCsv('title,artist\n' + 'a'.repeat(2.1 * 1024 * 1024) + ',b')).toThrow(/larger than/);
  });

  it('parses pasted lists in several formats', () => {
    const p = parseText('1. Nova Lattice - Glass Orbit\n"Harbour Lights" by Ivy Marlowe\nQuiet Engine\tTeo Vance\n# comment\n\nnonsense line');
    expect(p.entries.map((e) => [e.artists[0], e.title])).toEqual([
      ['Nova Lattice', 'Glass Orbit'],
      ['Ivy Marlowe', 'Harbour Lights'],
      ['Teo Vance', 'Quiet Engine'],
    ]);
    expect(p.errors).toHaveLength(1);
    expect(() => parseText('\n\n')).toThrow(/No tracks/);
  });

  it('reads M3U metadata and ignores file locations', () => {
    const p = parseM3u(fixture('night-drive.m3u'), 'night-drive.m3u');
    expect(p.name).toBe('Night Drive');
    expect(p.entries.map((e) => `${e.artists[0]} — ${e.title}`)).toEqual([
      'Nova Lattice — Glass Orbit',
      'Kilo Ray — Midnight Relay',
      'Pulse Garden — Fern Circuit',
    ]);
    expect(p.entries[0]?.durationMs).toBe(252000);
    expect(p.entries[2]?.parseConfidence).toBe('low');
    expect(JSON.stringify(p)).not.toContain('C:\\Users');
    expect(JSON.stringify(p)).not.toContain('example.invalid');
    expect(p.errors).toHaveLength(1);
  });

  it('reads XSPF safely', () => {
    const p = parseXspf(fixture('harbour.xspf'), 'harbour.xspf');
    expect(p.name).toBe('Harbour & Haze');
    expect(p.entries).toHaveLength(2);
    expect(p.entries[0]).toMatchObject({ title: 'Harbour Lights', album: 'Salt & Signal', isrc: 'QZFAK2100003', durationMs: 211000 });
    expect(p.entries[1]?.title).toBe('Fog <Index>');
    expect(p.errors).toHaveLength(1);
    expect(() => parseXspf('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><playlist><trackList/></playlist>')).toThrow(/DTD/);
    expect(() => parseXspf('<html></html>')).toThrow(/XSPF/);
  });

  it('reads JSON exports and rejects malformed JSON', () => {
    const p = parseJson(JSON.stringify({ name: 'Mine', tracks: [{ title: 'Quiet Engine', artists: [{ name: 'Teo Vance' }], genres: ['hard bop'], year: 1964 }, { title: 'x' }] }));
    expect(p.name).toBe('Mine');
    expect(p.entries[0]).toMatchObject({ title: 'Quiet Engine', artists: ['Teo Vance'], releaseDate: '1964', genres: ['hard bop'] });
    expect(p.errors).toEqual([{ row: 2, message: 'Missing artist.' }]);
    expect(() => parseJson('{oops')).toThrow(/not valid JSON/);
    expect(() => parseJson('{"tracks": 3}')).toThrow(/Expected an array/);
  });

  it('parses durations in several notations', () => {
    expect(parseDuration('4:12')).toBe(252000);
    expect(parseDuration('1:02:03')).toBe(3723000);
    expect(parseDuration('252')).toBe(252000);
    expect(parseDuration('252000')).toBe(252000);
    expect(parseDuration('soon')).toBeNull();
  });
});

describe('import workflow (preview → commit)', () => {
  it('classifies duplicates, alternate versions and invalid rows in the preview', async () => {
    const { client } = createTestServer();
    const a = client();
    await a.signup('preview-tester');
    const r = await a.post('/api/imports/preview', { source: 'csv', content: fixture('neon-tides.csv'), fileName: 'neon-tides.csv' });
    expect(r.status).toBe(200);
    const byRow = Object.fromEntries(r.body.entries.map((e: any) => [e.row, e]));
    expect(byRow[5].status).toBe('duplicate');
    expect(byRow[5].duplicateOf).toBe(2);
    expect(byRow[5].skipByDefault).toBe(true);
    expect(byRow[4].status).toBe('alternate_version');
    expect(byRow[4].version).toBe('remix');
    expect(byRow[11].version).toBe('live');
    expect(byRow[3].artists).toEqual(['Nova Lattice', 'Ivy Marlowe']);
    expect(r.body.summary).toMatchObject({ invalid: 2, duplicates: 1, toImport: 7 });
  });

  it('commits, deduplicates against the catalogue and keeps versions distinct', async () => {
    const { client, ctx } = createTestServer();
    const a = client();
    await a.signup('importer');
    const first = await a.importCsv(fixture('neon-tides.csv'));
    expect(first.imported).toBe(7);
    const lib = await a.get('/api/library/tracks?pageSize=100');
    expect(lib.body.total).toBe(7);
    const titles = lib.body.tracks.map((t: any) => `${t.title}|${t.version ?? ''}`).sort();
    expect(titles).toContain('Glass Orbit|');
    expect(titles).toContain('Glass Orbit|remix');
    expect(titles).toContain('Glass Orbit|live');

    // A second user importing the same song by ISRC shares the canonical track.
    const b = client();
    await b.signup('second-importer');
    await b.importCsv(csv([['Glass Orbit (Album Version)', 'Nova Lattice', 'Neon Tides', '', '2019']]).replace('title,artist,album,genre,year', 'title,artist,album,genre,year') + '');
    const tracks = ctx.db.prepare("SELECT COUNT(*) AS n FROM tracks WHERE normalized_title = 'glass orbit' AND version IS NULL").get() as { n: number };
    expect(tracks.n).toBe(1);
  });

  it('does not merge same title+artist when durations conflict', async () => {
    const { client, ctx } = createTestServer();
    const a = client();
    await a.signup('durations');
    const content = 'title,artist,duration\nEcho Room,Mira Sol,3:00\nEcho Room,Mira Sol,9:30';
    const preview = await a.post('/api/imports/preview', { source: 'csv', content });
    expect(preview.body.entries[1].status).not.toBe('duplicate');
    expect(preview.body.entries[1].notes.join(' ')).toMatch(/different length/);
    await a.post(`/api/imports/${preview.body.draftId}/commit`, {});
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM tracks WHERE normalized_title = 'echo room'").get() as { n: number }).n).toBe(2);
  });

  it('marks songs already in the library', async () => {
    const { client } = createTestServer();
    const a = client();
    await a.signup('repeat-importer');
    await a.importCsv(csv([['Glass Orbit', 'Nova Lattice']]));
    const p = await a.post('/api/imports/preview', { source: 'csv', content: csv([['Glass Orbit', 'Nova Lattice'], ['New One', 'Nova Lattice']]) });
    expect(p.body.entries[0].status).toBe('in_library');
    expect(p.body.entries[1].status).toBe('new');
  });

  it('lets the user include a duplicate or skip rows explicitly', async () => {
    const { client } = createTestServer();
    const a = client();
    await a.signup('chooser');
    const content = csv([['A', 'X'], ['A', 'X'], ['B', 'X']]);
    const p = await a.post('/api/imports/preview', { source: 'csv', content });
    const commit = await a.post(`/api/imports/${p.body.draftId}/commit`, { skipRows: [4] });
    expect(commit.body.imported).toBe(1);
    const nothing = await a.post('/api/imports/preview', { source: 'csv', content: csv([['C', 'Y']]) });
    const empty = await a.post(`/api/imports/${nothing.body.draftId}/commit`, { skipRows: [2] });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('empty');
  });

  it('returns structured errors for invalid, empty and unsupported imports', async () => {
    const { client } = createTestServer();
    const a = client();
    await a.signup('errors');
    expect((await a.post('/api/imports/preview', { source: 'csv', content: '' })).body.error.code).toBe('empty');
    expect((await a.post('/api/imports/preview', { source: 'csv', content: 'a,b\n1,2' })).body.error.code).toBe('invalid_input');
    expect((await a.post('/api/imports/preview', { source: 'napster', content: 'x' })).status).toBe(400);
    const spotify = await a.post('/api/imports/preview', { source: 'spotify', playlist: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' });
    expect(spotify.status).toBe(503);
    expect(spotify.body.error.code).toBe('needs_credentials');
    const yt = await a.post('/api/imports/preview', { source: 'youtube', playlist: 'https://www.youtube.com/playlist?list=PLabcdefghijkl' });
    expect(yt.body.error.code).toBe('needs_credentials');
    const evil = await a.post('/api/imports/preview', { source: 'youtube', playlist: 'http://169.254.169.254/latest/meta-data' });
    expect(['invalid_input', 'needs_credentials']).toContain(evil.body.error.code);
    expect((await a.post('/api/imports/nope/commit', {})).status).toBe(404);
  });

  it('requires authentication to import', async () => {
    const { client } = createTestServer();
    const r = await client().post('/api/imports/preview', { source: 'text', content: 'A - B' });
    expect(r.status).toBe(401);
  });

  it('reports job progress and finishes without enrichment when MusicBrainz is not configured', async () => {
    const { client, ctx } = createTestServer();
    const a = client();
    await a.signup('jobs');
    const { jobId } = await a.importCsv(csv([['A', 'X', '', 'jazz'], ['B', 'Y']]));
    let job = (await a.get(`/api/imports/jobs/${jobId}`)).body;
    expect(job.job.status).toBe('enriching');
    expect(job.enrichment.enabled).toBe(false);
    expect(job.enrichment.reason).toMatch(/MUSICBRAINZ_ENABLED=false/);
    await ctx.queue.drain();
    job = (await a.get(`/api/imports/jobs/${jobId}`)).body;
    expect(job.job.status).toBe('done');
    expect(job.job.counts.skipped).toBe(2);
    expect(job.job.genreCoverage).toBe(0.5);
    // Another user cannot read this job.
    const b = client();
    await b.signup('jobs-intruder');
    expect((await b.get(`/api/imports/jobs/${jobId}`)).status).toBe(404);
  });
});
