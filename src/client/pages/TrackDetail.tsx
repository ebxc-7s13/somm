import { useState } from 'react';
import type { AttributeAssignment } from '../../shared/types';
import { api, errorMessage } from '../api';
import { KindBadge, ProviderName, SourceLabel } from '../components/Badges';
import { familyColor } from '../components/Charts';
import { ErrorState, Loading } from '../components/States';
import { useApi, useDocumentTitle } from '../hooks';
import { Link } from '../router';
import { useToast } from '../state';

interface Detail {
  track: {
    id: string;
    title: string;
    displayTitle: string;
    version: string | null;
    versionDetail: string | null;
    artists: { id: string; name: string; role: string }[];
    album: { id: string; title: string | null; artworkUrl: string | null } | null;
    durationMs: number | null;
    releaseDate: string | null;
    releaseYear: number | null;
    isrc: string | null;
    explicit: boolean | null;
    tempoBpm: number | null;
    tempoSource: string | null;
    enrichment: { status: string; error: string | null; at: string | null };
  };
  genres: { name: string; label: string; family: string; source: string; kind: string; confidence: number }[];
  attributes: AttributeAssignment[];
  links: { namespace: string; value: string; url: string | null }[];
  entries: { playlist_id: string; playlist: string; provider: string; raw_title: string; raw_artist: string; raw_album: string | null; source_url: string | null; match_method: string; hidden: boolean; user_bpm: number | null; added_at: string }[];
}

const LINK_LABELS: Record<string, string> = {
  'spotify:track': 'Open in Spotify',
  'youtube:video': 'Watch on YouTube',
  'apple_music:song': 'Open in Apple Music',
  'itunes:track': 'View in the iTunes Store',
  'musicbrainz:recording': 'MusicBrainz recording',
};

const MATCH_TEXT: Record<string, string> = {
  provider_id: 'Matched by provider ID',
  isrc: 'Matched by ISRC',
  title_artist: 'Matched by title + artist (no conflicting duration/ISRC)',
  new: 'New canonical track',
};

const ENRICH_TEXT: Record<string, string> = {
  pending: 'Waiting for metadata lookup',
  done: 'Looked up in MusicBrainz',
  not_found: 'No confident MusicBrainz match — nothing was guessed',
  error: 'Lookup failed — retry from the import screen',
  skipped: 'Not looked up',
};

function fmt(ms: number | null) {
  if (!ms) return 'unknown';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function TrackDetailPage({ params }: { params: { id: string } }) {
  const { data, error, loading, reload } = useApi<Detail>(`/api/library/tracks/${params.id}`);
  useDocumentTitle(data?.track.title ?? 'Track');
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error) return <div className="page"><ErrorState error={error} onRetry={error.status === 404 ? undefined : reload} title={error.status === 404 ? 'Track not found' : undefined} /></div>;
  if (!data) return null;
  const { track } = data;
  const verified = data.attributes.filter((a) => a.kind !== 'inferred');
  const inferred = data.attributes.filter((a) => a.kind === 'inferred');

  return (
    <div className="page">
      <Link to="/library" className="small">
        ← Library
      </Link>
      <div className="page-head" style={{ marginTop: 'var(--space-3)' }}>
        <div style={{ minWidth: 0 }}>
          <p className="eyebrow">Song detail</p>
          <h1 style={{ overflowWrap: 'anywhere' }}>
            {track.title} {track.version && <span className="badge badge-user" style={{ verticalAlign: 'middle' }}>{track.versionDetail ?? track.version}</span>}
          </h1>
          <p className="lead" style={{ margin: 0 }}>
            {track.artists.map((a, i) => (
              <span key={a.id}>
                {i > 0 && (a.role === 'featured' ? ' feat. ' : ', ')}
                <Link to={`/library?artist=${a.id}`}>{a.name}</Link>
              </span>
            ))}
          </p>
        </div>
      </div>

      <div className="split">
        <div className="stack">
          <section className="panel" aria-labelledby="facts">
            <h2 id="facts">Metadata</h2>
            <dl className="kv">
              <dt>Album</dt>
              <dd>{track.album?.title ?? <span className="faint">unknown</span>}</dd>
              <dt>Released</dt>
              <dd>{track.releaseDate ?? track.releaseYear ?? <span className="faint">unknown</span>}</dd>
              <dt>Duration</dt>
              <dd className="num">{fmt(track.durationMs)}</dd>
              <dt>ISRC</dt>
              <dd className="num">{track.isrc ?? <span className="faint">not provided</span>}</dd>
              <dt>Explicit</dt>
              <dd>{track.explicit === null ? <span className="faint">unknown</span> : track.explicit ? 'Yes' : 'No'}</dd>
              <dt>Tempo</dt>
              <dd>
                {track.tempoBpm ? (
                  <>
                    {track.tempoBpm} BPM <span className="faint xsmall">({track.tempoSource})</span>
                  </>
                ) : (
                  <span className="faint">not available — no permitted source provides it</span>
                )}
              </dd>
              <dt>Lookup</dt>
              <dd>
                {ENRICH_TEXT[track.enrichment.status] ?? track.enrichment.status}
                {track.enrichment.error && <span className="faint xsmall"> ({track.enrichment.error})</span>}
              </dd>
            </dl>
          </section>

          <section className="panel" aria-labelledby="genres">
            <h2 id="genres">Genres</h2>
            {data.genres.length === 0 ? (
              <p className="muted">No source provided a genre for this track, so SOMM shows it as “Genre unknown” rather than guessing.</p>
            ) : (
              <ul className="list-plain">
                {data.genres.map((g) => (
                  <li key={`${g.name}-${g.source}`} className="list-item">
                    <span className="dot" style={{ background: familyColor(g.family) }} aria-hidden="true" />
                    <strong style={{ flex: 1 }}>{g.label}</strong>
                    <KindBadge kind={g.kind} />
                    <SourceLabel source={g.source} />
                    <span className="xsmall faint num">{Math.round(g.confidence * 100)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="attrs">
            <h2 id="attrs">Instruments & sound</h2>
            {data.attributes.length === 0 && <p className="muted">No instrument, mood or texture metadata is available for this track.</p>}
            {verified.length > 0 && (
              <ul className="list-plain">
                {verified.map((a) => (
                  <li key={`${a.category}:${a.value}:${a.source}`} className="list-item">
                    <span className="small faint" style={{ minWidth: 86 }}>{a.category}</span>
                    <strong style={{ flex: 1 }}>{a.value}</strong>
                    <KindBadge kind={a.kind} />
                    <span className="xsmall faint">{a.evidence}</span>
                  </li>
                ))}
              </ul>
            )}
            {inferred.length > 0 && (
              <>
                <h3 className="small" style={{ marginTop: 'var(--space-4)' }}>Inferred associations</h3>
                <ul className="list-plain">
                  {inferred.map((a) => (
                    <li key={`${a.category}:${a.value}`} className="list-item" style={{ borderStyle: 'dashed' }}>
                      <span className="small faint" style={{ minWidth: 86 }}>{a.category}</span>
                      <strong style={{ flex: 1 }}>{a.value}</strong>
                      <KindBadge kind="inferred" />
                      <span className="xsmall faint">
                        {a.evidence} · {Math.round(a.confidence * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="panel" aria-labelledby="links">
            <h2 id="links">Listen & sources</h2>
            <ul className="list-plain">
              {data.links.filter((l) => l.url).map((l) => (
                <li key={`${l.namespace}:${l.value}`}>
                  <a className="btn btn-ghost btn-sm" href={l.url!} target="_blank" rel="noopener noreferrer">
                    {LINK_LABELS[l.namespace] ?? l.namespace} ↗
                  </a>
                </li>
              ))}
              {data.links.filter((l) => l.url).length === 0 && <li className="muted small">No provider links for this track.</li>}
            </ul>
            <p className="xsmall faint" style={{ marginTop: 8 }}>
              SOMM never streams or stores audio. Genre and tag data from MusicBrainz is licensed CC BY-NC-SA 3.0.
            </p>
          </section>

          <section className="panel" aria-labelledby="entries">
            <h2 id="entries">In your playlists</h2>
            <ul className="list-plain">
              {data.entries.map((e) => (
                <li key={e.playlist_id} className="list-item" style={{ display: 'grid', gap: 6 }}>
                  <strong>{e.playlist}</strong>
                  <span className="xsmall faint">
                    <ProviderName id={e.provider} /> · as imported: “{e.raw_title}” — {e.raw_artist}
                  </span>
                  <span className="xsmall faint">{MATCH_TEXT[e.match_method] ?? e.match_method}</span>
                  <label className="row xsmall" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={e.hidden}
                      disabled={busy}
                      style={{ accentColor: 'var(--yellow)' }}
                      onChange={async (ev) => {
                        setBusy(true);
                        try {
                          await api.patch(`/api/playlists/${e.playlist_id}/tracks/${track.id}`, { hidden: ev.target.checked });
                          toast(ev.target.checked ? 'Hidden from sharing and public listings.' : 'No longer hidden.', 'success');
                          reload();
                        } catch (err) {
                          toast(errorMessage(err), 'error');
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                    Hide this track from sharing and public listings
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
