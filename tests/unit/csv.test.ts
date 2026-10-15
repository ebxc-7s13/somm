import { describe, expect, it } from 'vitest';
import { csvFileName, formatDuration, neutralizeCell, restoreCell, SOMM_CSV_COLUMNS, toSommCsv } from '../../src/shared/csv';
import { parseCsv, parseCsvPlaylists } from '../../src/server/import/adapters/files';
import { entryToCsvRow } from '../../src/server/import/convert';
import type { RawEntry } from '../../src/server/import/types';

const BOM = String.fromCharCode(0xfeff);

describe('SOMM CSV writer', () => {
  it('writes a header, a BOM for spreadsheets, CRLF lines and RFC 4180 quoting', () => {
    const csv = toSommCsv([{ ...Object.fromEntries(SOMM_CSV_COLUMNS.map((c) => [c, ''])), title: 'Say "hi", world', artist: 'Nova Lattice' } as never]);
    expect(csv.startsWith(BOM)).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(SOMM_CSV_COLUMNS.join(','));
    expect(lines[1]).toBe('"Say ""hi"", world",Nova Lattice,,,,,,,,,,');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('neutralises formula-like cells for spreadsheets and restores them on import', () => {
    for (const v of ['=SUM(A1:A9)', '+44', '-', '@home']) {
      expect(neutralizeCell(v)).toBe(`'${v}`);
      expect(restoreCell(neutralizeCell(v))).toBe(v);
    }
    expect(neutralizeCell('Normal title')).toBe('Normal title');
    expect(restoreCell("'Twas a song")).toBe("'Twas a song");
  });

  it('formats durations and safe file names', () => {
    expect(formatDuration(185_000)).toBe('3:05');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(null)).toBe('');
    expect(csvFileName('Café Nights / 2026!')).toBe('cafe-nights-2026-somm.csv');
    expect(csvFileName('★★★')).toBe('playlist-somm.csv');
  });
});

describe('convert → CSV → import round trip', () => {
  const entries: RawEntry[] = [
    {
      row: 1,
      title: 'Glass Orbit, Part 2 ("Live")',
      artists: ['Nova Lattice', 'Pulse Garden'],
      album: 'Night Drive',
      genres: ['techno', 'ambient'],
      releaseDate: '2019-05-01',
      durationMs: 245_000,
      isrc: 'GBAAA1900001',
      bpm: 124,
      attributes: [
        { category: 'instrument', value: 'synthesizer' },
        { category: 'mood', value: 'dreamy' },
      ],
      providerIds: [{ namespace: 'spotify:track', value: '4uLU6hMCjMI75M1A2tKUQC', url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' }],
    },
    { row: 2, title: '=1+1', artists: ['Teo Vance'] },
    { row: 3, title: 'Line\nbreak', artists: ['Blue Lantern'], album: null, genres: [] },
  ];

  it('reads back exactly the songs that were written', () => {
    const csv = toSommCsv(entries.map(entryToCsvRow));
    const back = parseCsv(csv, 'round-trip.csv');
    expect(back.errors).toEqual([]);
    expect(back.entries).toHaveLength(3);
    const [a, b, c] = back.entries;
    expect(a).toMatchObject({
      title: 'Glass Orbit, Part 2 ("Live")',
      artists: ['Nova Lattice', 'Pulse Garden'],
      album: 'Night Drive',
      genres: ['techno', 'ambient'],
      releaseDate: '2019-05-01',
      durationMs: 245_000,
      isrc: 'GBAAA1900001',
      bpm: 124,
      providerIds: [{ namespace: 'spotify:track', value: '4uLU6hMCjMI75M1A2tKUQC' }],
    });
    expect(a!.attributes).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'synthesizer' }), { category: 'mood', value: 'dreamy' }]));
    expect(b!.title).toBe('=1+1');
    expect(c!.title).toBe('Line break');
  });
});

describe('CSV files holding several playlists', () => {
  // Some playlist export tools write one row per song with the playlist's name in a column (fictional content).
  const header = 'Track name,Artist name,Album,Playlist name';
  const file = [header, 'Glass Orbit,Nova Lattice,Signals,Night Drive', 'Blue Hour,Teo Vance,Sessions,Quiet Hours', ',Kilo Ray,,Night Drive', 'Basement Loop,Kilo Ray,Home Tapes,Night Drive'].join('\r\n');

  it('the converter splits them into one playlist each, keeping file row numbers', () => {
    const lists = parseCsvPlaylists(file, 'everything.csv');
    expect(lists.map((p) => [p.name, p.entries.map((e) => e.title)])).toEqual([
      ['Night Drive', ['Glass Orbit', 'Basement Loop']],
      ['Quiet Hours', ['Blue Hour']],
    ]);
    expect(lists[0]!.errors).toEqual([{ row: 4, message: 'Missing title.' }]);
    expect(lists[0]!.entries.map((e) => e.row)).toEqual([2, 5]);
    expect(lists[0]!.notes.join(' ')).toMatch(/2 playlists, each converted to its own CSV/);
  });

  it('rows without a playlist name, or files without the column, use the file name', () => {
    const mixed = [header, 'Glass Orbit,Nova Lattice,Signals,', 'Blue Hour,Teo Vance,Sessions,Quiet Hours'].join('\n');
    expect(parseCsvPlaylists(mixed, 'my-export.csv').map((p) => p.name)).toEqual(['my-export', 'Quiet Hours']);
    const plain = parseCsvPlaylists('title,artist\nGlass Orbit,Nova Lattice\n', 'plain.csv');
    expect(plain).toHaveLength(1);
    expect(plain[0]!.name).toBe('plain');
    expect(plain[0]!.notes).toEqual([]);
  });

  it('the importer keeps one playlist and says the file held several', () => {
    const p = parseCsv(file, 'everything.csv');
    expect(p.name).toBe('everything');
    expect(p.entries.map((e) => e.title)).toEqual(['Glass Orbit', 'Blue Hour', 'Basement Loop']);
    expect(p.notes.join(' ')).toMatch(/2 playlists; they were imported together as one/);
  });

  it('limits each playlist to what one import can take', () => {
    const rows = Array.from({ length: 5001 }, (_, i) => `Song ${i},Nova Lattice,,Huge`);
    expect(() => parseCsvPlaylists([header, ...rows, 'Blue Hour,Teo Vance,,Small'].join('\n'), 'big.csv', 12 * 1024 * 1024)).toThrow(/“Huge” has more than 5000 songs/);
  });
});
