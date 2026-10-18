/**
 * Music shared in a Tree: members share their own playlists with the Tree, and
 * everyone in it can open the song lists. Sharing never changes a playlist's own
 * privacy setting, and leaving the Tree removes your shares.
 */
import { useState } from 'react';
import { api, errorMessage } from '../api';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { useApi } from '../hooks';
import { Link, useNavigate, useQuery } from '../router';
import { useToast } from '../state';
import type { Playlist, SharedPlaylist, SharedTrack, TreeSummary } from '../types';

function ShareForm({ tree, onShared }: { tree: TreeSummary; onShared: () => void }) {
  const mine = useApi<{ playlists: Playlist[] }>('/api/playlists');
  const [playlistId, setPlaylistId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const playlists = (mine.data?.playlists ?? []).filter((p) => p.track_count > 0);

  const share = async () => {
    if (!playlistId) return;
    setBusy(true);
    try {
      await api.post(`/api/trees/${tree.slug}/shares`, { playlistId, note: note.trim() });
      toast('Shared with the Tree. Members can open it here and in the chat.', 'success');
      setNote('');
      setPlaylistId('');
      onShared();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack" aria-labelledby="share-music">
      <h2 id="share-music" style={{ margin: 0 }}>
        Share your music
      </h2>
      <p className="small muted" style={{ margin: 0 }}>
        Members of {tree.name} can open the songs of a playlist you share here. Its privacy setting for matching stays as it is, and you can remove the
        share at any time.
      </p>
      {mine.loading && <Loading lines={2} />}
      {mine.error && <ErrorState error={mine.error} onRetry={mine.reload} />}
      {mine.data && playlists.length === 0 && (
        <p className="small">
          You have no playlists yet. <Link to="/import">Import one</Link> first.
        </p>
      )}
      {playlists.length > 0 && (
        <>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="share-playlist" className="label">
              Playlist
            </label>
            <select id="share-playlist" className="select" value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
              <option value="">Choose one of your playlists…</option>
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.track_count} songs)
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="share-note" className="label">
              Say something about it (optional)
            </label>
            <input id="share-note" className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Late-night synthwave for coding…" />
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => void share()} disabled={!playlistId || busy}>
              <Icon name="note" size={18} /> {busy ? 'Sharing…' : 'Share with the Tree'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function PlaylistSongs({ tree, playlistId }: { tree: TreeSummary; playlistId: string }) {
  const { data, error, loading, reload } = useApi<{ playlist: SharedPlaylist; tracks: SharedTrack[] }>(`/api/trees/${tree.slug}/shares/${encodeURIComponent(playlistId)}`);
  const navigate = useNavigate();
  if (loading && !data) return <Loading lines={6} />;
  if (error) return <ErrorState error={error} onRetry={reload} title={error.status === 404 ? 'This playlist is no longer shared' : undefined} />;
  if (!data) return null;
  const p = data.playlist;
  return (
    <section className="panel stack" aria-labelledby="shared-playlist">
      <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => navigate(`/trees/${tree.slug}/music`)}>
        ← All shared music
      </button>
      <div>
        <h2 id="shared-playlist" style={{ margin: 0, overflowWrap: 'anywhere' }}>
          {p.name}
        </h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          {p.trackCount} song{p.trackCount === 1 ? '' : 's'} · shared by {p.mine ? 'you' : `${p.sharedBy.displayName} (@${p.sharedBy.handle})`} on{' '}
          {new Date(p.sharedAt).toLocaleDateString()}
        </p>
      </div>
      <ol className="shared-songs">
        {data.tracks.map((t) => (
          <li key={t.id}>
            <span className="shared-song-title">
              {t.title}
              {t.version ? <span className="faint"> ({t.version})</span> : null}
            </span>
            <span className="shared-song-meta">
              {t.artist}
              {t.album ? ` · ${t.album}` : ''}
              {t.year ? ` · ${t.year}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function TreeMusic({ tree, isModerator }: { tree: TreeSummary; isModerator: boolean }) {
  const shares = useApi<{ shares: SharedPlaylist[] }>(`/api/trees/${tree.slug}/shares`);
  const query = useQuery();
  const open = query.get('p');
  const toast = useToast();

  if (open) return <PlaylistSongs tree={tree} playlistId={open} />;

  const remove = async (s: SharedPlaylist) => {
    try {
      await api.del(`/api/trees/${tree.slug}/shares/${encodeURIComponent(s.playlistId)}`);
      toast(`Removed “${s.name}” from the Tree.`, 'success');
      shares.reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div className="split">
      <section className="stack" aria-labelledby="shared-list">
        <h2 id="shared-list" style={{ margin: 0 }}>
          Shared in {tree.name}
        </h2>
        {shares.loading && !shares.data && <Loading lines={4} />}
        {shares.error && <ErrorState error={shares.error} onRetry={shares.reload} />}
        {shares.data && shares.data.shares.length === 0 && (
          <EmptyState title="No shared music yet">Be the first: share one of your playlists, and members can open its songs.</EmptyState>
        )}
        <ul className="list-plain shared-grid">
          {shares.data?.shares.map((s) => (
            <li key={s.playlistId} className="shared-card">
              <Link to={`/trees/${tree.slug}/music?p=${encodeURIComponent(s.playlistId)}`} className="shared-card-main">
                <span className="shared-card-icon" aria-hidden="true">
                  <Icon name="note" size={22} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <strong className="clamp-2">{s.name}</strong>
                  <span className="xsmall muted" style={{ display: 'block' }}>
                    {s.trackCount} song{s.trackCount === 1 ? '' : 's'}
                    {s.topArtists.length ? ` · ${s.topArtists.join(', ')}` : ''}
                  </span>
                  <span className="xsmall faint" style={{ display: 'block' }}>
                    Shared by {s.mine ? 'you' : s.sharedBy.displayName} · {new Date(s.sharedAt).toLocaleDateString()}
                  </span>
                </span>
              </Link>
              {(s.mine || isModerator) && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(s)} aria-label={`Remove ${s.name} from the Tree`}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <ShareForm tree={tree} onShared={shares.reload} />
    </div>
  );
}
