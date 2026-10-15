/**
 * Interactive Music Map renderer (SVG).
 *
 * Performance: the node/edge scene is memoised and only re-renders when the
 * level-of-detail tier, selection or search changes — panning and zooming just
 * update one transform. Label sizes stay constant on screen via a CSS variable
 * (--k), so zooming never re-renders hundreds of text nodes.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { MapEdge, MapNode, MusicMap as MusicMapData } from '../../shared/analysis/map';
import { normalizeText } from '../../shared/normalize';
import { ALL_LAYERS, edgeVisible, nodeVisible, type Layers } from '../map3d/engine';
import { Icon } from './Icon';

interface View {
  k: number;
  x: number;
  y: number;
}

export interface MusicMapProps {
  map: MusicMapData;
  ariaLabel: string;
  selectedId?: string | null;
  onSelect?: (node: MapNode | null) => void;
  interactive?: boolean;
  compact?: boolean;
  query?: string;
  showControls?: boolean;
  legend?: boolean;
  /** 'minimal' labels only the genre families (for small decorative maps). */
  labels?: 'auto' | 'minimal';
  /** Label size multiplier (the listener's text-size setting). */
  labelScale?: number;
  /** Which optional layers to draw. */
  layers?: Layers;
}

const FONT: Record<string, number> = { root: 15, family: 15, genre: 13, artist: 12, track: 11, attribute: 12, more: 11 };

function detailFor(z: number): number {
  return z >= 3 ? 4 : z >= 1.8 ? 3 : z >= 1.25 ? 2 : z >= 0.85 ? 1 : 0;
}

function edgePath(e: MapEdge, s: MapNode, t: MapNode): string {
  if (e.kind === 'branch') {
    if (s.kind === 'root') return `M${s.x},${s.y}L${t.x},${t.y}`;
    // Radial curve: bend through the parent's radius at the child's angle.
    const pr = Math.hypot(s.x, s.y);
    const cx = Math.cos(t.angle) * pr;
    const cy = Math.sin(t.angle) * pr;
    return `M${s.x},${s.y}Q${cx},${cy} ${t.x},${t.y}`;
  }
  const pull = e.kind === 'cooccurrence' ? 0.25 : e.kind === 'association' ? 0.55 : 0.8;
  const mx = ((s.x + t.x) / 2) * pull;
  const my = ((s.y + t.y) / 2) * pull;
  return `M${s.x},${s.y}Q${mx},${my} ${t.x},${t.y}`;
}

function nodeAria(n: MapNode): string {
  const kind = { root: 'Centre', family: 'Genre family', genre: 'Genre', artist: 'Artist', track: 'Track', attribute: 'Sound attribute', more: 'Collapsed group' }[n.kind];
  const pct = n.share ? `, ${Math.round(n.share * 100)}% of library` : '';
  const unc = n.uncertain ? (n.kind === 'attribute' ? ', inferred from genre' : ', uncertain') : '';
  return `${kind}: ${n.label}, ${n.trackCount} track${n.trackCount === 1 ? '' : 's'}${pct}${unc}`;
}

interface SceneProps {
  map: MusicMapData;
  detail: number;
  selectedId: string | null;
  matchIds: Set<string> | null;
  topArtists: Set<string>;
  topGenres: Set<string>;
  interactive: boolean;
  animate: boolean;
  minimal: boolean;
  layers: Layers;
}

const Scene = memo(function Scene({ map, detail, selectedId, matchIds, topArtists, topGenres, interactive, animate, minimal, layers }: SceneProps) {
  const byId = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const expandedArtist = selected?.kind === 'artist' ? selected.id : selected?.kind === 'track' ? selected.parentId : null;

  const visible = useCallback(
    (n: MapNode) => {
      if (!nodeVisible(n, layers)) return false;
      if (n.kind !== 'track') return true;
      return detail >= 3 || n.parentId === expandedArtist || n.id === selectedId || (matchIds?.has(n.id) ?? false);
    },
    [detail, expandedArtist, selectedId, matchIds, layers],
  );

  const showLabel = (n: MapNode) => {
    if (minimal) return n.kind === 'root' || n.kind === 'family';
    if (n.id === selectedId || matchIds?.has(n.id)) return true;
    switch (n.kind) {
      case 'root':
      case 'family':
        return true;
      case 'genre':
        return detail >= 1 || topGenres.has(n.id);
      case 'attribute':
        return detail >= 1 || n.share >= 0.2;
      case 'artist':
        return detail >= 2 || topArtists.has(n.id) || n.parentId === selectedId;
      case 'more':
        return detail >= 2;
      case 'track':
        return detail >= 4 || n.parentId === expandedArtist;
    }
  };

  const related = useMemo(() => {
    if (!selectedId) return null;
    const ids = new Set<string>([selectedId]);
    let cur = byId.get(selectedId);
    while (cur?.parentId) {
      ids.add(cur.parentId);
      cur = byId.get(cur.parentId);
    }
    for (const n of map.nodes) if (n.parentId === selectedId) ids.add(n.id);
    for (const e of map.edges) {
      if (e.source === selectedId) ids.add(e.target);
      if (e.target === selectedId) ids.add(e.source);
    }
    return ids;
  }, [selectedId, byId, map]);

  const focusSet = matchIds ?? related;
  const kindOrder = { root: 0, family: 1, genre: 2, attribute: 2, artist: 3, more: 3, track: 4 } as const;

  return (
    <>
      <g aria-hidden="true">
        {map.edges.map((e) => {
          const s = byId.get(e.source);
          const t = byId.get(e.target);
          if (!s || !t || !visible(s) || !visible(t) || !edgeVisible(e, layers)) return null;
          const dim = focusSet ? !(focusSet.has(e.source) && focusSet.has(e.target)) : false;
          const width = e.kind === 'branch' ? 0.8 + 4.5 * e.weight : e.kind === 'cooccurrence' ? 0.8 + 6 * e.weight : 0.8 + 2.5 * e.weight;
          return (
            <path
              key={e.id}
              className={`edge edge-${e.kind}`}
              d={edgePath(e, s, t)}
              strokeWidth={width}
              vectorEffect="non-scaling-stroke"
              data-dim={dim}
              strokeDasharray={e.uncertain && e.kind === 'branch' ? '4 4' : undefined}
              // Inline style: a stroke attribute would lose to the .edge-branch CSS rule.
              style={e.kind === 'branch' && t.kind !== 'track' ? { stroke: t.color } : undefined}
            />
          );
        })}
      </g>
      <g>
        {map.nodes.filter(visible).map((n) => {
          const focusable = interactive && (n.kind === 'family' || n.kind === 'genre' || n.kind === 'attribute' || n.kind === 'root' || n.kind === 'more');
          const dim = focusSet ? !focusSet.has(n.id) : false;
          return (
            <g
              key={n.id}
              className="node"
              data-id={n.id}
              data-dim={dim}
              data-selected={n.id === selectedId}
              data-match={matchIds?.has(n.id) ?? false}
              data-uncertain={n.uncertain ?? false}
              transform={`translate(${n.x},${n.y})`}
              tabIndex={focusable ? 0 : undefined}
              role={focusable ? 'button' : undefined}
              aria-label={focusable ? nodeAria(n) : undefined}
              aria-pressed={focusable ? n.id === selectedId : undefined}
            >
              <g className={animate ? 'enter' : undefined} style={animate ? { animationDelay: `${kindOrder[n.kind] * 90}ms`, transformBox: 'fill-box', transformOrigin: 'center' } : undefined}>
                {n.kind !== 'track' && <circle className="glow" r={n.r * 2.2} fill={n.kind === 'root' ? '#5cf2ff' : n.color} />}
                {n.kind === 'root' && <circle className="root-ring" r={n.r + 10} vectorEffect="non-scaling-stroke" />}
                <circle className="halo" r={n.r + 6} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                <circle className="core" r={n.r} fill={n.kind === 'root' ? 'url(#somm-root)' : n.color} vectorEffect="non-scaling-stroke" />
                {n.r >= 7 && <circle className="sheen" r={n.r} fill="url(#somm-sheen)" />}
                {n.kind === 'more' && (
                  <text textAnchor="middle" dominantBaseline="central" className="label" style={{ fontSize: `calc(11px * var(--ls, 1) / var(--k))`, strokeWidth: `calc(3px * var(--ls, 1) / var(--k))` }}>
                    +
                  </text>
                )}
              </g>
              {showLabel(n) && !(minimal && n.kind === 'root') && (() => {
                // Inner rings (centre, families, genres) label below the node, because their children
                // continue outward along the same ray. Outer rings label radially outward.
                const inner = n.kind === 'root' || n.kind === 'family' || n.kind === 'genre';
                const ux = inner ? 0 : Math.cos(n.angle);
                // The centre label sits on the root node itself.
                const uy = n.kind === 'root' ? 0 : inner ? 1 : Math.sin(n.angle);
                const anchor = inner ? 'middle' : ux > 0.35 ? 'start' : ux < -0.35 ? 'end' : 'middle';
                return (
                  <text
                    className={`label label-${n.kind}`}
                    textAnchor={anchor}
                    x={ux * n.r}
                    y={uy * n.r}
                    dx={anchor === 'start' ? '0.45em' : anchor === 'end' ? '-0.45em' : 0}
                    dy={n.kind === 'root' ? '0.35em' : anchor === 'middle' ? (uy >= 0 ? '1.15em' : '-0.55em') : '0.35em'}
                    style={{ fontSize: `calc(${FONT[n.kind]}px * var(--ls, 1) / var(--k))`, strokeWidth: `calc(3.5px * var(--ls, 1) / var(--k))` }}
                  >
                    {n.label.length > 34 ? `${n.label.slice(0, 32)}…` : n.label}
                  </text>
                );
              })()}
            </g>
          );
        })}
      </g>
    </>
  );
});

export function MusicMap({
  map,
  ariaLabel,
  selectedId = null,
  onSelect,
  interactive = true,
  compact = false,
  query = '',
  showControls = true,
  legend = false,
  labels = 'auto',
  labelScale = 1,
  layers = ALL_LAYERS,
}: MusicMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<{ node: MapNode; sx: number; sy: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // The node under the pointer at pointerdown: with pointer capture active, pointerup is retargeted to the <svg>.
  const gesture = useRef<{ moved: number; pinch: number | null; downNode: MapNode | undefined }>({ moved: 0, pinch: null, downNode: undefined });
  const [animate, setAnimate] = useState(true);

  const byId = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map]);
  const b = map.bounds;
  // Compact (decorative) maps leave extra room so outward labels on the outer ring are not clipped.
  const fitK = useMemo(() => Math.min(size.w / (b.maxX - b.minX), size.h / (b.maxY - b.minY)) * (compact ? 0.78 : 0.96), [size, b, compact]);

  const fit = useCallback(
    (scale = 1) => {
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const k = fitK * scale;
      setView({ k, x: size.w / 2 - cx * k, y: size.h / 2 - cy * k });
    },
    [b, fitK, size],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // Phones open slightly zoomed in around the centre (pan/pinch to explore; "Fit" shows everything).
    fit(interactive && !compact && size.w < 560 ? 1.5 : 1);
    // Only refit when the map or container size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, size.w, size.h]);

  useEffect(() => {
    const t = window.setTimeout(() => setAnimate(false), 1400);
    return () => window.clearTimeout(t);
  }, [map]);

  const clampK = useCallback((k: number) => Math.min(fitK * 9, Math.max(fitK * 0.5, k)), [fitK]);

  const zoomAt = useCallback(
    (factor: number, sx: number, sy: number) => {
      setView((v) => {
        const k = clampK(v.k * factor);
        const mx = (sx - v.x) / v.k;
        const my = (sy - v.y) / v.k;
        return { k, x: sx - mx * k, y: sy - my * k };
      });
    },
    [clampK],
  );

  const centerOn = useCallback(
    (n: MapNode, minZoom = 1.8) => {
      setView((v) => {
        const k = clampK(Math.max(v.k, fitK * minZoom));
        return { k, x: size.w / 2 - n.x * k, y: size.h / 2 - n.y * k };
      });
    },
    [clampK, fitK, size],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !interactive) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, interactive]);

  const matchIds = useMemo(() => {
    const q = normalizeText(query);
    if (q.length < 2) return null;
    const ids = new Set<string>();
    for (const n of map.nodes) if (normalizeText(n.label).includes(q)) ids.add(n.id);
    return ids;
  }, [query, map]);

  useEffect(() => {
    if (!matchIds || matchIds.size === 0) return;
    const first = map.nodes.find((n) => matchIds.has(n.id) && n.kind !== 'track') ?? map.nodes.find((n) => matchIds.has(n.id));
    if (first) centerOn(first, first.kind === 'track' ? 2.6 : 1.5);
  }, [matchIds, map, centerOn]);

  // Narrow screens get fewer always-on labels; zooming in reveals the rest.
  const narrow = size.w < 560;
  const topArtists = useMemo(
    () => new Set(map.nodes.filter((n) => n.kind === 'artist').sort((a, c) => c.trackCount - a.trackCount).slice(0, narrow ? 3 : 12).map((n) => n.id)),
    [map, narrow],
  );
  const topGenres = useMemo(
    () => new Set(map.nodes.filter((n) => n.kind === 'genre').sort((a, c) => c.trackCount - a.trackCount).slice(0, narrow ? 4 : 10).map((n) => n.id)),
    [map, narrow],
  );

  // On narrow screens the label tiers start one zoom step later.
  const detail = Math.max(0, detailFor(view.k / fitK) - (narrow ? 1 : 0));

  const nodeFromEvent = (target: EventTarget | null): MapNode | undefined => {
    const el = (target as Element | null)?.closest?.('[data-id]');
    const id = el?.getAttribute('data-id');
    return id ? byId.get(id) : undefined;
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: RPointerEvent) => {
    if (!interactive) return;
    const downNode = nodeFromEvent(e.target);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    gesture.current = { moved: 0, pinch: null, downNode };
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current.pinch = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    }
  };

  const onPointerMove = (e: RPointerEvent) => {
    if (!interactive) return;
    const p = local(e);
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === 'mouse') {
        const n = nodeFromEvent(e.target);
        setHover(n ? { node: n, sx: p.x, sy: p.y } : null);
      }
      return;
    }
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2 && gesture.current.pinch) {
      const [p1, p2] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      zoomAt(d / gesture.current.pinch, mid.x, mid.y);
      gesture.current.pinch = d;
      gesture.current.moved += 10;
      return;
    }
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    gesture.current.moved += Math.abs(dx) + Math.abs(dy);
    if (gesture.current.moved > 4) {
      setDragging(true);
      setHover(null);
    }
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };

  const onPointerUp = (e: RPointerEvent) => {
    if (!interactive) return;
    pointers.current.delete(e.pointerId);
    setDragging(false);
    if (gesture.current.moved <= 4 && pointers.current.size === 0) {
      onSelect?.(gesture.current.downNode ?? null);
    }
    if (pointers.current.size < 2) gesture.current.pinch = null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const step = 60;
    const target = e.target as Element;
    if ((e.key === 'Enter' || e.key === ' ') && target.closest('[data-id]')) {
      e.preventDefault();
      const n = nodeFromEvent(target);
      if (n) {
        onSelect?.(n);
        centerOn(n, 1.3);
      }
      return;
    }
    const keys: Record<string, () => void> = {
      ArrowLeft: () => setView((v) => ({ ...v, x: v.x + step })),
      ArrowRight: () => setView((v) => ({ ...v, x: v.x - step })),
      ArrowUp: () => setView((v) => ({ ...v, y: v.y + step })),
      ArrowDown: () => setView((v) => ({ ...v, y: v.y - step })),
      '+': () => zoomAt(1.25, size.w / 2, size.h / 2),
      '=': () => zoomAt(1.25, size.w / 2, size.h / 2),
      '-': () => zoomAt(0.8, size.w / 2, size.h / 2),
      '0': () => fit(),
      Escape: () => onSelect?.(null),
    };
    const fn = keys[e.key];
    if (fn && (target === e.currentTarget || target.tagName === 'svg' || e.key === 'Escape' || e.key.length === 1)) {
      e.preventDefault();
      fn();
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`map-wrap ${compact ? 'compact' : ''}`}
      onKeyDown={onKeyDown}
      tabIndex={interactive ? 0 : -1}
      role="application"
      aria-roledescription="interactive music map"
      aria-label={`${ariaLabel}. Drag or use arrow keys to pan, plus and minus to zoom, Tab to move between genre nodes, Enter to select.`}
    >
      <svg
        className={`map-svg ${dragging ? 'dragging' : ''}`}
        width={size.w}
        height={size.h}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        style={{ ['--k' as string]: view.k / (narrow ? 0.85 : 1), ['--ls' as string]: labelScale }}
      >
        <defs>
          <radialGradient id="somm-root" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#8fe9ff" />
            <stop offset="45%" stopColor="#1747FF" />
            <stop offset="100%" stopColor="#0B2A9E" />
          </radialGradient>
          <radialGradient id="somm-sheen" cx="32%" cy="28%" r="70%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.75" />
            <stop offset="35%" stopColor="#ffffff" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#020824" stopOpacity="0.35" />
          </radialGradient>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <Scene
            map={map}
            detail={detail}
            selectedId={selectedId}
            matchIds={matchIds}
            topArtists={topArtists}
            topGenres={topGenres}
            interactive={interactive}
            animate={animate}
            minimal={labels === 'minimal'}
            layers={layers}
          />
        </g>
      </svg>

      {hover && (
        <div className="map-tooltip" style={{ left: Math.min(hover.sx + 14, size.w - 270), top: Math.max(8, hover.sy - 10) }} aria-hidden="true">
          <strong>{hover.node.label}</strong>
          <div className="muted">
            {hover.node.trackCount} track{hover.node.trackCount === 1 ? '' : 's'}
            {hover.node.share ? ` · ${Math.round(hover.node.share * 100)}%` : ''}
          </div>
          {hover.node.detail && <div className="faint">{hover.node.detail}</div>}
        </div>
      )}

      {interactive && showControls && (
        <div className="map-zoom">
          <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => zoomAt(1.3, size.w / 2, size.h / 2)}>
            <Icon name="plus" />
          </button>
          <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.3, size.w / 2, size.h / 2)}>
            <Icon name="minus" />
          </button>
          <button type="button" className="icon-btn" aria-label="Fit the whole map" onClick={() => fit()}>
            <Icon name="fit" />
          </button>
        </div>
      )}
      {legend && <MapLegend map={map} />}
    </div>
  );
}

export function MapLegend({ map }: { map: MusicMapData }) {
  const families = map.nodes.filter((n) => n.kind === 'family').slice(0, 8);
  // Collapsed by default on phones so it does not cover the map.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 760);
  return (
    <div className="map-legend">
      <button type="button" className="link-btn xsmall" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide legend' : 'Legend'}
      </button>
      {open && (
        <ul style={{ marginTop: 6 }}>
          {families.map((f) => (
            <li key={f.id}>
              <span className="dot" style={{ background: f.color, outline: f.uncertain ? '2px dashed var(--orange)' : undefined }} />
              {f.label}
            </li>
          ))}
          <li>
            <span className="legend-line" style={{ borderColor: 'rgba(255,216,61,.7)' }} /> genres heard together
          </li>
          <li>
            <span className="legend-line" style={{ borderColor: 'rgba(143,179,255,.7)', borderTopStyle: 'dashed' }} /> artist spans genres
          </li>
          <li>
            <span className="dot" style={{ background: '#FFD83D' }} /> verified sound attribute
          </li>
          <li>
            <span className="dot" style={{ background: '#FF7A24', outline: '2px dashed #FF7A24', outlineOffset: 1 }} /> inferred attribute
          </li>
          <li className="faint">Node size = number of tracks</li>
        </ul>
      )}
    </div>
  );
}

/** Accessible list alternative to the graph: the same hierarchy as nested disclosure lists. */
export function MapList({ map, onSelect }: { map: MusicMapData; onSelect?: (n: MapNode) => void }) {
  const children = useMemo(() => {
    const m = new Map<string, MapNode[]>();
    for (const n of map.nodes) {
      if (!n.parentId) continue;
      const list = m.get(n.parentId) ?? [];
      list.push(n);
      m.set(n.parentId, list);
    }
    return m;
  }, [map]);
  const attributes = map.nodes.filter((n) => n.kind === 'attribute');

  const renderNode = (n: MapNode, depth: number): ReactNode => {
    const kids = children.get(n.id) ?? [];
    const meta = (
      <>
        <span className="dot" style={{ background: n.color }} aria-hidden="true" />
        <span className="truncate">{n.label}</span>
        <span className="faint xsmall num">
          {n.trackCount} track{n.trackCount === 1 ? '' : 's'}
          {n.share && n.kind !== 'track' ? ` · ${Math.round(n.share * 100)}%` : ''}
        </span>
        {n.uncertain && <span className="badge badge-unknown">uncertain</span>}
        {onSelect && n.kind !== 'track' && (
          <button type="button" className="link-btn xsmall" onClick={(e) => (e.preventDefault(), onSelect(n))}>
            details
          </button>
        )}
      </>
    );
    if (kids.length === 0 && !n.hidden) {
      return (
        <li key={n.id}>
          <div className="leaf">{meta}</div>
        </li>
      );
    }
    return (
      <li key={n.id}>
        <details open={depth < 1}>
          <summary>{meta}</summary>
          <ul>
            {kids.map((k) => renderNode(k, depth + 1))}
            {n.hidden?.map((h) => (
              <li key={h.id}>
                <div className="leaf faint">
                  {h.label} · {h.trackCount}
                </div>
              </li>
            ))}
          </ul>
        </details>
      </li>
    );
  };

  const root = map.nodes.find((n) => n.kind === 'root');
  return (
    <div className="stack">
      <ul className="map-list" aria-label="Music Map as a list">
        {(children.get(root?.id ?? 'root') ?? []).map((n) => renderNode(n, 0))}
      </ul>
      {attributes.length > 0 && (
        <section>
          <h3 className="small">Sound attributes</h3>
          <ul className="map-list">
            {attributes.map((a) => (
              <li key={a.id}>
                <div className="leaf">
                  <span className="dot" style={{ background: a.color }} aria-hidden="true" />
                  {a.label} <span className="faint xsmall">{a.trackCount} tracks</span>
                  <span className={`badge ${a.uncertain ? 'badge-inferred' : 'badge-verified'}`}>{a.uncertain ? 'inferred' : 'verified'}</span>
                  {onSelect && (
                    <button type="button" className="link-btn xsmall" onClick={() => onSelect(a)}>
                      details
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
