/**
 * Interactive 3D Music Map (canvas). Drag to rotate, right-drag or Shift+drag
 * to pan, scroll or pinch to zoom, twist with two fingers to spin. In showcase
 * mode (landing page) it auto-rotates and leans towards the pointer instead.
 *
 * Accessibility: the 2D map and the list view remain the keyboard- and
 * screen-reader-friendly ways to explore; this view adds keyboard rotation and
 * zoom, and a text summary of the largest genre families.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import type { MapNode, MusicMap } from '../../shared/analysis/map';
import { normalizeText } from '../../shared/normalize';
import { useReducedMotion } from '../fx/motion';
import { renderMap, type ThemeId } from './draw';
import {
  ALL_LAYERS,
  type Camera,
  clampCamera,
  easeOutCubic,
  FLAT_CAMERA,
  hitTest,
  type Layers,
  lerpCamera,
  PITCH_MAX,
  prepareScene,
  type Projected,
  TILTED_CAMERA,
  ZOOM_MAX,
  ZOOM_MIN,
} from './engine';

export interface MusicMap3DHandle {
  getCamera(): Camera;
  setCamera(c: Camera, animate?: boolean): void;
  reset(): void;
}

export interface MusicMap3DProps {
  map: MusicMap;
  ariaLabel: string;
  selectedId?: string | null;
  onSelect?: (node: MapNode | null) => void;
  query?: string;
  labelScale?: number;
  layers?: Layers;
  autoRotate?: boolean;
  /** Height of the dome, 0 (flat) to 1.6. */
  depth?: number;
  theme?: ThemeId;
  showGrid?: boolean;
  /** Decorative landing-page mode: auto-rotates, family labels only, leans towards the pointer. */
  showcase?: boolean;
  /** Called when the listener grabs the map while it auto-rotates. */
  onUserRotate?: () => void;
  className?: string;
}

export const MusicMap3D = forwardRef<MusicMap3DHandle, MusicMap3DProps>(function MusicMap3D(
  {
    map,
    ariaLabel,
    selectedId = null,
    onSelect,
    query = '',
    labelScale = 1,
    layers = ALL_LAYERS,
    autoRotate = false,
    depth = 1,
    theme = 'midnight',
    showGrid = true,
    showcase = false,
    onUserRotate,
    className,
  },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const scene = useMemo(() => prepareScene(map), [map]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ node: MapNode; x: number; y: number } | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const matchIds = useMemo(() => {
    const q = normalizeText(query);
    if (q.length < 2) return null;
    const ids = new Set<string>();
    for (const n of map.nodes) if (normalizeText(n.label).includes(q)) ids.add(n.id);
    return ids;
  }, [query, map]);

  // Everything the render loop reads lives in refs, so drawing never waits for React.
  const cam = useRef<Camera>({ ...FLAT_CAMERA });
  const tween = useRef<{ from: Camera; to: Camera; start: number; dur: number } | null>(null);
  const vel = useRef({ yaw: 0, pitch: 0 });
  const parallax = useRef({ yaw: 0, pitch: 0, tYaw: 0, tPitch: 0 });
  const proj = useRef<Projected | null>(null);
  const raf = useRef(0);
  const last = useRef(0);
  const dragging = useRef(false);
  const live = useRef({ selectedId, hoverId: null as string | null, matchIds, labelScale, layers, autoRotate, depth, theme, showGrid });
  live.current = { ...live.current, selectedId, matchIds, labelScale, layers, autoRotate, depth, theme, showGrid };

  const frame = useRef<(now: number) => void>(() => {});
  const schedule = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame((t) => {
      raf.current = 0;
      frame.current(t);
    });
  }, []);

  frame.current = (now: number) => {
    const s = live.current;
    const dt = last.current ? Math.min(64, now - last.current) : 16;
    last.current = now;
    let animating = false;
    if (tween.current) {
      const p = Math.min(1, (now - tween.current.start) / tween.current.dur);
      cam.current = lerpCamera(tween.current.from, tween.current.to, easeOutCubic(Math.max(0, p)));
      if (p < 1) animating = true;
      else tween.current = null;
    } else if (Math.abs(cam.current.depth - s.depth) > 0.002) {
      cam.current = { ...cam.current, depth: cam.current.depth + (s.depth - cam.current.depth) * Math.min(1, dt / 90) };
      animating = true;
    }
    if (!dragging.current && (Math.abs(vel.current.yaw) > 2e-5 || Math.abs(vel.current.pitch) > 2e-5)) {
      cam.current = clampCamera({ ...cam.current, yaw: cam.current.yaw + vel.current.yaw * dt, pitch: cam.current.pitch + vel.current.pitch * dt });
      const decay = 0.9 ** (dt / 16);
      vel.current = { yaw: vel.current.yaw * decay, pitch: vel.current.pitch * decay };
      animating = true;
    }
    if (s.autoRotate && !dragging.current && !reduced) {
      cam.current = { ...cam.current, yaw: cam.current.yaw + dt * (showcase ? 0.00014 : 0.00011) };
      animating = true;
    }
    const px = parallax.current;
    if (Math.abs(px.tYaw - px.yaw) > 1e-4 || Math.abs(px.tPitch - px.pitch) > 1e-4) {
      px.yaw += (px.tYaw - px.yaw) * Math.min(1, dt / 220);
      px.pitch += (px.tPitch - px.pitch) * Math.min(1, dt / 220);
      animating = true;
    }
    if (s.selectedId && !reduced) animating = true; // selection pulse

    const canvas = canvasRef.current;
    const w = canvas?.clientWidth ?? 0;
    const h = canvas?.clientHeight ?? 0;
    const ctx = canvas && w > 0 && h > 0 ? canvas.getContext('2d') : null;
    if (canvas && w > 0 && ctx === null) {
      setUnavailable(true);
      return;
    }
    if (canvas && ctx) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const view = showcase ? { ...cam.current, yaw: cam.current.yaw + px.yaw, pitch: Math.min(PITCH_MAX, Math.max(0, cam.current.pitch + px.pitch)) } : cam.current;
      proj.current = renderMap(ctx, scene, {
        width: w,
        height: h,
        camera: view,
        theme: s.theme,
        labelScale: s.labelScale,
        // Small stages (phones) get proportionally smaller labels; the text-size setting still applies.
        uiScale: Math.max(0.72, Math.min(1, Math.min(w, h) / 640)),
        layers: s.layers,
        selectedId: s.selectedId,
        hoverId: s.hoverId,
        matchIds: s.matchIds,
        showGrid: s.showGrid,
        labelMode: showcase ? 'families' : 'auto',
        background: !showcase,
        fill: showcase ? 0.86 : 0.94,
        time: now,
      });
    }
    if (animating) schedule();
  };

  // Intro: unfold from the flat 2D map into the dome.
  useEffect(() => {
    const target = { ...TILTED_CAMERA, depth };
    vel.current = { yaw: 0, pitch: 0 };
    if (reduced) {
      cam.current = target;
      tween.current = null;
    } else {
      cam.current = { ...FLAT_CAMERA, yaw: target.yaw + 0.9 };
      tween.current = { from: cam.current, to: target, start: performance.now() + 120, dur: showcase ? 2200 : 1500 };
    }
    schedule();
    // Re-run only for a new map; depth changes ease in the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, reduced, showcase]);

  useEffect(() => {
    schedule();
  }, [selectedId, matchIds, labelScale, layers, autoRotate, depth, theme, showGrid, size, schedule]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(
    () => () => {
      // Clear the id too: StrictMode remounts reuse these refs, and a stale id would block schedule().
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      last.current = 0;
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      getCamera: () => ({ ...cam.current }),
      setCamera: (c: Camera, animate = true) => {
        vel.current = { yaw: 0, pitch: 0 };
        if (animate && !reduced) tween.current = { from: cam.current, to: clampCamera(c), start: performance.now(), dur: 900 };
        else cam.current = clampCamera(c);
        schedule();
      },
      reset: () => {
        vel.current = { yaw: 0, pitch: 0 };
        const to = { ...TILTED_CAMERA, depth: live.current.depth };
        if (reduced) cam.current = to;
        else tween.current = { from: cam.current, to, start: performance.now(), dur: 900 };
        schedule();
      },
    }),
    [reduced, schedule],
  );

  // ------------------------------------------------------------ pointer input
  const pointers = useRef(new Map<number, { x: number; y: number; t: number }>());
  const gesture = useRef({ moved: 0, pan: false, dist: 0, angle: 0, mid: { x: 0, y: 0 } });

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const pinchState = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return { dist: 0, angle: 0, mid: { x: 0, y: 0 } };
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (showcase) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, { ...p, t: performance.now() });
    tween.current = null;
    vel.current = { yaw: 0, pitch: 0 };
    dragging.current = true;
    gesture.current.moved = 0;
    gesture.current.pan = e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey;
    if (pointers.current.size === 2) Object.assign(gesture.current, pinchState());
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const p = local(e);
    if (showcase) {
      const w = wrapRef.current?.clientWidth || 1;
      const h = wrapRef.current?.clientHeight || 1;
      parallax.current.tYaw = (p.x / w - 0.5) * 0.7;
      parallax.current.tPitch = (p.y / h - 0.5) * 0.35;
      schedule();
      return;
    }
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === 'mouse' && proj.current) {
        const i = hitTest(proj.current, p.x, p.y);
        const node = i >= 0 ? scene.nodes[i]!.node : null;
        if ((node?.id ?? null) !== live.current.hoverId) {
          live.current.hoverId = node?.id ?? null;
          schedule();
        }
        setHover(node ? { node, x: p.x, y: p.y } : null);
      }
      return;
    }
    const now = performance.now();
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    pointers.current.set(e.pointerId, { ...p, t: now });
    const short = Math.min(wrapRef.current?.clientWidth || 1, wrapRef.current?.clientHeight || 1);
    if (pointers.current.size === 2) {
      const next = pinchState();
      const g = gesture.current;
      cam.current = clampCamera({
        ...cam.current,
        zoom: cam.current.zoom * (g.dist > 0 ? next.dist / g.dist : 1),
        yaw: cam.current.yaw + (next.angle - g.angle),
        panX: cam.current.panX + (next.mid.x - g.mid.x) / short,
        panY: cam.current.panY + (next.mid.y - g.mid.y) / short,
      });
      Object.assign(g, next);
      g.moved += 10;
    } else if (gesture.current.pan) {
      cam.current = clampCamera({ ...cam.current, panX: cam.current.panX + dx / short, panY: cam.current.panY + dy / short });
      gesture.current.moved += Math.abs(dx) + Math.abs(dy);
    } else {
      const ddt = Math.max(1, now - prev.t);
      cam.current = clampCamera({ ...cam.current, yaw: cam.current.yaw + dx * 0.0065, pitch: cam.current.pitch + dy * 0.005 });
      vel.current = { yaw: (dx * 0.0065) / ddt, pitch: (dy * 0.005) / ddt };
      gesture.current.moved += Math.abs(dx) + Math.abs(dy);
    }
    if (gesture.current.moved > 4) {
      setHover(null);
      if (live.current.autoRotate) onUserRotate?.();
    }
    schedule();
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (showcase) return;
    const p = local(e);
    const wasSingle = pointers.current.size === 1;
    const prev = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1) Object.assign(gesture.current, { dist: 0 });
    if (pointers.current.size === 0) dragging.current = false;
    // A release after a pause should not fling the map.
    if (prev && performance.now() - prev.t > 90) vel.current = { yaw: 0, pitch: 0 };
    if (wasSingle && gesture.current.moved <= 4 && proj.current) {
      vel.current = { yaw: 0, pitch: 0 };
      const i = hitTest(proj.current, p.x, p.y, e.pointerType === 'mouse' ? 4 : 10);
      onSelect?.(i >= 0 ? scene.nodes[i]!.node : null);
    }
    schedule();
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || showcase) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const short = Math.min(rect.width, rect.height) || 1;
      const c = cam.current;
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.zoom * Math.exp(-e.deltaY * 0.0015)));
      const ratio = zoom / c.zoom;
      // Keep the point under the cursor roughly in place.
      const cx = (e.clientX - rect.left - rect.width / 2) / short - c.panX;
      const cy = (e.clientY - rect.top - rect.height / 2) / short - c.panY;
      cam.current = clampCamera({ ...c, zoom, panX: c.panX - cx * (ratio - 1), panY: c.panY - cy * (ratio - 1) });
      tween.current = null;
      schedule();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [schedule, showcase]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (showcase) return;
    const c = cam.current;
    const keys: Record<string, () => Camera> = {
      ArrowLeft: () => ({ ...c, yaw: c.yaw - 0.12 }),
      ArrowRight: () => ({ ...c, yaw: c.yaw + 0.12 }),
      ArrowUp: () => ({ ...c, pitch: c.pitch - 0.08 }),
      ArrowDown: () => ({ ...c, pitch: c.pitch + 0.08 }),
      '+': () => ({ ...c, zoom: c.zoom * 1.2 }),
      '=': () => ({ ...c, zoom: c.zoom * 1.2 }),
      '-': () => ({ ...c, zoom: c.zoom / 1.2 }),
    };
    if (e.key === 'Escape') {
      onSelect?.(null);
      return;
    }
    if (e.key === '0') {
      e.preventDefault();
      tween.current = { from: c, to: { ...TILTED_CAMERA, depth: live.current.depth }, start: performance.now(), dur: reduced ? 1 : 700 };
      schedule();
      return;
    }
    const fn = keys[e.key];
    if (fn) {
      e.preventDefault();
      tween.current = null;
      cam.current = clampCamera(fn());
      schedule();
    }
  };

  const families = useMemo(
    () =>
      map.nodes
        .filter((n) => n.kind === 'family')
        .slice(0, 6)
        .map((n) => `${n.label} ${Math.round(n.share * 100)}%`)
        .join(', '),
    [map],
  );

  if (showcase) {
    return (
      <div
        ref={wrapRef}
        className={`map3d map3d-showcase ${className ?? ''}`}
        role="img"
        aria-label={`${ariaLabel}. Largest genre families: ${families}.`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => {
          parallax.current.tYaw = 0;
          parallax.current.tPitch = 0;
          schedule();
        }}
      >
        <canvas ref={canvasRef} className="map3d-canvas" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className={`map3d ${className ?? ''}`}
      tabIndex={0}
      role="application"
      aria-roledescription="3D music map"
      aria-label={`${ariaLabel}. Largest genre families: ${families}. Drag to rotate, right-drag or Shift and drag to pan, scroll or pinch to zoom. Keyboard: arrow keys rotate and tilt, plus and minus zoom, 0 resets the view, Escape clears the selection.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        if (live.current.hoverId) {
          live.current.hoverId = null;
          schedule();
        }
        setHover(null);
      }}
      onDoubleClick={() => {
        tween.current = { from: cam.current, to: { ...TILTED_CAMERA, depth: live.current.depth }, start: performance.now(), dur: reduced ? 1 : 800 };
        schedule();
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvasRef} className="map3d-canvas" aria-hidden="true" />
      {unavailable && <p className="map3d-unavailable small">The 3D view needs a browser with canvas support. The 2D map and the list show the same information.</p>}
      {hover && (
        <div className="map-tooltip" style={{ left: Math.min(hover.x + 16, size.w - 270), top: Math.max(8, hover.y - 12) }} aria-hidden="true">
          <strong>{hover.node.label}</strong>
          <div className="muted">
            {hover.node.trackCount} track{hover.node.trackCount === 1 ? '' : 's'}
            {hover.node.share ? ` · ${Math.round(hover.node.share * 100)}%` : ''}
          </div>
          {hover.node.detail && <div className="faint">{hover.node.detail}</div>}
        </div>
      )}
    </div>
  );
});
