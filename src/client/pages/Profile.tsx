import { api, errorMessage } from '../api';
import { DemoBadge } from '../components/Badges';
import { Bars, familyColor } from '../components/Charts';
import { MusicMap } from '../components/MusicMap';
import { ErrorState, Loading } from '../components/States';
import { useApi, useDocumentTitle } from '../hooks';
import { Link, useNavigate } from '../router';
import { useAuth, useToast } from '../state';
import type { MusicMap as MusicMapData } from '../types';

interface ProfileView {
  user: { handle: string; displayName: string; isDemo: boolean; isYou: boolean; visibility: string; bio?: string };
  visible: boolean;
  profile?: {
    totals: { tracks: number; artists: number };
    families: { family: string; label: string; share: number }[];
    genres: { name: string; label: string; trackCount: number }[];
    artists: { name: string; trackCount: number }[];
  };
  map?: MusicMapData | null;
  playlists?: { id: string; name: string; provider: string; track_count: number; tracks: { id: string; title: string; artist: string }[] }[];
  memberships?: { slug: string; name: string; color: string }[];
}

export function ProfilePage({ params }: { params: { handle: string } }) {
  const { data, error, loading, reload } = useApi<ProfileView>(`/api/users/${encodeURIComponent(params.handle)}`);
  useDocumentTitle(data ? `${data.user.displayName} (@${data.user.handle})` : 'Profile');
  const { me } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error) return <div className="page"><ErrorState error={error} title={error.status === 404 ? 'Listener not found' : undefined} onRetry={error.status === 404 ? undefined : reload} /></div>;
  if (!data) return null;
  const u = data.user;

  return (
    <div className="page">
      <p className="eyebrow">Public music profile</p>
      <div className="page-head">
        <div>
          <h1 style={{ margin: 0 }}>
            {u.displayName} {u.isDemo && <DemoBadge what="Fictional demo listener" />}
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            @{u.handle}
          </p>
          {u.bio && <p style={{ marginTop: 8 }}>{u.bio}</p>}
        </div>
        {me && !u.isYou && (
          <div className="row">
            <Link to={`/compare/${u.handle}`} className="btn btn-primary">
              Compare with me
            </Link>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                if (!window.confirm(`Block @${u.handle}? You will no longer see each other’s messages or profiles.`)) return;
                try {
                  await api.post('/api/blocks', { handle: u.handle, kind: 'block' });
                  toast(`Blocked @${u.handle}.`, 'success');
                  navigate('/trees');
                } catch (err) {
                  toast(errorMessage(err), 'error');
                }
              }}
            >
              Block
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                try {
                  await api.post('/api/reports', { targetType: 'user', targetId: u.handle, reason: 'other' });
                  toast('Report sent.', 'success');
                } catch (err) {
                  toast(errorMessage(err), 'error');
                }
              }}
            >
              Report
            </button>
          </div>
        )}
        {u.isYou && (
          <Link to="/settings/privacy" className="btn btn-ghost">
            Edit what is shown
          </Link>
        )}
      </div>

      {!data.visible ? (
        <div className="state">
          <h2>This profile is {u.visibility === 'members' ? 'visible to Tree members only' : 'private'}</h2>
          <p className="muted">{u.displayName} has chosen not to show their music here.</p>
        </div>
      ) : (
        <div className="split">
          <div className="stack">
            {data.map ? (
              <MusicMap map={data.map} ariaLabel={`${u.displayName}'s public Music Map`} legend />
            ) : (
              <div className="state">
                <h2>No public playlists</h2>
                <p className="muted">{u.isYou ? 'Mark a playlist as Public in Privacy to show it here.' : 'Nothing has been made public yet.'}</p>
              </div>
            )}
            {data.playlists?.map((p) => (
              <details key={p.id} className="disclose">
                <summary>
                  {p.name} · {p.track_count} tracks
                </summary>
                <ol className="small" style={{ paddingLeft: 22 }}>
                  {p.tracks.map((t) => (
                    <li key={t.id}>
                      {t.title} <span className="faint">— {t.artist}</span>
                    </li>
                  ))}
                </ol>
              </details>
            ))}
          </div>
          <div className="stack">
            {data.profile && data.profile.totals.tracks > 0 && (
              <section className="panel" aria-labelledby="pub-fam">
                <h3 id="pub-fam">Genre families</h3>
                <Bars label="Genre families" items={data.profile.families.map((f) => ({ key: f.family, label: f.label, value: f.share, display: `${Math.round(f.share * 100)}%`, color: familyColor(f.family) }))} max={1} />
                <h3 style={{ marginTop: 'var(--space-4)' }}>Top artists</h3>
                <div className="chips">
                  {data.profile.artists.map((a) => (
                    <span key={a.name} className="chip">
                      {a.name}
                    </span>
                  ))}
                </div>
              </section>
            )}
            {data.memberships && data.memberships.length > 0 && (
              <section className="panel" aria-labelledby="pub-trees">
                <h3 id="pub-trees">Trees</h3>
                <ul className="list-plain" style={{ gap: 6 }}>
                  {data.memberships.map((m) => (
                    <li key={m.slug} className="row">
                      <span className="dot" style={{ background: m.color }} aria-hidden="true" />
                      <Link to={`/trees/${m.slug}`}>{m.name}</Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
