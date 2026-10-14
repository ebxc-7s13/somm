import { describe, expect, it } from 'vitest';
import { aggregateVectors, clusterProfiles, explainMatch, labelTree } from '../../src/shared/analysis/communities';
import { buildMatchVector } from '../../src/shared/analysis/profile';
import { buildPopulationStats, compareVectors, DEFAULT_WEIGHTS, labelFor } from '../../src/shared/analysis/similarity';
import { attr, library, track } from '../helpers/library';

const electronicArtists = ['Nova Lattice', 'Pulse Garden', 'Kilo Ray', 'Velvet Static', 'Orbit Choir'];

describe('compareVectors', () => {
  it('scores identical track lists as a strong match', () => {
    const lib = library('Song', 25, electronicArtists, ['techno', 'ambient']);
    const r = compareVectors(buildMatchVector(lib), buildMatchVector(lib));
    expect(r.score).toBeGreaterThan(0.85);
    expect(r.label).toBe('strong');
    expect(r.components.find((c) => c.key === 'tracks')?.sharedCount).toBe(25);
  });

  it('gives shared artists with no shared tracks a moderate score', () => {
    const a = library('A-side', 20, electronicArtists, ['techno']);
    const b = library('B-side', 20, electronicArtists, ['techno']);
    const r = compareVectors(buildMatchVector(a), buildMatchVector(b));
    const tracks = r.components.find((c) => c.key === 'tracks')!;
    const artists = r.components.find((c) => c.key === 'artists')!;
    expect(tracks.sharedCount).toBe(0);
    expect(tracks.score).toBe(0);
    expect(artists.sharedCount).toBe(5);
    expect(r.score).toBeGreaterThan(0.35);
    expect(r.score).toBeLessThan(0.75);
    expect(['good', 'strong']).toContain(r.label);
  });

  it('does not treat broad popular-genre overlap alone as a strong match', () => {
    const a = library('Pop A', 30, ['Star One', 'Star Two', 'Star Three'], ['pop']);
    const b = library('Pop B', 30, ['Idol Four', 'Idol Five', 'Idol Six'], ['pop']);
    const r = compareVectors(buildMatchVector(a), buildMatchVector(b));
    expect(r.components.find((c) => c.key === 'genres')!.raw).toBeGreaterThan(0.95);
    expect(r.score).toBeLessThan(0.3);
    expect(['possible', 'low']).toContain(r.label);
  });

  it('keeps different genres with a few shared artists in the low-to-possible range', () => {
    const a = [...library('Metal', 28, ['Iron Vale', 'Ash Crown', 'Grave Signal'], ['death metal']), ...library('Cross', 2, ['Crossover Kid', 'Bridge Unit'], ['metal'])];
    const b = [...library('Jazz', 28, ['Teo Vance', 'Blue Lantern', 'Mono Quartet'], ['hard bop']), ...library('X', 2, ['Crossover Kid', 'Bridge Unit'], ['jazz'])];
    const r = compareVectors(buildMatchVector(a), buildMatchVector(b));
    expect(r.components.find((c) => c.key === 'artists')!.sharedCount).toBe(2);
    expect(r.score).toBeLessThan(0.3);
    expect(r.label).not.toBe('strong');
    expect(r.label).not.toBe('good');
  });

  it('normalises unequal playlist sizes so a huge library does not dominate', () => {
    const small = library('Core', 10, electronicArtists, ['techno']);
    const huge = [...small, ...library('Extra', 990, Array.from({ length: 200 }, (_, i) => `Other ${i}`), ['rock', 'pop', 'jazz', 'country'])];
    const sameSmall = library('Core', 10, electronicArtists, ['techno']);
    const rHuge = compareVectors(buildMatchVector(small), buildMatchVector(huge));
    const rSame = compareVectors(buildMatchVector(small), buildMatchVector(sameSmall));
    // Containing all of someone's songs inside 1000 others is weaker evidence than an equal library.
    expect(rHuge.score).toBeLessThan(rSame.score);
    expect(rHuge.score).toBeGreaterThan(0);
    // Symmetric.
    expect(compareVectors(buildMatchVector(huge), buildMatchVector(small)).score).toBeCloseTo(rHuge.score, 6);
  });

  it('renormalises weights when verified attributes are missing', () => {
    const lib = library('S', 12, electronicArtists, ['techno']);
    const r = compareVectors(buildMatchVector(lib), buildMatchVector(lib));
    const attributes = r.components.find((c) => c.key === 'attributes')!;
    expect(attributes.available).toBe(false);
    expect(attributes.reason).toMatch(/redistributed/);
    const effective = r.components.filter((c) => c.available).reduce((s, c) => s + c.effectiveWeight, 0);
    expect(effective).toBeCloseTo(1, 3);
    expect(r.components.find((c) => c.key === 'tracks')!.effectiveWeight).toBeCloseTo(0.4 / 0.85, 3);
  });

  it('uses verified attributes when both sides have enough evidence', () => {
    const withPiano = (prefix: string) =>
      library(prefix, 6, ['Teo Vance', 'Blue Lantern'], ['jazz']).map((t) => ({ ...t, attributes: [attr('instrument', 'piano')] }));
    const r = compareVectors(buildMatchVector(withPiano('A')), buildMatchVector(withPiano('B')));
    const attributes = r.components.find((c) => c.key === 'attributes')!;
    expect(attributes.available).toBe(true);
    expect(attributes.raw).toBeCloseTo(1, 3);
    expect(attributes.effectiveWeight).toBeCloseTo(0.15, 3);
  });

  it('exposes transparent component scores that add up to the total', () => {
    const a = library('A', 15, electronicArtists, ['techno', 'ambient']);
    const b = [...a.slice(0, 5), ...library('B', 10, electronicArtists.slice(0, 2), ['ambient'])];
    const r = compareVectors(buildMatchVector(a), buildMatchVector(b));
    const sum = r.components.reduce((s, c) => s + c.contribution, 0);
    expect(sum).toBeCloseTo(r.score, 2);
    for (const c of r.components) {
      expect(c.score).toBeCloseTo(c.raw * c.evidence, 3);
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(1);
    }
    expect(r.weights).toEqual(DEFAULT_WEIGHTS);
  });

  it('does not overmatch on one popular song', () => {
    const hit = track('Summer Anthem', 'Chart Giant', ['pop']);
    const a = [hit, track('Moss', 'Forest Choir', ['folk']), track('Fern', 'Forest Choir', ['folk'])];
    const b = [hit, track('Rust', 'Iron Vale', ['metal']), track('Ash', 'Iron Vale', ['metal'])];
    const others = Array.from({ length: 30 }, (_, i) => buildMatchVector([hit, track(`Filler ${i}`, `Filler Artist ${i}`, ['pop'])]));
    const population = buildPopulationStats([buildMatchVector(a), buildMatchVector(b), ...others]);
    const r = compareVectors(buildMatchVector(a), buildMatchVector(b), { population });
    expect(r.components.find((c) => c.key === 'tracks')!.sharedCount).toBe(1);
    expect(r.score).toBeLessThan(0.15);
    expect(r.label).toBe('low');
    // Even two one-song libraries with the same song are held down by the evidence factor s/(s+k).
    const tiny = compareVectors(buildMatchVector([hit]), buildMatchVector([hit]));
    expect(tiny.components.find((c) => c.key === 'tracks')!.raw).toBe(1);
    expect(tiny.score).toBeLessThan(0.35);
    expect(['possible', 'low']).toContain(tiny.label);
  });

  it('caps high scores without enough shared items (evidence gate)', () => {
    const component = (key: 'tracks' | 'artists' | 'genres', sharedCount: number, score: number) => ({
      key, label: key, available: true, raw: score, evidence: 1, score, weight: 1, effectiveWeight: 1, contribution: score, sharedCount, topShared: [],
    });
    const gated = labelFor(0.8, [component('tracks', 1, 0.9), component('artists', 2, 0.9), component('genres', 5, 0.9)]);
    expect(gated.label).toBe('good');
    expect(gated.gate).toMatch(/3 shared tracks or 3 shared artists/);
    const doubleGated = labelFor(0.5, [component('tracks', 0, 0), component('artists', 1, 0.4), component('genres', 5, 0.3)]);
    expect(doubleGated.label).toBe('possible');
    expect(labelFor(0.8, [component('tracks', 4, 0.9), component('artists', 4, 0.9)]).label).toBe('strong');
  });

  it('handles empty libraries without NaN', () => {
    const r = compareVectors(buildMatchVector([]), buildMatchVector(library('A', 3, ['X'], ['jazz'])));
    expect(r.score).toBe(0);
    expect(Number.isNaN(r.score)).toBe(false);
  });

  it('accepts configurable weights', () => {
    const a = library('A', 10, electronicArtists, ['techno']);
    const b = library('B', 10, electronicArtists, ['techno']);
    const genresOnly = compareVectors(buildMatchVector(a), buildMatchVector(b), { weights: { tracks: 0, artists: 0, genres: 1, attributes: 0 } });
    expect(genresOnly.components.find((c) => c.key === 'genres')!.effectiveWeight).toBe(1);
  });
});

describe('Trees — clustering and labels', () => {
  const user = (prefix: string, artists: string[], genres: string[]) => ({ id: prefix, vector: buildMatchVector(library(prefix, 20, artists, genres)) });

  it('clusters compatible listeners and ignores outliers', () => {
    const inputs = [
      user('e1', electronicArtists, ['techno', 'ambient']),
      user('e2', electronicArtists, ['techno', 'ambient']),
      user('e3', electronicArtists.slice(0, 4), ['techno']),
      user('j1', ['Teo Vance', 'Blue Lantern', 'Mono Quartet'], ['hard bop']),
      user('j2', ['Teo Vance', 'Blue Lantern', 'Mono Quartet'], ['hard bop', 'cool jazz']),
      user('m1', ['Iron Vale'], ['death metal']),
    ];
    const clusters = clusterProfiles(inputs, { minSize: 3 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.memberIds).toEqual(['e1', 'e2', 'e3']);
    // With a minimum of 2 the jazz pair forms its own group; the metal listener stays alone.
    const pairs = clusterProfiles(inputs, { minSize: 2 });
    expect(pairs.map((c) => c.memberIds)).toEqual([['e1', 'e2', 'e3'], ['j1', 'j2']]);
  });

  it('requires the minimum evidence threshold before forming a Tree', () => {
    expect(clusterProfiles([user('a', ['X'], ['pop']), user('b', ['Y'], ['pop'])], { minSize: 3 })).toEqual([]);
    expect(clusterProfiles([], {})).toEqual([]);
  });

  it('labels Trees from the dominant genres in the data', () => {
    const agg = aggregateVectors([
      buildMatchVector(library('a', 20, electronicArtists, ['ambient', 'drone'])),
      buildMatchVector(library('b', 20, electronicArtists, ['ambient'])),
    ]);
    const label = labelTree(agg);
    expect(label.name).toContain('Atmosphere');
    expect(label.topFamilies[0]).toBe('ambient');
    const mixed = aggregateVectors([
      buildMatchVector(library('m', 40, ['A', 'B', 'C', 'D'], ['jazz', 'techno', 'indie folk', 'death metal'])),
    ]);
    expect(labelTree(mixed).name).toBe('Cross-Genre Discoverers');
  });

  it('aggregates member fractions without exposing a single library', () => {
    const agg = aggregateVectors([
      buildMatchVector([track('Shared', 'Nova Lattice', ['techno'])]),
      buildMatchVector([track('Shared', 'Nova Lattice', ['techno']), track('Solo', 'Hidden Artist', ['techno'])]),
    ]);
    expect(agg.artists['a-nova-lattice']).toBe(1);
    expect(agg.artists['a-hidden-artist']).toBe(0.5);
  });

  it('explains matches using only computed numbers', () => {
    const lib = library('A', 12, electronicArtists, ['techno']);
    const r = compareVectors(buildMatchVector(lib), buildMatchVector(library('B', 12, electronicArtists, ['techno'])));
    const ex = explainMatch(r, { artists: { 'a-nova-lattice': 'Nova Lattice' } });
    expect(ex.summary).toContain('share several artists');
    expect(ex.points.join(' ')).toContain('5 shared artists');
    expect(ex.points.join(' ')).toContain('Nova Lattice');
    expect(ex.points.join(' ')).toMatch(/redistributed/);
  });
});
