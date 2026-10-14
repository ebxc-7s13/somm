/**
 * Trees — music-based communities.
 *
 * - A Tree's profile is the aggregate of its members' *shared* vectors
 *   (private playlists never contribute). Each key holds the fraction of
 *   members that have it, so no single member's library is exposed.
 * - New Trees are proposed from clusters of compatible listeners using
 *   average-linkage agglomerative clustering with a similarity threshold and a
 *   minimum cluster size, so SOMM does not create hundreds of near-empty groups.
 * - Labels come from the cluster's actual dominant genres, not from a fixed list.
 */
import { FAMILY_LABELS, genreDisplayName, type Family } from '../taxonomy';
import type { MatchVector } from '../types';
import { compareVectors, type CompareOptions, type MatchResult } from './similarity';

export const MIN_TREE_MEMBERS = 3;
export const CLUSTER_THRESHOLD = 0.3;
/** Items (artists/tracks) must be held by at least this many members to be listed publicly in a Tree. */
export const K_ANONYMITY = 2;
/** No artists are listed at all until this many members contribute (2 would expose the other person exactly). */
export const MIN_CONTRIBUTORS_FOR_ARTISTS = 3;

export function aggregateVectors(vectors: MatchVector[]): MatchVector {
  const n = vectors.length;
  const out: MatchVector = {
    tracks: {},
    artists: {},
    genres: {},
    attributes: {},
    attributeEvidence: 0,
    text: {},
    trackCount: 0,
    genreTrackCount: 0,
  };
  if (n === 0) return out;
  const add = (target: Record<string, number>, source: Record<string, number>, normalise: boolean) => {
    let total = 0;
    if (normalise) for (const v of Object.values(source)) total += v;
    for (const [k, v] of Object.entries(source)) {
      const value = normalise ? (total > 0 ? v / total : 0) : v > 0 ? 1 : 0;
      target[k] = (target[k] ?? 0) + value / n;
    }
  };
  for (const v of vectors) {
    add(out.tracks, v.tracks, false);
    add(out.artists, v.artists, false);
    add(out.genres, v.genres, true);
    add(out.attributes, v.attributes, true);
    add(out.text, v.text, true);
    out.attributeEvidence += v.attributeEvidence;
    out.trackCount += v.trackCount;
    out.genreTrackCount += v.genreTrackCount;
  }
  const r = (rec: Record<string, number>) => {
    for (const k of Object.keys(rec)) rec[k] = Math.round(rec[k]! * 1e6) / 1e6;
  };
  r(out.tracks);
  r(out.artists);
  r(out.genres);
  r(out.attributes);
  r(out.text);
  return out;
}

export interface ClusterInput {
  id: string;
  vector: MatchVector;
}

export interface Cluster {
  memberIds: string[];
  /** Mean pairwise similarity inside the cluster. */
  cohesion: number;
}

/**
 * Average-linkage agglomerative clustering. O(n²) similarity evaluations, which
 * is fine for a periodic batch over a few thousand discoverable profiles; larger
 * populations should block candidates by top genre family first (see docs).
 */
export function clusterProfiles(
  inputs: ClusterInput[],
  options: CompareOptions & { threshold?: number; minSize?: number } = {},
): Cluster[] {
  const threshold = options.threshold ?? CLUSTER_THRESHOLD;
  const minSize = options.minSize ?? MIN_TREE_MEMBERS;
  const items = [...inputs].sort((a, b) => a.id.localeCompare(b.id));
  const n = items.length;
  if (n < minSize) return [];

  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = compareVectors(items[i]!.vector, items[j]!.vector, options).score;
      sim[i]![j] = s;
      sim[j]![i] = s;
    }
  }

  let clusters: number[][] = items.map((_, i) => [i]);
  const linkage = (a: number[], b: number[]) => {
    let s = 0;
    for (const i of a) for (const j of b) s += sim[i]![j]!;
    return s / (a.length * b.length);
  };

  for (;;) {
    let best = -1;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const l = linkage(clusters[i]!, clusters[j]!);
        if (l > best) {
          best = l;
          bi = i;
          bj = j;
        }
      }
    }
    if (best < threshold || bi < 0) break;
    const merged = [...clusters[bi]!, ...clusters[bj]!].sort((x, y) => x - y);
    clusters = clusters.filter((_, k) => k !== bi && k !== bj);
    clusters.push(merged);
  }

  return clusters
    .filter((c) => c.length >= minSize)
    .map((c) => {
      let s = 0;
      let pairs = 0;
      for (let x = 0; x < c.length; x++) {
        for (let y = x + 1; y < c.length; y++) {
          s += sim[c[x]!]![c[y]!]!;
          pairs++;
        }
      }
      return { memberIds: c.map((i) => items[i]!.id).sort(), cohesion: pairs ? Math.round((s / pairs) * 1e4) / 1e4 : 0 };
    })
    .sort((a, b) => b.memberIds.length - a.memberIds.length || b.cohesion - a.cohesion || a.memberIds[0]!.localeCompare(b.memberIds[0]!));
}

const FAMILY_NOUNS: Record<string, string> = {
  electronic: 'Sound Explorers',
  ambient: 'Atmosphere',
  rock: 'Collective',
  metal: 'Heavy Riffs',
  pop: 'Hook Society',
  'hip hop': 'Cypher',
  'r&b & soul': 'Soul Circle',
  jazz: 'Improvisation Circle',
  blues: 'Blues Porch',
  classical: 'Chamber',
  'folk & country': 'Campfire',
  indian: 'Raga Explorers',
  latin: 'Ritmo Club',
  'reggae & caribbean': 'Riddim Yard',
  african: 'Groove Collective',
  world: 'World Crossing',
  experimental: 'Sound Lab',
  soundtrack: 'Score Room',
  other: 'Listening Room',
};

export interface TreeLabel {
  name: string;
  description: string;
  topFamilies: string[];
  topGenres: string[];
}

/** Derive a readable label from an aggregate vector's dominant genres. */
export function labelTree(aggregate: MatchVector): TreeLabel {
  const families = Object.entries(aggregate.genres)
    .filter(([k]) => k.startsWith('family:'))
    .map(([k, v]) => [k.slice(7), v] as const)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const genres = Object.entries(aggregate.genres)
    .filter(([k]) => !k.startsWith('family:'))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const familyTotal = families.reduce((s, [, v]) => s + v, 0) || 1;
  const topFamilies = families.slice(0, 3).map(([f]) => f);
  const topGenres = genres.slice(0, 4).map(([g]) => g);
  const lead = families[0];
  const leadShare = lead ? lead[1] / familyTotal : 0;

  let name: string;
  if (!lead) {
    name = 'Open Listening Room';
  } else if (leadShare < 0.35 && families.length >= 3) {
    name = 'Cross-Genre Discoverers';
  } else {
    const noun = FAMILY_NOUNS[lead[0]] ?? 'Listening Room';
    const leadGenre = genres.find(([g]) => g !== lead[0]);
    const second = families[1];
    if (second && second[1] / familyTotal >= 0.25) {
      name = `${FAMILY_LABELS[lead[0] as Family] ?? lead[0]} & ${FAMILY_LABELS[second[0] as Family] ?? second[0]} ${noun}`;
    } else if (leadGenre && leadGenre[1] >= 0.15) {
      name = `${genreDisplayName(leadGenre[0])} ${noun}`;
    } else {
      name = `${FAMILY_LABELS[lead[0] as Family] ?? lead[0]} ${noun}`;
    }
  }

  const genreList = topGenres.map(genreDisplayName);
  const description = genreList.length
    ? `Listeners whose libraries lean towards ${genreList.slice(0, 3).join(', ')}${genreList.length > 3 ? ` and ${genreList[3]}` : ''}.`
    : 'Listeners with overlapping libraries.';
  return { name, description, topFamilies, topGenres };
}

export interface MatchExplanation {
  summary: string;
  points: string[];
}

/** Turn component scores into plain-language reasons, using only computed numbers. */
export function explainMatch(
  match: MatchResult,
  names: { artists?: Record<string, string>; tracks?: Record<string, string> } = {},
  subject = 'this Tree',
): MatchExplanation {
  const points: string[] = [];
  const get = (k: string) => match.components.find((c) => c.key === k);
  const tracks = get('tracks');
  const artists = get('artists');
  const genres = get('genres');
  const attributes = get('attributes');

  if (tracks && tracks.sharedCount > 0) {
    const examples = tracks.topShared.map((id) => names.tracks?.[id]).filter(Boolean).slice(0, 3);
    points.push(
      `${tracks.sharedCount} shared track${tracks.sharedCount === 1 ? '' : 's'}${examples.length ? ` (e.g. ${examples.join(', ')})` : ''}.`,
    );
  }
  if (artists && artists.sharedCount > 0) {
    const examples = artists.topShared.map((id) => names.artists?.[id]).filter(Boolean).slice(0, 4);
    points.push(
      `${artists.sharedCount} shared artist${artists.sharedCount === 1 ? '' : 's'}${examples.length ? `, including ${examples.join(', ')}` : ''}.`,
    );
  }
  if (genres && genres.available) {
    const g = genres.topShared.slice(0, 3).map(genreDisplayName);
    points.push(
      `Genre distributions are ${genres.raw >= 0.75 ? 'very similar' : genres.raw >= 0.5 ? 'similar' : genres.raw >= 0.25 ? 'partly similar' : 'quite different'} (${Math.round(genres.raw * 100)}% cosine)${g.length ? `, overlapping most on ${g.join(', ')}` : ''}.`,
    );
  }
  if (attributes) {
    points.push(
      attributes.available
        ? `Verified sound attributes overlap at ${Math.round(attributes.raw * 100)}%${attributes.topShared.length ? ` (${attributes.topShared.slice(0, 3).map((k) => k.split(':')[1]).join(', ')})` : ''}.`
        : 'Not enough verified instrument/sound metadata to compare attributes — that weight was redistributed.',
    );
  }
  if (match.gate) points.push(match.gate);

  const strength =
    match.label === 'strong' ? 'a strong match' : match.label === 'good' ? 'a good match' : match.label === 'possible' ? 'a possible match' : 'a weak match';
  const lead: string[] = [];
  if (artists && artists.sharedCount >= 2) lead.push('your libraries share several artists');
  if (tracks && tracks.sharedCount >= 2) lead.push('you have tracks in common');
  if (genres && genres.raw >= 0.5) lead.push('your genre distributions are similar');
  if (attributes?.available && attributes.raw >= 0.5) lead.push('both profiles carry similar verified sound attributes');
  const summary = lead.length
    ? `You are ${strength} for ${subject} because ${lead.length > 1 ? `${lead.slice(0, -1).join(', ')} and ${lead[lead.length - 1]}` : lead[0]}.`
    : `You are ${strength} for ${subject}; there is little shared evidence so far.`;
  return { summary, points };
}

/** Similarity between two Trees' aggregate vectors (for "related communities"). */
export function relatedScore(a: MatchVector, b: MatchVector, options: CompareOptions = {}): number {
  return compareVectors(a, b, options).score;
}
