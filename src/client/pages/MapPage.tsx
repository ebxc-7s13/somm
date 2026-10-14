import { useMemo, useState, type FormEvent } from 'react';
import type { MapNode } from '../../shared/analysis/map';
import { api, errorMessage } from '../api';
import { MapList, MusicMap } from '../components/MusicMap';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { useApi, useDocumentTitle } from '../hooks';
import { Link, useNavigate } from '../router';
import { useToast } from '../state';
import type { LibraryPage, MusicMap as MusicMapData, ProfileResponse } from '../types';

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

function NodePanel({ node, onClose }: { node: MapNode; onClose: () => void }) {
  const q = filterQuery(node);
  const tracks = useApi<LibraryPage>(q ? `/api/library/tracks?${q}&pageSize=25&sort=title` : null);
  return (
    <section className="panel map-side" aria-labelledby="node-title">
      <div className="row-between">
        <p className="eyebrow" style={{ margin: 0 }}>
          {KIND_NAME[node.kind]}
        </p>
        <button type="button" className="icon-btn" aria-label="Close details" onClick={onClose} style={{ width: 36, height: 36 }}>
          ×
        </button>
      </div>
      <h2 id="node-title" style={{ overflowWrap: 'anywhere' }}>
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

export function MapPage() {
  useDocumentTitle('My Music Map');
  const map = useApi<{ map: MusicMapData | null }>('/api/profile/map');
  const profile = useApi<ProfileResponse>('/api/profile');
  const [selected, setSelected] = useState<MapNode | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'map' | 'list'>('map');
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState('');
  const toast = useToast();
  const navigate = useNavigate();
  const data = map.data?.map;
  const stats = useMemo(() => data?.stats, [data]);

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

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <p className="eyebrow">Signature view</p>
          <h1>My Music Map</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {stats?.tracks} tracks · {stats?.visibleArtists} artists shown{stats && stats.hiddenArtists > 0 ? ` (${stats.hiddenArtists} collapsed)` : ''} ·{' '}
            {profile.data?.pendingEnrichment ? `${profile.data.pendingEnrichment} tracks still being looked up` : 'up to date'}
          </p>
        </div>
        <div className="row">
          <div className="tabs" role="tablist" aria-label="View" style={{ margin: 0, border: 0 }}>
            <button type="button" role="tab" aria-selected={view === 'map'} onClick={() => setView('map')}>
              Map
            </button>
            <button type="button" role="tab" aria-selected={view === 'list'} onClick={() => setView('list')}>
              List
            </button>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={regenerate} disabled={busy}>
            {busy ? 'Regenerating…' : 'Regenerate'}
          </button>
          <Link to="/mind" className="btn btn-primary btn-sm">
            Read my Music Mind
          </Link>
        </div>
      </div>

      {view === 'map' ? (
        <div className="map-layout">
          <div style={{ position: 'relative' }}>
            <MusicMap map={data} ariaLabel={`Your Music Map with ${stats?.tracks} tracks`} selectedId={selected?.id ?? null} onSelect={setSelected} query={query} legend />
            <div className="map-toolbar">
              <label className="sr-only" htmlFor="map-search">
                Find on the map
              </label>
              <input id="map-search" className="input" type="search" placeholder="Find a genre, artist or song…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          {selected ? (
            <NodePanel node={selected} onClose={() => setSelected(null)} />
          ) : (
            <aside className="panel map-side stack">
              <h2 style={{ margin: 0 }}>Explore</h2>
              <ul className="small muted" style={{ paddingLeft: 18, margin: 0 }}>
                <li>Click or tap a node to see its tracks.</li>
                <li>Drag to pan, scroll or pinch to zoom. Zoom in to reveal songs.</li>
                <li>Keyboard: Tab between genre nodes, Enter to select, arrows to pan, + / − to zoom, 0 to fit.</li>
                <li>Dashed outlines mark uncertain or inferred information.</li>
              </ul>
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
              <Link to="/trees" className="btn btn-primary">
                Find my Trees →
              </Link>
            </aside>
          )}
        </div>
      ) : (
        <div className="split">
          <section className="panel" aria-label="Music Map as a list">
            <MapList map={data} onSelect={setSelected} />
          </section>
          {selected && <NodePanel node={selected} onClose={() => setSelected(null)} />}
        </div>
      )}
    </div>
  );
}
