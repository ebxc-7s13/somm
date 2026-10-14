import { describe, expect, it } from 'vitest';
import { csvFileName, formatDuration, neutralizeCell, restoreCell, SOMM_CSV_COLUMNS, toSommCsv } from '../../src/shared/csv';
import { parseCsv } from '../../src/server/import/adapters/files';
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
