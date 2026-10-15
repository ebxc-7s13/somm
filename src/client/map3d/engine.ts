/**
 * 3D Music Map maths: lifts the deterministic 2D radial layout into a 3D
 * constellation and projects it through a simple perspective camera.
 *
 * Pure functions, no DOM, so they are unit-tested. Looking straight down with
 * depth 0 reproduces the 2D map exactly; tilting reveals a dome with the centre
 * ("My Music Mind") at the summit and each ring of the hierarchy below it.
 */
import type { MapEdge, MapNode, MusicMap } from '../../shared/analysis/map';

export interface Node3D {
  index: number;
  node: MapNode;
  /** Layout position (world units, same as the 2D map). */
  x: number;
  y: number;
  /** Height at depth 1. */
  h: number;
  r: number;
  parent: number;
}

export interface Edge3D {
  edge: MapEdge;
  s: number;
  t: number;
  /** Curve control point in the layout plane. */
  cx: number;
  cy: number;
}

export interface Scene3D {
  map: MusicMap;
  nodes: Node3D[];
  edges: Edge3D[];
  byId: Map<string, number>;
  /** World radius enclosing every node. */
  radius: number;
  /** Ring radii (families, genres, artists, songs, attributes) for the grid. */
  rings: number[];
  /** Deterministic background stars on a shell around the map. */
  stars: { x: number; y: number; z: number; a: number }[];
}

export interface Camera {
  /** Spin around the vertical axis (radians). */
  yaw: number;
  /** Tilt: 0 looks straight down, ~1.3 looks from the side. */
  pitch: number;
  zoom: number;
  /** Pan, as a fraction of the viewport's shorter side. */
  panX: number;
  panY: number;
  /** 0 = flat map, 1 = full dome. */
  depth: number;
}

export const FLAT_CAMERA: Camera = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0, depth: 0 };
export const TILTED_CAMERA: Camera = { yaw: -0.4, pitch: 0.92, zoom: 1.08, panX: 0, panY: 0.05, depth: 1 };
export const PITCH_MAX = 1.35;
export const ZOOM_MIN = 0.45;
export const ZOOM_MAX = 7;

export const CAMERA_PRESETS: Record<'top' | 'tilt' | 'side', Camera> = {
  top: { ...FLAT_CAMERA, depth: 1 },
  tilt: TILTED_CAMERA,
  side: { yaw: -0.25, pitch: 1.28, zoom: 1.15, panX: 0, panY: 0.12, depth: 1 },
};

export interface Viewport {
  w: number;
  h: number;
  /** Fraction of the shorter side the map may fill (labels need a margin). */
  fill?: number;
}

/** Stable pseudo-random number in [0, 1) from a string. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const RING_KINDS = ['family', 'genre', 'artist', 'track', 'attribute'] as const;

export function prepareScene(map: MusicMap): Scene3D {
  const byId = new Map(map.nodes.map((n, i) => [n.id, i]));
  let radius = 1;
  let inner = 1;
  for (const n of map.nodes) {
    const rho = Math.hypot(n.x, n.y);
    radius = Math.max(radius, rho + n.r);
    if (n.kind !== 'attribute') inner = Math.max(inner, rho);
  }
  const nodes: Node3D[] = map.nodes.map((n, index) => {
    const rho = Math.hypot(n.x, n.y);
    // A dome: the centre is highest and each ring of the hierarchy sits lower.
    let h = n.kind === 'attribute' ? -radius * 0.07 : radius * 0.4 * (1 - Math.min(1, rho / inner) ** 1.5);
    if (n.kind !== 'root') h += (hash01(n.id) - 0.5) * radius * 0.035;
    return { index, node: n, x: n.x, y: n.y, h, r: n.r, parent: n.parentId ? (byId.get(n.parentId) ?? -1) : -1 };
  });
  const edges: Edge3D[] = [];
  for (const e of map.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (s === undefined || t === undefined) continue;
    const a = map.nodes[s]!;
    const b = map.nodes[t]!;
    let cx: number;
    let cy: number;
    if (e.kind === 'branch') {
      if (a.kind === 'root') {
        cx = (a.x + b.x) / 2;
        cy = (a.y + b.y) / 2;
      } else {
        // Same curve as the 2D map: bend through the parent's radius at the child's angle.
        const pr = Math.hypot(a.x, a.y);
        cx = Math.cos(b.angle) * pr;
        cy = Math.sin(b.angle) * pr;
      }
    } else {
      const pull = e.kind === 'cooccurrence' ? 0.25 : e.kind === 'association' ? 0.55 : 0.8;
      cx = ((a.x + b.x) / 2) * pull;
      cy = ((a.y + b.y) / 2) * pull;
    }
    edges.push({ edge: e, s, t, cx, cy });
  }
  const rings: number[] = [];
  for (const kind of RING_KINDS) {
    const list = map.nodes.filter((n) => n.kind === kind);
    if (list.length) rings.push(list.reduce((sum, n) => sum + Math.hypot(n.x, n.y), 0) / list.length);
  }
  const stars: Scene3D['stars'] = [];
  for (let i = 0; i < 160; i++) {
    // Fibonacci sphere: even, deterministic spread.
    const k = i + 0.5;
    const phi = Math.acos(1 - (2 * k) / 160);
    const theta = Math.PI * (1 + Math.sqrt(5)) * k;
    const shell = radius * (2.1 + hash01(`star${i}`) * 0.8);
    stars.push({ x: Math.cos(theta) * Math.sin(phi) * shell, y: Math.sin(theta) * Math.sin(phi) * shell, z: Math.cos(phi) * shell, a: 0.25 + hash01(`a${i}`) * 0.55 });
  }
  return { map, nodes, edges, byId, radius, rings, stars };
}

export interface Projector {
  /** Screen position, perspective scale and depth (larger = nearer) of a world point. */
  point(x: number, y: number, z: number): [sx: number, sy: number, scale: number, depth: number];
  /** Pixels per world unit at scale 1. */
  unit: number;
}

export function projector(scene: Scene3D, cam: Camera, vp: Viewport): Projector {
  const short = Math.min(vp.w, vp.h);
  // Framing: a tilted dome is flatter on screen, so in a wide viewport it may use more of the
  // width. Looking straight down (pitch 0) this is exactly the 2D map's scale.
  const ext = Math.min(1, Math.max(0.66, Math.cos(cam.pitch) + 0.3 * Math.sin(cam.pitch)));
  const fit = Math.min(vp.w / (2 * scene.radius), vp.h / (2 * scene.radius * ext)) * (vp.fill ?? 0.94);
  const unit = fit * cam.zoom;
  const D = scene.radius * 3.2;
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const ox = vp.w / 2 + cam.panX * short;
  const oy = vp.h / 2 + cam.panY * short;
  return {
    unit,
    point(x, y, z) {
      const x1 = x * cy - y * sy;
      const y1 = x * sy + y * cy;
      const y2 = y1 * cp - z * sp;
      const z2 = y1 * sp + z * cp;
      const scale = D / Math.max(D * 0.2, D - z2);
      return [ox + x1 * unit * scale, oy + y2 * unit * scale, scale, z2];
    },
  };
}

export interface Projected {
  sx: Float32Array;
  sy: Float32Array;
  /** On-screen node radius in px. */
  rr: Float32Array;
  scale: Float32Array;
  depth: Float32Array;
  /** Node indices, far to near (draw order). */
  order: number[];
  visible: Uint8Array;
  minDepth: number;
  maxDepth: number;
}

export interface Layers {
  songs: boolean;
  attributes: boolean;
  links: boolean;
}

export const ALL_LAYERS: Layers = { songs: true, attributes: true, links: true };

export function nodeVisible(n: MapNode, layers: Layers): boolean {
  if (n.kind === 'track') return layers.songs;
  if (n.kind === 'attribute') return layers.attributes;
  return true;
}

export function edgeVisible(e: MapEdge, layers: Layers): boolean {
  if (e.kind === 'attribute') return layers.attributes;
  if (e.kind === 'cooccurrence' || e.kind === 'association') return layers.links;
  return true;
}

export function projectScene(scene: Scene3D, cam: Camera, vp: Viewport, layers: Layers, nodeScale = 1): Projected {
  const p = projector(scene, cam, vp);
  const count = scene.nodes.length;
  const out: Projected = {
    sx: new Float32Array(count),
    sy: new Float32Array(count),
    rr: new Float32Array(count),
    scale: new Float32Array(count),
    depth: new Float32Array(count),
    order: [],
    visible: new Uint8Array(count),
    minDepth: Infinity,
    maxDepth: -Infinity,
  };
  for (const n of scene.nodes) {
    const [sx, sy, scale, depth] = p.point(n.x, n.y, n.h * cam.depth);
    const i = n.index;
    out.sx[i] = sx;
    out.sy[i] = sy;
    out.scale[i] = scale;
    out.depth[i] = depth;
    // Nodes keep a readable minimum size when zoomed far out.
    out.rr[i] = Math.max(n.node.kind === 'track' ? 1.3 : 2.5, n.r * p.unit * scale * nodeScale);
    const visible = nodeVisible(n.node, layers);
    out.visible[i] = visible ? 1 : 0;
    if (visible) {
      out.order.push(i);
      out.minDepth = Math.min(out.minDepth, depth);
      out.maxDepth = Math.max(out.maxDepth, depth);
    }
  }
  out.order.sort((a, b) => out.depth[a]! - out.depth[b]! || a - b);
  return out;
}

/** Nearest node under a screen point, or -1. Near nodes win over far ones. */
export function hitTest(proj: Projected, x: number, y: number, slop = 6): number {
  for (let k = proj.order.length - 1; k >= 0; k--) {
    const i = proj.order[k]!;
    const r = Math.max(proj.rr[i]!, 4) + slop;
    if ((proj.sx[i]! - x) ** 2 + (proj.sy[i]! - y) ** 2 <= r * r) return i;
  }
  return -1;
}

/** Base label size (px) by node kind, before the listener's text-size setting. */
export const LABEL_PX: Record<MapNode['kind'], number> = { root: 17, family: 15, genre: 13, attribute: 12, artist: 12, more: 11, track: 11 };

export interface LabelContext {
  selectedId: string | null;
  hoverId: string | null;
  matchIds: Set<string> | null;
  zoom: number;
  /** Artist whose songs are expanded (selected artist, or the selected song's artist). */
  expandedId: string | null;
  mode: 'auto' | 'families';
}

/** Placement priority for a node's label (higher is placed first); null = no label. */
export function labelPriority(n: MapNode, ctx: LabelContext): number | null {
  if (n.id === ctx.selectedId || n.id === ctx.hoverId) return 5000;
  if (ctx.matchIds?.has(n.id)) return 4000 + n.trackCount;
  if (ctx.mode === 'families') return n.kind === 'family' ? 900 + n.share * 100 : null;
  switch (n.kind) {
    case 'root':
      return 3000;
    case 'family':
      return 2000 + n.share * 100;
    case 'genre':
      return 1200 + n.share * 300;
    case 'attribute':
      return 1000 + n.share * 300;
    case 'artist':
      return 400 + Math.min(n.trackCount, 60) * 5 + (n.parentId === ctx.selectedId ? 800 : 0);
    case 'more':
      return ctx.zoom >= 1.6 ? 150 : null;
    case 'track':
      return n.parentId === ctx.expandedId ? 900 : ctx.zoom >= 2.8 ? 100 : null;
  }
}

export interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LabelCandidate extends LabelBox {
  index: number;
  priority: number;
  /** Always placed (centre, selection), even when it overlaps. */
  force: boolean;
  /** Fallback positions, tried in order when the preferred one overlaps (fields override the candidate's). */
  alts?: (LabelBox & Record<string, unknown>)[];
}

/**
 * Greedy label placement: highest priority first; each label takes its preferred
 * position, else the first fallback that overlaps nothing placed, else it is left
 * out. A uniform grid keeps it fast for hundreds of labels.
 */
export function placeLabels<T extends LabelCandidate>(candidates: T[], pad = 3): T[] {
  const cell = 80;
  const grid = new Map<string, LabelBox[]>();
  const placed: T[] = [];
  const keys = (b: LabelBox) => {
    const out: string[] = [];
    for (let gx = Math.floor((b.x0 - pad) / cell); gx <= Math.floor((b.x1 + pad) / cell); gx++) {
      for (let gy = Math.floor((b.y0 - pad) / cell); gy <= Math.floor((b.y1 + pad) / cell); gy++) out.push(`${gx},${gy}`);
    }
    return out;
  };
  const free = (b: LabelBox) => {
    for (const k of keys(b)) {
      for (const o of grid.get(k) ?? []) {
        if (b.x0 - pad < o.x1 && b.x1 + pad > o.x0 && b.y0 - pad < o.y1 && b.y1 + pad > o.y0) return false;
      }
    }
    return true;
  };
  const sorted = [...candidates].sort((a, b) => Number(b.force) - Number(a.force) || b.priority - a.priority || a.index - b.index);
  for (const c of sorted) {
    let chosen: T | null = null;
    if (c.force || free(c)) chosen = c;
    else {
      const alt = c.alts?.find(free);
      if (alt) chosen = { ...c, ...alt };
    }
    if (!chosen) continue;
    placed.push(chosen);
    const box = { x0: chosen.x0, y0: chosen.y0, x1: chosen.x1, y1: chosen.y1 };
    for (const k of keys(box)) {
      const list = grid.get(k);
      if (list) list.push(box);
      else grid.set(k, [box]);
    }
  }
  return placed;
}

export function clampCamera(c: Camera): Camera {
  return {
    ...c,
    pitch: Math.min(PITCH_MAX, Math.max(0, c.pitch)),
    zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.zoom)),
    panX: Math.min(1.5, Math.max(-1.5, c.panX)),
    panY: Math.min(1.5, Math.max(-1.5, c.panY)),
    depth: Math.min(1.6, Math.max(0, c.depth)),
  };
}

export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  const l = (x: number, y: number) => x + (y - x) * t;
  // Take the short way round when spinning.
  let dyaw = b.yaw - a.yaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  return { yaw: a.yaw + dyaw * t, pitch: l(a.pitch, b.pitch), zoom: l(a.zoom, b.zoom), panX: l(a.panX, b.panX), panY: l(a.panY, b.panY), depth: l(a.depth, b.depth) };
}

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
