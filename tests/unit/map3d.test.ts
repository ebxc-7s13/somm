/**
 * 3D Music Map maths and the poster layout: pure functions, no canvas needed.
 */
import { describe, expect, it } from 'vitest';
import { buildMusicMap } from '../../src/shared/analysis/map';
import { computeProfile } from '../../src/shared/analysis/profile';
import {
  ALL_LAYERS,
  CAMERA_PRESETS,
  clampCamera,
  edgeVisible,
  FLAT_CAMERA,
  hitTest,
  labelPriority,
  type LabelCandidate,
  lerpCamera,
  nodeVisible,
  PITCH_MAX,
  placeLabels,
  prepareScene,
  projectScene,
  TILTED_CAMERA,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../src/client/map3d/engine';
import { drawPoster, fitCamera, ORIENTATIONS, type Orientation, posterFileName, posterLayout } from '../../src/client/map3d/poster';
import { attr, library, track } from '../helpers/library';

function sample() {
  const tracks = [
    ...library('Neon', 6, ['Nova Lattice', 'Pulse Garden'], ['synthwave', 'techno']).map((t) => ({ ...t, attributes: [attr('mood', 'dreamy')] })),
    ...library('Blue', 4, ['Teo Vance'], ['hard bop']),
    track('Unlabelled', 'Mira Sol', []),
  ];
  return buildMusicMap(tracks, computeProfile(tracks));
}

const VP = { w: 800, h: 600 };

describe('3D scene', () => {
  const map = sample();
  const scene = prepareScene(map);

  it('looking straight down with no depth reproduces the 2D layout', () => {
    const p = projectScene(scene, FLAT_CAMERA, VP, ALL_LAYERS);
    const fit = (Math.min(VP.w, VP.h) / (2 * scene.radius)) * 0.94;
    for (const n of scene.nodes) {
      expect(p.sx[n.index]).toBeCloseTo(VP.w / 2 + n.x * fit, 2);
      expect(p.sy[n.index]).toBeCloseTo(VP.h / 2 + n.y * fit, 2);
      expect(p.scale[n.index]).toBeCloseTo(1, 5);
    }
  });

  it('lifts the centre into a dome and drops sound attributes below the rings', () => {
    const root = scene.nodes[scene.byId.get('root')!]!;
    const others = scene.nodes.filter((n) => n.node.kind !== 'root');
    expect(others.every((n) => n.h < root.h)).toBe(true);
    const attrs = scene.nodes.filter((n) => n.node.kind === 'attribute');
    expect(attrs.length).toBeGreaterThan(0);
    expect(attrs.every((n) => n.h < 0)).toBe(true);
    expect(scene.rings.length).toBeGreaterThanOrEqual(3);
    expect(scene.stars).toHaveLength(160);
    // Deterministic: the same map gives the same scene.
    expect(prepareScene(map).nodes.map((n) => n.h)).toEqual(scene.nodes.map((n) => n.h));
  });

  it('tilting moves nodes on screen and draws them far to near', () => {
    const flat = projectScene(scene, FLAT_CAMERA, VP, ALL_LAYERS);
    const tilt = projectScene(scene, TILTED_CAMERA, VP, ALL_LAYERS);
    const moved = scene.nodes.filter((n) => Math.abs(flat.sy[n.index]! - tilt.sy[n.index]!) > 1);
    expect(moved.length).toBeGreaterThan(scene.nodes.length / 2);
    for (let k = 1; k < tilt.order.length; k++) expect(tilt.depth[tilt.order[k]!]!).toBeGreaterThanOrEqual(tilt.depth[tilt.order[k - 1]!]!);
  });

  it('hit-tests the nearest node under the pointer', () => {
    const p = projectScene(scene, TILTED_CAMERA, VP, ALL_LAYERS);
    const root = scene.byId.get('root')!;
    expect(hitTest(p, p.sx[root]!, p.sy[root]!)).toBe(root);
    expect(hitTest(p, -500, -500)).toBe(-1);
  });

  it('hides song and attribute layers on request', () => {
    const layers = { songs: false, attributes: false, links: false };
    const p = projectScene(scene, TILTED_CAMERA, VP, layers);
    for (const i of p.order) expect(['track', 'attribute']).not.toContain(scene.nodes[i]!.node.kind);
    expect(scene.nodes.some((n) => n.node.kind === 'track' && nodeVisible(n.node, ALL_LAYERS))).toBe(true);
    for (const e of scene.edges) {
      if (e.edge.kind === 'branch') expect(edgeVisible(e.edge, layers)).toBe(true);
      else expect(edgeVisible(e.edge, layers)).toBe(false);
    }
  });
});

describe('labels', () => {
  const map = sample();
  const ctx = { selectedId: null, hoverId: null, matchIds: null, zoom: 1, expandedId: null, mode: 'auto' as const };

  it('labels the centre and families first, and songs only when zoomed in or expanded', () => {
    const root = map.nodes.find((n) => n.kind === 'root')!;
    const family = map.nodes.find((n) => n.kind === 'family')!;
    const song = map.nodes.find((n) => n.kind === 'track')!;
    expect(labelPriority(root, ctx)!).toBeGreaterThan(labelPriority(family, ctx)!);
    expect(labelPriority(song, ctx)).toBeNull();
    expect(labelPriority(song, { ...ctx, zoom: 3 })).not.toBeNull();
    expect(labelPriority(song, { ...ctx, expandedId: song.parentId })).not.toBeNull();
    expect(labelPriority(song, { ...ctx, selectedId: song.id })).toBe(5000);
    expect(labelPriority(map.nodes.find((n) => n.kind === 'genre')!, { ...ctx, mode: 'families' })).toBeNull();
  });

  it('never overlaps placed labels, but always places forced ones', () => {
    const box = (index: number, x: number, y: number, priority: number, force = false): LabelCandidate => ({ index, priority, force, x0: x, y0: y, x1: x + 100, y1: y + 20 });
    const placed = placeLabels([box(0, 0, 0, 10), box(1, 50, 5, 20), box(2, 300, 0, 5), box(3, 600, 0, 1, true), box(4, 620, 5, 0, true), box(5, 610, 2, 99)]);
    const ids = placed.map((c) => c.index).sort();
    // 1 beats 0 where they overlap; 2 is clear; 3 and 4 are forced, so both are placed even though they
    // overlap, and they block 5 despite its higher priority.
    expect(ids).toEqual([1, 2, 3, 4]);
    const free = placed.filter((c) => !c.force);
    for (const a of free) for (const b of free) if (a !== b) expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0).toBe(true);
  });
});

describe('label fallbacks', () => {
  it('moves a label to its first free fallback instead of dropping it', () => {
    const centre = { index: 0, priority: 100, force: true, x0: 0, y0: 0, x1: 200, y1: 20 };
    const family = {
      index: 1,
      priority: 50,
      force: false,
      x0: 50, y0: 10, x1: 150, y1: 30, // overlaps the centre label
      side: 'below',
      alts: [
        { x0: 50, y0: 5, x1: 150, y1: 25, side: 'right-but-still-overlapping' },
        { x0: 50, y0: -40, x1: 150, y1: -20, side: 'above' },
      ],
    };
    const placed = placeLabels([centre, family]);
    expect(placed.map((c) => c.index).sort()).toEqual([0, 1]);
    const moved = placed.find((c) => c.index === 1)!;
    expect(moved).toMatchObject({ side: 'above', y0: -40, y1: -20 });
  });
});

describe('camera', () => {
  it('clamps tilt, zoom and depth', () => {
    const c = clampCamera({ yaw: 9, pitch: 4, zoom: 100, panX: 9, panY: -9, depth: 5 });
    expect(c).toEqual({ yaw: 9, pitch: PITCH_MAX, zoom: ZOOM_MAX, panX: 1.5, panY: -1.5, depth: 1.6 });
    expect(clampCamera({ ...FLAT_CAMERA, zoom: 0 }).zoom).toBe(ZOOM_MIN);
  });

  it('eases the short way round', () => {
    const mid = lerpCamera({ ...FLAT_CAMERA, yaw: 3 }, { ...FLAT_CAMERA, yaw: -3 }, 0.5);
    expect(Math.abs(Math.cos(mid.yaw) + 1)).toBeLessThan(0.01); // halfway through ±π, not through 0
    expect(lerpCamera(FLAT_CAMERA, CAMERA_PRESETS.side, 1).pitch).toBeCloseTo(CAMERA_PRESETS.side.pitch);
  });
});

describe('poster layout', () => {
  const all = Object.keys(ORIENTATIONS) as Orientation[];

  it('has the advertised size in each orientation, with the footer below the map', () => {
    for (const o of all) {
      for (const q of [1, 2] as const) {
        const L = posterLayout(o, q);
        expect([L.W, L.H]).toEqual([ORIENTATIONS[o].w * q, ORIENTATIONS[o].h * q]);
        expect(L.footer.y).toBeGreaterThanOrEqual(L.map.y + L.map.h);
        expect(L.footer.y + L.footer.h).toBeLessThanOrEqual(L.H);
        expect(L.footer.x + L.footer.w).toBeLessThanOrEqual(L.W);
        // The map is the main thing on the poster.
        expect(L.map.h).toBeGreaterThan(L.H * 0.6);
      }
    }
  });

  it('names files after the handle and orientation', () => {
    expect(posterFileName('Night.Owl', 'story')).toBe('night-owl-sound-of-my-mind-story.png');
    expect(posterFileName(undefined, 'square')).toBe('my-sound-of-my-mind-square.png');
    expect(posterFileName('***', 'portrait')).toBe('my-sound-of-my-mind-portrait.png');
  });
});

/** A 2D context stand-in that records drawing calls (no canvas in Node). */
function recordingCanvas() {
  const calls: { name: string; args: unknown[] }[] = [];
  const gradient = { addColorStop: () => undefined };
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop.startsWith('create')) return () => gradient;
      if (prop === 'measureText') return (text: string) => ({ width: text.length * 10 });
      return (...args: unknown[]) => void calls.push({ name: prop, args });
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

describe('poster drawing', () => {
  const scene = prepareScene(sample());
  const options = {
    orientation: 'portrait' as const,
    quality: 1 as const,
    theme: 'midnight' as const,
    camera: TILTED_CAMERA,
    labelScale: 1.2,
    layers: ALL_LAYERS,
    showGrid: true,
    user: { handle: 'night_owl', displayName: 'Night Owl' },
    stats: { tracks: 11, artists: 4, genres: 3, families: [{ label: 'Electronic', share: 0.55, color: '#1747ff' }] },
    date: new Date('2026-10-15T12:00:00Z'),
    site: 'soundofmymind.onrender.com',
  };

  it('puts the logo, the @handle and the site under the map, over a painted background', () => {
    const { canvas, calls } = recordingCanvas();
    expect(drawPoster(canvas, scene, options)).toBe(true);
    expect([canvas.width, canvas.height]).toEqual([1080, 1350]);
    // Nothing is cleared: a cleared map area would be transparent in the saved PNG.
    expect(calls.filter((c) => c.name === 'clearRect')).toEqual([]);
    const text = (t: string) => calls.find((c) => c.name === 'fillText' && c.args[0] === t);
    const mapBottom = posterLayout('portrait').map.h;
    for (const t of ['@night_owl', 'Night Owl’s Sound of My Mind', 'soundofmymind.onrender.com']) {
      expect(text(t), t).toBeDefined();
      expect(text(t)!.args[2] as number).toBeGreaterThan(mapBottom);
    }
    expect(text('S')).toBeDefined(); // the logo wordmark
    expect(text('MM')).toBeDefined();
    expect(calls.some((c) => c.name === 'fillText' && /11 tracks.*4 artists.*3 genres.*Electronic 55%/.test(String(c.args[0])))).toBe(true);
  });

  it('fits the whole map into the frame, centred, keeping the viewing angle', () => {
    for (const [w, h] of [[1080, 1000], [1920, 800], [1080, 1600]] as const) {
      const cam = fitCamera(scene, { ...TILTED_CAMERA, zoom: 3, panX: 0.4 }, ALL_LAYERS, w, h);
      expect([cam.yaw, cam.pitch, cam.depth]).toEqual([TILTED_CAMERA.yaw, TILTED_CAMERA.pitch, TILTED_CAMERA.depth]);
      const p = projectScene(scene, cam, { w, h, fill: 1 }, ALL_LAYERS);
      const xs = p.order.flatMap((i) => [p.sx[i]! - p.rr[i]!, p.sx[i]! + p.rr[i]!]);
      const ys = p.order.flatMap((i) => [p.sy[i]! - p.rr[i]!, p.sy[i]! + p.rr[i]!]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      expect(Math.abs((x0 + x1) / 2 - w / 2)).toBeLessThan(3);
      expect(Math.abs((y0 + y1) / 2 - h / 2)).toBeLessThan(3);
      // The limiting side spans the fit margin; the other one less.
      expect(Math.max((x1 - x0) / w / 0.8, (y1 - y0) / h / 0.86)).toBeCloseTo(1, 1);
      // Map size scales from there.
      expect(fitCamera(scene, TILTED_CAMERA, ALL_LAYERS, w, h, 1.5).zoom).toBeCloseTo(cam.zoom * 1.5, 5);
    }
  });

  it('makes room for measured labels, so bigger text gives a smaller map rather than cut-off labels', () => {
    const labels = (w: number) => (n: { kind: string }) => (n.kind === 'track' ? null : { w, h: 20, gap: 4 });
    const zoomWith = (w: number) => fitCamera(scene, FLAT_CAMERA, ALL_LAYERS, 1080, 1000, 1, labels(w)).zoom;
    expect(zoomWith(240)).toBeLessThan(zoomWith(120));
    expect(zoomWith(120)).toBeLessThan(zoomWith(1));
    // Tiny labels: the map may use nearly the whole frame (more than the rough, unmeasured margin).
    expect(zoomWith(1)).toBeGreaterThan(fitCamera(scene, FLAT_CAMERA, ALL_LAYERS, 1080, 1000).zoom);
  });

  it('draws every orientation at its size, and twice the size when extra sharp', () => {
    for (const o of Object.keys(ORIENTATIONS) as Orientation[]) {
      const { canvas } = recordingCanvas();
      expect(drawPoster(canvas, scene, { ...options, orientation: o, quality: 2 })).toBe(true);
      expect([canvas.width, canvas.height]).toEqual([ORIENTATIONS[o].w * 2, ORIENTATIONS[o].h * 2]);
    }
  });
});
