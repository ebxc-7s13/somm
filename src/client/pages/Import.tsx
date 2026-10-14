import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { ProviderName } from '../components/Badges';
import { Icon } from '../components/Icon';
import { ErrorState, Loading, Spinner } from '../components/States';
import { useApi, useDocumentTitle } from '../hooks';
import { detectSource, readTextFile, takeCsvHandoff } from '../fileText';
import { Link, useNavigate, useQuery } from '../router';
import { useToast } from '../state';
import type { PreviewEntry, PreviewResult, ProviderStatus } from '../types';

type Source = 'sample' | 'file' | 'paste' | 'manual' | 'spotify' | 'youtube' | 'apple_music';

const SOURCES: { id: Source; label: string; provider?: string }[] = [
  { id: 'file', label: 'Upload a file' },
  { id: 'paste', label: 'Paste a list' },
  { id: 'manual', label: 'Add songs' },
  { id: 'spotify', label: 'Spotify', provider: 'spotify' },
  { id: 'youtube', label: 'YouTube', provider: 'youtube' },
  { id: 'apple_music', label: 'Apple Music', provider: 'apple_music' },
  { id: 'sample', label: 'Fictional sample' },
];

const STATE_TEXT: Record<ProviderStatus['state'], string> = {
  available: 'Available',
  connected: 'Connected',
  needs_connection: 'Connect to use',
  needs_credentials: 'Not configured on this server',
  unavailable: 'Unavailable',
};

function ProviderNotice({ status }: { status?: ProviderStatus }) {
  if (!status) return null;
  return (
    <div className="panel panel-tight" style={{ background: 'var(--surface-2)' }}>
      <div className="row-between">
        <strong>{status.label}</strong>
        <span className={`badge ${status.state === 'available' || status.state === 'connected' ? 'badge-verified' : status.state === 'needs_connection' ? 'badge-community' : 'badge-inferred'}`}>
          {STATE_TEXT[status.state]}
        </span>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        {status.summary}
      </p>
      {status.limitations.length > 0 && (
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          {status.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <p className="xsmall faint" style={{ marginTop: 8, marginBottom: 0 }}>
        Capabilities checked against the provider’s documentation on {status.verifiedAt}.
      </p>
    </div>
  );
}

interface ManualRow {
  title: string;
  artist: string;
  album: string;
  year: string;
  genre: string;
}
const emptyRow = (): ManualRow => ({ title: '', artist: '', album: '', year: '', genre: '' });

function ManualEntry({ onPreview, busy }: { onPreview: (rows: ManualRow[]) => void; busy: boolean }) {
  const [rows, setRows] = useState<ManualRow[]>([emptyRow()]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ title: string; artist: string; album: string | null; year: string | null; mbid: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 3) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.get<{ musicbrainz: typeof results; musicbrainzEnabled: boolean; musicbrainzError: string | null }>(`/api/catalog/search?q=${encodeURIComponent(q)}`);
        setResults(r.musicbrainz);
        setSearchNote(!r.musicbrainzEnabled ? 'Song search needs MusicBrainz to be configured on this server — you can still type songs below.' : r.musicbrainzError);
      } catch (err) {
        setSearchNote(errorMessage(err));
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => window.clearTimeout(t);
  }, [q]);

  const update = (i: number, patch: Partial<ManualRow>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const valid = rows.filter((r) => r.title.trim() && r.artist.trim());

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="song-search">Search for a song (MusicBrainz)</label>
        <input id="song-search" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. song title and artist" />
        {searching && <Spinner label="Searching…" />}
        {searchNote && <span className="hint">{searchNote}</span>}
        {results.length > 0 && (
          <ul className="list-plain" aria-label="Search results">
            {results.map((r) => (
              <li key={r.mbid} className="list-item">
                <span className="truncate" style={{ flex: 1 }}>
                  <strong>{r.title}</strong> — {r.artist} {r.year && <span className="faint">({r.year})</span>}
                </span>
                <button
                  type="button"
                  className="btn btn-blue btn-sm"
                  onClick={() => {
                    setRows((rs) => [...rs.filter((x) => x.title || x.artist), { title: r.title, artist: r.artist, album: r.album ?? '', year: r.year ?? '', genre: '' }]);
                    setQ('');
                  }}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {rows.map((row, i) => (
        <fieldset key={i} className="panel panel-tight" style={{ border: '1px solid var(--line)' }}>
          <legend className="small muted">Song {i + 1}</legend>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <div className="field">
              <label htmlFor={`t${i}`}>Title</label>
              <input id={`t${i}`} className="input" value={row.title} onChange={(e) => update(i, { title: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`a${i}`}>Artist</label>
              <input id={`a${i}`} className="input" value={row.artist} onChange={(e) => update(i, { artist: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`al${i}`}>Album (optional)</label>
              <input id={`al${i}`} className="input" value={row.album} onChange={(e) => update(i, { album: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`y${i}`}>Year</label>
              <input id={`y${i}`} className="input" inputMode="numeric" maxLength={4} value={row.year} onChange={(e) => update(i, { year: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`g${i}`}>Genre (yours)</label>
              <input id={`g${i}`} className="input" value={row.genre} onChange={(e) => update(i, { genre: e.target.value })} />
            </div>
          </div>
          {rows.length > 1 && (
            <button type="button" className="link-btn small" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
              Remove song {i + 1}
            </button>
          )}
        </fieldset>
      ))}
      <div className="row">
        <button type="button" className="btn btn-ghost" onClick={() => setRows((r) => [...r, emptyRow()])}>
          <Icon name="plus" /> Another song
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || valid.length === 0} onClick={() => onPreview(valid)}>
          Preview {valid.length} song{valid.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}

const STATUS_BADGE: Record<PreviewEntry['status'], { label: string; cls: string }> = {
  new: { label: 'New', cls: 'badge-verified' },
  in_library: { label: 'In your library', cls: 'badge-community' },
  duplicate: { label: 'Duplicate', cls: 'badge-inferred' },
  alternate_version: { label: 'Different version', cls: 'badge-user' },
  review: { label: 'Check artist', cls: 'badge-orange' },
};

function PreviewPanel({ preview, onCommitted, onBack }: { preview: PreviewResult; onCommitted: (jobId: string) => void; onBack: () => void }) {
  const [name, setName] = useState(preview.playlist.name);
  const [visibility, setVisibility] = useState<'private' | 'shared' | 'public'>('private');
  const [included, setIncluded] = useState<Set<number>>(() => new Set(preview.entries.filter((e) => !e.skipByDefault).map((e) => e.row)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const s = preview.summary;

  const commit = async () => {
    setBusy(true);
    setError(null);
    const skipRows = preview.entries.filter((e) => !included.has(e.row) && !e.skipByDefault).map((e) => e.row);
    const includeRows = preview.entries.filter((e) => included.has(e.row) && e.skipByDefault).map((e) => e.row);
    try {
      const r = await api.post<{ jobId: string }>(`/api/imports/${preview.draftId}/commit`, { name, visibility, skipRows, includeRows });
      onCommitted(r.jobId);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const shown = showAll ? preview.entries : preview.entries.slice(0, 60);
  return (
    <div className="stack-lg">
      <div className="panel panel-accent">
        <div className="row-between">
          <div>
            <p className="eyebrow">Step 2 · Review</p>
            <h2 style={{ margin: 0 }}>{preview.playlist.name}</h2>
            <p className="small muted">
              From <ProviderName id={preview.playlist.provider} />
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
            Choose a different source
          </button>
        </div>
        <div className="stats" style={{ marginTop: 'var(--space-4)' }}>
          <div className="stat"><b className="num">{included.size}</b><span>to import</span></div>
          <div className="stat"><b className="num">{s.duplicates}</b><span>duplicates</span></div>
          <div className="stat"><b className="num">{s.alternateVersions}</b><span>other versions</span></div>
          <div className="stat"><b className="num">{s.inLibrary}</b><span>already yours</span></div>
          <div className="stat"><b className="num">{s.invalid}</b><span>unreadable rows</span></div>
        </div>
      </div>

      {preview.notes.length > 0 && (
        <div className="panel panel-tight" role="note">
          <strong className="small">About this source</strong>
          <ul className="small muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {preview.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {preview.errors.length > 0 && (
        <details className="disclose">
          <summary>
            {preview.errors.length} row{preview.errors.length === 1 ? '' : 's'} could not be read
          </summary>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            {preview.errors.slice(0, 100).map((e) => (
              <li key={e.row}>
                Row {e.row}: {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      <section className="panel" aria-labelledby="detected">
        <div className="row-between">
          <h3 id="detected" style={{ margin: 0 }}>
            Detected tracks
          </h3>
          <div className="row small">
            <button type="button" className="link-btn" onClick={() => setIncluded(new Set(preview.entries.map((e) => e.row)))}>
              Include all
            </button>
            <button type="button" className="link-btn" onClick={() => setIncluded(new Set(preview.entries.filter((e) => !e.skipByDefault).map((e) => e.row)))}>
              Reset
            </button>
          </div>
        </div>
        <ul className="track-list" style={{ marginTop: 'var(--space-3)' }}>
          {shown.map((e) => (
            <li key={e.row} className="list-item" style={{ background: 'transparent', border: 0, borderBottom: '1px solid var(--line)', borderRadius: 0 }}>
              <input
                type="checkbox"
                id={`row-${e.row}`}
                checked={included.has(e.row)}
                onChange={(ev) =>
                  setIncluded((set) => {
                    const next = new Set(set);
                    if (ev.target.checked) next.add(e.row);
                    else next.delete(e.row);
                    return next;
                  })
                }
                style={{ width: 20, height: 20, accentColor: 'var(--yellow)' }}
              />
              <label htmlFor={`row-${e.row}`} style={{ flex: 1, minWidth: 0 }}>
                <span className="clamp-2">
                  <strong>{e.title}</strong> <span className="muted">— {e.artists.join(', ')}</span>
                </span>
                {e.notes.length > 0 && <span className="xsmall faint">{e.notes.join(' ')}</span>}
              </label>
              <span className={`badge ${STATUS_BADGE[e.status].cls}`}>{STATUS_BADGE[e.status].label}</span>
            </li>
          ))}
        </ul>
        {preview.entries.length > 60 && !showAll && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 'var(--space-3)' }} onClick={() => setShowAll(true)}>
            Show all {preview.entries.length}
          </button>
        )}
      </section>

      <section className="panel" aria-labelledby="save">
        <h3 id="save">Step 3 · Save</h3>
        <div className="field">
          <label htmlFor="pl-name">Playlist name</label>
          <input id="pl-name" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </div>
        <fieldset className="choice-group">
          <legend className="label" style={{ marginBottom: 8 }}>
            Who can use this playlist?
          </legend>
          {(
            [
              ['private', 'Private', 'Only you. Used for your own map and recommendations.'],
              ['shared', 'Shared for matching', 'Used anonymously for matching and Tree statistics. Tracks are never listed.'],
              ['public', 'Public', 'Listed on your public profile, if your profile is visible.'],
            ] as const
          ).map(([value, label, desc]) => (
            <label key={value} className="choice">
              <input type="radio" name="visibility" value={value} checked={visibility === value} onChange={() => setVisibility(value)} />
              <strong>{label}</strong>
              <span className="small muted">{desc}</span>
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="btn btn-primary btn-lg" disabled={busy || included.size === 0} onClick={commit}>
          {busy ? 'Importing…' : `Import ${included.size} track${included.size === 1 ? '' : 's'}`}
        </button>
      </section>
    </div>
  );
}

export function ImportFlow({ onCommitted, initialSource = 'file' }: { onCommitted: (jobId: string) => void; initialSource?: Source }) {
  const query = useQuery();
  const providers = useApi<{ providers: ProviderStatus[]; enrichment: { enabled: boolean; reason: string | null } }>('/api/providers');
  const [source, setSource] = useState<Source>((query.get('provider') as Source) || initialSource);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [pasteName, setPasteName] = useState('');
  const [url, setUrl] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const spotifyPlaylists = useApi<{ playlists: { id: string; name: string; owner: string; importable: boolean; trackCount: number | null }[] }>(
    source === 'spotify' && providers.data?.providers.find((p) => p.id === 'spotify')?.state === 'connected' ? '/api/providers/spotify/playlists' : null,
  );

  useEffect(() => {
    const err = query.get('error');
    if (err) setError(err);
    if (query.get('connected')) toast('Spotify connected.', 'success');
  }, [query, toast]);

  const statusFor = (id?: string) => providers.data?.providers.find((p) => p.id === id);

  const run = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.post<PreviewResult>('/api/imports/preview', body));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // A CSV made on the converter page: import exactly that file.
  const handoffDone = useRef(false);
  useEffect(() => {
    if (handoffDone.current || query.get('from') !== 'convert') return;
    handoffDone.current = true;
    const handoff = takeCsvHandoff();
    if (handoff) void run({ source: 'csv', content: handoff.csv, fileName: handoff.fileName, name: handoff.name });
    else setError('The converted CSV was not found in this browser tab. Upload the downloaded file under “Upload a file”.');
    // Once per visit: run is recreated every render, so depending on it would import the same CSV repeatedly.
  }, [query]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setError('Files are limited to 2 MB. Split large exports into several files.');
    await run({ source: detectSource(file.name), content: await readTextFile(file), fileName: file.name });
  };

  const sample = async () => {
    setBusy(true);
    try {
      const s = await api.get<{ csv: string; fileName: string }>('/api/samples/library');
      await run({ source: 'csv', content: s.csv, fileName: s.fileName });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const submitUrl = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) void run({ source, playlist: url.trim() });
  };

  if (preview) return <PreviewPanel preview={preview} onCommitted={onCommitted} onBack={() => setPreview(null)} />;

  const providerSource = SOURCES.find((s) => s.id === source)?.provider;
  const status = statusFor(providerSource);
  const providerUsable = status && (status.state === 'available' || status.state === 'connected');

  return (
    <div className="stack-lg">
      <div className="tabs" role="tablist" aria-label="Music source">
        {SOURCES.map((s) => {
          const st = statusFor(s.provider);
          return (
            <button key={s.id} type="button" role="tab" aria-selected={source === s.id} onClick={() => (setSource(s.id), setError(null), setUrl(''))}>
              {s.label}
              {st && st.state === 'needs_credentials' && <span className="faint xsmall"> (setup needed)</span>}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="stack">
        {source === 'file' && (
          <>
            <div
              className="state"
              style={{ borderColor: drag ? 'var(--yellow)' : undefined, cursor: 'pointer' }}
              onDragOver={(e) => (e.preventDefault(), setDrag(true))}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                void onFile(e.dataTransfer.files[0]);
              }}
            >
              <Icon name="upload" size={40} />
              <h2>Drop a playlist file</h2>
              <p className="muted small">
                CSV (title, artist, album, genre, year, duration, isrc, instruments…), Exportify CSV exports from Spotify, Apple Music / iTunes exported
                playlists (.txt), M3U/M3U8, XSPF, Spotify data-export or SOMM JSON. Up to 2 MB / 5,000 tracks.
              </p>
              <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
                Choose a file
              </button>
              <input ref={fileRef} type="file" accept=".csv,.m3u,.m3u8,.xspf,.json,.txt,text/csv" className="sr-only" aria-label="Playlist file" onChange={(e) => void onFile(e.target.files?.[0])} />
            </div>
            <p className="small muted">SOMM reads only song metadata from the file. File paths and audio are never read or stored.</p>
            <p className="small muted">
              Playlist in another format, or want to check and fix every song first? <Link to="/convert">Convert it to a SOMM CSV</Link>.
            </p>
          </>
        )}

        {source === 'paste' && (
          <form
            className="panel"
            onSubmit={(e) => {
              e.preventDefault();
              void run({ source: 'text', content: paste, name: pasteName || 'Pasted list' });
            }}
          >
            <div className="field">
              <label htmlFor="paste">One song per line</label>
              <textarea id="paste" className="textarea" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Artist - Title\n"Title" by Artist'} />
              <span className="hint">Formats: “Artist - Title”, “Title by Artist”, or “Title [tab] Artist”.</span>
            </div>
            <div className="field">
              <label htmlFor="paste-name">Playlist name</label>
              <input id="paste-name" className="input" value={pasteName} onChange={(e) => setPasteName(e.target.value)} placeholder="Pasted list" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy || !paste.trim()}>
              Preview
            </button>
          </form>
        )}

        {source === 'manual' && (
          <div className="panel">
            <ManualEntry busy={busy} onPreview={(rows) => void run({ source: 'manual', entries: rows, name: 'Added manually' })} />
          </div>
        )}

        {source === 'sample' && (
          <div className="panel">
            <h3>Try SOMM with a fictional library</h3>
            <p className="muted">
              32 invented tracks by invented artists — electronic, ambient and jazz, with a remix, a few missing genres and some instrument tags. It
              overlaps with SOMM’s fictional demo listeners, so you can see matching and Trees work end to end.
            </p>
            <button type="button" className="btn btn-primary" onClick={sample} disabled={busy}>
              Use the fictional sample library
            </button>
          </div>
        )}

        {providerSource && (
          <>
            <ProviderNotice status={status} />
            {source === 'spotify' && status?.state === 'needs_connection' && (
              <button
                type="button"
                className="btn btn-blue"
                onClick={async () => {
                  try {
                    const r = await api.get<{ url: string }>('/api/providers/spotify/authorize');
                    window.location.assign(r.url);
                  } catch (err) {
                    setError(errorMessage(err));
                  }
                }}
              >
                Connect Spotify
              </button>
            )}
            {source === 'spotify' && status?.state === 'connected' && (
              <div className="panel">
                <div className="row-between">
                  <h3 style={{ margin: 0 }}>Your Spotify playlists</h3>
                  <button
                    type="button"
                    className="link-btn small"
                    onClick={async () => {
                      await api.del('/api/providers/spotify');
                      providers.reload();
                    }}
                  >
                    Disconnect Spotify
                  </button>
                </div>
                {spotifyPlaylists.loading && <Loading />}
                {spotifyPlaylists.error && <ErrorState error={spotifyPlaylists.error} onRetry={spotifyPlaylists.reload} />}
                <ul className="list-plain" style={{ marginTop: 'var(--space-3)' }}>
                  {spotifyPlaylists.data?.playlists.map((p) => (
                    <li key={p.id} className="list-item">
                      <span className="truncate" style={{ flex: 1 }}>
                        <strong>{p.name}</strong> <span className="faint small">by {p.owner}</span>
                      </span>
                      {p.importable ? (
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run({ source: 'spotify', playlist: p.id })}>
                          Preview
                        </button>
                      ) : (
                        <span className="badge badge-inferred" title="Spotify only returns tracks for playlists you own or collaborate on.">
                          Not readable
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(source !== 'spotify' || status?.state === 'connected') && (
              <form className="panel" onSubmit={submitUrl}>
                <div className="field">
                  <label htmlFor="pl-url">Playlist link</label>
                  <input
                    id="pl-url"
                    className="input"
                    inputMode="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={!providerUsable}
                    placeholder={source === 'youtube' ? 'https://www.youtube.com/playlist?list=…' : source === 'spotify' ? 'https://open.spotify.com/playlist/…' : 'https://music.apple.com/…/playlist/…'}
                  />
                </div>
                <button type="submit" className="btn btn-primary" disabled={busy || !providerUsable || !url.trim()}>
                  Preview playlist
                </button>
                {!providerUsable && (
                  <p className="small muted" style={{ marginTop: 8 }}>
                    This source cannot be used on this server yet. Export the playlist to CSV instead, or add songs manually.
                  </p>
                )}
              </form>
            )}
          </>
        )}

        {busy && <Spinner label="Reading your music…" />}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {providers.data && !providers.data.enrichment.enabled && (
          <p className="small faint">Automatic genre lookup is off on this server — {providers.data.enrichment.reason} Genres from your file are still used.</p>
        )}
      </div>
    </div>
  );
}

export function ImportPage() {
  useDocumentTitle('Import music');
  const navigate = useNavigate();
  const playlists = useApi<{ playlists: { id: string }[] }>('/api/playlists');
  const count = useMemo(() => playlists.data?.playlists.length ?? 0, [playlists.data]);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Step 1 · Bring your music</p>
          <h1>Import a playlist</h1>
          <p className="lead">Pick a source. You will see every detected track — duplicates, alternate versions and unreadable rows — before anything is saved.</p>
          <p className="small muted">
            Want to check every song before importing, or split a Spotify data export into playlists? <Link to="/convert">Use the playlist-to-CSV converter</Link>.
          </p>
        </div>
        {count > 0 && <span className="badge">{count} playlist{count === 1 ? '' : 's'} imported</span>}
      </div>
      <ImportFlow onCommitted={(jobId) => navigate(`/import/jobs/${jobId}`)} />
    </div>
  );
}
