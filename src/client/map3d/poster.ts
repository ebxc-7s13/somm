/**
 * "Sound of My Mind" poster: the Music Map in a chosen orientation with the
 * SOMM logo, the listener's @handle and a short summary underneath.
 */
import type { MapNode } from '../../shared/analysis/map';
import { type Camera, labelPriority, type Layers, projectScene, type Scene3D } from './engine';
import { FONT_BODY, FONT_DISPLAY, FONT_LOGO, FONT_UI, labelSide, labelStyle, paintBackground, renderMap, rgba, THEMES, type ThemeId } from './draw';

export type Orientation = 'portrait' | 'story' | 'square' | 'landscape';

export const ORIENTATIONS: Record<Orientation, { w: number; h: number; label: string; hint: string }> = {
  portrait: { w: 1080, h: 1350, label: 'Portrait', hint: '4:5 · posts' },
  story: { w: 1080, h: 1920, label: 'Story', hint: '9:16 · phone wallpaper' },
  square: { w: 1080, h: 1080, label: 'Square', hint: '1:1' },
  landscape: { w: 1920, h: 1080, label: 'Landscape', hint: '16:9 · desktop wallpaper' },
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PosterLayout {
  W: number;
  H: number;
  pad: number;
  /** Tall formats get a headline above the map (a wide dome leaves room there). */
  header: Rect | null;
  map: Rect;
  footer: Rect;
  /** 1 at 1080 px on the shorter side. */
  unit: number;
}

export function posterLayout(o: Orientation, quality: 1 | 2 = 1): PosterLayout {
  const base = ORIENTATIONS[o];
  const W = base.w * quality;
  const H = base.h * quality;
  const short = Math.min(W, H);
  const pad = Math.round(short * 0.055);
  const footerH = Math.round(o === 'landscape' ? H * 0.2 : o === 'story' ? H * 0.16 : o === 'square' ? H * 0.22 : H * 0.2);
  const footer = { x: pad, y: H - pad - footerH, w: W - 2 * pad, h: footerH };
  const header = o === 'story' ? { x: pad, y: pad, w: W - 2 * pad, h: Math.round(H * 0.12) } : null;
  const top = header ? header.y + header.h : 0;
  const map = { x: 0, y: top, w: W, h: footer.y - Math.round(pad * 0.3) - top };
  return { W, H, pad, header, map, footer, unit: short / 1080 };
}

export interface PosterStats {
  tracks: number;
  artists: number;
  genres: number;
  families: { label: string; share: number; color: string }[];
}

export interface PosterOptions {
  orientation: Orientation;
  quality: 1 | 2;
  theme: ThemeId;
  /** The viewing angle; the framing is fitted to the poster (see fitCamera). */
  camera: Camera;
  /** Map size relative to the fitted framing (1 = the whole map fills the frame). */
  zoom?: number;
  labelScale: number;
  layers: Layers;
  showGrid: boolean;
  user: { handle: string; displayName: string } | null;
  stats: PosterStats;
  date: Date;
  site: string;
}

/** Wait until the poster fonts are loaded so the canvas does not fall back to system fonts. */
export async function ensurePosterFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const fonts = [`700 64px ${FONT_DISPLAY}`, `600 32px ${FONT_UI}`, `800 40px ${FONT_LOGO}`, `500 24px ${FONT_BODY}`];
  await Promise.all(fonts.map((f) => document.fonts.load(f).catch(() => [])));
}

/** The SOMM wordmark (same geometry as the on-screen logo). */
export function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, height: number, color: string) {
  const s = height / 40;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = color;
  ctx.font = `800 38px ${FONT_LOGO}`;
  const ls = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  ls.letterSpacing = '-1px';
  ctx.fillText('S', 0, 33);
  ctx.beginPath();
  ctx.arc(39, 20, 12.5, 0, Math.PI * 2);
  ctx.lineWidth = 6.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(48, 11);
  ctx.lineTo(68, 4);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#FF7A24';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(48, 11, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#FFD83D';
  ctx.fill();
  ctx.fillStyle = color;
  ls.letterSpacing = '-2px';
  ctx.fillText('MM', 56, 33);
  ls.letterSpacing = '0px';
  ctx.beginPath();
  ctx.arc(68, 4, 2.6, 0, Math.PI * 2);
  ctx.fillStyle = '#FF7A24';
  ctx.fill();
  ctx.restore();
}

/** Largest font size (≤ max) at which `text` fits in `width`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, family: string, max: number, width: number, min = 10): number {
  let size = max;
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > min && ctx.measureText(text).width > width) {
    size -= Math.max(1, size * 0.06);
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

export function posterFileName(handle: string | undefined, o: Orientation): string {
  const safe =
    (handle ?? 'my')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'my';
  return `${safe}-sound-of-my-mind-${o}.png`;
}

/** Labels the fit should keep inside the frame: their size in px (labels do not scale with zoom). */
export type LabelMeasure = (node: MapNode) => { w: number; h: number; gap: number } | null;

/** Share of the frame the map may span: with measured labels the map can reach the edges, without them leave room. */
const FIT_MARGIN = { measured: { x: 0.94, y: 0.92 }, rough: { x: 0.8, y: 0.86 } };

/**
 * Keeps the camera's angle and fits the whole map — nodes and, when measured, their
 * labels — into a w × h frame, centred. Zoom scales the projection about the frame's
 * centre while labels keep their size, so the largest fitting scale is found by
 * bisection. `zoom` then enlarges the fitted map (cropping its edges).
 */
export function fitCamera(scene: Scene3D, camera: Camera, layers: Layers, w: number, h: number, zoom = 1, measure?: LabelMeasure): Camera {
  const base: Camera = { ...camera, zoom: 1, panX: 0, panY: 0 };
  const p = projectScene(scene, base, { w, h, fill: 1 }, layers);
  if (p.order.length === 0) return base;
  const rootIndex = scene.byId.get('root');
  const rx = rootIndex !== undefined ? p.sx[rootIndex]! : w / 2;
  const ry = rootIndex !== undefined ? p.sy[rootIndex]! : h / 2;
  const items = p.order.map((i) => {
    const node = scene.nodes[i]!.node;
    const dx = p.sx[i]! - w / 2;
    const dy = p.sy[i]! - h / 2;
    return { dx, dy, r: p.rr[i]!, label: measure?.(node) ?? null, side: labelSide(node, p.sx[i]! - rx, p.sy[i]! - ry) };
  });
  const extents = (s: number) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const it of items) {
      const cx = it.dx * s;
      const cy = it.dy * s;
      const r = it.r * s;
      x0 = Math.min(x0, cx - r);
      x1 = Math.max(x1, cx + r);
      y0 = Math.min(y0, cy - r);
      y1 = Math.max(y1, cy + r);
      const l = it.label;
      if (!l) continue;
      if (it.side === 'right') {
        x1 = Math.max(x1, cx + r + l.gap + l.w);
        y0 = Math.min(y0, cy - l.h / 2);
        y1 = Math.max(y1, cy + l.h / 2);
      } else if (it.side === 'left') {
        x0 = Math.min(x0, cx - r - l.gap - l.w);
        y0 = Math.min(y0, cy - l.h / 2);
        y1 = Math.max(y1, cy + l.h / 2);
      } else {
        x0 = Math.min(x0, cx - l.w / 2);
        x1 = Math.max(x1, cx + l.w / 2);
        if (it.side === 'below') y1 = Math.max(y1, cy + r + l.gap + l.h);
        else if (it.side === 'above') y0 = Math.min(y0, cy - r - l.gap - l.h);
        else {
          y0 = Math.min(y0, cy - l.h / 2);
          y1 = Math.max(y1, cy + l.h / 2);
        }
      }
    }
    return { x0, x1, y0, y1 };
  };
  const m = measure ? FIT_MARGIN.measured : FIT_MARGIN.rough;
  // Extents grow with the scale, so bisect for the largest scale that fits.
  let lo = 0.01;
  let hi = 64;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const e = extents(mid);
    if (e.x1 - e.x0 <= w * m.x && e.y1 - e.y0 <= h * m.y) lo = mid;
    else hi = mid;
  }
  const s = lo * zoom;
  const e = extents(s);
  const short = Math.min(w, h);
  return { ...base, zoom: s, panX: -(e.x0 + e.x1) / 2 / short, panY: -(e.y0 + e.y1) / 2 / short };
}

/** Measures the labels a poster draws (the same rules as renderMap, at the poster's scale). */
function posterLabelMeasure(ctx: CanvasRenderingContext2D, labelScale: number, ui: number): LabelMeasure {
  const lctx = { selectedId: null, hoverId: null, matchIds: null, zoom: 1, expandedId: null, mode: 'auto' } as const;
  return (node) => {
    if (labelPriority(node, lctx) === null) return null;
    const { text, font, size } = labelStyle(node, labelScale, ui, 1.1);
    ctx.font = font;
    return { w: ctx.measureText(text).width, h: size * 1.24, gap: 4 * ui };
  };
}

export function drawPoster(canvas: HTMLCanvasElement, scene: Scene3D, o: PosterOptions): boolean {
  const L = posterLayout(o.orientation, o.quality);
  canvas.width = L.W;
  canvas.height = L.H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const theme = THEMES[o.theme];
  const u = L.unit;
  paintBackground(ctx, L.W, L.H, theme);

  // The map.
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.map.x, L.map.y, L.map.w, L.map.h);
  ctx.clip();
  ctx.translate(L.map.x, L.map.y);
  renderMap(ctx, scene, {
    width: L.map.w,
    height: L.map.h,
    camera: fitCamera(scene, o.camera, o.layers, L.map.w, L.map.h, o.zoom, posterLabelMeasure(ctx, o.labelScale, u * 1.35)),
    theme: o.theme,
    labelScale: o.labelScale,
    layers: o.layers,
    uiScale: u * 1.35,
    showGrid: o.showGrid,
    // The poster background is already painted under the whole image: draw over it.
    background: false,
    clear: false,
    fill: 1, // as measured by fitCamera
    time: 0,
  });
  ctx.restore();
  // Fade the map into the footer.
  const mapBottom = L.map.y + L.map.h;
  const fade = ctx.createLinearGradient(0, mapBottom - L.pad * 1.6, 0, mapBottom);
  fade.addColorStop(0, rgba(theme.bg[2], 0));
  fade.addColorStop(1, rgba(theme.bg[2], theme.dark ? 0.55 : 0.4));
  ctx.fillStyle = fade;
  ctx.fillRect(0, mapBottom - L.pad * 1.6, L.W, L.pad * 1.6);

  // Headline (tall formats): the three largest genre families, in holographic type.
  if (L.header) {
    const hd = L.header;
    const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = theme.dark ? '#5cf2ff' : theme.halo;
    ctx.font = `700 ${Math.round(20 * u)}px ${FONT_UI}`;
    spaced.letterSpacing = `${(6 * u).toFixed(1)}px`;
    ctx.fillText('SOUND OF MY MIND', L.W / 2, hd.y + 44 * u);
    spaced.letterSpacing = '0px';
    const families = o.stats.families.slice(0, 3).map((f) => f.label);
    const headline = families.length ? families.join(' · ') : 'My Music Map';
    const size = fitFont(ctx, headline, 700, FONT_DISPLAY, Math.round(66 * u), hd.w);
    const width = ctx.measureText(headline).width;
    if (theme.dark) {
      const holo = ctx.createLinearGradient(L.W / 2 - width / 2, 0, L.W / 2 + width / 2, 0);
      for (const [stop, c] of [[0, '#5cf2ff'], [0.4, '#c3b5ff'], [0.7, '#ff8ae2'], [1, '#ffd83d']] as const) holo.addColorStop(stop, c);
      ctx.fillStyle = holo;
    } else ctx.fillStyle = theme.text;
    ctx.fillText(headline, L.W / 2, hd.y + 44 * u + size * 1.35);
    ctx.textAlign = 'left';
  }

  // Footer: holographic rule, logo, @handle, summary.
  const f = L.footer;
  const rule = ctx.createLinearGradient(f.x, 0, f.x + f.w, 0);
  for (const [stop, c] of [[0, '#5cf2ff'], [0.35, '#9b7bff'], [0.65, '#ff5ad8'], [1, '#ffd83d']] as const) rule.addColorStop(stop, c);
  ctx.fillStyle = rule;
  ctx.fillRect(f.x, f.y, f.w, Math.max(2, 3 * u));

  const ink = theme.text;
  const muted = theme.textMuted;
  const handle = o.user ? `@${o.user.handle}` : 'My Music Map';
  const name = o.user && o.user.displayName && o.user.displayName !== o.user.handle ? o.user.displayName : '';
  const top = o.stats.families[0];
  const summary = [`${o.stats.tracks} tracks`, `${o.stats.artists} artists`, `${o.stats.genres} genres`, top ? `${top.label} ${Math.round(top.share * 100)}%` : ''].filter(Boolean).join('  ·  ');
  const dateText = o.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  ctx.textBaseline = 'alphabetic';

  const familyBar = (x: number, y: number, w: number, h: number) => {
    const total = o.stats.families.slice(0, 6).reduce((s, fam) => s + fam.share, 0) || 1;
    let cx = x;
    for (const fam of o.stats.families.slice(0, 6)) {
      const fw = (fam.share / total) * w;
      ctx.fillStyle = fam.color;
      ctx.fillRect(cx, y, Math.max(1, fw - 2 * u), h);
      cx += fw;
    }
  };

  if (o.orientation === 'landscape') {
    const logoH = f.h * 0.3;
    drawLogo(ctx, f.x, f.y + f.h * 0.2, logoH, ink);
    ctx.fillStyle = muted;
    ctx.font = `600 ${Math.round(14 * u)}px ${FONT_UI}`;
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(3 * u).toFixed(1)}px`;
    ctx.fillText('SOUND OF MY MIND', f.x, f.y + f.h * 0.2 + logoH + 26 * u);
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
    const colX = f.x + logoH * 3.25 + 60 * u;
    const colW = f.w * 0.5;
    const size = fitFont(ctx, handle, 700, FONT_DISPLAY, Math.round(58 * u), colW);
    ctx.fillStyle = ink;
    ctx.fillText(handle, colX, f.y + f.h * 0.2 + size * 0.85);
    ctx.fillStyle = muted;
    ctx.font = `500 ${Math.round(20 * u)}px ${FONT_BODY}`;
    ctx.fillText(name ? `${name}  ·  ${summary}` : summary, colX, f.y + f.h * 0.2 + size * 0.85 + 34 * u, colW);
    familyBar(colX, f.y + f.h * 0.78, colW, Math.max(4, 8 * u));
    ctx.textAlign = 'right';
    ctx.fillStyle = muted;
    ctx.font = `600 ${Math.round(18 * u)}px ${FONT_UI}`;
    ctx.fillText(o.site, f.x + f.w, f.y + f.h * 0.42);
    ctx.font = `500 ${Math.round(16 * u)}px ${FONT_BODY}`;
    ctx.fillText(dateText, f.x + f.w, f.y + f.h * 0.42 + 26 * u);
    ctx.textAlign = 'left';
    return true;
  }

  // Portrait, story and square: stacked.
  const row = f.h / 5;
  const logoH = Math.min(row * 0.95, 46 * u);
  drawLogo(ctx, f.x, f.y + row * 0.45, logoH, ink);
  ctx.textAlign = 'right';
  ctx.fillStyle = muted;
  ctx.font = `600 ${Math.round(17 * u)}px ${FONT_UI}`;
  ctx.fillText(o.site, f.x + f.w, f.y + row * 0.45 + logoH * 0.48);
  ctx.font = `500 ${Math.round(15 * u)}px ${FONT_BODY}`;
  ctx.fillText(dateText, f.x + f.w, f.y + row * 0.45 + logoH * 0.48 + 22 * u);
  ctx.textAlign = 'left';
  const size = fitFont(ctx, handle, 700, FONT_DISPLAY, Math.round(64 * u), f.w);
  ctx.fillStyle = ink;
  ctx.fillText(handle, f.x, f.y + row * 1.6 + size * 0.75);
  ctx.fillStyle = muted;
  const line = name ? `${name}’s Sound of My Mind` : 'Sound of My Mind';
  const lineSize = fitFont(ctx, line, 600, FONT_UI, Math.round(26 * u), f.w);
  ctx.font = `600 ${lineSize}px ${FONT_UI}`;
  ctx.fillText(line, f.x, f.y + row * 1.6 + size * 0.75 + lineSize * 1.45);
  const sumSize = fitFont(ctx, summary, 500, FONT_BODY, Math.round(19 * u), f.w);
  ctx.font = `500 ${sumSize}px ${FONT_BODY}`;
  ctx.fillText(summary, f.x, f.y + row * 1.6 + size * 0.75 + lineSize * 1.45 + sumSize * 1.6);
  familyBar(f.x, f.y + f.h - Math.max(4, 8 * u), f.w, Math.max(4, 8 * u));
  return true;
}
