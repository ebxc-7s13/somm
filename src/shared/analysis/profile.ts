/**
 * Stage 1 — deterministic metadata analysis.
 *
 * Pure functions that turn a list of canonical library tracks into a
 * MusicProfile (counts, distributions, diversity, co-occurrence) and a
 * MatchVector (sparse vectors for similarity). No network, no model, no
 * randomness: identical input always produces identical output.
 */
import { hashString } from '../hash';
import { normalizeText } from '../normalize';
import { FAMILY_LABELS, GENRE_IMPLIED_ATTRIBUTES, type Family } from '../taxonomy';
import type {
  AttributeAssignment,
  AttributeStat,
  GenreAssignment,
  LibraryTrack,
  MatchVector,
  MusicProfile,
} from '../types';

/** Attribute assignments at or above this confidence (and not inferred) count as verified. */
export const VERIFIED_ATTRIBUTE_CONFIDENCE = 0.5;

export function isVerifiedAttribute(a: AttributeAssignment): boolean {
  return a.kind !== 'inferred' && a.confidence >= VERIFIED_ATTRIBUTE_CONFIDENCE;
}

/** Collapse duplicate genre assignments on one track, keeping the strongest per genre. */
export function dedupeGenres(genres: GenreAssignment[]): GenreAssignment[] {
  const best = new Map<string, GenreAssignment>();
  for (const g of genres) {
    const prev = best.get(g.name);
    if (!prev || g.confidence > prev.confidence) best.set(g.name, g);
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
}

/**
 * Attributes for a track: stored metadata plus SOMM's genre-implied inferences,
 * which are clearly marked `kind: 'inferred'` and never override real metadata.
 */
export function effectiveAttributes(track: LibraryTrack): AttributeAssignment[] {
  const result = [...track.attributes];
  const present = new Set(result.map((a) => `${a.category}:${a.value}`));
  for (const g of track.genres) {
    for (const implied of GENRE_IMPLIED_ATTRIBUTES[g.name] ?? []) {
      const key = `${implied.category}:${implied.value}`;
      if (present.has(key)) continue;
      present.add(key);
      result.push({
        category: implied.category,
        value: implied.value,
        source: 'somm-rules',
        kind: 'inferred',
        confidence: Math.min(implied.confidence, g.confidence),
        evidence: `inferred from genre “${g.name}”`,
      });
    }
  }
  return result;
}

function normalizedEntropy(counts: number[]): number {
  const total = counts.reduce((s, c) => s + c, 0);
  const k = counts.filter((c) => c > 0).length;
  if (total === 0 || k <= 1) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log(p);
  }
  return round(h / Math.log(k), 4);
}

function round(value: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function byCountThenName<T extends { trackCount: number }>(key: (t: T) => string) {
  return (a: T, b: T) => b.trackCount - a.trackCount || key(a).localeCompare(key(b));
}

/** Stable fingerprint of everything the analysis reads. */
export function libraryInputHash(tracks: LibraryTrack[]): string {
  const canonical = [...tracks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => [
      t.id,
      t.title,
      t.version,
      t.artists.map((a) => `${a.id}:${a.role}`).join(','),
      t.album?.id ?? '',
      t.releaseYear ?? '',
      t.durationMs ?? '',
      t.explicit ?? '',
      dedupeGenres(t.genres).map((g) => `${g.name}/${g.kind}/${g.confidence}`).join(','),
      t.attributes.map((a) => `${a.category}:${a.value}/${a.kind}/${a.confidence}`).sort().join(','),
      t.tempoBpm ?? '',
    ]);
  return hashString(JSON.stringify(canonical));
}

export function computeProfile(input: LibraryTrack[]): MusicProfile {
  const tracks = [...input].sort((a, b) => a.id.localeCompare(b.id));
  const total = tracks.length;

  const genreTracks = new Map<string, { family: string; ids: Set<string>; sources: Set<string>; kinds: Set<string>; conf: number[] }>();
  const familyTracks = new Map<string, Set<string>>();
  const artistInfo = new Map<string, { name: string; count: number; primaryCount: number; genres: Map<string, number> }>();
  const albumInfo = new Map<string, { title: string; count: number }>();
  const decadeCounts = new Map<number, number>();
  const years: number[] = [];
  const pairCounts = new Map<string, number>();
  const attributeInfo = new Map<string, {
    category: AttributeStat['category'];
    value: string;
    ids: Set<string>;
    verified: Set<string>;
    conf: number[];
    evidence: Set<string>;
  }>();
  const versionCounts = new Map<string, number>();
  let genreKnown = 0;
  let withAlbum = 0;
  let withDuration = 0;
  let withAttributes = 0;
  let withVerifiedAttributes = 0;
  let explicitKnown = 0;
  let explicitTrue = 0;
  const tempos: number[] = [];

  for (const t of tracks) {
    const genres = dedupeGenres(t.genres);
    if (genres.length > 0) genreKnown++;
    const trackFamilies = new Set<string>();
    for (const g of genres) {
      let entry = genreTracks.get(g.name);
      if (!entry) {
        entry = { family: g.family, ids: new Set(), sources: new Set(), kinds: new Set(), conf: [] };
        genreTracks.set(g.name, entry);
      }
      entry.ids.add(t.id);
      entry.sources.add(g.source);
      entry.kinds.add(g.kind);
      entry.conf.push(g.confidence);
      trackFamilies.add(g.family);
    }
    for (const f of trackFamilies) {
      if (!familyTracks.has(f)) familyTracks.set(f, new Set());
      familyTracks.get(f)!.add(t.id);
    }
    const names = genres.map((g) => g.name).sort();
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const key = `${names[i]}\u0000${names[j]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }

    const seenArtists = new Set<string>();
    for (const a of t.artists) {
      if (seenArtists.has(a.id)) continue;
      seenArtists.add(a.id);
      let info = artistInfo.get(a.id);
      if (!info) {
        info = { name: a.name, count: 0, primaryCount: 0, genres: new Map() };
        artistInfo.set(a.id, info);
      }
      info.count++;
      if (a.role === 'primary') info.primaryCount++;
      for (const g of genres) info.genres.set(g.name, (info.genres.get(g.name) ?? 0) + 1);
    }

    if (t.album) {
      withAlbum++;
      const al = albumInfo.get(t.album.id) ?? { title: t.album.title, count: 0 };
      al.count++;
      albumInfo.set(t.album.id, al);
    }
    if (t.durationMs) withDuration++;
    if (t.releaseYear) {
      years.push(t.releaseYear);
      const decade = Math.floor(t.releaseYear / 10) * 10;
      decadeCounts.set(decade, (decadeCounts.get(decade) ?? 0) + 1);
    }
    if (t.version) versionCounts.set(t.version, (versionCounts.get(t.version) ?? 0) + 1);
    if (t.explicit !== null) {
      explicitKnown++;
      if (t.explicit) explicitTrue++;
    }
    if (t.tempoBpm && t.tempoBpm > 0) tempos.push(t.tempoBpm);

    const attrs = effectiveAttributes(t);
    if (attrs.length > 0) withAttributes++;
    if (attrs.some(isVerifiedAttribute)) withVerifiedAttributes++;
    for (const a of attrs) {
      const key = `${a.category}:${a.value}`;
      let info = attributeInfo.get(key);
      if (!info) {
        info = { category: a.category, value: a.value, ids: new Set(), verified: new Set(), conf: [], evidence: new Set() };
        attributeInfo.set(key, info);
      }
      info.ids.add(t.id);
      if (isVerifiedAttribute(a)) info.verified.add(t.id);
      info.conf.push(a.confidence);
      if (a.evidence && info.evidence.size < 3) info.evidence.add(a.evidence);
      else if (!a.evidence && info.evidence.size < 3) info.evidence.add(`${a.kind} metadata from ${a.source}`);
    }
  }

  const families = [...familyTracks.entries()]
    .map(([family, ids]) => ({
      family,
      label: FAMILY_LABELS[family as Family] ?? family,
      trackCount: ids.size,
      share: genreKnown ? round(ids.size / genreKnown) : 0,
    }))
    .sort(byCountThenName((f) => f.family));

  const genres = [...genreTracks.entries()]
    .map(([name, e]) => ({
      name,
      family: e.family,
      trackCount: e.ids.size,
      share: genreKnown ? round(e.ids.size / genreKnown) : 0,
      sources: [...e.sources].sort(),
      kinds: [...e.kinds].sort() as MusicProfile['genres'][number]['kinds'],
      meanConfidence: round(e.conf.reduce((s, c) => s + c, 0) / e.conf.length, 3),
    }))
    .sort(byCountThenName((g) => g.name));

  const artists = [...artistInfo.entries()]
    .map(([id, a]) => ({
      id,
      name: a.name,
      trackCount: a.count,
      share: total ? round(a.count / total) : 0,
      topGenres: [...a.genres.entries()]
        .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
        .slice(0, 3)
        .map(([g]) => g),
    }))
    .sort(byCountThenName((a) => `${normalizeText(a.name)}|${a.id}`));

  const albums = [...albumInfo.entries()]
    .map(([id, a]) => ({ id, title: a.title, trackCount: a.count }))
    .sort(byCountThenName((a) => `${a.title}|${a.id}`))
    .slice(0, 50);

  const primaryCounts = [...artistInfo.values()].map((a) => a.primaryCount).sort((a, b) => b - a);
  const topFive = primaryCounts.slice(0, 5).reduce((s, c) => s + c, 0);

  const genreCooccurrence = [...pairCounts.entries()]
    .map(([key, count]) => {
      const [a, b] = key.split('\u0000') as [string, string];
      const ca = genreTracks.get(a)!.ids.size;
      const cb = genreTracks.get(b)!.ids.size;
      return { a, b, trackCount: count, jaccard: round(count / (ca + cb - count)) };
    })
    .sort((x, y) => y.trackCount - x.trackCount || y.jaccard - x.jaccard || `${x.a}${x.b}`.localeCompare(`${y.a}${y.b}`))
    .slice(0, 60);

  const attributes: AttributeStat[] = [...attributeInfo.values()]
    .map((a) => ({
      category: a.category,
      value: a.value,
      trackCount: a.ids.size,
      share: total ? round(a.ids.size / total) : 0,
      verifiedCount: a.verified.size,
      inferredCount: a.ids.size - a.verified.size,
      meanConfidence: round(a.conf.reduce((s, c) => s + c, 0) / a.conf.length, 3),
      evidence: [...a.evidence],
    }))
    .sort(byCountThenName((a) => `${a.category}:${a.value}`));

  const sortedYears = [...years].sort((a, b) => a - b);
  const sortedTempos = [...tempos].sort((a, b) => a - b);

  return {
    schemaVersion: 1,
    inputHash: libraryInputHash(tracks),
    totals: {
      tracks: total,
      artists: artistInfo.size,
      albums: albumInfo.size,
      genres: genreTracks.size,
      families: familyTracks.size,
    },
    coverage: {
      genre: total ? round(genreKnown / total) : 0,
      year: total ? round(years.length / total) : 0,
      album: total ? round(withAlbum / total) : 0,
      duration: total ? round(withDuration / total) : 0,
      attributes: total ? round(withAttributes / total) : 0,
      verifiedAttributes: total ? round(withVerifiedAttributes / total) : 0,
      tempo: total ? round(tempos.length / total) : 0,
    },
    families,
    genres,
    artists,
    albums,
    decades: [...decadeCounts.entries()].map(([decade, trackCount]) => ({ decade, trackCount })).sort((a, b) => a.decade - b.decade),
    years: sortedYears.length
      ? { min: sortedYears[0]!, max: sortedYears[sortedYears.length - 1]!, median: median(sortedYears) }
      : null,
    diversity: {
      artistEntropy: normalizedEntropy([...artistInfo.values()].map((a) => a.count)),
      genreEntropy: normalizedEntropy([...genreTracks.values()].map((g) => g.ids.size)),
      familyEntropy: normalizedEntropy([...familyTracks.values()].map((f) => f.size)),
      uniqueArtistRatio: total ? round(artistInfo.size / total) : 0,
      topFiveArtistShare: total ? round(Math.min(1, topFive / total)) : 0,
    },
    genreCooccurrence,
    attributes,
    versions: [...versionCounts.entries()].map(([label, trackCount]) => ({ label, trackCount })).sort(byCountThenName((v) => v.label)),
    explicitShare: explicitKnown ? round(explicitTrue / explicitKnown) : null,
    tempo: sortedTempos.length
      ? {
          trackCount: sortedTempos.length,
          medianBpm: median(sortedTempos),
          minBpm: sortedTempos[0]!,
          maxBpm: sortedTempos[sortedTempos.length - 1]!,
        }
      : null,
    unknownGenreCount: total - genreKnown,
  };
}

/**
 * Build sparse matching vectors. Feature design avoids double counting:
 * - tracks are binary (a song counts once, however many playlists contain it);
 * - artists use sublinear weights (1 + ln n), so one prolific artist cannot dominate;
 * - genres are a per-track distribution (each track contributes a total of 1),
 *   plus half-weight family dimensions for broad similarity;
 * - attributes include only verified metadata — genre-implied inferences are
 *   excluded because they would re-count the genre signal;
 * - text uses descriptive tags not already mapped to genres or attributes.
 */
export function buildMatchVector(input: LibraryTrack[], tags: Record<string, string[]> = {}): MatchVector {
  const tracks = [...input].sort((a, b) => a.id.localeCompare(b.id));
  const trackVec: Record<string, number> = {};
  const artistCounts = new Map<string, number>();
  const genreVec: Record<string, number> = {};
  const attributeVec: Record<string, number> = {};
  const textVec: Record<string, number> = {};
  let attributeEvidence = 0;
  let genreTrackCount = 0;

  for (const t of tracks) {
    trackVec[t.id] = 1;
    const seen = new Set<string>();
    for (const a of t.artists) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      artistCounts.set(a.id, (artistCounts.get(a.id) ?? 0) + (a.role === 'primary' ? 1 : 0.5));
    }
    const genres = dedupeGenres(t.genres);
    if (genres.length) {
      genreTrackCount++;
      const totalConf = genres.reduce((s, g) => s + g.confidence, 0) || genres.length;
      const familyShare = new Map<string, number>();
      for (const g of genres) {
        const w = (g.confidence || 1) / totalConf;
        genreVec[g.name] = (genreVec[g.name] ?? 0) + w;
        familyShare.set(g.family, (familyShare.get(g.family) ?? 0) + w);
      }
      for (const [family, w] of familyShare) {
        genreVec[`family:${family}`] = (genreVec[`family:${family}`] ?? 0) + 0.5 * w;
      }
    }
    const verified = t.attributes.filter(isVerifiedAttribute);
    if (verified.length) {
      attributeEvidence++;
      for (const a of verified) {
        const key = `${a.category}:${a.value}`;
        attributeVec[key] = Math.max(attributeVec[key] ?? 0, 0) + a.confidence;
      }
    }
    for (const tag of tags[t.id] ?? []) {
      for (const token of normalizeText(tag).split(' ')) {
        if (token.length > 2) textVec[token] = (textVec[token] ?? 0) + 1;
      }
    }
  }

  const artistVec: Record<string, number> = {};
  for (const [id, n] of [...artistCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    artistVec[id] = round(1 + Math.log(Math.max(1, n)), 6);
  }
  for (const k of Object.keys(genreVec)) genreVec[k] = round(genreVec[k]!, 6);
  for (const k of Object.keys(attributeVec)) attributeVec[k] = round(attributeVec[k]!, 6);
  for (const k of Object.keys(textVec)) textVec[k] = round(1 + Math.log(textVec[k]!), 6);

  return {
    tracks: trackVec,
    artists: artistVec,
    genres: genreVec,
    attributes: attributeVec,
    attributeEvidence,
    text: textVec,
    trackCount: tracks.length,
    genreTrackCount,
  };
}
