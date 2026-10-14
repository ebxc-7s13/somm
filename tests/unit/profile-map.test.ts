import { describe, expect, it } from 'vitest';
import { generateInsights } from '../../src/shared/analysis/insights';
import { buildMusicMap } from '../../src/shared/analysis/map';
import { buildMatchVector, computeProfile } from '../../src/shared/analysis/profile';
import { attr, genre, library, track } from '../helpers/library';

describe('computeProfile — counts', () => {
  const tracks = [
    track('Glass Orbit', 'Nova Lattice', ['synthwave', 'electronic'], { releaseYear: 2019, album: { id: 'al1', title: 'Neon Tides' } }),
    track('Paper Comets', 'Nova Lattice', ['synthwave'], { releaseYear: 2021, album: { id: 'al1', title: 'Neon Tides' } }),
    track('Harbour Lights', 'Ivy Marlowe', ['indie folk'], { releaseYear: 2008 }),
    track('Quiet Engine', 'Teo Vance', ['jazz'], { releaseYear: 1964 }),
    track('Unlabelled', 'Mira Sol', []),
  ];
  const profile = computeProfile(tracks);

  it('counts tracks, artists, albums and genres exactly', () => {
    expect(profile.totals).toEqual({ tracks: 5, artists: 4, albums: 1, genres: 4, families: 3 });
    expect(profile.genres.find((g) => g.name === 'synthwave')?.trackCount).toBe(2);
    expect(profile.genres.find((g) => g.name === 'electronic')?.trackCount).toBe(1);
    // Electronic family counts a track once even if it has two electronic genres.
    expect(profile.families.find((f) => f.family === 'electronic')?.trackCount).toBe(2);
    expect(profile.artists[0]).toMatchObject({ name: 'Nova Lattice', trackCount: 2 });
    expect(profile.decades).toEqual([
      { decade: 1960, trackCount: 1 },
      { decade: 2000, trackCount: 1 },
      { decade: 2010, trackCount: 1 },
      { decade: 2020, trackCount: 1 },
    ]);
  });

  it('reports missing genres instead of inventing them', () => {
    expect(profile.unknownGenreCount).toBe(1);
    expect(profile.coverage.genre).toBe(0.8);
    // Shares are relative to tracks that have genre data.
    expect(profile.families.find((f) => f.family === 'electronic')?.share).toBe(0.5);
  });

  it('records genre co-occurrence on the same track', () => {
    expect(profile.genreCooccurrence).toContainEqual({ a: 'electronic', b: 'synthwave', trackCount: 1, jaccard: 0.5 });
  });

  it('is stable for unchanged input regardless of order', () => {
    const shuffled = [...tracks].reverse();
    expect(computeProfile(shuffled)).toEqual(profile);
  });

  it('separates verified attributes from genre inferences', () => {
    const synth = profile.attributes.find((a) => a.value === 'synthesizer');
    expect(synth).toMatchObject({ trackCount: 2, verifiedCount: 0, inferredCount: 2 });
    const withCredit = computeProfile([
      track('Credit', 'Nova Lattice', ['synthwave'], { attributes: [attr('instrument', 'synthesizer')] }),
      track('NoCredit', 'Nova Lattice', ['synthwave']),
    ]);
    expect(withCredit.attributes.find((a) => a.value === 'synthesizer')).toMatchObject({ trackCount: 2, verifiedCount: 1, inferredCount: 1 });
  });

  it('ignores low-confidence and inferred attributes for matching vectors', () => {
    const vector = buildMatchVector([
      track('A', 'X', ['synthwave'], { attributes: [attr('texture', 'gritty', 'community', 0.3)] }),
      track('B', 'X', ['synthwave'], { attributes: [attr('instrument', 'piano', 'credited', 0.9)] }),
    ]);
    expect(vector.attributes).toEqual({ 'instrument:piano': 0.9 });
    expect(vector.attributeEvidence).toBe(1);
  });

  it('handles an empty library', () => {
    const empty = computeProfile([]);
    expect(empty.totals.tracks).toBe(0);
    expect(empty.coverage.genre).toBe(0);
    expect(generateInsights(empty)[0]?.id).toBe('empty');
  });
});

describe('Music Map', () => {
  it('builds a hierarchy from computed data with an explicit unknown branch', () => {
    const tracks = [
      track('Glass Orbit', 'Nova Lattice', ['synthwave']),
      track('Paper Comets', 'Nova Lattice', ['synthwave']),
      track('Harbour Lights', 'Ivy Marlowe', ['indie folk']),
      track('Unlabelled', 'Mira Sol', []),
    ];
    const map = buildMusicMap(tracks, computeProfile(tracks));
    const ids = map.nodes.map((n) => n.id);
    expect(ids).toContain('root');
    expect(ids).toContain('family:electronic');
    expect(ids).toContain('genre:synthwave');
    expect(ids).toContain('family:unknown');
    expect(map.nodes.find((n) => n.id === 'family:unknown')).toMatchObject({ uncertain: true, trackCount: 1 });
    expect(map.nodes.find((n) => n.id === 'family:electronic')?.trackCount).toBe(2);
    expect(map.nodes.filter((n) => n.kind === 'track')).toHaveLength(4);
    // Every branch edge connects existing nodes.
    for (const e of map.edges) {
      expect(ids).toContain(e.source);
      expect(ids).toContain(e.target);
    }
  });

  it('produces an identical map for identical input', () => {
    const tracks = library('Song', 40, ['Nova Lattice', 'Ivy Marlowe', 'Teo Vance', 'Mira Sol'], ['synthwave', 'jazz', 'indie folk', 'techno']);
    const a = buildMusicMap(tracks, computeProfile(tracks));
    const b = buildMusicMap([...tracks].reverse(), computeProfile([...tracks].reverse()));
    expect(b).toEqual(a);
  });

  it('works for a single-track library', () => {
    const tracks = [track('Only One', 'Nova Lattice', ['ambient'])];
    const map = buildMusicMap(tracks, computeProfile(tracks));
    expect(map.nodes.length).toBeGreaterThanOrEqual(4);
    expect(map.stats.tracks).toBe(1);
  });

  it('keeps large libraries bounded with "more" nodes', () => {
    const artists = Array.from({ length: 300 }, (_, i) => `Artist ${i}`);
    const tracks = library('Track', 2000, artists, ['techno', 'house', 'ambient', 'jazz', 'rock', 'hip hop']);
    const map = buildMusicMap(tracks, computeProfile(tracks));
    expect(map.nodes.filter((n) => n.kind === 'track').length).toBeLessThanOrEqual(600);
    expect(map.nodes.filter((n) => n.kind === 'artist').length).toBeLessThanOrEqual(160);
    expect(map.nodes.some((n) => n.kind === 'more')).toBe(true);
    expect(map.stats.hiddenTracks).toBeGreaterThan(0);
  });

  it('grows when new tracks are imported and regenerates deterministically', () => {
    const first = [track('Glass Orbit', 'Nova Lattice', ['synthwave'])];
    const second = [...first, track('Quiet Engine', 'Teo Vance', ['jazz'])];
    const m1 = buildMusicMap(first, computeProfile(first));
    const m2 = buildMusicMap(second, computeProfile(second));
    expect(m2.nodes.length).toBeGreaterThan(m1.nodes.length);
    expect(m2.inputHash).not.toBe(m1.inputHash);
    expect(m2.nodes.map((n) => n.id)).toContain('family:jazz');
  });

  it('marks inferred-only attribute nodes as uncertain', () => {
    const tracks = library('Synth', 5, ['Nova Lattice'], ['synthwave']);
    const map = buildMusicMap(tracks, computeProfile(tracks));
    const node = map.nodes.find((n) => n.id === 'attr:instrument:synthesizer');
    expect(node).toBeDefined();
    expect(node?.uncertain).toBe(true);
    expect(node?.detail).toMatch(/Inferred/);
  });
});

describe('insights', () => {
  it('only states a dominant genre when the data supports it', () => {
    const electronic = library('E', 24, ['Nova Lattice', 'Pulse Garden', 'Kilo Ray'], ['techno', 'house', 'synthwave']);
    const insights = generateInsights(computeProfile(electronic));
    const dominant = insights.find((i) => i.id === 'dominant-family');
    expect(dominant?.text).toContain('strong preference for electronic music');
    expect(dominant?.confidence).toBe('high');
    expect(dominant?.evidence.length).toBeGreaterThan(0);
  });

  it('describes mixed-genre libraries as broad rather than dominant', () => {
    const mixed = [
      ...library('E', 6, ['Nova Lattice'], ['techno']),
      ...library('J', 6, ['Teo Vance'], ['jazz']),
      ...library('F', 6, ['Ivy Marlowe'], ['indie folk']),
      ...library('R', 6, ['Steel Orchard'], ['post rock']),
    ];
    const insights = generateInsights(computeProfile(mixed));
    expect(insights.find((i) => i.id === 'dominant-family')).toBeUndefined();
    expect(insights.find((i) => i.id === 'breadth')?.text).toContain('4 distinct genre families');
  });

  it('labels genre-implied attributes as inferred with low confidence', () => {
    const insights = generateInsights(computeProfile(library('S', 10, ['Nova Lattice', 'Kilo Ray'], ['synthwave'])));
    const synth = insights.find((i) => i.id === 'attr-instrument-synthesizer');
    expect(synth?.basis).toBe('inferred');
    expect(synth?.confidence).toBe('low');
    expect(synth?.text).toContain('associated with');
  });

  it('states verified attributes only with verified evidence', () => {
    const tracks = library('P', 10, ['Teo Vance'], ['jazz']).map((t) => ({ ...t, attributes: [attr('instrument', 'piano')] }));
    const insight = generateInsights(computeProfile(tracks)).find((i) => i.id === 'attr-instrument-piano');
    expect(insight?.basis).toBe('metadata');
    expect(insight?.text).toContain('verified metadata');
  });

  it('adds caveats for small libraries and missing genres', () => {
    const insights = generateInsights(computeProfile([track('A', 'X', []), track('B', 'Y', ['jazz'])]));
    expect(insights.map((i) => i.id)).toEqual(expect.arrayContaining(['small-library', 'missing-genres', 'no-verified-attributes']));
  });

  it('never makes non-musical claims', () => {
    const insights = generateInsights(computeProfile(library('E', 30, ['Nova Lattice', 'Ivy Marlowe'], ['techno', 'indie folk'])));
    const banned = /intelligen|personality|introvert|extrovert|depress|anxi|politic|moral|religio|gender|age\b/i;
    for (const i of insights) expect(i.text).not.toMatch(banned);
  });

  it('uses user-provided genres', () => {
    const p = computeProfile([track('A', 'X', [genre('jazz', 'user', 1, 'csv')])]);
    expect(p.genres[0]).toMatchObject({ name: 'jazz', kinds: ['user'], sources: ['csv'] });
  });
});
