import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { ErrorState, Loading } from '../components/States';
import { useApi, useDocumentTitle } from '../hooks';
import { Link, NavLink, useNavigate } from '../router';
import { useAuth, useToast } from '../state';
import type { Playlist, ProviderStatus } from '../types';
import { realtime } from '../realtime';

function SettingsNav() {
  return (
    <nav className="tabs" aria-label="Settings sections">
      <NavLink to="/settings" exact>
        Profile & providers
      </NavLink>
      <NavLink to="/settings/privacy">Privacy & sharing</NavLink>
      <NavLink to="/settings/account">Account & data</NavLink>
    </nav>
  );
}

const STATE_CLASS: Record<string, string> = {
  available: 'badge-verified',
  connected: 'badge-verified',
  needs_connection: 'badge-community',
  needs_credentials: 'badge-inferred',
  unavailable: 'badge-unknown',
};

export function SettingsPage() {
  useDocumentTitle('Settings');
  const { me, refresh } = useAuth();
  const toast = useToast();
  const providers = useApi<{ providers: ProviderStatus[]; enrichment: { enabled: boolean; reason: string | null }; tokenStorage: string }>('/api/providers');
  const calls = useApi<{ enabled: boolean; hasTurn: boolean; limitations: string[] }>('/api/calls/config');
  const [name, setName] = useState(me?.user.displayName ?? '');
  const [bio, setBio] = useState(me?.user.bio ?? '');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.patch('/api/me', { displayName: name, bio });
      await refresh();
      toast('Profile saved.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div className="page">
      <h1>Settings</h1>
      <SettingsNav />
      <div className="split">
        <form className="panel" onSubmit={save} aria-labelledby="prof">
          <h2 id="prof">Profile</h2>
          <p className="small muted">SOMM only needs a pseudonymous handle. Nothing here is required.</p>
          <div className="field">
            <label htmlFor="s-name">Display name</label>
            <input id="s-name" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="s-bio">About your listening (optional)</label>
            <textarea id="s-bio" className="textarea" maxLength={280} value={bio} onChange={(e) => setBio(e.target.value)} />
            <span className="hint">{bio.length}/280 · Please do not include contact details.</span>
          </div>
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </form>
        <section className="panel" aria-labelledby="calls">
          <h2 id="calls">Calls</h2>
          {calls.data ? (
            <ul className="small muted" style={{ paddingLeft: 18 }}>
              <li>{calls.data.enabled ? 'Voice and video calls are enabled.' : 'Calls are disabled on this server.'}</li>
              {calls.data.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : (
            <Loading lines={2} />
          )}
        </section>
      </div>
      <section aria-labelledby="prov" style={{ marginTop: 'var(--space-6)' }}>
        <h2 id="prov">Music sources & metadata</h2>
        {providers.loading && <Loading />}
        {providers.error && <ErrorState error={providers.error} onRetry={providers.reload} />}
        {providers.data && (
          <>
            <p className="small muted">Token storage: {providers.data.tokenStorage}. Tokens are never shown in the browser or logs.</p>
            <div className="grid">
              {providers.data.providers.map((p) => (
                <article key={p.id} className="panel" aria-labelledby={`p-${p.id}`}>
                  <div className="row-between">
                    <h3 id={`p-${p.id}`} style={{ margin: 0 }}>
                      {p.label}
                    </h3>
                    <span className={`badge ${STATE_CLASS[p.state]}`}>{p.state.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="small muted" style={{ marginTop: 8 }}>
                    {p.summary}
                  </p>
                  <ul className="xsmall muted" style={{ paddingLeft: 16 }}>
                    {p.limitations.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                  <div className="row">
                    {p.state === 'connected' && (p.id === 'spotify' || p.id === 'apple_music') && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={async () => {
                          await api.del(`/api/providers/${p.id}`);
                          toast(`${p.label} disconnected and its tokens deleted.`, 'success');
                          providers.reload();
                        }}
                      >
                        Disconnect
                      </button>
                    )}
                    {p.state === 'needs_connection' && p.id === 'spotify' && (
                      <Link to="/import?provider=spotify" className="btn btn-blue btn-sm">
                        Connect
                      </Link>
                    )}
                    <a href={p.docsUrl.startsWith('http') ? p.docsUrl : undefined} target="_blank" rel="noopener noreferrer" className="xsmall faint" hidden={!p.docsUrl.startsWith('http')}>
                      Provider docs ↗
                    </a>
                  </div>
                  <p className="xsmall faint" style={{ margin: 0 }}>Verified {p.verifiedAt}</p>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const VIS = {
  private: { label: 'Private', desc: 'Only you. Used for your own map and recommendations.' },
  shared: { label: 'Shared for matching', desc: 'Counts anonymously towards matching and Tree statistics. Never listed.' },
  public: { label: 'Public', desc: 'Listed on your public profile (if your profile is visible).' },
} as const;

export function PrivacyPage() {
  useDocumentTitle('Privacy & sharing');
  const { me, refresh } = useAuth();
  const toast = useToast();
  const playlists = useApi<{ playlists: Playlist[] }>('/api/playlists');
  const blocks = useApi<{ blocks: { handle: string; displayName: string; kind: string; createdAt: string }[] }>('/api/blocks');
  if (!me) return null;
  const u = me.user;

  const patch = async (body: Record<string, unknown>, msg: string) => {
    try {
      await api.patch('/api/me', body);
      await refresh();
      toast(msg, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div className="page">
      <h1>Settings</h1>
      <SettingsNav />
      <div className="stack-lg">
        <section className="panel" aria-labelledby="pv">
          <h2 id="pv">Profile visibility</h2>
          <fieldset className="choice-group">
            <legend className="sr-only">Who can see your public profile</legend>
            {(
              [
                ['private', 'Private', 'Only your handle is visible. Nobody sees your map or playlists.'],
                ['members', 'Tree members', 'People in a Tree with you can see your public playlists and map.'],
                ['public', 'Public', 'Anyone with the link can see your public playlists and map.'],
              ] as const
            ).map(([v, l, d]) => (
              <label key={v} className="choice">
                <input type="radio" name="profile-vis" checked={u.profileVisibility === v} onChange={() => void patch({ profileVisibility: v }, `Profile visibility: ${l}.`)} />
                <strong>{l}</strong>
                <span className="small muted">{d}</span>
              </label>
            ))}
          </fieldset>
          <div className="stack">
            <label className="switch">
              <span>
                <strong>Discoverable</strong>
                <span className="small muted" style={{ display: 'block' }}>
                  Let compatible listeners find you and include you in Tree proposals. Uses only shared/public playlists. You will see similar listeners too.
                </span>
              </span>
              <input type="checkbox" checked={u.discoverable} onChange={(e) => void patch({ discoverable: e.target.checked }, e.target.checked ? 'You are discoverable.' : 'You are no longer discoverable.')} />
            </label>
            <label className="switch">
              <span>
                <strong>Show my Trees on my profile</strong>
                <span className="small muted" style={{ display: 'block' }}>
                  Members of a Tree can always see each other; this controls your public profile only.
                </span>
              </span>
              <input type="checkbox" checked={u.showMemberships} onChange={(e) => void patch({ showMemberships: e.target.checked }, 'Saved.')} />
            </label>
          </div>
        </section>

        <section className="panel" aria-labelledby="plv">
          <h2 id="plv">Playlist sharing</h2>
          <p className="small muted">Importing a playlist never publishes it. Joining a public Tree never shares a private playlist.</p>
          {playlists.loading && <Loading lines={2} />}
          <ul className="list-plain">
            {playlists.data?.playlists.map((p) => (
              <li key={p.id} className="list-item" style={{ flexWrap: 'wrap' }}>
                <strong style={{ flex: 1, minWidth: 160 }} className="clamp-2">
                  {p.name}
                </strong>
                <label htmlFor={`pv-${p.id}`} className="sr-only">
                  Sharing for {p.name}
                </label>
                <select
                  id={`pv-${p.id}`}
                  className="select"
                  style={{ width: 'auto', minHeight: 38 }}
                  value={p.visibility}
                  onChange={async (e) => {
                    try {
                      await api.patch(`/api/playlists/${p.id}`, { visibility: e.target.value });
                      toast('Sharing updated.', 'success');
                      playlists.reload();
                    } catch (err) {
                      toast(errorMessage(err), 'error');
                    }
                  }}
                >
                  {Object.entries(VIS).map(([v, x]) => (
                    <option key={v} value={v}>
                      {x.label}
                    </option>
                  ))}
                </select>
                <span className="xsmall faint" style={{ flexBasis: '100%' }}>
                  {VIS[p.visibility].desc}
                </span>
              </li>
            ))}
            {playlists.data?.playlists.length === 0 && <li className="muted small">No playlists yet.</li>}
          </ul>
          <p className="xsmall faint">To hide individual songs, open a song in your Library and tick “Hide this track from sharing”.</p>
        </section>

        <section className="panel" aria-labelledby="bl">
          <h2 id="bl">Blocked & muted</h2>
          {blocks.data?.blocks.length === 0 && <p className="small muted">You have not blocked or muted anyone.</p>}
          <ul className="list-plain">
            {blocks.data?.blocks.map((b) => (
              <li key={`${b.handle}-${b.kind}`} className="list-item">
                <span style={{ flex: 1 }}>
                  {b.displayName} <span className="faint small">@{b.handle}</span> <span className="badge">{b.kind === 'block' ? 'blocked' : 'muted'}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    await api.del(`/api/blocks/${b.handle}?kind=${b.kind}`);
                    blocks.reload();
                  }}
                >
                  {b.kind === 'block' ? 'Unblock' : 'Unmute'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function AccountPage() {
  useDocumentTitle('Account & data');
  const { me, refresh, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  return (
    <div className="page">
      <h1>Settings</h1>
      <SettingsNav />
      <div className="stack-lg">
        <section className="panel" aria-labelledby="exp">
          <h2 id="exp">Export your data</h2>
          <p className="small muted">Download everything SOMM stores about you as JSON: account settings, playlists and entries, Tree memberships, your messages, blocks and reports. Provider tokens and your password hash are never included.</p>
          <a className="btn btn-blue" href="/api/me/export" download>
            Download my data
          </a>
        </section>
        <section className="panel" aria-labelledby="dellib">
          <h2 id="dellib">Delete imported music</h2>
          <p className="small muted">Removes all your playlists, your Music Map, insights and match data. Your account and Tree memberships stay. Catalogue entries nobody else uses are removed too.</p>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('Delete all imported music data? This cannot be undone.')) return;
              setBusy(true);
              try {
                const r = await api.del<{ playlistsDeleted: number }>('/api/me/library');
                toast(`Deleted ${r.playlistsDeleted} playlist(s) and your map.`, 'success');
                await refresh();
              } catch (err) {
                toast(errorMessage(err), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete my music data
          </button>
        </section>
        <section className="panel" aria-labelledby="delacc" style={{ borderColor: 'rgba(255,138,122,.5)' }}>
          <h2 id="delacc">Delete account</h2>
          <p className="small muted">Permanently deletes your account, sessions, provider connections, playlists, map, memberships and messages.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api.del('/api/me', { confirmHandle: confirm });
                realtime().disconnect();
                await signOut();
                navigate('/');
              } catch (err) {
                toast(errorMessage(err), 'error');
                setBusy(false);
              }
            }}
          >
            <div className="field">
              <label htmlFor="confirm-handle">
                Type your handle <strong>{me.user.handle}</strong> to confirm
              </label>
              <input id="confirm-handle" className="input" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-danger" disabled={busy || confirm.trim().toLowerCase() !== me.user.handle}>
              Permanently delete my account
            </button>
          </form>
        </section>
        <section className="panel" aria-labelledby="so">
          <h2 id="so">Sign out</h2>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              realtime().disconnect();
              await signOut();
              navigate('/');
            }}
          >
            Sign out of this device
          </button>
        </section>
      </div>
    </div>
  );
}
