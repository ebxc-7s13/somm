/**
 * Canvas renderer for the 3D Music Map, shared by the interactive view, the
 * landing-page showcase and the downloadable poster.
 *
 * Performance: glowing spheres are pre-rendered once per colour and size bucket
 * and drawn as images; labels are measured once and placed without overlaps.
 */
import type { MapNode } from '../../shared/analysis/map';
import {
  type Camera,
  edgeVisible,
  LABEL_PX,
  labelPriority,
  type LabelCandidate,
  type Layers,
  placeLabels,
  type Projected,
  projector,
  projectScene,
  type Scene3D,
} from './engine';

export const FONT_DISPLAY = '"Unbounded Variable", "Sora Variable", system-ui, sans-serif';
export const FONT_UI = '"Space Grotesk Variable", "Inter Variable", system-ui, sans-serif';
export const FONT_LOGO = '"Sora Variable", system-ui, sans-serif';
export const FONT_BODY = '"Inter Variable", system-ui, sans-serif';

export type ThemeId = 'midnight' | 'holo' | 'daylight';

export interface Theme {
  id: ThemeId;
  label: string;
  dark: boolean;
  /** Vertical background gradient, top to bottom. */
  bg: [string, string, string];
  /** Soft colour glows, positions as fractions of the canvas. */
  glows: { x: number; y: number; r: number; color: string }[];
  grid: string;
  star: string;
  text: string;
  textStroke: string;
  textMuted: string;
  edgeAlpha: number;
  links: { cooccurrence: string; association: string; attribute: string };
  halo: string;
}

export const THEMES: Record<ThemeId, Theme> = {
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    dark: true,
    bg: ['#0c1d63', '#060f3c', '#02061c'],
    glows: [
      { x: 0.12, y: 0.08, r: 0.65, color: 'rgba(23,71,255,0.55)' },
      { x: 0.92, y: 0.28, r: 0.5, color: 'rgba(255,90,216,0.20)' },
      { x: 0.55, y: 0.98, r: 0.6, color: 'rgba(92,242,255,0.16)' },
    ],
    grid: 'rgba(140,200,255,0.17)',
    star: '#e4ecff',
    text: '#ffffff',
    textStroke: 'rgba(3,8,32,0.92)',
    textMuted: '#b9c6f2',
    edgeAlpha: 0.48,
    links: { cooccurrence: '#ffd83d', association: '#8fb3ff', attribute: '#ff7a24' },
    halo: '#ffd83d',
  },
  holo: {
    id: 'holo',
    label: 'Holo',
    dark: true,
    bg: ['#2b0f63', '#150a3f', '#05031a'],
    glows: [
      { x: 0.1, y: 0.15, r: 0.6, color: 'rgba(92,242,255,0.32)' },
      { x: 0.9, y: 0.12, r: 0.55, color: 'rgba(255,90,216,0.34)' },
      { x: 0.5, y: 1, r: 0.7, color: 'rgba(155,123,255,0.30)' },
    ],
    grid: 'rgba(255,175,255,0.2)',
    star: '#fff2ff',
    text: '#ffffff',
    textStroke: 'rgba(14,4,40,0.92)',
    textMuted: '#e3d6ff',
    edgeAlpha: 0.5,
    links: { cooccurrence: '#5cf2ff', association: '#ff9ce8', attribute: '#ffd83d' },
    halo: '#5cf2ff',
  },
  daylight: {
    id: 'daylight',
    label: 'Daylight',
    dark: false,
    bg: ['#f7f9ff', '#e9efff', '#dbe4ff'],
    glows: [
      { x: 0.1, y: 0.05, r: 0.6, color: 'rgba(23,71,255,0.14)' },
      { x: 0.92, y: 0.3, r: 0.5, color: 'rgba(255,90,216,0.12)' },
      { x: 0.5, y: 1, r: 0.6, color: 'rgba(92,242,255,0.16)' },
    ],
    grid: 'rgba(23,71,255,0.16)',
    star: '#1747ff',
    text: '#101629',
    textStroke: 'rgba(247,249,255,0.95)',
    textMuted: '#3a4566',
    edgeAlpha: 0.55,
    links: { cooccurrence: '#c79a00', association: '#1747ff', attribute: '#e0600f' },
    halo: '#1747ff',
  },
};

// ------------------------------------------------------------------ colour

function rgbOf(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  const n = m ? parseInt(m[1]!, 16) : 0x8899cc;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

function mix(hex: string, target: [number, number, number], t: number): string {
  const [r, g, b] = rgbOf(hex);
  const m = (c: number, d: number) => Math.round(c + (d - c) * t);
  return `rgb(${m(r, target[0])},${m(g, target[1])},${m(b, target[2])})`;
}

// ----------------------------------------------------------------- sprites

const sprites = new Map<string, HTMLCanvasElement>();

/** A glowing sphere: soft glow, shaded body, rim light. The body radius is 42% of the sprite's half-size. */
function sphereSprite(color: string, px: number, dark: boolean): HTMLCanvasElement | null {
  const key = `${color}|${px}|${dark ? 'd' : 'l'}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  if (!g) return null;
  const r = px / 2;
  const glow = g.createRadialGradient(r, r, r * 0.3, r, r, r);
  glow.addColorStop(0, rgba(color, dark ? 0.5 : 0.28));
  glow.addColorStop(0.5, rgba(color, dark ? 0.16 : 0.08));
  glow.addColorStop(1, rgba(color, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, px, px);
  const br = r * 0.42;
  const body = g.createRadialGradient(r - br * 0.38, r - br * 0.42, br * 0.08, r, r, br);
  body.addColorStop(0, mix(color, [255, 255, 255], 0.7));
  body.addColorStop(0.38, color);
  body.addColorStop(1, mix(color, [4, 8, 40], 0.5));
  g.beginPath();
  g.arc(r, r, br, 0, Math.PI * 2);
  g.fillStyle = body;
  g.fill();
  g.lineWidth = Math.max(1, br * 0.07);
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.beginPath();
  g.arc(r, r, br * 0.93, -2.7, -1.25);
  g.stroke();
  if (sprites.size > 400) sprites.clear();
  sprites.set(key, c);
  return c;
}

const bucket = (px: number) => (px <= 32 ? 32 : px <= 64 ? 64 : px <= 128 ? 128 : 256);

// ----------------------------------------------------------------- text

const widths = new Map<string, number>();

function measure(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  const key = `${font}|${text}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  ctx.font = font;
  const w = ctx.measureText(text).width;
  if (widths.size > 6000) widths.clear();
  widths.set(key, w);
  return w;
}

export const truncate = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 2)}…` : s);

/** A node's label text, font and pixel size, as renderMap draws it (before perspective). */
export function labelStyle(n: MapNode, labelScale: number, ui: number, persp = 1): { text: string; font: string; size: number } {
  const size = LABEL_PX[n.kind] * labelScale * ui * persp;
  const display = n.kind === 'root' || n.kind === 'family';
  return { text: truncate(n.label), font: `${n.kind === 'root' ? 700 : 600} ${size.toFixed(1)}px ${display ? FONT_DISPLAY : FONT_UI}`, size };
}

export type LabelSide = 'center' | 'below' | 'above' | 'left' | 'right';

/** Where a label sits next to its node: centred on the root, under genres, otherwise pointing away from the centre. */
export function labelSide(n: MapNode, dx: number, dy: number): LabelSide {
  if (n.kind === 'root') return 'center';
  if (n.kind === 'family' || n.kind === 'genre') return 'below';
  const len = Math.hypot(dx, dy) || 1;
  if (dx / len > 0.35) return 'right';
  if (dx / len < -0.35) return 'left';
  return dy >= 0 ? 'below' : 'above';
}

// --------------------------------------------------------------- painting

export function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number, theme: Theme) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, theme.bg[0]);
  bg.addColorStop(0.55, theme.bg[1]);
  bg.addColorStop(1, theme.bg[2]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const big = Math.max(w, h);
  for (const glow of theme.glows) {
    const gx = glow.x * w;
    const gy = glow.y * h;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, glow.r * big);
    g.addColorStop(0, glow.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  if (theme.dark) {
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, big * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,10,0.45)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }
}

export interface RenderOptions {
  width: number;
  height: number;
  camera: Camera;
  theme: ThemeId;
  labelScale: number;
  layers: Layers;
  /** Multiplies label sizes and line widths (posters are drawn larger than the screen). */
  uiScale?: number;
  selectedId?: string | null;
  hoverId?: string | null;
  matchIds?: Set<string> | null;
  showGrid?: boolean;
  showStars?: boolean;
  showLabels?: boolean;
  labelMode?: 'auto' | 'families';
  /** Paint the theme background (default). Without it the canvas is cleared first, unless `clear` is false. */
  background?: boolean;
  /** With `background: false`: clear the canvas before drawing (default) or draw over what is there (posters). */
  clear?: boolean;
  /** Fraction of the shorter side the map may fill. */
  fill?: number;
  /** Milliseconds, for the selection pulse. */
  time?: number;
}

function relatedIds(scene: Scene3D, selectedId: string): Set<string> {
  const ids = new Set<string>([selectedId]);
  const map = scene.map;
  let cur = map.nodes[scene.byId.get(selectedId) ?? -1];
  while (cur?.parentId) {
    ids.add(cur.parentId);
    cur = map.nodes[scene.byId.get(cur.parentId) ?? -1];
  }
  for (const n of map.nodes) if (n.parentId === selectedId) ids.add(n.id);
  for (const e of map.edges) {
    if (e.source === selectedId) ids.add(e.target);
    if (e.target === selectedId) ids.add(e.source);
  }
  return ids;
}

/** Draws the map into the current canvas transform and returns the projection for hit-testing. */
export function renderMap(ctx: CanvasRenderingContext2D, scene: Scene3D, o: RenderOptions): Projected {
  const theme = THEMES[o.theme];
  const ui = o.uiScale ?? 1;
  const cam = o.camera;
  const vp = { w: o.width, h: o.height, fill: o.fill };
  if (o.background !== false) paintBackground(ctx, o.width, o.height, theme);
  else if (o.clear !== false) ctx.clearRect(0, 0, o.width, o.height);

  const proj = projectScene(scene, cam, vp, o.layers);
  const point = projector(scene, cam, vp).point;
  const range = Math.max(1e-6, proj.maxDepth - proj.minDepth);
  const nearness = (d: number) => (proj.maxDepth === proj.minDepth ? 1 : (d - proj.minDepth) / range);

  // Stars: a shell around the map, so they drift with the camera.
  if (o.showStars !== false) {
    ctx.fillStyle = theme.star;
    for (const s of scene.stars) {
      const [sx, sy, sc] = point(s.x, s.y, s.z);
      if (sc > 2.5 || sx < -4 || sy < -4 || sx > o.width + 4 || sy > o.height + 4) continue;
      ctx.globalAlpha = s.a * (theme.dark ? 0.9 : 0.35);
      const size = Math.min(2.4, 0.6 * sc + 0.4) * ui;
      ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  // Polar grid under the dome — the "radar" floor.
  if (o.showGrid !== false) {
    const gz = -scene.radius * 0.1 * cam.depth;
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = ui;
    const radii = [...scene.rings, scene.radius * 1.04];
    for (const R of radii) {
      ctx.beginPath();
      for (let k = 0; k <= 96; k++) {
        const a = (k / 96) * Math.PI * 2;
        const [x, y] = point(Math.cos(a) * R, Math.sin(a) * R, gz);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.beginPath();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const [x0, y0] = point(Math.cos(a) * scene.radius * 0.12, Math.sin(a) * scene.radius * 0.12, gz);
      const [x1, y1] = point(Math.cos(a) * scene.radius * 1.04, Math.sin(a) * scene.radius * 1.04, gz);
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();
  }

  const selectedId = o.selectedId ?? null;
  const focus = o.matchIds && o.matchIds.size ? o.matchIds : selectedId ? relatedIds(scene, selectedId) : null;

  // Edges.
  ctx.lineCap = 'round';
  for (const e of scene.edges) {
    if (!edgeVisible(e.edge, o.layers) || !proj.visible[e.s] || !proj.visible[e.t]) continue;
    const a = scene.nodes[e.s]!;
    const b = scene.nodes[e.t]!;
    const dim = focus ? !(focus.has(a.node.id) && focus.has(b.node.id)) : false;
    const fade = 0.45 + 0.55 * nearness((proj.depth[e.s]! + proj.depth[e.t]!) / 2);
    const kind = e.edge.kind;
    const color = kind === 'branch' ? b.node.color : theme.links[kind];
    const weight = e.edge.weight;
    const base = kind === 'branch' ? 0.6 + 3.2 * weight : kind === 'cooccurrence' ? 0.8 + 5 * weight : 0.8 + 2.2 * weight;
    const scale = Math.min(1.4, Math.max(0.7, (proj.scale[e.s]! + proj.scale[e.t]!) / 2));
    ctx.strokeStyle = rgba(color, theme.edgeAlpha * fade * (dim ? 0.18 : 1) * (kind === 'branch' ? 0.85 : 1));
    ctx.lineWidth = base * ui * scale;
    ctx.setLineDash(kind === 'association' ? [3 * ui, 5 * ui] : kind === 'attribute' ? [1 * ui, 6 * ui] : e.edge.uncertain ? [4 * ui, 4 * ui] : []);
    const [cx, cy] = point(e.cx, e.cy, ((a.h + b.h) / 2) * cam.depth);
    ctx.beginPath();
    ctx.moveTo(proj.sx[e.s]!, proj.sy[e.s]!);
    ctx.quadraticCurveTo(cx, cy, proj.sx[e.t]!, proj.sy[e.t]!);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Nodes, far to near.
  const t = o.time ?? 0;
  for (const i of proj.order) {
    const n = scene.nodes[i]!.node;
    const sx = proj.sx[i]!;
    const sy = proj.sy[i]!;
    const hovered = n.id === o.hoverId;
    const rr = proj.rr[i]! * (hovered ? 1.18 : 1);
    const dim = focus ? !focus.has(n.id) : false;
    const alpha = (dim ? 0.2 : 1) * (0.6 + 0.4 * nearness(proj.depth[i]!));
    ctx.globalAlpha = alpha;
    if (rr < 2.6) {
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(sx, sy, rr, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const half = rr / 0.42;
      const sprite = sphereSprite(n.color, bucket(half * 2 * (typeof devicePixelRatio === 'number' ? Math.min(2, devicePixelRatio) : 1)), theme.dark);
      if (sprite) ctx.drawImage(sprite, sx - half, sy - half, half * 2, half * 2);
    }
    if (n.kind === 'root') {
      // Holographic ring around the centre.
      ctx.lineWidth = 3 * ui;
      const ringR = rr + 7 * ui;
      const conic = typeof ctx.createConicGradient === 'function' ? ctx.createConicGradient(t / 2400, sx, sy) : null;
      if (conic) {
        for (const [stop, c] of [[0, '#5cf2ff'], [0.25, '#9b7bff'], [0.5, '#ff5ad8'], [0.75, '#ffd83d'], [1, '#5cf2ff']] as const) conic.addColorStop(stop, c);
        ctx.strokeStyle = conic;
      } else ctx.strokeStyle = '#5cf2ff';
      ctx.beginPath();
      ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (n.uncertain) {
      ctx.setLineDash([3 * ui, 3 * ui]);
      ctx.strokeStyle = '#ff7a24';
      ctx.lineWidth = 1.6 * ui;
      ctx.beginPath();
      ctx.arc(sx, sy, rr + 1.5 * ui, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (n.kind === 'more') {
      ctx.fillStyle = theme.dark ? '#ffffff' : '#101629';
      ctx.font = `700 ${Math.max(9, rr * 1.4)}px ${FONT_UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+', sx, sy + 0.5);
    }
    if (n.id === selectedId || hovered || o.matchIds?.has(n.id)) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = n.id === selectedId || o.matchIds?.has(n.id) ? theme.halo : rgba(theme.text, 0.8);
      ctx.lineWidth = 2.4 * ui;
      ctx.beginPath();
      ctx.arc(sx, sy, rr + (5 + Math.sin(t / 260) * 1.5) * ui, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  if (o.showLabels !== false) drawLabels(ctx, scene, proj, o, theme, ui, focus);
  return proj;
}

function drawLabels(ctx: CanvasRenderingContext2D, scene: Scene3D, proj: Projected, o: RenderOptions, theme: Theme, ui: number, focus: Set<string> | null) {
  const selected = o.selectedId ? scene.map.nodes[scene.byId.get(o.selectedId) ?? -1] : undefined;
  const expandedId = selected?.kind === 'artist' ? selected.id : selected?.kind === 'track' ? selected.parentId : null;
  const lctx = { selectedId: o.selectedId ?? null, hoverId: o.hoverId ?? null, matchIds: o.matchIds ?? null, zoom: o.camera.zoom, expandedId, mode: o.labelMode ?? 'auto' } as const;
  const rootIndex = scene.byId.get('root') ?? -1;
  const rootX = rootIndex >= 0 ? proj.sx[rootIndex]! : o.width / 2;
  const rootY = rootIndex >= 0 ? proj.sy[rootIndex]! : o.height / 2;

  type Cand = LabelCandidate & { text: string; font: string; size: number; align: CanvasTextAlign; x: number; y: number; node: MapNode };
  const cands: Cand[] = [];
  for (const i of proj.order) {
    const n = scene.nodes[i]!.node;
    const priority = labelPriority(n, lctx);
    if (priority === null) continue;
    const persp = Math.min(1.3, Math.max(0.8, proj.scale[i]!));
    const { text, font, size } = labelStyle(n, o.labelScale, ui, persp);
    const w = measure(ctx, font, text);
    const sx = proj.sx[i]!;
    const sy = proj.sy[i]!;
    const rr = proj.rr[i]!;
    const gap = 4 * ui;
    const at = (side: LabelSide) => {
      let align: CanvasTextAlign = 'center';
      let x = sx;
      let y = sy;
      if (side === 'below') y = sy + rr + gap + size * 0.55;
      else if (side === 'above') y = sy - rr - gap - size * 0.55;
      else if (side === 'right') {
        align = 'left';
        x = sx + rr + gap;
      } else if (side === 'left') {
        align = 'right';
        x = sx - rr - gap;
      }
      const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
      return { align, x, y, x0, y0: y - size * 0.62, x1: x0 + w, y1: y + size * 0.62 };
    };
    const side = labelSide(n, sx - rootX, sy - rootY);
    // If the preferred spot is taken, try the other sides (staying on the canvas) before dropping the label.
    const fallbacks = side === 'center' ? [] : (['below', 'above', 'right', 'left'] as const).filter((s) => s !== side);
    const alts = fallbacks.map(at).filter((b) => b.x0 >= 0 && b.y0 >= 0 && b.x1 <= o.width && b.y1 <= o.height);
    cands.push({
      index: i,
      priority,
      force: n.kind === 'root' || n.id === o.selectedId || n.id === o.hoverId,
      ...at(side),
      alts,
      text,
      font,
      size,
      node: n,
    });
  }
  const placed = placeLabels(cands, 3 * ui);
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const c of placed.sort((a, b) => a.priority - b.priority)) {
    const dim = focus ? !focus.has(c.node.id) : false;
    ctx.globalAlpha = dim ? 0.35 : 1;
    ctx.font = c.font;
    ctx.textAlign = c.align;
    ctx.lineWidth = Math.max(2, c.size * 0.3);
    ctx.strokeStyle = theme.textStroke;
    ctx.strokeText(c.text, c.x, c.y);
    ctx.fillStyle = c.node.kind === 'family' && theme.dark ? mix(c.node.color, [255, 255, 255], 0.72) : theme.text;
    ctx.fillText(c.text, c.x, c.y);
  }
  ctx.globalAlpha = 1;
}
