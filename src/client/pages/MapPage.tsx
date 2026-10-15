import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { MapNode } from '../../shared/analysis/map';
import { FAMILY_COLORS, type Family } from '../../shared/taxonomy';
import { api, errorMessage } from '../api';
import { Icon } from '../components/Icon';
import { MapLegend, MapList, MusicMap } from '../components/MusicMap';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { prefersReducedMotion, usePersistentState } from '../fx/motion';
import { useApi, useDocumentTitle } from '../hooks';
import { isNativeApp } from '../install';
import { ALL_LAYERS, type Camera, CAMERA_PRESETS, type Layers } from '../map3d/engine';
import { ExportDialog } from '../map3d/ExportDialog';
import { MusicMap3D, type MusicMap3DHandle } from '../map3d/MusicMap3D';
import { Link, useNavigate } from '../router';
import { useAuth, useToast } from '../state';
import type { LibraryPage, MusicMap as MusicMapData, ProfileResponse } from '../types';

type Mode = '3d' | '2d' | 'list';

const isMode = (v: unknown): v is Mode => v === '3d' || v === '2d' || v === 'list';
const isScale = (v: unknown): v is number => typeof v === 'number' && v >= 0.6 && v <= 2.2;
const isDepth = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1.6;
const isLayers = (v: unknown): v is Layers =>
  !!v && typeof v === 'object' && ['songs', 'attributes', 'links'].every((k) => typeof (v as Record<string, unknown>)[k] === 'boolean');

function filterQuery(node: MapNode): string | null {
  const f = node.filter;
  if (!f) return null;
  if (f.trackId) return null;
  if (f.unknownGenre) return 'unknownGenre=1';
  if (f.artistId) return `artist=${encodeURIComponent(f.artistId)}`;
  if (f.genre) return `genre=${encodeURIComponent(f.genre)}`;
  if (f.family) return `family=${encodeURIComponent(f.family)}`;
  if (f.attribute) return `attribute=${encodeURIComponent(f.attribute)}`;
  return null;
}

const KIND_NAME: Record<string, string> = {
  root: 'Your whole library',
  family: 'Genre family',
  genre: 'Genre',
  artist: 'Artist',
  track: 'Track',
  attribute: 'Sound attribute',
  more: 'Collapsed group',
};

function NodePanel({ node, onClose, overlay = false }: { node: MapNode; onClose: () => void; overlay?: boolean }) {
  const q = filterQuery(node);
  const tracks = useApi<LibraryPage>(q ? `/api/library/tracks?${q}&pageSize=25&sort=title` : null);
  return (
    <section className={`panel map-side ${overlay ? 'map-side-overlay' : ''}`} aria-labelledby="node-title">
      <div className="row-between">
        <p className="eyebrow" style={{ margin: 0 }}>
          {KIND_NAME[node.kind]}
        </p>
        <button type="button" className="icon-btn" aria-label="Close details" onClick={onClose} style={{ width: 36, height: 36 }}>
          ×
        </button>
      </div>
      <h2 id="node-title" style={{ overflowWrap: 'anywhere' }}>
        <span className="dot" style={{ background: node.color, width: 14, height: 14, marginRight: 10, verticalAlign: 'middle' }} aria-hidden="true" />
        {node.label}
      </h2>
      <div className="stats">
        <div className="stat">
          <b className="num">{node.trackCount}</b>
          <span>tracks</span>
        </div>
        {node.kind !== 'track' && (
          <div className="stat">
            <b className="num">{Math.round(node.share * 100)}%</b>
            <span>of library</span>
          </div>
        )}
      </div>
      {node.detail && (
        <p className="small" style={{ color: node.uncertain ? 'var(--orange)' : 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
          {node.detail}
        </p>
      )}
      {node.kind === 'attribute' && node.uncertain && (
        <p className="xsmall faint">Inferred attributes are drawn with dashed orange outlines and never count towards matching.</p>
      )}
      {node.hidden && (
        <>
          <h3 className="small">Collapsed to keep the map readable</h3>
          <ul className="small muted" style={{ paddingLeft: 18 }}>
            {node.hidden.slice(0, 40).map((h) => (
              <li key={h.id}>
                {h.label} · {h.trackCount}
              </li>
            ))}
          </ul>
        </>
      )}
      {node.filter?.trackId && (
        <Link to={`/library/tracks/${node.filter.trackId}`} className="btn btn-primary btn-sm">
          Open song details
        </Link>
      )}
      {q && (
        <div className="stack" style={{ marginTop: 'var(--space-4)' }}>
          <h3 className="small" style={{ margin: 0 }}>
            Tracks
          </h3>
          {tracks.loading && <Loading lines={4} />}
          {tracks.error && <ErrorState error={tracks.error} onRetry={tracks.reload} />}
          {tracks.data && (
            <ul className="list-plain" style={{ gap: 4 }}>
              {tracks.data.tracks.map((t) => (
                <li key={t.id}>
                  <Link to={`/library/tracks/${t.id}`} className="list-item" style={{ textDecoration: 'none', color: 'var(--text)', padding: '8px 12px' }}>
                    <span style={{ minWidth: 0 }}>
                      <strong className="clamp-2 small">{t.title}</strong>
                      <span className="xsmall faint truncate" style={{ display: 'block' }}>
                        {t.artist.name}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {tracks.data && tracks.data.total > tracks.data.tracks.length && (
            <Link to={`/library?${q}`} className="small">
              See all {tracks.data.total} in the library →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

function Segmented({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Map view">
      {(
        [
          ['3d', '3D'],
          ['2d', '2D'],
          ['list', 'List'],
        ] as const
      ).map(([m, label]) => (
        <button key={m} type="button" role="radio" aria-checked={value === m} onClick={() => onChange(m)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function MapPage() {
  useDocumentTitle('My Music Map');
  const { me } = useAuth();
  const map = useApi<{ map: MusicMapData | null }>('/api/profile/map');
  const profile = useApi<ProfileResponse>('/api/profile');
  const [selected, setSelected] = useState<MapNode | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = usePersistentState<Mode>('somm:map:mode', '3d', isMode);
  const [labelScale, setLabelScale] = usePersistentState<number>('somm:map:labelScale', 1, isScale);
  const [depth, setDepth] = usePersistentState<number>('somm:map:depth', 1, isDepth);
  const [layers, setLayers] = usePersistentState<Layers>('somm:map:layers', ALL_LAYERS, isLayers);
  const [autoRotate, setAutoRotate] = useState(() => !prefersReducedMotion());
  const [layersOpen, setLayersOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportCamera, setExportCamera] = useState<Camera | null>(null);
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const map3d = useRef<MusicMap3DHandle>(null);
  const toast = useToast();
  const navigate = useNavigate();
  const data = map.data?.map;
  const stats = useMemo(() => data?.stats, [data]);
  const isFull = fullscreen || immersive;

  useEffect(() => {
    const onChange = () => setFullscreen(!!stageRef.current && document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // CSS full-screen fallback (iPhone Safari has no element full-screen): lock page scroll, Escape exits.
  useEffect(() => {
    if (!immersive) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !exporting && setImmersive(false);
    window.addEventListener('keydown', onKey);
    return () => {
      html.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [immersive, exporting]);

  const enterFullscreen = async () => {
    const el = stageRef.current;
    if (!el) return;
    if (!isNativeApp() && typeof el.requestFullscreen === 'function') {
      try {
        await el.requestFullscreen();
        return;
      } catch {
        /* fall back to the CSS version */
      }
    }
    setImmersive(true);
  };

  const exitFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setImmersive(false);
  };

  // The poster starts from the camera as it is when the dialog opens.
  const openExport = () => {
    setExportCamera(mode === '3d' ? (map3d.current?.getCamera() ?? null) : null);
    setExporting(true);
  };

  const posterStats = useMemo(() => {
    const p = profile.data?.profile;
    return {
      tracks: p?.totals.tracks ?? data?.stats.tracks ?? 0,
      artists: p?.totals.artists ?? data?.stats.visibleArtists ?? 0,
      genres: p?.totals.genres ?? 0,
      families: (p?.families ?? []).map((f) => ({ label: f.label, share: f.share, color: FAMILY_COLORS[f.family as Family] ?? FAMILY_COLORS.other })),
    };
  }, [profile.data, data]);

  if (map.loading && !map.data) return <div className="page"><Loading label="Drawing your map…" lines={5} /></div>;
  if (map.error) return <div className="page"><ErrorState error={map.error} onRetry={map.reload} /></div>;
  if (!data || data.stats.tracks === 0) {
    return (
      <div className="page">
        <h1>My Music Map</h1>
        <EmptyState title="Your map is waiting for music" action={<Link to="/import" className="btn btn-primary">Import a playlist</Link>}>
          Your Music Map is generated from the tracks you import. Even ten songs are enough for a first sketch.
        </EmptyState>
      </div>
    );
  }

  const regenerate = async () => {
    setBusy(true);
    try {
      await api.post('/api/profile/regenerate');
      map.reload();
      profile.reload();
      toast('Map regenerated from your current library.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitCompare = (e: FormEvent) => {
    e.preventDefault();
    const h = compare.trim().replace(/^@/, '');
    if (h) navigate(`/compare/${encodeURIComponent(h)}`);
  };

  const pct = Math.round(labelScale * 100);
  const ariaLabel = `Your Music Map with ${stats?.tracks} tracks`;

  return (
    <div className="page page-wide map-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Signature view</p>
          <h1>
            My <span className="holo-text">Music Map</span>
          </h1>
          <p className="muted small" style={{ margin: 0 }}>
            {stats?.tracks} tracks · {stats?.visibleArtists} artists shown{stats && stats.hiddenArtists > 0 ? ` (${stats.hiddenArtists} collapsed)` : ''} ·{' '}
            {profile.data?.pendingEnrichment ? `${profile.data.pendingEnrichment} tracks still being looked up` : 'up to date'}
          </p>
        </div>
        <div className="row">
          <Segmented value={mode} onChange={setMode} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={regenerate} disabled={busy}>
            {busy ? 'Regenerating…' : 'Regenerate'}
          </button>
          <Link to="/mind" className="btn btn-primary btn-sm">
            Read my Music Mind
          </Link>
        </div>
      </div>

      {mode === 'list' ? (
        <div className="split">
          <section className="panel" aria-label="Music Map as a list">
            <MapList map={data} onSelect={setSelected} />
          </section>
          {selected && <NodePanel node={selected} onClose={() => setSelected(null)} />}
        </div>
      ) : (
        <div className={`map-layout ${isFull ? 'is-full' : ''}`}>
          <div ref={stageRef} className={`map-stage ${isFull ? 'is-full' : ''} ${immersive ? 'is-immersive' : ''}`} data-mode={mode}>
            {mode === '3d' ? (
              <MusicMap3D
                ref={map3d}
                map={data}
                ariaLabel={ariaLabel}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
                query={query}
                labelScale={labelScale}
                layers={layers}
                autoRotate={autoRotate && !exporting}
                depth={depth}
                onUserRotate={() => setAutoRotate(false)}
              />
            ) : (
              <MusicMap map={data} ariaLabel={ariaLabel} selectedId={selected?.id ?? null} onSelect={setSelected} query={query} labelScale={labelScale} layers={layers} />
            )}

            <div className="map-hud map-hud-top">
              <label className="sr-only" htmlFor="map-search">
                Find on the map
              </label>
              <input id="map-search" className="input hud-search" type="search" placeholder="Find a genre, artist or song…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <div className="hud-actions">
                <button type="button" className="hud-btn" aria-expanded={layersOpen} aria-controls="map-layers" onClick={() => setLayersOpen((o) => !o)}>
                  <Icon name="list" size={18} /> <span className="hud-label">Layers</span>
                </button>
                <button type="button" className="hud-btn" aria-expanded={legendOpen} aria-controls="map-legend" onClick={() => setLegendOpen((o) => !o)}>
                  <Icon name="note" size={18} /> <span className="hud-label">Legend</span>
                </button>
                {isFull ? (
                  <button type="button" className="hud-btn" onClick={exitFullscreen}>
                    <Icon name="close" size={18} /> <span className="hud-label">Exit full screen</span>
                  </button>
                ) : (
                  <button type="button" className="hud-btn" onClick={() => void enterFullscreen()}>
                    <Icon name="fit" size={18} /> <span className="hud-label">Full screen</span>
                  </button>
                )}
                <button type="button" className="hud-btn hud-btn-primary" onClick={openExport}>
                  <Icon name="download" size={18} /> <span className="hud-label">Save my map</span>
                </button>
              </div>
            </div>

            {layersOpen && (
              <div id="map-layers" className="hud-panel hud-panel-layers" role="group" aria-label="Map layers">
                <label className="check">
                  <input type="checkbox" checked={layers.songs} onChange={(e) => setLayers({ ...layers, songs: e.target.checked })} /> Songs
                </label>
                <label className="check">
                  <input type="checkbox" checked={layers.attributes} onChange={(e) => setLayers({ ...layers, attributes: e.target.checked })} /> Sound attributes
                </label>
                <label className="check">
                  <input type="checkbox" checked={layers.links} onChange={(e) => setLayers({ ...layers, links: e.target.checked })} /> Genre connections
                </label>
              </div>
            )}
            {legendOpen && (
              <div id="map-legend" className="hud-legend">
                <MapLegend map={data} />
              </div>
            )}

            <div className="map-hud map-hud-bottom">
              <label className="hud-range">
                <span>
                  Text <output className="num">{pct}%</output>
                </span>
                <input type="range" min={0.6} max={2.2} step={0.05} value={labelScale} aria-label="Map text size" aria-valuetext={`${pct}%`} onChange={(e) => setLabelScale(Number(e.target.value))} />
              </label>
              {mode === '3d' && (
                <>
                  <label className="hud-range">
                    <span>
                      Depth <output className="num">{Math.round(depth * 100)}%</output>
                    </span>
                    <input type="range" min={0} max={1.6} step={0.05} value={depth} aria-label="3D depth" aria-valuetext={`${Math.round(depth * 100)}%`} onChange={(e) => setDepth(Number(e.target.value))} />
                  </label>
                  <div className="hud-group" role="group" aria-label="Camera">
                    <button type="button" className="hud-btn" aria-pressed={autoRotate} onClick={() => setAutoRotate((a) => !a)}>
                      <Icon name="refresh" size={18} /> <span className="hud-label">{autoRotate ? 'Spinning' : 'Spin'}</span>
                    </button>
                    <button type="button" className="hud-btn" onClick={() => map3d.current?.setCamera({ ...CAMERA_PRESETS.top, depth })}>
                      Top
                    </button>
                    <button type="button" className="hud-btn" onClick={() => map3d.current?.setCamera({ ...CAMERA_PRESETS.tilt, depth })}>
                      Tilt
                    </button>
                    <button type="button" className="hud-btn" onClick={() => map3d.current?.setCamera({ ...CAMERA_PRESETS.side, depth })}>
                      Side
                    </button>
                  </div>
                </>
              )}
            </div>

            {isFull && selected && <NodePanel node={selected} onClose={() => setSelected(null)} overlay />}

            {/* Inside the stage: in full screen only the stage and its children are shown. */}
            {exporting && (
              <ExportDialog
                map={data}
                onClose={() => setExporting(false)}
                camera={exportCamera}
                labelScale={labelScale}
                layers={layers}
                user={me ? { handle: me.user.handle, displayName: me.user.displayName } : null}
                stats={posterStats}
              />
            )}
          </div>

          {!isFull &&
            (selected ? (
              <NodePanel node={selected} onClose={() => setSelected(null)} />
            ) : (
              <aside className="panel map-side stack">
                <h2 style={{ margin: 0 }}>Explore</h2>
                <ul className="small muted" style={{ paddingLeft: 18, margin: 0 }}>
                  {mode === '3d' ? (
                    <>
                      <li>Drag to rotate, scroll or pinch to zoom, right-drag or Shift+drag to pan; two fingers twist it on a phone.</li>
                      <li>Top, Tilt and Side jump to a camera angle; Depth lifts the rings into a dome.</li>
                      <li>Tap a sphere to see its tracks.</li>
                    </>
                  ) : (
                    <>
                      <li>Click or tap a node to see its tracks.</li>
                      <li>Drag to pan, scroll or pinch to zoom. Zoom in to reveal songs.</li>
                      <li>Keyboard: Tab between genre nodes, Enter to select, arrows to pan, + / − to zoom, 0 to fit.</li>
                    </>
                  )}
                  <li>Text sets the label size — handy before you save the map.</li>
                  <li>Save my map makes a poster in the shape you choose, with your @handle under it.</li>
                </ul>
                <button type="button" className="btn btn-primary" onClick={openExport}>
                  <Icon name="download" size={18} /> Save my map
                </button>
                <form onSubmit={submitCompare} className="stack" style={{ gap: 8 }}>
                  <label htmlFor="compare-handle" className="label">
                    Compare with another listener
                  </label>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <input id="compare-handle" className="input" placeholder="@handle" value={compare} onChange={(e) => setCompare(e.target.value)} />
                    <button type="submit" className="btn btn-blue btn-sm">
                      Compare
                    </button>
                  </div>
                </form>
                <Link to="/trees" className="btn btn-ghost">
                  Find my Trees →
                </Link>
              </aside>
            ))}
        </div>
      )}
    </div>
  );
}
