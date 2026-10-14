/**
 * Stage 3 — transparent, weighted similarity between two music vectors.
 *
 * Music Match = Σ wᵢ·cᵢ / Σ wᵢ over the components that can be computed.
 * Default weights (hypotheses, configurable — see docs/MATCHING_ALGORITHM.md):
 *   tracks 0.40 · artists 0.25 · genres 0.20 · attributes 0.15 · text 0
 *
 * Safeguards:
 * - Popular items are down-weighted with inverse document frequency (IDF), so a
 *   song everyone has says little about two people.
 * - Each overlap component is multiplied by an evidence factor s / (s + k), where
 *   s is the number of shared items, so a single shared song or artist can never
 *   produce a high score on its own.
 * - Cosine normalisation stops large libraries from dominating small ones.
 * - Components that cannot be computed (e.g. no verified attributes) are left
 *   out and the remaining weights are renormalised, instead of counting as zero.
 */
import type { MatchVector } from '../types';

export type ComponentKey = 'tracks' | 'artists' | 'genres' | 'attributes' | 'text';

export type MatchWeights = Record<ComponentKey, number>;

export const DEFAULT_WEIGHTS: MatchWeights = {
  tracks: 0.4,
  artists: 0.25,
  genres: 0.2,
  attributes: 0.15,
  text: 0,
};

/** Evidence half-saturation constants: shared items needed for a 50% evidence factor. */
export const EVIDENCE_K: Record<ComponentKey, number> = {
  tracks: 1.5,
  artists: 2,
  genres: 3,
  attributes: 2,
  text: 3,
};

/** Minimum tracks with verified attributes (each side) before the attribute component is used. */
export const MIN_ATTRIBUTE_EVIDENCE = 3;
/** Minimum tracks with genre information (each side) before the genre component is used. */
export const MIN_GENRE_EVIDENCE = 1;

export interface PopulationStats {
  /** Number of profiles in the population. */
  size: number;
  /** Document frequency of each key (how many profiles contain it), per component. */
  df: Partial<Record<ComponentKey, Record<string, number>>>;
}

export interface ComponentScore {
  key: ComponentKey;
  label: string;
  available: boolean;
  /** Raw similarity before the evidence factor (0..1). */
  raw: number;
  /** Evidence factor s/(s+k) (0..1). */
  evidence: number;
  /** Final component score = raw × evidence (0..1). */
  score: number;
  weight: number;
  /** Weight after renormalisation over available components. */
  effectiveWeight: number;
  /** Contribution to the total = score × effectiveWeight. */
  contribution: number;
  sharedCount: number;
  /** Keys of the most informative shared items (highest IDF-weighted product). */
  topShared: string[];
  reason?: string;
}

export type MatchLabel = 'strong' | 'good' | 'possible' | 'low';

export interface MatchResult {
  score: number;
  label: MatchLabel;
  /** Why the label may have been capped by the evidence gate. */
  gate: string | null;
  components: ComponentScore[];
  weights: MatchWeights;
}

const LABELS: Record<ComponentKey, string> = {
  tracks: 'Shared tracks',
  artists: 'Shared artists',
  genres: 'Genre distribution',
  attributes: 'Verified sound attributes',
  text: 'Descriptive tag similarity',
};

function idf(population: PopulationStats | undefined, component: ComponentKey, key: string): number {
  if (!population || population.size < 2) return 1;
  const df = population.df[component]?.[key] ?? 0;
  // Smoothed IDF, normalised so an item held by nobody else scores 1 and an item
  // held by everyone approaches a floor of ~0.15.
  const raw = Math.log((population.size + 1) / (df + 1)) + 1;
  const max = Math.log(population.size + 1) + 1;
  return Math.max(0.15, raw / max);
}

function weightedCosine(
  a: Record<string, number>,
  b: Record<string, number>,
  weightOf: (key: string) => number,
): { cosine: number; shared: { key: string; strength: number }[] } {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const shared: { key: string; strength: number }[] = [];
  for (const [k, va] of Object.entries(a)) {
    const w = weightOf(k);
    const x = va * w;
    na += x * x;
    const vb = b[k];
    if (vb !== undefined && vb > 0 && va > 0) {
      const y = vb * w;
      dot += x * y;
      shared.push({ key: k, strength: x * y });
    }
  }
  for (const [k, vb] of Object.entries(b)) {
    const y = vb * weightOf(k);
    nb += y * y;
  }
  if (na === 0 || nb === 0) return { cosine: 0, shared };
  shared.sort((p, q) => q.strength - p.strength || p.key.localeCompare(q.key));
  return { cosine: Math.min(1, dot / Math.sqrt(na * nb)), shared };
}

function round(value: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function normalizeWeights(weights: Partial<MatchWeights> | undefined): MatchWeights {
  const merged: MatchWeights = { ...DEFAULT_WEIGHTS, ...(weights ?? {}) };
  for (const k of Object.keys(merged) as ComponentKey[]) {
    const v = merged[k];
    merged[k] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  return merged;
}

export interface CompareOptions {
  weights?: Partial<MatchWeights>;
  population?: PopulationStats;
}

/**
 * Compare two vectors. Works for user↔user and user↔Tree (Tree vectors hold
 * member fractions instead of binary weights; cosine handles both).
 */
export function compareVectors(a: MatchVector, b: MatchVector, options: CompareOptions = {}): MatchResult {
  const weights = normalizeWeights(options.weights);
  const pop = options.population;
  const components: ComponentScore[] = [];

  const overlapComponent = (key: 'tracks' | 'artists', va: Record<string, number>, vb: Record<string, number>) => {
    const available = Object.keys(va).length > 0 && Object.keys(vb).length > 0;
    const { cosine, shared } = weightedCosine(va, vb, (k) => idf(pop, key, k));
    const sharedCount = shared.length;
    const evidence = sharedCount / (sharedCount + EVIDENCE_K[key]);
    components.push({
      key,
      label: LABELS[key],
      available,
      raw: round(cosine),
      evidence: round(evidence),
      score: round(cosine * evidence),
      weight: weights[key],
      effectiveWeight: 0,
      contribution: 0,
      sharedCount,
      topShared: shared.slice(0, 8).map((s) => s.key),
      reason: available ? undefined : 'One of the libraries is empty.',
    });
  };

  overlapComponent('tracks', a.tracks, b.tracks);
  overlapComponent('artists', a.artists, b.artists);

  // Genres: cosine over genre + family distributions with IDF so that broad,
  // near-universal genres (pop, rock) count for less than specific ones.
  {
    const available = a.genreTrackCount >= MIN_GENRE_EVIDENCE && b.genreTrackCount >= MIN_GENRE_EVIDENCE;
    const { cosine, shared } = weightedCosine(a.genres, b.genres, (k) => idf(pop, 'genres', k));
    const specificShared = shared.filter((s) => !s.key.startsWith('family:'));
    const n = Math.min(a.genreTrackCount, b.genreTrackCount);
    const evidence = n / (n + EVIDENCE_K.genres);
    components.push({
      key: 'genres',
      label: LABELS.genres,
      available,
      raw: round(cosine),
      evidence: round(evidence),
      score: available ? round(cosine * evidence) : 0,
      weight: weights.genres,
      effectiveWeight: 0,
      contribution: 0,
      sharedCount: specificShared.length,
      topShared: specificShared.slice(0, 8).map((s) => s.key),
      reason: available ? undefined : 'Genre information is missing for one of the libraries.',
    });
  }

  // Verified attributes (credits, user-provided, provider metadata) only.
  {
    const available =
      a.attributeEvidence >= MIN_ATTRIBUTE_EVIDENCE &&
      b.attributeEvidence >= MIN_ATTRIBUTE_EVIDENCE &&
      Object.keys(a.attributes).length > 0 &&
      Object.keys(b.attributes).length > 0;
    const { cosine, shared } = weightedCosine(a.attributes, b.attributes, (k) => idf(pop, 'attributes', k));
    const evidence = shared.length / (shared.length + EVIDENCE_K.attributes);
    components.push({
      key: 'attributes',
      label: LABELS.attributes,
      available,
      raw: available ? round(cosine) : 0,
      evidence: available ? round(evidence) : 0,
      score: available ? round(cosine * evidence) : 0,
      weight: weights.attributes,
      effectiveWeight: 0,
      contribution: 0,
      sharedCount: available ? shared.length : 0,
      topShared: available ? shared.slice(0, 8).map((s) => s.key) : [],
      reason: available
        ? undefined
        : `Needs at least ${MIN_ATTRIBUTE_EVIDENCE} tracks with verified attributes on both sides; weight redistributed.`,
    });
  }

  {
    const available = weights.text > 0 && Object.keys(a.text).length > 0 && Object.keys(b.text).length > 0;
    const { cosine, shared } = weightedCosine(a.text, b.text, (k) => idf(pop, 'text', k));
    const evidence = shared.length / (shared.length + EVIDENCE_K.text);
    components.push({
      key: 'text',
      label: LABELS.text,
      available,
      raw: available ? round(cosine) : 0,
      evidence: available ? round(evidence) : 0,
      score: available ? round(cosine * evidence) : 0,
      weight: weights.text,
      effectiveWeight: 0,
      contribution: 0,
      sharedCount: available ? shared.length : 0,
      topShared: available ? shared.slice(0, 8).map((s) => s.key) : [],
      reason: available ? undefined : weights.text > 0 ? 'No descriptive tags on one side.' : 'Disabled (weight 0).',
    });
  }

  const usable = components.filter((c) => c.available && c.weight > 0);
  const weightSum = usable.reduce((s, c) => s + c.weight, 0);
  let score = 0;
  for (const c of components) {
    if (c.available && c.weight > 0 && weightSum > 0) {
      c.effectiveWeight = round(c.weight / weightSum);
      c.contribution = round(c.score * c.effectiveWeight);
      score += c.score * (c.weight / weightSum);
    }
  }
  score = round(score);

  const { label, gate } = labelFor(score, components);
  return { score, label, gate, components, weights };
}

/**
 * Score bands plus an evidence gate: a high label requires several shared items,
 * not just a high number. This is what stops one popular song or one popular
 * artist from producing a "strong" match.
 */
export function labelFor(score: number, components: ComponentScore[]): { label: MatchLabel; gate: string | null } {
  const tracks = components.find((c) => c.key === 'tracks')?.sharedCount ?? 0;
  const artists = components.find((c) => c.key === 'artists')?.sharedCount ?? 0;
  const genreScore = components.find((c) => c.key === 'genres')?.score ?? 0;
  const sharedItems = tracks + artists;

  let label: MatchLabel = score >= 0.55 ? 'strong' : score >= 0.35 ? 'good' : score >= 0.2 ? 'possible' : 'low';
  let gate: string | null = null;

  if (label === 'strong' && !(tracks >= 3 || artists >= 3)) {
    label = 'good';
    gate = 'A strong match needs at least 3 shared tracks or 3 shared artists.';
  }
  if (label === 'good' && !(artists >= 2 || tracks >= 2 || (genreScore >= 0.6 && sharedItems >= 1))) {
    label = 'possible';
    gate = 'A good match needs at least 2 shared artists or tracks, or a close genre profile plus one shared item.';
  }
  return { label, gate };
}

/** Build document-frequency statistics from a set of vectors (used for IDF). */
export function buildPopulationStats(vectors: MatchVector[]): PopulationStats {
  const df: PopulationStats['df'] = { tracks: {}, artists: {}, genres: {}, attributes: {}, text: {} };
  for (const v of vectors) {
    for (const key of ['tracks', 'artists', 'genres', 'attributes', 'text'] as const) {
      const bucket = df[key]!;
      for (const k of Object.keys(v[key])) bucket[k] = (bucket[k] ?? 0) + 1;
    }
  }
  return { size: vectors.length, df };
}
