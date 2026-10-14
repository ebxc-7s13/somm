import { useMemo, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { Icon } from '../components/Icon';
import { Spinner } from '../components/States';
import { detectSource, readTextFile, storeCsvHandoff } from '../fileText';
import { useApi, useDocumentTitle } from '../hooks';
import { isNativeApp } from '../install';
import { Link, useNavigate } from '../router';
import { useAuth, useToast } from '../state';
import type { ProviderStatus } from '../types';
import { csvFileName, emptyCsvRow, toSommCsv, type SommCsvRow } from '../../shared/csv';

interface ConvertedPlaylist {
  name: string;
  provider: string;
  rows: SommCsvRow[];
  errors: { row: number; message: string }[];
  notes: string[];
}

type Tab = 'paste' | 'file' | 'link';
type LinkSource = 'spotify' | 'youtube' | 'apple_music';

const EDITABLE: { key: 'title' | 'artist' | 'album' | 'genre' | 'year'; label: string; width: string }[] = [
  { key: 'title', label: 'Title', width: '24%' },
  { key: 'artist', label: 'Artist', width: '20%' },
  { key: 'album', label: 'Album', width: '20%' },
  { key: 'genre', label: 'Genre', width: '18%' },
  { key: 'year', label: 'Year', width: '9%' },
];
const PAGE = 50;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 12 * 1024 * 1024;

const isComplete = (r: SommCsvRow) => r.title.trim() !== '' && r.artist.trim() !== '';

function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SourceHelp() {
  return (
    <details className="disclose">
      <summary>Where do I get my playlist?</summary>
      <dl className="small muted help-list">
        <dt>Spotify</dt>
        <dd>
          In your Spotify account, open <em>Privacy settings → Download your data</em> and request your account data. Spotify emails a zip; upload{' '}
          <code>Playlist1.json</code> from it here and every playlist becomes its own CSV. A CSV from Exportify (a third-party exporter that signs in
          with Spotify) works too. Copying songs out of the Spotify app only gives links without names, so that does not work.
        </dd>
        <dt>Apple Music or iTunes</dt>
        <dd>
          In the Music app on a Mac or iTunes on Windows, select the playlist, then <em>File → Library → Export Playlist…</em> and save as text. Upload
          the <code>.txt</code> file here.
        </dd>
        <dt>YouTube and YouTube Music</dt>
        <dd>Playlist links work under “Playlist link” when this server has a YouTube API key. Otherwise paste “Artist - Title” lines.</dd>
        <dt>VLC, foobar2000, MusicBee, Winamp and other players</dt>
        <dd>Save the playlist as M3U, M3U8 or XSPF and upload it. Only song details are read; file paths are ignored.</dd>
        <dt>Anything else</dt>
        <dd>Paste one song per line (“Artist - Title”), or paste a table copied from a spreadsheet whose first row names the columns (title, artist, …).</dd>
      </dl>
    </details>
  );
}

function Sheet({ playlist, onChange }: { playlist: ConvertedPlaylist; onChange: (rows: SommCsvRow[]) => void }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(playlist.rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const start = current * PAGE;
  const shown = playlist.rows.slice(start, start + PAGE);

  const update = (index: number, key: keyof SommCsvRow, value: string) => onChange(playlist.rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  const remove = (index: number) => onChange(playlist.rows.filter((_, i) => i !== index));

  return (
    <div className="stack">
      <div className="sheet-wrap" role="region" aria-label="Songs in this playlist" tabIndex={0}>
        <table className="sheet">
          <thead>
            <tr>
              <th scope="col" style={{ width: 48 }}>
                #
              </th>
              {EDITABLE.map((c) => (
                <th key={c.key} scope="col" style={{ width: c.width }}>
                  {c.label}
                </th>
              ))}
              <th scope="col" style={{ width: 52 }}>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, j) => {
              const i = start + j;
              const incomplete = !isComplete(row);
              return (
                <tr key={i} className={incomplete ? 'sheet-incomplete' : undefined}>
                  <td className="faint num">{i + 1}</td>
                  {EDITABLE.map((c) => (
                    <td key={c.key}>
                      <input
                        className="sheet-input"
                        value={row[c.key]}
                        aria-label={`${c.label}, song ${i + 1}`}
                        aria-invalid={(c.key === 'title' || c.key === 'artist') && !row[c.key].trim() ? true : undefined}
                        maxLength={c.key === 'year' ? 10 : 300}
                        onChange={(e) => update(i, c.key, e.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    <button type="button" className="icon-btn" aria-label={`Remove song ${i + 1}`} onClick={() => remove(i)}>
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row-between small">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => (onChange([...playlist.rows, emptyCsvRow()]), setPage(Math.floor(playlist.rows.length / PAGE)))}>
          Add a song
        </button>
        {pages > 1 && (
          <div className="row" role="navigation" aria-label="Song pages">
            <button type="button" className="btn btn-ghost btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </button>
            <span className="muted">
              Songs {start + 1}–{Math.min(start + PAGE, playlist.rows.length)} of {playlist.rows.length}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ConvertPage() {
  useDocumentTitle('Playlist to CSV');
  const { me } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const providers = useApi<{ providers: ProviderStatus[] }>('/api/providers');
  const [tab, setTab] = useState<Tab>('paste');
  const [paste, setPaste] = useState('');
  const [pasteName, setPasteName] = useState('');
  const [linkSource, setLinkSource] = useState<LinkSource>('youtube');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<ConvertedPlaylist[] | null>(null);
  const [active, setActive] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const native = isNativeApp();

  const convert = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ playlists: ConvertedPlaylist[] }>('/api/convert', body);
      setPlaylists(r.playlists);
      setActive(Math.max(0, r.playlists.findIndex((p) => p.rows.length > 0)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const source = detectSource(file.name);
    const limit = source === 'json' ? MAX_JSON_BYTES : MAX_FILE_BYTES;
    if (file.size > limit) return setError(`This file is larger than ${limit / 1024 / 1024} MB. Split it into smaller files.`);
    await convert({ source, content: await readTextFile(file), fileName: file.name });
  };

  const playlist = playlists?.[active] ?? null;
  const complete = useMemo(() => playlist?.rows.filter(isComplete) ?? [], [playlist]);
  const missingGenre = complete.filter((r) => !r.genre.trim()).length;
  const csvFor = (p: ConvertedPlaylist) => toSommCsv(p.rows.filter(isComplete));

  const setRows = (rows: SommCsvRow[]) => setPlaylists((ps) => ps && ps.map((p, i) => (i === active ? { ...p, rows } : p)));
  const rename = (name: string) => setPlaylists((ps) => ps && ps.map((p, i) => (i === active ? { ...p, name } : p)));

  const importNow = () => {
    if (!playlist) return;
    const ok = storeCsvHandoff({ csv: csvFor(playlist), fileName: csvFileName(playlist.name), name: playlist.name });
    if (!ok) return setError('This playlist is too large to hand over directly. Download the CSV and upload it on the import page instead.');
    const target = '/import?from=convert';
    navigate(me ? target : `/signin?next=${encodeURIComponent(target)}`);
  };

  const copyCsv = async () => {
    if (!playlist) return;
    try {
      await navigator.clipboard.writeText(csvFor(playlist));
      toast('CSV copied. Paste it into a spreadsheet or a text file.', 'success');
    } catch {
      setError('Copying is not available here. Use Download CSV instead.');
    }
  };

  const linkStatus = providers.data?.providers.find((p) => p.id === linkSource);
  const linkUsable = !!linkStatus && (linkStatus.state === 'available' || linkStatus.state === 'connected');

  if (playlists && playlist) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <p className="eyebrow">Step 2 · Check every song</p>
            <h1>Your playlist as a CSV</h1>
            <p className="lead">Fix anything that was read wrongly and fill in genres you know. Every row becomes one song when you import the file.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setPlaylists(null), setError(null))}>
            Convert something else
          </button>
        </div>

        {playlists.length > 1 && (
          <section className="panel" aria-labelledby="pl-list">
            <h2 id="pl-list" style={{ marginTop: 0 }}>
              {playlists.length} playlists in this file
            </h2>
            <ul className="list-plain">
              {playlists.map((p, i) => (
                <li key={i} className="list-item">
                  <span className="truncate" style={{ flex: 1 }}>
                    <strong>{p.name}</strong> <span className="faint small">· {p.rows.filter(isComplete).length} songs</span>
                  </span>
                  {i === active ? (
                    <span className="badge badge-yellow">Editing</span>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActive(i)} disabled={p.rows.length === 0}>
                      Edit
                    </button>
                  )}
                  <button type="button" className="btn btn-blue btn-sm" disabled={p.rows.filter(isComplete).length === 0} onClick={() => downloadText(csvFor(p), csvFileName(p.name))}>
                    Download
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel stack" aria-labelledby="sheet-title">
          <h2 id="sheet-title" style={{ margin: 0 }}>
            Songs
          </h2>
          <div className="stats">
            <div className="stat">
              <b className="num">{complete.length}</b>
              <span>ready</span>
            </div>
            <div className="stat">
              <b className="num">{playlist.rows.length - complete.length}</b>
              <span>need a title or artist</span>
            </div>
            <div className="stat">
              <b className="num">{missingGenre}</b>
              <span>without a genre</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="conv-name">Playlist name</label>
            <input id="conv-name" className="input" value={playlist.name} maxLength={120} onChange={(e) => rename(e.target.value)} />
          </div>
          {playlist.notes.length > 0 && (
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {playlist.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {playlist.errors.length > 0 && (
            <details className="disclose">
              <summary>
                {playlist.errors.length} item{playlist.errors.length === 1 ? '' : 's'} in the source could not be read
              </summary>
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                {playlist.errors.slice(0, 100).map((e) => (
                  <li key={`${e.row}-${e.message}`}>
                    Item {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <Sheet key={active} playlist={playlist} onChange={setRows} />
          {missingGenre > 0 && (
            <p className="small faint" style={{ margin: 0 }}>
              Songs without a genre still import. SOMM looks genres up after import when its metadata service is enabled; otherwise they appear under
              “Genre unknown” on your map until you add one.
            </p>
          )}
        </section>

        <section className="panel stack" aria-labelledby="next-step">
          <h2 id="next-step" style={{ margin: 0 }}>
            Step 3 · Use the CSV
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            The file has one row per song with the columns SOMM reads: title, artist, album, genre, year, duration, ISRC, BPM, instruments, mood, tags
            and link. Rows without a title and artist are left out.
          </p>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={complete.length === 0} onClick={importNow}>
              {me ? 'Import this CSV into SOMM' : 'Sign in and import this CSV'}
            </button>
            <button type="button" className="btn btn-blue" disabled={complete.length === 0} onClick={() => downloadText(csvFor(playlist), csvFileName(playlist.name))}>
              <Icon name="download" size={18} /> Download CSV
            </button>
            <button type="button" className="btn btn-ghost" disabled={complete.length === 0} onClick={() => void copyCsv()}>
              Copy CSV
            </button>
          </div>
          {native && (
            <p className="small faint" style={{ margin: 0 }}>
              The Android app cannot save files yet. Use “Import this CSV” or “Copy CSV”, or open SOMM in your browser to download the file.
            </p>
          )}
          <p className="small faint" style={{ margin: 0 }}>
            A downloaded CSV can be uploaded again any time under <Link to="/import">Import → Upload a file</Link>.
          </p>
          {error && (
            <p className="error-text" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Step 1 · Bring your playlist</p>
          <h1>Convert a playlist to CSV</h1>
          <p className="lead">
            Turn a playlist from almost any app into SOMM’s CSV format — one row per song — then check it, download it and import that same file. No
            account is needed to convert, and nothing you convert is stored.
          </p>
        </div>
      </div>

      <div className="stack-lg">
        <div className="tabs" role="tablist" aria-label="Playlist source">
          {(
            [
              ['paste', 'Paste a list'],
              ['file', 'Upload a file'],
              ['link', 'Playlist link'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => (setTab(id), setError(null))}>
              {label}
            </button>
          ))}
        </div>

        <div role="tabpanel" className="stack">
          {tab === 'paste' && (
            <form
              className="panel"
              onSubmit={(e) => {
                e.preventDefault();
                void convert({ source: 'text', content: paste, name: pasteName || 'Pasted list' });
              }}
            >
              <div className="field">
                <label htmlFor="conv-paste">Songs, one per line — or a table with a header row</label>
                <textarea
                  id="conv-paste"
                  className="textarea"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder={'Artist - Title\n"Title" by Artist\n\nor paste spreadsheet rows whose first row is: title, artist, album, genre, year'}
                />
              </div>
              <div className="field">
                <label htmlFor="conv-paste-name">Playlist name</label>
                <input id="conv-paste-name" className="input" value={pasteName} onChange={(e) => setPasteName(e.target.value)} placeholder="Pasted list" />
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy || !paste.trim()}>
                Convert
              </button>
            </form>
          )}

          {tab === 'file' && (
            <div className="state">
              <Icon name="upload" size={40} />
              <h2>Upload a playlist file</h2>
              <p className="muted small">
                Spotify data export (Playlist1.json, up to 12 MB), Exportify or other CSV exports, Apple Music / iTunes exported playlists (.txt), M3U/M3U8,
                XSPF or JSON. Other files up to 2 MB.
              </p>
              <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
                Choose a file
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,.m3u,.m3u8,.xspf,.json,text/csv,text/plain,application/json"
                className="sr-only"
                aria-label="Playlist file to convert"
                onChange={(e) => {
                  void onFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          )}

          {tab === 'link' && (
            <form
              className="panel stack"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (url.trim()) void convert({ source: linkSource, playlist: url.trim() });
              }}
            >
              <fieldset className="choice-group">
                <legend className="label" style={{ marginBottom: 8 }}>
                  Service
                </legend>
                {(
                  [
                    ['youtube', 'YouTube / YouTube Music'],
                    ['spotify', 'Spotify'],
                    ['apple_music', 'Apple Music'],
                  ] as const
                ).map(([value, label]) => {
                  const st = providers.data?.providers.find((p) => p.id === value);
                  return (
                    <label key={value} className="choice">
                      <input type="radio" name="link-source" value={value} checked={linkSource === value} onChange={() => setLinkSource(value)} />
                      <strong>{label}</strong>
                      <span className="small muted">
                        {!st ? '…' : st.state === 'available' || st.state === 'connected' ? 'Ready' : st.state === 'needs_connection' ? 'Connect it on the Import page first' : 'Not set up on this server'}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              <div className="field">
                <label htmlFor="conv-url">Playlist link</label>
                <input
                  id="conv-url"
                  className="input"
                  inputMode="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={!linkUsable || !me}
                  placeholder={linkSource === 'youtube' ? 'https://www.youtube.com/playlist?list=…' : linkSource === 'spotify' ? 'https://open.spotify.com/playlist/…' : 'https://music.apple.com/…/playlist/…'}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy || !linkUsable || !me || !url.trim()}>
                Convert
              </button>
              {!me ? (
                <p className="small muted" style={{ margin: 0 }}>
                  <Link to="/signin?next=%2Fconvert">Sign in</Link> to convert a playlist link. Files and pasted lists work without an account.
                </p>
              ) : !linkUsable ? (
                <p className="small muted" style={{ margin: 0 }}>
                  Links only work for services this server is set up for, because song names come from each service’s official API — SOMM does not
                  scrape pages. Use an export file instead (see below).
                </p>
              ) : null}
            </form>
          )}

          {busy && <Spinner label="Reading your playlist…" />}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <SourceHelp />
        </div>
      </div>
    </div>
  );
}
