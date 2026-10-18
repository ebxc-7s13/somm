import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { useCalls } from '../components/CallOverlay';
import { Bars, familyColor, MatchBreakdown, matchLabel, ScoreRing } from '../components/Charts';
import { Icon } from '../components/Icon';
import { MapList, MusicMap } from '../components/MusicMap';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { TreeGlyph } from '../components/TreeGlyph';
import { useApi, useDocumentTitle } from '../hooks';
import { Link, NavLink } from '../router';
import { useToast } from '../state';
import type { Member, TreeDetail } from '../types';
import { TreeChat } from './TreeChat';
import { TreeMusic } from './TreeMusic';

function Overview({ detail, reload }: { detail: TreeDetail; reload: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [listView, setListView] = useState(false);
  const p = detail.profile;
  const member = !!detail.membership;

  const propose = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/api/trees/${detail.tree.slug}/names`, { name });
      setName('');
      reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div className="split">
      <div className="stack">
        {detail.match && (
          <section className="panel panel-accent" aria-labelledby="why">
            <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <ScoreRing score={detail.match.match.score} label={detail.match.match.label} />
              <div>
                <h2 id="why" style={{ marginBottom: 4 }}>
                  Why you {member ? 'fit' : 'match'}: {matchLabel(detail.match.match.label).toLowerCase()}
                </h2>
                <p style={{ margin: 0 }}>{detail.match.explanation.summary}</p>
              </div>
            </div>
            <ul className="small muted" style={{ paddingLeft: 18 }}>
              {detail.match.explanation.points.map((pt) => (
                <li key={pt}>{pt}</li>
              ))}
            </ul>
            <MatchBreakdown match={detail.match.match} />
          </section>
        )}

        <section className="panel" aria-labelledby="shared-map">
          <div className="row-between">
            <h2 id="shared-map" style={{ margin: 0 }}>
              Shared map
            </h2>
            {detail.map && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setListView((v) => !v)}>
                {listView ? 'Show map' : 'Show as list'}
              </button>
            )}
          </div>
          <p className="small muted">
            Aggregated from {p?.contributingMembers ?? 0} member{p?.contributingMembers === 1 ? '' : 's'} who share playlists. Artists appear only once 3 or more members contribute, and only when at least {p?.kAnonymity ?? 2} of them share an artist.
          </p>
          {detail.map ? (
            listView ? (
              <MapList map={detail.map} />
            ) : (
              <MusicMap map={detail.map} ariaLabel={`Shared map of ${detail.tree.name}`} legend={false} />
            )
          ) : (
            <EmptyState title="Not enough shared music yet">{p?.note ?? 'The shared map appears once members contribute shared playlists.'}</EmptyState>
          )}
        </section>
      </div>

      <div className="stack">
        {p && p.families.length > 0 && (
          <section className="panel" aria-labelledby="sound">
            <h3 id="sound">Sound profile</h3>
            <Bars label="Genre family balance" items={p.families.slice(0, 8).map((f) => ({ key: f.family, label: f.label, value: f.share, display: `${Math.round(f.share * 100)}%`, color: familyColor(f.family) }))} max={1} />
            {p.genres.length > 0 && (
              <div className="chips" style={{ marginTop: 'var(--space-3)' }}>
                {p.genres.slice(0, 10).map((g) => (
                  <span key={g.name} className="chip">
                    <span className="dot" style={{ background: familyColor(g.family), width: 7, height: 7 }} aria-hidden="true" />
                    {g.label}
                  </span>
                ))}
              </div>
            )}
          </section>
        )}
        <section className="panel" aria-labelledby="artists">
          <h3 id="artists">Shared artists</h3>
          {p && p.artists.length > 0 ? (
            <ul className="list-plain" style={{ gap: 4 }}>
              {p.artists.slice(0, 12).map((a) => (
                <li key={a.id} className="row-between small">
                  <span className="truncate">{a.name}</span>
                  <span className="faint xsmall">{a.members} members</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">{p?.note ?? 'No artists are shared by enough members yet.'}</p>
          )}
        </section>
        {detail.related.length > 0 && (
          <section className="panel" aria-labelledby="related">
            <h3 id="related">Explore similar Trees</h3>
            <ul className="list-plain">
              {detail.related.map((r) => (
                <li key={r.slug} className="row-between">
                  <Link to={`/trees/${r.slug}`}>{r.name}</Link>
                  <span className="row" style={{ gap: 6 }}>
                    {r.isMember && <span className="badge badge-joined">Joined</span>}
                    <span className="xsmall faint">{Math.round(r.score * 100)}% similar</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="panel" aria-labelledby="names">
          <h3 id="names">Name this Tree</h3>
          <p className="small muted">Members suggest and vote. A name backed by a majority (at least two votes) becomes the Tree’s name.</p>
          {detail.names.length > 0 && (
            <ul className="list-plain" style={{ gap: 6 }}>
              {detail.names.map((n) => (
                <li key={n.id} className="row-between">
                  <span>
                    {n.name} <span className="faint xsmall">{n.votes} vote{n.votes === 1 ? '' : 's'}</span>
                  </span>
                  {member && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={n.votedByMe}
                      onClick={async () => {
                        try {
                          const r = await api.post<{ renamed: boolean }>(`/api/trees/${detail.tree.slug}/names/${n.id}/vote`);
                          if (r.renamed) toast(`The Tree is now called “${n.name}”.`, 'success');
                          reload();
                        } catch (err) {
                          toast(errorMessage(err), 'error');
                        }
                      }}
                    >
                      {n.votedByMe ? 'Your vote' : 'Vote'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {member ? (
            <form onSubmit={propose} className="row" style={{ marginTop: 'var(--space-3)', flexWrap: 'nowrap' }}>
              <label htmlFor="name-prop" className="sr-only">
                Suggest a name
              </label>
              <input id="name-prop" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Suggest a name" />
              <button type="submit" className="btn btn-blue btn-sm" disabled={name.trim().length < 3}>
                Suggest
              </button>
            </form>
          ) : (
            <p className="xsmall faint">Join to suggest names.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Members({ slug, treeId }: { slug: string; treeId: string }) {
  const { data, error, loading, reload } = useApi<{ members: Member[] }>(`/api/trees/${slug}/members`);
  const calls = useCalls();
  const toast = useToast();
  const callsCfg = useApi<{ enabled: boolean; hasTurn: boolean; limitations: string[] }>('/api/calls/config');
  if (loading && !data) return <Loading lines={4} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg, 'success');
      reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };
  return (
    <div className="stack">
      {callsCfg.data && (
        <p className="small muted">
          {callsCfg.data.enabled ? 'Voice and video calls: 1:1, between members who are online. ' : 'Calls are disabled on this server. '}
          {callsCfg.data.limitations[1]}
        </p>
      )}
      <ul className="list-plain">
        {data?.members.map((m) => (
          <li key={m.id} className="list-item" style={{ flexWrap: 'wrap' }}>
            <span className="dot" style={{ background: m.online ? 'var(--ok)' : 'var(--text-faint)' }} title={m.online ? 'Online' : 'Offline'} aria-label={m.online ? 'Online' : 'Offline'} role="img" />
            <span style={{ flex: 1, minWidth: 160 }}>
              <strong>{m.displayName}</strong> <span className="faint small">@{m.handle}</span> {m.role === 'moderator' && <span className="badge badge-yellow">moderator</span>}
              {m.isYou && <span className="badge">you</span>}
              <span className="xsmall faint" style={{ display: 'block' }}>
                Joined {new Date(m.joinedAt).toLocaleDateString()}
                {m.match && ` · ${Math.round(m.match.score * 100)}% match (${matchLabel(m.match.label).toLowerCase()})`}
              </span>
            </span>
            {!m.isYou && (
              <span className="row" style={{ gap: 6 }}>
                {m.profileVisible && (
                  <Link to={`/u/${m.handle}`} className="btn btn-ghost btn-sm">
                    Profile
                  </Link>
                )}
                <Link to={`/compare/${m.handle}`} className="btn btn-ghost btn-sm">
                  Compare
                </Link>
                {calls && callsCfg.data?.enabled && m.online && (
                  <>
                    <button type="button" className="icon-btn" aria-label={`Voice call ${m.displayName}`} onClick={() => void calls.start({ id: m.id, handle: m.handle, displayName: m.displayName }, 'audio', treeId)}>
                      <Icon name="phone" />
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Video call ${m.displayName}`} onClick={() => void calls.start({ id: m.id, handle: m.handle, displayName: m.displayName }, 'video', treeId)}>
                      <Icon name="video" />
                    </button>
                  </>
                )}
                <details className="more-wrap">
                  <summary className="btn btn-ghost btn-sm" aria-label={`More actions for ${m.displayName}`}>
                    More
                  </summary>
                  <div className="more-menu">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(() => api.post('/api/blocks', { handle: m.handle, kind: 'mute' }), `Muted @${m.handle}.`)}>
                      Mute
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(() => api.post('/api/blocks', { handle: m.handle, kind: 'block' }), `Blocked @${m.handle}.`)}>
                      Block
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => act(() => api.post('/api/reports', { targetType: 'user', targetId: m.handle, reason: 'harassment' }), 'Report sent.')}>
                      Report
                    </button>
                  </div>
                </details>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TreePage({ params }: { params: { slug: string; tab?: string } }) {
  const { data, error, loading, reload } = useApi<TreeDetail>(`/api/trees/${params.slug}`);
  useDocumentTitle(data?.tree.name ?? 'Tree');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const tab = params.tab ?? 'overview';

  if (loading && !data) return <div className="page"><Loading lines={6} /></div>;
  if (error) return <div className="page"><ErrorState error={error} title={error.status === 404 ? 'Tree not found' : undefined} onRetry={error.status === 404 ? undefined : reload} /></div>;
  if (!data) return null;
  const t = data.tree;
  const member = !!data.membership;

  const toggle = async () => {
    setBusy(true);
    try {
      await api.post(`/api/trees/${t.slug}/${member ? 'leave' : 'join'}`);
      toast(member ? `You left ${t.name}.` : `Welcome to ${t.name}!`, 'success');
      reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
          <TreeGlyph seed={t.glyphSeed} families={t.families} size={84} label={`${t.name} emblem`} />
          <div style={{ minWidth: 0 }}>
            <p className="eyebrow">{t.status === 'proposed' ? 'Tree forming' : 'Tree'}</p>
            <h1 style={{ overflowWrap: 'anywhere' }}>{t.name}</h1>
            <p className="muted" style={{ margin: 0 }}>
              {t.description}
            </p>
            <p className="small faint" style={{ margin: '6px 0 0' }}>
              {t.memberCount} member{t.memberCount === 1 ? '' : 's'} · {t.origin === 'cluster' ? 'proposed by SOMM from compatible listeners' : 'started by a member'}
              {member && <span className="badge badge-joined" style={{ marginLeft: 8 }}>Joined</span>}
            </p>
          </div>
        </div>
        <div className="row">
          <button type="button" className={`btn ${member ? 'btn-ghost' : 'btn-primary'}`} onClick={toggle} disabled={busy}>
            {member ? 'Leave Tree' : 'Join Tree'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              if (!window.confirm('Report this Tree to the SOMM moderators?')) return;
              try {
                await api.post('/api/reports', { targetType: 'community', targetId: t.id, reason: 'other' });
                toast('Report sent.', 'success');
              } catch (err) {
                toast(errorMessage(err), 'error');
              }
            }}
          >
            Report
          </button>
        </div>
      </div>
      <nav className="tabs" aria-label="Tree sections">
        <NavLink to={`/trees/${t.slug}`} exact>
          Overview
        </NavLink>
        <NavLink to={`/trees/${t.slug}/chat`}>Chat</NavLink>
        <NavLink to={`/trees/${t.slug}/music`}>Music</NavLink>
        <NavLink to={`/trees/${t.slug}/members`}>Members</NavLink>
      </nav>
      {tab === 'overview' && <Overview detail={data} reload={reload} />}
      {tab !== 'overview' && !member && (
        <EmptyState title="Members only" action={<button type="button" className="btn btn-primary" onClick={toggle} disabled={busy}>Join {t.name}</button>}>
          The chat, shared music and member directory are open to members of this Tree. Joining never publishes your private playlists.
        </EmptyState>
      )}
      {tab === 'members' && member && <Members slug={t.slug} treeId={t.id} />}
      {tab === 'chat' && member && <TreeChat tree={t} isModerator={data.membership?.role === 'moderator'} />}
      {tab === 'music' && member && <TreeMusic tree={t} isModerator={data.membership?.role === 'moderator'} />}
    </div>
  );
}
