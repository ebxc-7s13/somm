import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../api';
import { ProviderName } from '../components/Badges';
import { familyColor } from '../components/Charts';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { useApi, useDocumentTitle } from '../hooks';
import { Link, useNavigate, useQuery } from '../router';
import { useToast } from '../state';
import type { LibraryPage, Playlist } from '../types';

interface Facets {
  genres: { name: string; label: string; family: string; count: number }[];
  families: { family: string; label: string; count: number }[];
  artists: { id: string; name: string; count: number }[];
  providers: { provider: string; n: number }[];
  coverage: { genre: number; year: number; album: number; duration: number } | null;
  totals: { tracks: number; artists: number; albums: number; genres: number } | null;
  unknownGenreCount: number;
  enrichment: Record<string, number>;
}

function duration(ms: number | null) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function CoverageDots({ c }: { c: LibraryPage['tracks'][number]['coverage'] }) {
  const missing = Object.entries(c)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  return (
    <span className="coverage-dots" role="img" aria-label={missing.length ? `Missing: ${missing.join(', ')}` : 'Genre, year, album and duration known'} title={missing.length ? `Missing: ${missing.join(', ')}` : 'Complete core metadata'}>
      <span data-on={c.genre} />
      <span data-on={c.year} />
      <span data-on={c.album} />
      <span data-on={c.duration} />
    </span>
  );
}

const VIS_TEXT = { private: 'Private', shared: 'Shared for matching', public: 'Public' } as const;

function PlaylistManager({ playlists, reload }: { playlists: Playlist[]; reload: () => void }) {
  const toast = useToast();
  return (
    <details className="disclose">
      <summary>Your playlists ({playlists.length})</summary>
      <ul className="list-plain">
        {playlists.map((p) => (
          <li key={p.id} className="list-item" style={{ flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 180 }}>
              <strong className="clamp-2">{p.name}</strong>
              <span className="xsmall faint">
                <ProviderName id={p.provider} /> · {p.track_count} tracks
                {p.data_expires_at && ` · provider data refreshes by ${new Date(p.data_expires_at).toLocaleDateString()}`}
              </span>
            </span>
            <label className="sr-only" htmlFor={`vis-${p.id}`}>
              Visibility of {p.name}
            </label>
            <select
              id={`vis-${p.id}`}
              className="select"
              style={{ width: 'auto', minHeight: 38 }}
              value={p.visibility}
              onChange={async (e) => {
                try {
                  await api.patch(`/api/playlists/${p.id}`, { visibility: e.target.value });
                  toast(`“${p.name}” is now ${VIS_TEXT[e.target.value as keyof typeof VIS_TEXT].toLowerCase()}.`, 'success');
                  reload();
                } catch (err) {
                  toast(errorMessage(err), 'error');
                }
              }}
            >
              {Object.entries(VIS_TEXT).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={async () => {
                if (!window.confirm(`Delete “${p.name}” and its ${p.track_count} entries from SOMM? This cannot be undone.`)) return;
                try {
                  await api.del(`/api/playlists/${p.id}`);
                  toast('Playlist deleted.', 'success');
                  reload();
                } catch (err) {
                  toast(errorMessage(err), 'error');
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function LibraryPage() {
  useDocumentTitle('Library');
  const query = useQuery();
  const navigate = useNavigate();
  const [q, setQ] = useState(query.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const filters = {
    genre: query.get('genre') ?? '',
    family: query.get('family') ?? '',
    artist: query.get('artist') ?? '',
    source: query.get('source') ?? '',
    playlist: query.get('playlist') ?? '',
    attribute: query.get('attribute') ?? '',
    unknownGenre: query.get('unknownGenre') ?? '',
    sort: query.get('sort') ?? 'added',
    dir: query.get('dir') ?? '',
    page: query.get('page') ?? '1',
  };
  const setFilter = (patch: Partial<typeof filters>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...patch, ...(patch.page ? {} : { page: '1' }) })) if (v && !(k === 'page' && v === '1')) next.set(k, v);
    if (debounced) next.set('q', debounced);
    navigate(`/library${next.toString() ? `?${next}` : ''}`, { replace: true });
  };

  const apiQuery = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    if (debounced) p.set('q', debounced);
    p.set('pageSize', '50');
    return p.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, debounced]);

  const page = useApi<LibraryPage>(`/api/library/tracks?${apiQuery}`);
  const facets = useApi<Facets>('/api/library/facets');
  const playlists = useApi<{ playlists: Playlist[] }>('/api/playlists');

  const totalPages = page.data ? Math.max(1, Math.ceil(page.data.total / page.data.pageSize)) : 1;
  const activeFilters = Object.entries(filters).filter(([k, v]) => v && !['sort', 'dir', 'page'].includes(k));

  if (facets.data && facets.data.totals?.tracks === 0 && !playlists.data?.playlists.length) {
    return (
      <div className="page">
        <h1>Library</h1>
        <EmptyState title="Your library is empty" action={<Link to="/import" className="btn btn-primary">Import a playlist</Link>}>
          Import a playlist file, paste a list of songs or connect a supported service. Your Music Map is generated from what you bring.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <p className="eyebrow">Complete song library</p>
          <h1>Library</h1>
          {facets.data?.totals && (
            <p className="muted small">
              {facets.data.totals.tracks} tracks · {facets.data.totals.artists} artists · genre known for {Math.round((facets.data.coverage?.genre ?? 0) * 100)}% ·
              year for {Math.round((facets.data.coverage?.year ?? 0) * 100)}%
            </p>
          )}
        </div>
        <Link to="/import" className="btn btn-primary">
          Import more
        </Link>
      </div>

      <div className="stack">
        {playlists.data && playlists.data.playlists.length > 0 && <PlaylistManager playlists={playlists.data.playlists} reload={() => (playlists.reload(), facets.reload(), page.reload())} />}

        <div className="panel panel-tight">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', alignItems: 'end' }}>
            <div className="field" style={{ margin: 0, gridColumn: 'span 2' }}>
              <label htmlFor="lib-q">Search songs, artists, albums or genres</label>
              <input id="lib-q" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="f-family">Genre family</label>
              <select id="f-family" className="select" value={filters.family} onChange={(e) => setFilter({ family: e.target.value })}>
                <option value="">All</option>
                {facets.data?.families.map((f) => (
                  <option key={f.family} value={f.family}>
                    {f.label} ({f.count})
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="f-genre">Genre</label>
              <select id="f-genre" className="select" value={filters.genre} onChange={(e) => setFilter({ genre: e.target.value })}>
                <option value="">All</option>
                {facets.data?.genres.map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.label} ({g.count})
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="f-artist">Artist</label>
              <select id="f-artist" className="select" value={filters.artist} onChange={(e) => setFilter({ artist: e.target.value })}>
                <option value="">All</option>
                {facets.data?.artists.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.count})
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="f-source">Source</label>
              <select id="f-source" className="select" value={filters.source} onChange={(e) => setFilter({ source: e.target.value })}>
                <option value="">All</option>
                {facets.data?.providers.map((p) => (
                  <option key={p.provider} value={p.provider}>
                    {p.provider} ({p.n})
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="f-sort">Sort by</label>
              <select id="f-sort" className="select" value={`${filters.sort}:${filters.dir}`} onChange={(e) => {
                const [sort, dir] = e.target.value.split(':');
                setFilter({ sort, dir });
              }}>
                <option value="added:">Recently added</option>
                <option value="title:asc">Title A–Z</option>
                <option value="artist:asc">Artist A–Z</option>
                <option value="year:desc">Newest first</option>
                <option value="year:asc">Oldest first</option>
                <option value="source:asc">Source</option>
              </select>
            </div>
          </div>
          <div className="row" style={{ marginTop: 'var(--space-3)' }}>
            <label className="row small" style={{ gap: 8 }}>
              <input type="checkbox" checked={!!filters.unknownGenre} onChange={(e) => setFilter({ unknownGenre: e.target.checked ? '1' : '' })} style={{ accentColor: 'var(--yellow)', width: 18, height: 18 }} />
              Only tracks with unknown genre ({facets.data?.unknownGenreCount ?? 0})
            </label>
            {activeFilters.length > 0 && (
              <button type="button" className="link-btn small" onClick={() => (setQ(''), navigate('/library', { replace: true }))}>
                Clear filters
              </button>
            )}
          </div>
        </div>

        <section className="panel" aria-label="Tracks" aria-busy={page.loading}>
          {page.error && <ErrorState error={page.error} onRetry={page.reload} />}
          {!page.error && page.loading && !page.data && <Loading lines={6} />}
          {page.data && page.data.tracks.length === 0 && <EmptyState title="No tracks match">Try a different search or clear the filters.</EmptyState>}
          {page.data && page.data.tracks.length > 0 && (
            <>
              <div className="track-row track-head" aria-hidden="true">
                <span>Title</span>
                <span>Artist</span>
                <span className="col-album">Album</span>
                <span>Year</span>
                <span className="col-coverage">Metadata</span>
              </div>
              <ul className="track-list">
                {page.data.tracks.map((t) => (
                  <li key={t.id}>
                    <Link to={`/library/tracks/${t.id}`} className="track-row">
                      <span className="col-title" style={{ minWidth: 0 }}>
                        <span className="title clamp-2" title={t.title}>
                          {t.title}
                          {t.version && <span className="badge badge-user" style={{ marginLeft: 6 }}>{t.version}</span>}
                        </span>
                        <span className="chips col-genre" style={{ marginTop: 4 }}>
                          {t.genres.slice(0, 3).map((g) => (
                            <span key={g.name} className="chip">
                              <span className="dot" style={{ background: familyColor(g.family), width: 7, height: 7 }} aria-hidden="true" />
                              {g.label}
                            </span>
                          ))}
                          {t.genres.length === 0 && <span className="chip faint">genre unknown</span>}
                        </span>
                      </span>
                      <span className="col-artist truncate" title={[t.artist.name, ...t.featured].join(', ')}>
                        {t.artist.name}
                        {t.featured.length > 0 && <span className="faint"> feat. {t.featured.join(', ')}</span>}
                      </span>
                      <span className="col-album truncate muted" title={t.album?.title ?? ''}>
                        {t.album?.title ?? '—'}
                      </span>
                      <span className="col-year num muted">{t.year ?? '—'}</span>
                      <span className="col-coverage row" style={{ gap: 8 }}>
                        <CoverageDots c={t.coverage} />
                        <span className="xsmall faint num">{duration(t.durationMs)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <nav className="pagination" aria-label="Pages">
                <button type="button" className="btn btn-ghost btn-sm" disabled={Number(filters.page) <= 1} onClick={() => setFilter({ page: String(Number(filters.page) - 1) })}>
                  Previous
                </button>
                <span className="small muted num">
                  Page {filters.page} of {totalPages} · {page.data.total} tracks
                </span>
                <button type="button" className="btn btn-ghost btn-sm" disabled={Number(filters.page) >= totalPages} onClick={() => setFilter({ page: String(Number(filters.page) + 1) })}>
                  Next
                </button>
              </nav>
              <p className="xsmall faint">Metadata dots: genre · year · album · duration (filled = known).</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
