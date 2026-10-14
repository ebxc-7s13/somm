import { genreDisplayName } from '../../shared/taxonomy';
import type { Insight } from '../../shared/types';
import { Confidence } from '../components/Badges';
import { Bars, familyColor } from '../components/Charts';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { useApi, useDocumentTitle } from '../hooks';
import { Link } from '../router';
import type { ProfileResponse } from '../types';

const BASIS_TEXT: Record<Insight['basis'], { label: string; cls: string }> = {
  metadata: { label: 'From your metadata', cls: 'badge-verified' },
  inferred: { label: 'Inferred', cls: 'badge-inferred' },
  coverage: { label: 'About the data', cls: 'badge-community' },
};

function InsightCard({ insight }: { insight: Insight }) {
  const b = BASIS_TEXT[insight.basis];
  return (
    <li className="panel" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <div className="row-between">
        <span className={`badge ${b.cls}`}>{b.label}</span>
        <Confidence level={insight.confidence} />
      </div>
      <p style={{ font: '600 var(--fs-lg)/1.4 var(--font-display)', margin: 0 }}>{insight.text}</p>
      {insight.evidence.length > 0 && (
        <details className="disclose small">
          <summary>Evidence</summary>
          <dl className="kv">
            {insight.evidence.map((e, i) => (
              <div key={i} style={{ display: 'contents' }}>
                <dt>{e.label}</dt>
                <dd className="num">{e.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </li>
  );
}

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

export function MindPage() {
  useDocumentTitle('Your Music Mind');
  const { data, error, loading, reload } = useApi<ProfileResponse>('/api/profile');
  if (loading && !data) return <div className="page"><Loading lines={6} /></div>;
  if (error) return <div className="page"><ErrorState error={error} onRetry={reload} /></div>;
  const p = data?.profile;
  if (!p || p.totals.tracks === 0) {
    return (
      <div className="page">
        <h1>Your Music Mind</h1>
        <EmptyState title="Nothing to analyse yet" action={<Link to="/import" className="btn btn-primary">Import a playlist</Link>}>
          Import some music and SOMM will describe your listening profile — with the evidence for every statement.
        </EmptyState>
      </div>
    );
  }

  const main = data!.insights.filter((i) => i.basis !== 'coverage');
  const caveats = data!.insights.filter((i) => i.basis === 'coverage');
  const decadesMax = Math.max(1, ...p.decades.map((d) => d.trackCount));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">You are what you consume</p>
          <h1>Your Music Mind</h1>
          <p className="lead" style={{ margin: 0 }}>
            What your imported tracks say about your musical taste — computed from metadata, not guessed.
          </p>
        </div>
        <Link to="/trees" className="btn btn-primary">
          Discover matching Trees
        </Link>
      </div>

      <div className="panel" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="stats">
          <div className="stat"><b className="num">{p.totals.tracks}</b><span>tracks</span></div>
          <div className="stat"><b className="num">{p.totals.artists}</b><span>artists</span></div>
          <div className="stat"><b className="num">{p.totals.genres}</b><span>genres</span></div>
          <div className="stat"><b className="num">{p.totals.families}</b><span>families</span></div>
          <div className="stat"><b className="num">{pct(p.coverage.genre)}</b><span>genre coverage</span></div>
          <div className="stat"><b className="num">{pct(p.coverage.year)}</b><span>year coverage</span></div>
        </div>
        {data!.pendingEnrichment > 0 && (
          <p className="small" style={{ color: 'var(--orange)', marginTop: 'var(--space-3)', marginBottom: 0 }}>
            {data!.pendingEnrichment} tracks are still being looked up; this report will update automatically.
          </p>
        )}
      </div>

      <div className="split">
        <section aria-labelledby="obs">
          <h2 id="obs">Observations</h2>
          <ul className="list-plain" style={{ gap: 'var(--space-4)' }}>
            {main.map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
            {main.length === 0 && <li className="muted">Not enough metadata yet for confident observations.</li>}
          </ul>
          {caveats.length > 0 && (
            <>
              <h2 style={{ marginTop: 'var(--space-6)' }}>Uncertainty & gaps</h2>
              <ul className="list-plain" style={{ gap: 'var(--space-3)' }}>
                {caveats.map((i) => (
                  <InsightCard key={i.id} insight={i} />
                ))}
              </ul>
            </>
          )}
          <div className="panel panel-pale" style={{ marginTop: 'var(--space-5)' }}>
            <strong>Musical taste, not personality.</strong>
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              SOMM describes patterns in your music metadata only. It makes no claims about intelligence, mental health, politics, morality or any
              other personal trait, and statements based on inference are labelled as such.
            </p>
          </div>
        </section>

        <div className="stack">
          <section className="panel" aria-labelledby="fam">
            <h3 id="fam">Genre families</h3>
            <Bars
              label="Share of tracks with known genres per family"
              items={p.families.slice(0, 10).map((f) => ({ key: f.family, label: f.label, value: f.share, display: pct(f.share), color: familyColor(f.family) }))}
              max={1}
            />
          </section>
          <section className="panel" aria-labelledby="gen">
            <h3 id="gen">Top genres</h3>
            <Bars
              label="Top genres by track count"
              items={p.genres.slice(0, 10).map((g) => ({ key: g.name, label: genreDisplayName(g.name), value: g.trackCount, display: `${g.trackCount}`, color: familyColor(g.family) }))}
            />
            <p className="xsmall faint" style={{ marginTop: 8 }}>
              Sources: {[...new Set(p.genres.flatMap((g) => g.sources))].join(', ') || 'none'}
            </p>
          </section>
          <section className="panel" aria-labelledby="art">
            <h3 id="art">Most represented artists</h3>
            <Bars label="Top artists" items={p.artists.slice(0, 8).map((a) => ({ key: a.id, label: a.name, value: a.trackCount, display: String(a.trackCount), color: 'var(--orange)' }))} />
          </section>
          <section className="panel" aria-labelledby="div">
            <h3 id="div">Diversity</h3>
            <dl className="kv small">
              <dt>Artist evenness</dt>
              <dd className="num">{p.diversity.artistEntropy.toFixed(2)} <span className="faint">(0 = one artist, 1 = perfectly even)</span></dd>
              <dt>Genre evenness</dt>
              <dd className="num">{p.diversity.genreEntropy.toFixed(2)}</dd>
              <dt>Unique artists per track</dt>
              <dd className="num">{p.diversity.uniqueArtistRatio.toFixed(2)}</dd>
              <dt>Top-5 artist share</dt>
              <dd className="num">{pct(p.diversity.topFiveArtistShare)}</dd>
              <dt>Alternate versions</dt>
              <dd>{p.versions.length ? p.versions.map((v) => `${v.trackCount} ${v.label}`).join(', ') : 'none'}</dd>
            </dl>
          </section>
          {p.decades.length > 0 && (
            <section className="panel" aria-labelledby="dec">
              <h3 id="dec">Release periods</h3>
              <div className="row" style={{ alignItems: 'flex-end', gap: 6, height: 120 }} role="img" aria-label={p.decades.map((d) => `${d.decade}s: ${d.trackCount}`).join(', ')}>
                {p.decades.map((d) => (
                  <div key={d.decade} style={{ flex: 1, display: 'grid', gap: 4, justifyItems: 'center' }}>
                    <div style={{ width: '100%', height: `${(d.trackCount / decadesMax) * 90}px`, background: 'linear-gradient(var(--yellow), var(--royal))', borderRadius: 6 }} />
                    <span className="xsmall faint">{String(d.decade).slice(2)}s</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="panel" aria-labelledby="attr">
            <h3 id="attr">Sound attributes</h3>
            {p.attributes.length === 0 ? (
              <p className="small muted">No instrument or texture information yet.</p>
            ) : (
              <ul className="list-plain" style={{ gap: 6 }}>
                {p.attributes.slice(0, 10).map((a) => (
                  <li key={`${a.category}:${a.value}`} className="row-between small">
                    <span>
                      {a.value} <span className="faint xsmall">{a.category}</span>
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      {a.verifiedCount > 0 && <span className="badge badge-verified">{a.verifiedCount} verified</span>}
                      {a.inferredCount > 0 && <span className="badge badge-inferred">{a.inferredCount} inferred</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {p.genreCooccurrence.length > 0 && (
            <section className="panel" aria-labelledby="co">
              <h3 id="co">Genres you combine</h3>
              <ul className="small muted" style={{ paddingLeft: 18, margin: 0 }}>
                {p.genreCooccurrence.slice(0, 6).map((c) => (
                  <li key={`${c.a}-${c.b}`}>
                    {genreDisplayName(c.a)} + {genreDisplayName(c.b)} — {c.trackCount} track{c.trackCount === 1 ? '' : 's'}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
