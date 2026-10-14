/**
 * Builders for fictional library tracks. Every artist, title and album used in
 * tests is invented for SOMM's test-suite.
 */
import { canonicalGenre, genreFamily } from '../../src/shared/taxonomy';
import type { AttributeAssignment, GenreAssignment, LibraryTrack, MetadataKind } from '../../src/shared/types';

export function genre(name: string, kind: MetadataKind = 'community', confidence = 0.8, source = 'test'): GenreAssignment {
  const canonical = canonicalGenre(name)!;
  return { name: canonical, family: genreFamily(canonical), kind, confidence, source };
}

export function track(
  title: string,
  artist: string,
  genres: (string | GenreAssignment)[] = [],
  extra: Partial<LibraryTrack> & { id?: string; featured?: string[] } = {},
): LibraryTrack {
  const artistId = `a-${artist.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return {
    id: extra.id ?? `t-${artistId}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    title,
    version: extra.version ?? null,
    artists: [
      { id: artistId, name: artist, role: 'primary' },
      ...(extra.featured ?? []).map((f) => ({ id: `a-${f.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: f, role: 'featured' as const })),
    ],
    album: extra.album ?? null,
    releaseYear: extra.releaseYear ?? null,
    durationMs: extra.durationMs ?? null,
    explicit: extra.explicit ?? null,
    genres: genres.map((g) => (typeof g === 'string' ? genre(g) : g)),
    attributes: extra.attributes ?? [],
    tempoBpm: extra.tempoBpm ?? null,
  };
}

export function attr(category: AttributeAssignment['category'], value: string, kind: MetadataKind = 'credited', confidence = 0.9): AttributeAssignment {
  return { category, value, kind, confidence, source: 'test', evidence: `${kind} test metadata` };
}

/** n fictional tracks by `artists` (round-robin) tagged with `genres`. */
export function library(prefix: string, n: number, artists: string[], genres: string[], extra: Partial<LibraryTrack> = {}): LibraryTrack[] {
  return Array.from({ length: n }, (_, i) =>
    track(`${prefix} ${i + 1}`, artists[i % artists.length]!, genres.length ? [genres[i % genres.length]!] : [], extra),
  );
}
