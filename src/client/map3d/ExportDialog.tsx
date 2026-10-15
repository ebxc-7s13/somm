/**
 * "Save my map" dialog: pick an orientation, a view, a theme and the text size,
 * preview the poster, then download (or share / save in the app).
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { MusicMap } from '../../shared/analysis/map';
import { Icon } from '../components/Icon';
import { isNativeApp } from '../install';
import { THEMES, type ThemeId } from './draw';
import { type Camera, CAMERA_PRESETS, FLAT_CAMERA, type Layers, prepareScene } from './engine';
import { drawPoster, ensurePosterFonts, ORIENTATIONS, type Orientation, type PosterStats, posterFileName } from './poster';
import { canShareFiles, savePoster } from './save';

export interface ExportDialogProps {
  map: MusicMap;
  onClose: () => void;
  /** Current 3D camera, or null when the map is shown in 2D. */
  camera: Camera | null;
  labelScale: number;
  layers: Layers;
  user: { handle: string; displayName: string } | null;
  stats: PosterStats;
}

type View = 'flat' | 'current' | 'tilt';

const SHAPES: Record<Orientation, { w: number; h: number }> = {
  portrait: { w: 16, h: 20 },
  story: { w: 12, h: 22 },
  square: { w: 18, h: 18 },
  landscape: { w: 24, h: 14 },
};

export function ExportDialog({ map, onClose, camera, labelScale: initialScale, layers: initialLayers, user, stats }: ExportDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const scene = useMemo(() => prepareScene(map), [map]);
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [view, setView] = useState<View>(camera ? 'current' : 'flat');
  const [theme, setTheme] = useState<ThemeId>('midnight');
  const [labelScale, setLabelScale] = useState(initialScale);
  const [zoom, setZoom] = useState(1);
  const [layers, setLayers] = useState<Layers>(initialLayers);
  const [grid, setGrid] = useState(true);
  const [quality, setQuality] = useState<1 | 2>(1);
  const [fontsReady, setFontsReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const native = isNativeApp();
  const shareable = !native && canShareFiles();

  const cameraFor = (v: View): Camera => (v === 'current' && camera ? camera : v === 'tilt' ? CAMERA_PRESETS.tilt : FLAT_CAMERA);

  const options = {
    orientation,
    quality,
    theme,
    camera: cameraFor(view),
    zoom,
    labelScale,
    layers,
    showGrid: grid,
    user,
    stats,
    date: new Date(),
    site: window.location.host || 'soundofmymind.onrender.com',
  };

  useEffect(() => {
    let alive = true;
    void ensurePosterFonts().then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // Redraw the preview (debounced) when an option changes.
  useEffect(() => {
    if (!fontsReady) return;
    const t = window.setTimeout(() => {
      if (previewRef.current) drawPoster(previewRef.current, scene, { ...options, quality: 1 });
    }, 90);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options is rebuilt each render from these values
  }, [fontsReady, scene, orientation, view, theme, labelScale, zoom, layers, grid]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button, input')?.focus();
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]') ?? [])];
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const save = async (share: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      await ensurePosterFonts();
      const canvas = document.createElement('canvas');
      if (!drawPoster(canvas, scene, options)) throw new Error('This browser cannot draw images.');
      const result = await savePoster(canvas, posterFileName(user?.handle, orientation), share);
      if (result === 'downloaded') setMessage({ kind: 'ok', text: 'Saved — check your downloads.' });
      else if (result === 'shared') setMessage({ kind: 'ok', text: native ? 'Done — choose “Save to device” or an app to keep it.' : 'Shared.' });
    } catch (err) {
      setMessage({
        kind: 'error',
        text: native
          ? 'Saving needs the latest SOMM app. Install the newest version from the GitHub releases page, or open SOMM in your browser to download the image.'
          : err instanceof Error
            ? err.message
            : 'Could not save the image.',
      });
    } finally {
      setBusy(false);
    }
  };

  const size = ORIENTATIONS[orientation];
  const pct = Math.round(labelScale * 100);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} className="modal export-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <div className="row-between">
          <div>
            <p className="eyebrow" style={{ margin: 0 }}>
              Sound of My Mind
            </p>
            <h2 id={titleId} style={{ margin: 0 }}>
              Save my map
            </h2>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>

        <div className="export-grid">
          <div className="export-preview" style={{ aspectRatio: `${size.w} / ${size.h}`, '--ar': (size.w / size.h).toFixed(4) } as CSSProperties}>
            <canvas ref={previewRef} aria-label={`Preview of your ${size.label.toLowerCase()} map poster`} role="img" />
            {!fontsReady && <span className="spinner" aria-hidden="true" />}
          </div>

          <div className="export-controls stack">
            <fieldset className="seg-field">
              <legend className="label">Orientation</legend>
              <div className="orient-grid">
                {(Object.keys(ORIENTATIONS) as Orientation[]).map((o) => (
                  <label key={o} className="orient-card" data-checked={orientation === o}>
                    <input type="radio" name="orientation" value={o} checked={orientation === o} onChange={() => setOrientation(o)} />
                    <span className="orient-shape" style={{ width: SHAPES[o].w * 1.6, height: SHAPES[o].h * 1.6 }} aria-hidden="true" />
                    <strong>{ORIENTATIONS[o].label}</strong>
                    <span className="xsmall faint">{ORIENTATIONS[o].hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="seg-field">
              <legend className="label">View</legend>
              <div className="segmented" role="radiogroup" aria-label="View">
                {(
                  [
                    ['flat', 'Flat'],
                    ['tilt', '3D tilt'],
                    ...(camera ? ([['current', 'As I see it']] as const) : []),
                  ] as [View, string][]
                ).map(([v, label]) => (
                  <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}>
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="seg-field">
              <legend className="label">Theme</legend>
              <div className="segmented" role="radiogroup" aria-label="Theme">
                {(Object.keys(THEMES) as ThemeId[]).map((id) => (
                  <button key={id} type="button" role="radio" aria-checked={theme === id} onClick={() => setTheme(id)}>
                    <span className={`swatch swatch-${id}`} aria-hidden="true" /> {THEMES[id].label}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="range-field">
              <span className="label">
                Text size <output className="num faint">{pct}%</output>
              </span>
              <input
                type="range"
                min={0.6}
                max={2.2}
                step={0.05}
                value={labelScale}
                aria-label="Poster text size"
                aria-valuetext={`${pct}%`}
                onChange={(e) => setLabelScale(Number(e.target.value))}
              />
            </label>

            <label className="range-field">
              <span className="label">
                Map size <output className="num faint">{Math.round(zoom * 100)}%</output>
              </span>
              <input
                type="range"
                min={0.7}
                max={1.8}
                step={0.05}
                value={zoom}
                aria-label="Poster map size"
                aria-valuetext={`${Math.round(zoom * 100)}%${zoom > 1 ? ', the edges are cropped' : ''}`}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
            </label>

            <div className="check-row">
              <label className="check">
                <input type="checkbox" checked={layers.songs} onChange={(e) => setLayers({ ...layers, songs: e.target.checked })} /> Songs
              </label>
              <label className="check">
                <input type="checkbox" checked={layers.attributes} onChange={(e) => setLayers({ ...layers, attributes: e.target.checked })} /> Sound attributes
              </label>
              <label className="check">
                <input type="checkbox" checked={layers.links} onChange={(e) => setLayers({ ...layers, links: e.target.checked })} /> Connections
              </label>
              <label className="check">
                <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Grid
              </label>
              <label className="check">
                <input type="checkbox" checked={quality === 2} onChange={(e) => setQuality(e.target.checked ? 2 : 1)} /> Extra sharp (2×)
              </label>
            </div>

            <p className="small muted" style={{ margin: 0 }}>
              Below the map: the SOMM logo and {user ? <strong>@{user.handle}</strong> : 'your handle'}, with your top genres and the date.
            </p>

            <div className="row">
              <button type="button" className="btn btn-primary" disabled={busy || !fontsReady} onClick={() => void save(false)}>
                <Icon name="download" size={18} /> {busy ? 'Preparing…' : native ? 'Save or share image' : 'Download PNG'}
              </button>
              {shareable && (
                <button type="button" className="btn btn-ghost" disabled={busy || !fontsReady} onClick={() => void save(true)}>
                  Share
                </button>
              )}
            </div>
            {message && (
              <p className={message.kind === 'error' ? 'error-text' : 'small'} role={message.kind === 'error' ? 'alert' : 'status'} style={{ margin: 0 }}>
                {message.text}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
