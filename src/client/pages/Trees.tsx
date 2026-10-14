import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { DemoBadge } from '../components/Badges';
import { MatchBreakdown, matchLabel, ScoreRing } from '../components/Charts';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { TreeGlyph } from '../components/TreeGlyph';
import { useApi, useDocumentTitle } from '../hooks';
import { Link, useNavigate } from '../router';
import { useAuth, useToast } from '../state';
import type { TreeRecommendation, TreeSummary } from '../types';

function RecommendationCard({ rec, onJoined }: { rec: TreeRecommendation; onJoined: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const c = rec.community;
  return (
    <article className="rec-card" data-label={rec.match.label} aria-labelledby={`rec-${c.id}`}>
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <ScoreRing score={rec.match.score} label={rec.match.label} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 8 }}>
            <h3 id={`rec-${c.id}`} style={{ margin: 0 }}>
              <Link to={`/trees/${c.slug}`}>{c.name}</Link>
            </h3>
            {c.isDemo && <DemoBadge what="Demo Tree" />}
            {c.status === 'proposed' && <span className="badge badge-orange">Forming</span>}
          </div>
          <p className="small muted" style={{ margin: '4px 0' }}>
            {matchLabel(rec.match.label)} · {c.memberCount} member{c.memberCount === 1 ? '' : 's'}
          </p>
          <p style={{ margin: 0 }}>{rec.explanation.summary}</p>
        </div>
      </div>
      <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
        {rec.explanation.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <MatchBreakdown match={rec.match} />
      <div className="row">
        {rec.isMember ? (
          <Link to={`/trees/${c.slug}/chat`} className="btn btn-blue btn-sm">
            Open chat
          </Link>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            aria-label={`Join ${c.name}`}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post(`/api/trees/${c.slug}/join`);
                toast(`You joined ${c.name}.`, 'success');
                onJoined();
              } catch (err) {
                toast(errorMessage(err), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Join this Tree
          </button>
        )}
        <Link to={`/trees/${c.slug}`} className="btn btn-ghost btn-sm" aria-label={`Explore ${c.name}`}>
          Explore
        </Link>
      </div>
    </article>
  );
}

export function TreeCard({ tree }: { tree: TreeSummary }) {
  return (
    <Link to={`/trees/${tree.slug}`} className="tree-card">
      <TreeGlyph seed={tree.glyphSeed} families={tree.families} size={64} />
      <div style={{ minWidth: 0 }}>
        <h3 className="clamp-2">{tree.name}</h3>
        <p className="xsmall muted" style={{ margin: 0 }}>
          {tree.memberCount} member{tree.memberCount === 1 ? '' : 's'} {tree.isMember && '· joined'}
        </p>
        <div className="chips" style={{ marginTop: 6 }}>
          {tree.topGenres.slice(0, 3).map((g) => (
            <span key={g} className="chip">
              {g}
            </span>
          ))}
          {tree.isDemo && <DemoBadge what="Demo" />}
        </div>
      </div>
    </Link>
  );
}

function StartTree() {
  const elig = useApi<{ eligible: boolean; compatibleCount: number; needed: number; threshold: number; reason: string }>('/api/trees/eligibility');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.post<{ tree: TreeSummary }>('/api/trees', { name, description });
      navigate(`/trees/${r.tree.slug}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <section className="panel" aria-labelledby="start">
      <h2 id="start">Start a Tree</h2>
      {elig.loading && <Loading lines={2} />}
      {elig.data && (
        <>
          <p className="small muted">{elig.data.reason}</p>
          {elig.data.eligible ? (
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="tree-name">Name</label>
                <input id="tree-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required minLength={3} />
              </div>
              <div className="field">
                <label htmlFor="tree-desc">Description</label>
                <textarea id="tree-desc" className="textarea" style={{ minHeight: 80 }} maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              {error && <p className="error-text" role="alert">{error}</p>}
              <button type="submit" className="btn btn-primary">
                Create Tree
              </button>
            </form>
          ) : (
            <p className="xsmall faint">SOMM prefers existing Trees until a new one has genuine support, so the map does not fill with empty communities.</p>
          )}
        </>
      )}
    </section>
  );
}

function SimilarListeners() {
  const { refresh } = useAuth();
  const list = useApi<{ listeners: { handle: string; displayName: string; isDemo: boolean; profileVisible: boolean; match: { score: number; label: string }; explanation: string }[]; requiresDiscoverable: boolean; reason?: string }>('/api/discover/listeners');
  return (
    <section className="panel" aria-labelledby="similar">
      <h2 id="similar">Similar listeners</h2>
      {list.loading && <Loading lines={2} />}
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.data?.requiresDiscoverable && (
        <>
          <p className="small muted">{list.data.reason}</p>
          <button
            type="button"
            className="btn btn-blue btn-sm"
            onClick={async () => {
              await api.patch('/api/me', { discoverable: true });
              await refresh();
              list.reload();
            }}
          >
            Make me discoverable
          </button>
          <p className="xsmall faint" style={{ marginTop: 8 }}>
            Only playlists you mark “shared” or “public” are used. You can switch this off at any time in Privacy.
          </p>
        </>
      )}
      {list.data && !list.data.requiresDiscoverable && list.data.listeners.length === 0 && <p className="small muted">No compatible discoverable listeners yet.</p>}
      <ul className="list-plain">
        {list.data?.listeners.slice(0, 8).map((l) => (
          <li key={l.handle} className="list-item">
            <ScoreRing score={l.match.score} label={l.match.label} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong>{l.displayName}</strong> <span className="faint small">@{l.handle}</span> {l.isDemo && <DemoBadge />}
              <span className="xsmall muted clamp-2">{l.explanation}</span>
            </span>
            <Link to={`/compare/${l.handle}`} className="btn btn-ghost btn-sm">
              Compare
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DiscoverSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ trees: TreeSummary[]; listeners: { handle: string; displayName: string; isDemo: boolean }[]; library: { id: string; title: string; artist: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        setResults(await api.get(`/api/discover?q=${encodeURIComponent(q)}`));
        setError(null);
      } catch (err) {
        setError(errorMessage(err));
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <section className="panel" aria-labelledby="disc">
      <h2 id="disc">Search</h2>
      <label htmlFor="disc-q" className="sr-only">
        Search Trees, listeners and your library by song, artist or genre
      </label>
      <input id="disc-q" className="input" type="search" placeholder="Song, artist, genre or Tree…" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <p className="error-text">{error}</p>}
      {results && (
        <div className="stack" style={{ marginTop: 'var(--space-4)' }}>
          <div>
            <h3 className="small">Trees</h3>
            {results.trees.length ? <div className="grid">{results.trees.map((t) => <TreeCard key={t.id} tree={t} />)}</div> : <p className="small faint">No Trees match.</p>}
          </div>
          <div>
            <h3 className="small">Public listeners</h3>
            {results.listeners.length ? (
              <ul className="list-plain">
                {results.listeners.map((l) => (
                  <li key={l.handle}>
                    <Link to={`/u/${l.handle}`}>{l.displayName}</Link> <span className="faint small">@{l.handle}</span> {l.isDemo && <DemoBadge />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small faint">No public profiles match.</p>
            )}
          </div>
          <div>
            <h3 className="small">In your library</h3>
            {results.library.length ? (
              <ul className="list-plain">
                {results.library.map((t) => (
                  <li key={t.id}>
                    <Link to={`/library/tracks/${t.id}`}>{t.title}</Link> <span className="faint small">— {t.artist}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small faint">No matching tracks.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function TreesPage() {
  useDocumentTitle('Discover Trees');
  const recs = useApi<{ recommendations: TreeRecommendation[] }>('/api/trees/recommended');
  const all = useApi<{ trees: TreeSummary[] }>('/api/trees');
  const reloadAll = () => (recs.reload(), all.reload());

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <p className="eyebrow">A Social Mind for Audiophiles</p>
          <h1>Discover Trees</h1>
          <p className="lead" style={{ margin: 0 }}>
            Communities formed from overlapping libraries. Every score shows how it was calculated.
          </p>
        </div>
      </div>
      <div className="split">
        <section aria-labelledby="recs" className="stack">
          <h2 id="recs">Recommended for you</h2>
          {recs.loading && !recs.data && <Loading lines={5} />}
          {recs.error && <ErrorState error={recs.error} onRetry={recs.reload} />}
          {recs.data && recs.data.recommendations.length === 0 && (
            <EmptyState title="No Trees to recommend yet" action={<Link to="/import" className="btn btn-primary">Import music</Link>}>
              Recommendations need an imported library and at least one Tree. As more listeners arrive, SOMM proposes Trees from genuinely compatible
              groups.
            </EmptyState>
          )}
          {recs.data?.recommendations.map((r) => (
            <RecommendationCard key={r.community.id} rec={r} onJoined={reloadAll} />
          ))}
        </section>
        <div className="stack">
          <DiscoverSearch />
          <SimilarListeners />
          <StartTree />
        </div>
      </div>
      <section aria-labelledby="all" style={{ marginTop: 'var(--space-7)' }}>
        <h2 id="all">All Trees</h2>
        {all.loading && !all.data && <Loading />}
        {all.error && <ErrorState error={all.error} onRetry={all.reload} />}
        {all.data && all.data.trees.length === 0 && <p className="muted">No public Trees yet.</p>}
        <div className="grid">{all.data?.trees.map((t) => <TreeCard key={t.id} tree={t} />)}</div>
      </section>
    </div>
  );
}
