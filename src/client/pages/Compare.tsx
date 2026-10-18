import { genreDisplayName } from '../../shared/taxonomy';
import type { MatchResult } from '../../shared/analysis/similarity';
import { familyColor, MatchBreakdown, matchLabel, ScoreRing } from '../components/Charts';
import { ErrorState, Loading } from '../components/States';
import { useApi, useDocumentTitle } from '../hooks';
import { Link } from '../router';

interface CompareResponse {
  target: { handle: string; displayName: string; isDemo: boolean; profileVisible: boolean };
  match: MatchResult;
  explanation: { summary: string; points: string[] };
  sharedPublic: { artists: { id: string; name: string }[]; tracks: { id: string; label: string }[] };
  families: { mine: { family: string; label: string; share: number }[]; theirs: { family: string; label: string; share: number }[] };
  note: string;
}

export function ComparePage({ params }: { params: { handle: string } }) {
  const { data, error, loading, reload } = useApi<CompareResponse>(`/api/compare/${encodeURIComponent(params.handle)}`);
  useDocumentTitle(`Compare with @${params.handle}`);
  if (loading && !data) return <div className="page"><Loading lines={5} /></div>;
  if (error) return <div className="page"><ErrorState error={error} onRetry={error.status >= 500 || error.isNetwork ? reload : undefined} title={error.status === 404 ? 'Listener not found' : 'Comparison unavailable'} /></div>;
  if (!data) return null;
  const families = [...new Set([...data.families.mine, ...data.families.theirs].map((f) => f.family))];
  const share = (list: { family: string; share: number }[], f: string) => list.find((x) => x.family === f)?.share ?? 0;
  const genres = data.match.components.find((c) => c.key === 'genres')?.topShared ?? [];

  return (
    <div className="page">
      <p className="eyebrow">Profile comparison</p>
      <div className="page-head">
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <ScoreRing score={data.match.score} label={data.match.label} />
          <div>
            <h1 style={{ margin: 0 }}>
              You & {data.target.displayName}
            </h1>
            <p className="muted" style={{ margin: 0 }}>
              @{data.target.handle} · {matchLabel(data.match.label)}
            </p>
          </div>
        </div>
        {data.target.profileVisible && (
          <Link to={`/u/${data.target.handle}`} className="btn btn-ghost">
            View their profile
          </Link>
        )}
      </div>
      <div className="split">
        <div className="stack">
          <section className="panel" aria-labelledby="explain">
            <h2 id="explain">What you share</h2>
            <p>{data.explanation.summary}</p>
            <ul className="small muted" style={{ paddingLeft: 18 }}>
              {data.explanation.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <MatchBreakdown match={data.match} />
            <p className="xsmall faint" style={{ marginTop: 'var(--space-3)' }}>
              {data.note}
            </p>
          </section>
          <section className="panel" aria-labelledby="fam-compare">
            <h2 id="fam-compare">Genre family balance</h2>
            <ul className="bars" aria-label="Your share and their share per genre family">
              {families.slice(0, 10).map((f) => {
                const label = data.families.mine.find((x) => x.family === f)?.label ?? data.families.theirs.find((x) => x.family === f)?.label ?? f;
                return (
                  <li key={f} className="bar-row" style={{ gridTemplateColumns: 'minmax(90px, 30%) 1fr' }}>
                    <span className="truncate">{label}</span>
                    <span style={{ display: 'grid', gap: 3 }}>
                      <span className="bar" title={`You: ${Math.round(share(data.families.mine, f) * 100)}%`}>
                        <span style={{ width: `${Math.max(2, share(data.families.mine, f) * 100)}%`, background: familyColor(f) }} />
                      </span>
                      <span className="bar" title={`Them: ${Math.round(share(data.families.theirs, f) * 100)}%`}>
                        <span style={{ width: `${Math.max(2, share(data.families.theirs, f) * 100)}%`, background: 'var(--text-faint)' }} />
                      </span>
                      <span className="xsmall faint num">
                        you {Math.round(share(data.families.mine, f) * 100)}% · them {Math.round(share(data.families.theirs, f) * 100)}%
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
        <div className="stack">
          <section className="panel" aria-labelledby="shared-artists">
            <h3 id="shared-artists">Shared artists (from their public playlists)</h3>
            {data.sharedPublic.artists.length ? (
              <div className="chips">
                {data.sharedPublic.artists.map((a) => (
                  <span key={a.id} className="chip">
                    {a.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="small muted">None to list. Shared counts above may include playlists they shared privately for matching.</p>
            )}
          </section>
          <section className="panel" aria-labelledby="shared-tracks">
            <h3 id="shared-tracks">Shared tracks</h3>
            {data.sharedPublic.tracks.length ? (
              <ul className="small" style={{ paddingLeft: 18 }}>
                {data.sharedPublic.tracks.map((t) => (
                  <li key={t.id}>
                    <Link to={`/library/tracks/${t.id}`}>{t.label}</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">No public tracks in common.</p>
            )}
          </section>
          {genres.length > 0 && (
            <section className="panel" aria-labelledby="overlap">
              <h3 id="overlap">Strongest genre overlap</h3>
              <div className="chips">
                {genres.map((g) => (
                  <span key={g} className="chip">
                    {genreDisplayName(g)}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
