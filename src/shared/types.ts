/**
 * Shared domain types used by the analysis engine, the server and the client.
 * Nothing in this file performs I/O.
 */

export type ProviderId =
  | 'spotify'
  | 'youtube'
  | 'apple_music'
  | 'csv'
  | 'text'
  | 'm3u'
  | 'xspf'
  | 'json'
  | 'manual';

/**
 * Where a metadata value came from. SOMM never presents an inferred value as
 * a fact, so every genre and attribute carries one of these kinds.
 *
 * - `provided`  — the source provider's own catalogue metadata (e.g. Apple genreNames).
 * - `credited`  — an explicit credit relationship (e.g. MusicBrainz performer → instrument).
 * - `community` — community-voted metadata (e.g. MusicBrainz genre votes).
 * - `user`      — supplied by the user in an import file.
 * - `inferred`  — derived by a documented SOMM rule from other metadata.
 */
export type MetadataKind = 'provided' | 'credited' | 'community' | 'user' | 'inferred';

export type AttributeCategory = 'instrument' | 'vocal' | 'texture' | 'mood' | 'rhythm' | 'production';

export interface GenreAssignment {
  name: string;
  family: string;
  source: string;
  kind: MetadataKind;
  /** 0..1 — how much the source supports this assignment. */
  confidence: number;
}

export interface AttributeAssignment {
  category: AttributeCategory;
  value: string;
  source: string;
  kind: MetadataKind;
  confidence: number;
  /** Human-readable evidence, e.g. "genre 'synthwave'" or "credit: Jane Doe – piano". */
  evidence?: string;
}

export interface TrackArtistRef {
  id: string;
  name: string;
  role: 'primary' | 'featured';
}

/** A canonical track as seen by the analysis engine (one per distinct recording in a library). */
export interface LibraryTrack {
  id: string;
  title: string;
  version: string | null;
  artists: TrackArtistRef[];
  album: { id: string; title: string } | null;
  releaseYear: number | null;
  durationMs: number | null;
  explicit: boolean | null;
  genres: GenreAssignment[];
  attributes: AttributeAssignment[];
  tempoBpm: number | null;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface FamilyStat {
  family: string;
  label: string;
  trackCount: number;
  share: number;
}

export interface GenreStat {
  name: string;
  family: string;
  trackCount: number;
  /** Share of tracks that have any genre information. */
  share: number;
  sources: string[];
  kinds: MetadataKind[];
  meanConfidence: number;
}

export interface ArtistStat {
  id: string;
  name: string;
  trackCount: number;
  share: number;
  topGenres: string[];
}

export interface AttributeStat {
  category: AttributeCategory;
  value: string;
  trackCount: number;
  /** Share of all tracks in the library. */
  share: number;
  /** Tracks where the attribute comes from provided/credited/user/community metadata. */
  verifiedCount: number;
  /** Tracks where the attribute is only inferred by a SOMM rule. */
  inferredCount: number;
  meanConfidence: number;
  evidence: string[];
}

export interface MusicProfile {
  schemaVersion: 1;
  inputHash: string;
  totals: {
    tracks: number;
    artists: number;
    albums: number;
    genres: number;
    families: number;
  };
  /** Fraction (0..1) of tracks carrying each kind of metadata. */
  coverage: {
    genre: number;
    year: number;
    album: number;
    duration: number;
    /** Tracks with any attribute, including SOMM inferences. */
    attributes: number;
    /** Tracks with at least one verified (non-inferred, confident) attribute. */
    verifiedAttributes: number;
    tempo: number;
  };
  families: FamilyStat[];
  genres: GenreStat[];
  artists: ArtistStat[];
  albums: { id: string; title: string; trackCount: number }[];
  decades: { decade: number; trackCount: number }[];
  years: { min: number; max: number; median: number } | null;
  diversity: {
    /** Normalised Shannon entropy of the artist distribution (0 = one artist, 1 = perfectly even). */
    artistEntropy: number;
    genreEntropy: number;
    familyEntropy: number;
    uniqueArtistRatio: number;
    /** Share of tracks belonging to the five most frequent artists. */
    topFiveArtistShare: number;
  };
  genreCooccurrence: { a: string; b: string; trackCount: number; jaccard: number }[];
  attributes: AttributeStat[];
  versions: { label: string; trackCount: number }[];
  explicitShare: number | null;
  tempo: { trackCount: number; medianBpm: number; minBpm: number; maxBpm: number } | null;
  unknownGenreCount: number;
}

export interface Insight {
  id: string;
  text: string;
  confidence: ConfidenceLevel;
  /** `metadata` = computed from stored metadata; `inferred` = relies on SOMM inference rules. */
  basis: 'metadata' | 'inferred' | 'coverage';
  evidence: { label: string; value: string }[];
}

/** Sparse vectors used for matching. Keys are stable ids, values are non-negative weights. */
export interface MatchVector {
  tracks: Record<string, number>;
  artists: Record<string, number>;
  genres: Record<string, number>;
  attributes: Record<string, number>;
  /** Number of tracks contributing verified attribute evidence. */
  attributeEvidence: number;
  /** Descriptive tag tokens not already used by genres/attributes (optional text component). */
  text: Record<string, number>;
  trackCount: number;
  genreTrackCount: number;
}
