/**
 * Music Map generation — a deterministic radial layout.
 *
 * Hierarchy (adapts to the data): My Music Mind → genre families → genres →
 * artists → tracks, with an outer orbit of sound-attribute nodes and cross-links
 * for genre co-occurrence and multi-genre artists. Tracks without genre
 * information hang off an explicit "Genre unknown" branch instead of being
 * forced into a category.
 *
 * The layout is computed here (not in the browser) so it is stable, testable,
 * identical on every device, and cheap to render as SVG.
 */
import { FAMILY_COLORS, FAMILY_LABELS, genreDisplayName, type Family } from '../taxonomy';
import type { LibraryTrack, MusicProfile } from '../types';
import { dedupeGenres, effectiveAttributes, isVerifiedAttribute } from './profile';

export type MapNodeKind = 'root' | 'family' | 'genre' | 'artist' | 'track' | 'attribute' | 'more';

export interface MapNodeFilter {
  family?: string;
  genre?: string;
  artistId?: string;
  trackId?: string;
  attribute?: string;
  unknownGenre?: boolean;
}

export interface MapNode {
  id: string;
  kind: MapNodeKind;
  label: string;
  parentId: string | null;
  trackCount: number;
  /** Share of the whole library (0..1). */
  share: number;
  color: string;
  x: number;
  y: number;
  r: number;
  /** Angle in radians from the centre — used for label placement. */
  angle: number;
  family: string | null;
  filter?: MapNodeFilter;
  /** True for inferred attributes and the unknown-genre branch. */
  uncertain?: boolean;
  /** For "more" nodes: labels of the children that were collapsed. */
  hidden?: { id: string; label: string; trackCount: number }[];
  detail?: string;
}

export type MapEdgeKind = 'branch' | 'cooccurrence' | 'association' | 'attribute';

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  kind: MapEdgeKind;
  /** 0..1 strength — rendered as stroke width. */
  weight: number;
  uncertain?: boolean;
}

export interface MusicMap {
  schemaVersion: 1;
  inputHash: string;
  nodes: MapNode[];
  edges: MapEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  stats: {
    tracks: number;
    visibleArtists: number;
    hiddenArtists: number;
    visibleTracks: number;
    hiddenTracks: number;
  };
}

export interface MapOptions {
  rootLabel?: string;
  maxGenresPerFamily?: number;
  maxArtistsPerGenre?: number;
  maxTracksPerArtist?: number;
  maxArtists?: number;
  maxTracks?: number;
  maxAttributes?: number;
  includeTracks?: boolean;
}

const DEFAULTS: Required<MapOptions> = {
  rootLabel: 'My Music Mind',
  maxGenresPerFamily: 8,
  maxArtistsPerGenre: 10,
  maxTracksPerArtist: 8,
  maxArtists: 160,
  maxTracks: 600,
  maxAttributes: 10,
  includeTracks: true,
};

interface HNode {
  id: string;
  kind: MapNodeKind;
  label: string;
  color: string;
  trackCount: number;
  family: string | null;
  filter?: MapNodeFilter;
  uncertain?: boolean;
  hidden?: MapNode['hidden'];
  detail?: string;
  children: HNode[];
}

const UNKNOWN = 'unknown';

function round(v: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function familyColor(family: string): string {
  return FAMILY_COLORS[family as Family] ?? FAMILY_COLORS.other;
}

function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}

function leafCount(node: HNode): number {
  if (node.children.length === 0) return 1;
  return node.children.reduce((s, c) => s + leafCount(c), 0);
}

function byWeight(a: { trackCount: number; label: string; id: string }, b: { trackCount: number; label: string; id: string }) {
  return b.trackCount - a.trackCount || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}

/** Primary placement of a track: its strongest genre (or the unknown branch). */
function placement(track: LibraryTrack): { family: string; genre: string } {
  const g = dedupeGenres(track.genres)[0];
  return g ? { family: g.family, genre: g.name } : { family: UNKNOWN, genre: UNKNOWN };
}

function buildHierarchy(tracks: LibraryTrack[], profile: MusicProfile, opts: Required<MapOptions>) {
  // family → genre → artist → tracks (by primary placement)
  const artistPlacement = new Map<string, Map<string, number>>(); // artistId → "family|genre" → count
  const artistNames = new Map<string, string>();
  const artistTracks = new Map<string, LibraryTrack[]>();
  for (const t of tracks) {
    const { family, genre } = placement(t);
    const primary = t.artists.find((a) => a.role === 'primary') ?? t.artists[0];
    if (!primary) continue;
    artistNames.set(primary.id, primary.name);
    const key = `${family}|${genre}`;
    const counts = artistPlacement.get(primary.id) ?? new Map<string, number>();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    artistPlacement.set(primary.id, counts);
    const list = artistTracks.get(primary.id) ?? [];
    list.push(t);
    artistTracks.set(primary.id, list);
  }

  // Each artist sits under the genre holding most of its tracks (ties → name order).
  const genreArtists = new Map<string, { artistId: string; count: number }[]>(); // "family|genre" → artists
  for (const [artistId, counts] of artistPlacement) {
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;
    const total = [...counts.values()].reduce((s, c) => s + c, 0);
    const list = genreArtists.get(best[0]) ?? [];
    list.push({ artistId, count: total });
    genreArtists.set(best[0], list);
  }

  const total = tracks.length;
  const familyCounts = new Map(profile.families.map((f) => [f.family, f.trackCount]));
  const genreCounts = new Map(profile.genres.map((g) => [g.name, g.trackCount]));
  if (profile.unknownGenreCount > 0) familyCounts.set(UNKNOWN, profile.unknownGenreCount);

  const familyGenres = new Map<string, string[]>();
  for (const key of genreArtists.keys()) {
    const [family, genre] = key.split('|') as [string, string];
    const list = familyGenres.get(family) ?? [];
    list.push(genre);
    familyGenres.set(family, list);
  }

  let artistBudget = opts.maxArtists;
  let trackBudget = opts.includeTracks ? opts.maxTracks : 0;
  let hiddenArtists = 0;
  let visibleTracks = 0;

  const makeArtist = (artistId: string, count: number, family: string): HNode => {
    const name = artistNames.get(artistId) ?? 'Unknown artist';
    const node: HNode = {
      id: `artist:${artistId}`,
      kind: 'artist',
      label: name,
      color: family === UNKNOWN ? FAMILY_COLORS.unknown : lighten(familyColor(family), 0.25),
      trackCount: count,
      family,
      filter: { artistId },
      children: [],
    };
    const ts = [...(artistTracks.get(artistId) ?? [])].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const shown = ts.slice(0, Math.min(opts.maxTracksPerArtist, trackBudget));
    trackBudget -= shown.length;
    visibleTracks += shown.length;
    for (const t of shown) {
      node.children.push({
        id: `track:${t.id}`,
        kind: 'track',
        label: t.version ? `${t.title} (${t.version})` : t.title,
        color: family === UNKNOWN ? FAMILY_COLORS.unknown : lighten(familyColor(family), 0.5),
        trackCount: 1,
        family,
        filter: { trackId: t.id },
        uncertain: family === UNKNOWN,
        children: [],
      });
    }
    return node;
  };

  const familyNodes: HNode[] = [];
  const families = [...familyGenres.keys()].sort((a, b) => {
    if (a === UNKNOWN) return 1;
    if (b === UNKNOWN) return -1;
    return (familyCounts.get(b) ?? 0) - (familyCounts.get(a) ?? 0) || a.localeCompare(b);
  });

  for (const family of families) {
    const isUnknown = family === UNKNOWN;
    const fNode: HNode = {
      id: `family:${family}`,
      kind: 'family',
      label: isUnknown ? 'Genre unknown' : FAMILY_LABELS[family as Family] ?? genreDisplayName(family),
      color: isUnknown ? FAMILY_COLORS.unknown : familyColor(family),
      trackCount: familyCounts.get(family) ?? 0,
      family,
      filter: isUnknown ? { unknownGenre: true } : { family },
      uncertain: isUnknown,
      detail: isUnknown ? 'No source provided a genre for these tracks.' : undefined,
      children: [],
    };
    const genres = (familyGenres.get(family) ?? []).sort(
      (a, b) => (genreCounts.get(b) ?? 0) - (genreCounts.get(a) ?? 0) || a.localeCompare(b),
    );
    const visibleGenres = genres.slice(0, opts.maxGenresPerFamily);
    const collapsedGenres = genres.slice(opts.maxGenresPerFamily);

    for (const genre of visibleGenres) {
      const artists = (genreArtists.get(`${family}|${genre}`) ?? []).sort(
        (a, b) => b.count - a.count || (artistNames.get(a.artistId) ?? '').localeCompare(artistNames.get(b.artistId) ?? '') || a.artistId.localeCompare(b.artistId),
      );
      const limit = Math.max(0, Math.min(opts.maxArtistsPerGenre, artistBudget));
      const shown = artists.slice(0, limit);
      const rest = artists.slice(limit);
      artistBudget -= shown.length;
      hiddenArtists += rest.length;

      // When a family has one genre with the family's own name, skip the genre level.
      const mergeIntoFamily = isUnknown || (genre === family && visibleGenres.length === 1);
      const parent: HNode = mergeIntoFamily
        ? fNode
        : {
            id: `genre:${genre}`,
            kind: 'genre',
            label: genreDisplayName(genre),
            color: lighten(familyColor(family), 0.12),
            trackCount: genreCounts.get(genre) ?? 0,
            family,
            filter: { genre },
            children: [],
          };
      for (const a of shown) parent.children.push(makeArtist(a.artistId, a.count, family));
      if (rest.length > 0) {
        parent.children.push({
          id: `more:${parent.id}`,
          kind: 'more',
          label: `+${rest.length} more`,
          color: '#3A4C8F',
          trackCount: rest.reduce((s, r) => s + r.count, 0),
          family,
          filter: parent.filter,
          hidden: rest.map((r) => ({ id: `artist:${r.artistId}`, label: artistNames.get(r.artistId) ?? '', trackCount: r.count })),
          children: [],
        });
      }
      if (!mergeIntoFamily) fNode.children.push(parent);
    }
    if (collapsedGenres.length > 0) {
      for (const g of collapsedGenres) hiddenArtists += (genreArtists.get(`${family}|${g}`) ?? []).length;
      fNode.children.push({
        id: `more:${fNode.id}`,
        kind: 'more',
        label: `+${collapsedGenres.length} genres`,
        color: '#3A4C8F',
        trackCount: collapsedGenres.reduce((s, g) => s + (genreCounts.get(g) ?? 0), 0),
        family,
        filter: { family },
        hidden: collapsedGenres.map((g) => ({ id: `genre:${g}`, label: genreDisplayName(g), trackCount: genreCounts.get(g) ?? 0 })),
        children: [],
      });
    }
    familyNodes.push(fNode);
  }

  const root: HNode = {
    id: 'root',
    kind: 'root',
    label: opts.rootLabel,
    color: '#1747FF',
    trackCount: total,
    family: null,
    children: familyNodes,
  };
  const visibleArtistCount = opts.maxArtists - artistBudget;
  return { root, hiddenArtists, visibleTracks, visibleArtistCount };
}

interface Rings {
  family: number;
  genre: number;
  artist: number;
  track: number;
  attribute: number;
}

function ringsFor(visibleArtists: number, visibleTracks: number): Rings {
  const artist = Math.max(520, (visibleArtists * 34) / (2 * Math.PI));
  const track = Math.max(artist + 110, (visibleTracks * 13) / (2 * Math.PI));
  // Families sit well away from the centre so the "My Music Mind" label has room.
  return {
    family: round(artist * 0.55),
    genre: round(artist * 0.8),
    artist: round(artist),
    track: round(track),
    attribute: round(track + 130),
  };
}

function radiusFor(node: HNode, total: number, maxArtistCount: number): number {
  const share = total ? node.trackCount / total : 0;
  switch (node.kind) {
    case 'root':
      return 52;
    case 'family':
      return round(20 + 34 * Math.sqrt(share));
    case 'genre':
      return round(11 + 24 * Math.sqrt(share));
    case 'artist':
      return round(6 + 15 * Math.sqrt(node.trackCount / Math.max(1, maxArtistCount)));
    case 'track':
      return 4.5;
    case 'more':
      return 9;
    default:
      return 10;
  }
}

function ringFor(kind: MapNodeKind, parentKind: MapNodeKind | null, rings: Rings): number {
  switch (kind) {
    case 'family':
      return rings.family;
    case 'genre':
      return rings.genre;
    case 'artist':
      return rings.artist;
    case 'track':
      return rings.track;
    case 'more':
      return parentKind === 'family' ? rings.genre : rings.artist;
    default:
      return 0;
  }
}

export function buildMusicMap(tracks: LibraryTrack[], profile: MusicProfile, options: MapOptions = {}): MusicMap {
  const opts = { ...DEFAULTS, ...options };
  const sorted = [...tracks].sort((a, b) => a.id.localeCompare(b.id));
  const total = sorted.length;
  const { root, hiddenArtists, visibleTracks, visibleArtistCount } = buildHierarchy(sorted, profile, opts);
  const rings = ringsFor(visibleArtistCount, visibleTracks);
  const maxArtistCount = Math.max(1, ...profile.artists.map((a) => a.trackCount));

  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const position = new Map<string, MapNode>();

  const place = (node: HNode, parent: HNode | null, start: number, end: number) => {
    const angle = (start + end) / 2;
    const radius = node.kind === 'root' ? 0 : ringFor(node.kind, parent?.kind ?? null, rings);
    // Stagger tracks of the same artist so neighbouring dots do not touch.
    const stagger = node.kind === 'track' && parent ? ((parent.children.indexOf(node) % 2) * 26) : 0;
    const mapNode: MapNode = {
      id: node.id,
      kind: node.kind,
      label: node.label,
      parentId: parent?.id ?? null,
      trackCount: node.trackCount,
      share: total ? round(node.trackCount / total, 4) : 0,
      color: node.color,
      x: round(Math.cos(angle) * (radius + stagger)),
      y: round(Math.sin(angle) * (radius + stagger)),
      r: radiusFor(node, total, maxArtistCount),
      angle: round(angle, 4),
      family: node.family,
      filter: node.filter,
      uncertain: node.uncertain,
      hidden: node.hidden,
      detail: node.detail,
    };
    nodes.push(mapNode);
    position.set(node.id, mapNode);
    if (parent) {
      const parentCount = Math.max(1, parent.trackCount);
      edges.push({
        id: `b:${parent.id}>${node.id}`,
        source: parent.id,
        target: node.id,
        kind: 'branch',
        weight: round(Math.min(1, node.trackCount / parentCount), 3),
        uncertain: node.uncertain,
      });
    }
    if (node.children.length === 0) return;

    // Divide the parent's arc between children: half by track weight, half by
    // leaf count, so small-but-wide branches stay readable.
    const span = end - start;
    const weightSum = node.children.reduce((s, c) => s + c.trackCount, 0) || 1;
    const leafSum = node.children.reduce((s, c) => s + leafCount(c), 0) || 1;
    const shares = node.children.map((c) => 0.5 * (c.trackCount / weightSum) + 0.5 * (leafCount(c) / leafSum));
    const shareSum = shares.reduce((s, x) => s + x, 0) || 1;
    let cursor = start;
    node.children.forEach((child, i) => {
      const childSpan = (span * shares[i]!) / shareSum;
      place(child, node, cursor, cursor + childSpan);
      cursor += childSpan;
    });
  };

  // Start at the top (−90°) and go clockwise.
  root.children.sort(byWeight);
  place(root, null, -Math.PI / 2, (3 * Math.PI) / 2);

  // Genre co-occurrence chords.
  const genreNodeId = (genre: string, family: string) =>
    position.has(`genre:${genre}`) ? `genre:${genre}` : position.has(`family:${family}`) ? `family:${family}` : null;
  const familyOfGenre = new Map(profile.genres.map((g) => [g.name, g.family]));
  const seenPairs = new Set<string>();
  for (const pair of profile.genreCooccurrence) {
    if (pair.jaccard < 0.1 || pair.trackCount < 2) continue;
    const a = genreNodeId(pair.a, familyOfGenre.get(pair.a) ?? '');
    const b = genreNodeId(pair.b, familyOfGenre.get(pair.b) ?? '');
    if (!a || !b || a === b) continue;
    const key = [a, b].sort().join('~');
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    edges.push({ id: `c:${key}`, source: a, target: b, kind: 'cooccurrence', weight: round(pair.jaccard, 3) });
    if (seenPairs.size >= 24) break;
  }

  // Multi-genre artists: link an artist to other genres it has tracks in.
  const artistGenreCounts = new Map<string, Map<string, number>>();
  for (const t of sorted) {
    const primary = t.artists.find((a) => a.role === 'primary') ?? t.artists[0];
    if (!primary) continue;
    const counts = artistGenreCounts.get(primary.id) ?? new Map<string, number>();
    for (const g of dedupeGenres(t.genres)) counts.set(g.name, (counts.get(g.name) ?? 0) + 1);
    artistGenreCounts.set(primary.id, counts);
  }
  let associations = 0;
  for (const node of nodes) {
    if (node.kind !== 'artist' || !node.filter?.artistId || associations >= 60) continue;
    const counts = artistGenreCounts.get(node.filter.artistId);
    if (!counts) continue;
    for (const [genre, count] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      const share = count / Math.max(1, node.trackCount);
      const target = genreNodeId(genre, familyOfGenre.get(genre) ?? '');
      if (!target || target === node.parentId || share < 0.25) continue;
      const parent = position.get(node.parentId ?? '');
      if (parent && parent.id === target) continue;
      edges.push({ id: `a:${node.id}>${target}`, source: node.id, target, kind: 'association', weight: round(share, 3) });
      associations++;
    }
  }

  // Attribute orbit.
  const attrTargets = new Map<string, { count: number; verified: number; targets: Map<string, number>; category: string; value: string }>();
  for (const t of sorted) {
    const { family, genre } = placement(t);
    const target = family === UNKNOWN ? `family:${UNKNOWN}` : genreNodeId(genre, family);
    for (const a of effectiveAttributes(t)) {
      const key = `${a.category}:${a.value}`;
      const info = attrTargets.get(key) ?? { count: 0, verified: 0, targets: new Map(), category: a.category, value: a.value };
      info.count++;
      if (isVerifiedAttribute(a)) info.verified++;
      if (target) info.targets.set(target, (info.targets.get(target) ?? 0) + 1);
      attrTargets.set(key, info);
    }
  }
  const attrList = [...attrTargets.entries()]
    .filter(([, info]) => info.count >= 2 || total < 10)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, opts.maxAttributes);

  const attrNodes: MapNode[] = [];
  for (const [key, info] of attrList) {
    const targets = [...info.targets.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
    let sx = 0;
    let sy = 0;
    for (const [target, count] of targets) {
      const t = position.get(target);
      if (!t) continue;
      sx += Math.cos(t.angle) * count;
      sy += Math.sin(t.angle) * count;
    }
    const angle = sx === 0 && sy === 0 ? 0 : Math.atan2(sy, sx);
    const verifiedOnly = info.verified > 0;
    const node: MapNode = {
      id: `attr:${key}`,
      kind: 'attribute',
      label: info.value,
      parentId: null,
      trackCount: info.count,
      share: total ? round(info.count / total, 4) : 0,
      color: verifiedOnly ? '#FFD83D' : '#FF7A24',
      x: 0,
      y: 0,
      r: round(8 + 14 * Math.sqrt(total ? info.count / total : 0)),
      angle: round(angle, 4),
      family: null,
      filter: { attribute: key },
      uncertain: !verifiedOnly,
      detail: verifiedOnly
        ? `${info.verified} of ${info.count} tracks have verified metadata for this attribute.`
        : 'Inferred from genre only — an association, not a verified fact.',
    };
    attrNodes.push(node);
    for (const [target, count] of targets) {
      edges.push({
        id: `t:${node.id}>${target}`,
        source: node.id,
        target,
        kind: 'attribute',
        weight: round(count / info.count, 3),
        uncertain: !verifiedOnly,
      });
    }
  }
  // Spread attribute nodes so they never overlap on the orbit.
  attrNodes.sort((a, b) => a.angle - b.angle || a.id.localeCompare(b.id));
  const minGap = attrNodes.length ? Math.min((2 * Math.PI) / attrNodes.length, 0.22) : 0;
  for (let i = 1; i < attrNodes.length; i++) {
    const prev = attrNodes[i - 1]!;
    if (attrNodes[i]!.angle - prev.angle < minGap) attrNodes[i]!.angle = round(prev.angle + minGap, 4);
  }
  for (const node of attrNodes) {
    node.x = round(Math.cos(node.angle) * rings.attribute);
    node.y = round(Math.sin(node.angle) * rings.attribute);
    nodes.push(node);
  }

  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r);
    minY = Math.min(minY, n.y - n.r);
    maxX = Math.max(maxX, n.x + n.r);
    maxY = Math.max(maxY, n.y + n.r);
  }
  const pad = 120;

  return {
    schemaVersion: 1,
    inputHash: profile.inputHash,
    nodes,
    edges,
    bounds: { minX: round(minX - pad), minY: round(minY - pad), maxX: round(maxX + pad), maxY: round(maxY + pad) },
    stats: {
      tracks: total,
      visibleArtists: nodes.filter((n) => n.kind === 'artist').length,
      hiddenArtists,
      visibleTracks,
      hiddenTracks: total - visibleTracks,
    },
  };
}

/** Aggregate map for a Tree: families → genres → artists (no tracks, no individual members). */
export function buildAggregateMap(
  input: {
    families: { family: string; trackCount: number }[];
    genres: { name: string; family: string; trackCount: number }[];
    artists: { id: string; name: string; genre: string | null; family: string | null; weight: number }[];
  },
  rootLabel: string,
): MusicMap {
  // Re-use the track layout by synthesising one pseudo-track per artist/genre unit.
  const pseudo: LibraryTrack[] = [];
  for (const a of input.artists) {
    const units = Math.max(1, Math.round(a.weight));
    for (let i = 0; i < units; i++) {
      pseudo.push({
        id: `${a.id}#${i}`,
        title: a.name,
        version: null,
        artists: [{ id: a.id, name: a.name, role: 'primary' }],
        album: null,
        releaseYear: null,
        durationMs: null,
        explicit: null,
        genres: a.genre && a.family ? [{ name: a.genre, family: a.family, source: 'tree', kind: 'community', confidence: 1 }] : [],
        attributes: [],
        tempoBpm: null,
      });
    }
  }
  const total = pseudo.length;
  const profile: MusicProfile = {
    schemaVersion: 1,
    inputHash: 'aggregate',
    totals: { tracks: total, artists: input.artists.length, albums: 0, genres: input.genres.length, families: input.families.length },
    coverage: { genre: 1, year: 0, album: 0, duration: 0, attributes: 0, verifiedAttributes: 0, tempo: 0 },
    families: input.families.map((f) => ({ family: f.family, label: f.family, trackCount: f.trackCount, share: 0 })),
    genres: input.genres.map((g) => ({ name: g.name, family: g.family, trackCount: g.trackCount, share: 0, sources: [], kinds: [], meanConfidence: 1 })),
    artists: input.artists.map((a) => ({ id: a.id, name: a.name, trackCount: Math.max(1, Math.round(a.weight)), share: 0, topGenres: [] })),
    albums: [],
    decades: [],
    years: null,
    diversity: { artistEntropy: 0, genreEntropy: 0, familyEntropy: 0, uniqueArtistRatio: 0, topFiveArtistShare: 0 },
    genreCooccurrence: [],
    attributes: [],
    versions: [],
    explicitShare: null,
    tempo: null,
    unknownGenreCount: 0,
  };
  const map = buildMusicMap(pseudo, profile, { rootLabel, includeTracks: false, maxAttributes: 0 });
  return { ...map, inputHash: 'aggregate' };
}
