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

type MatchStatus = 'matched' | 'check' | 'needs_artist' | 'not_found' | 'error';
interface MatchInfo {
  status: MatchStatus;
  message: string;
  url: string | null;
}
interface MatchResult extends MatchInfo {
  fill: Partial<Record<'artist' | 'album' | 'year' | 'genre' | 'isrc', string>>;
}

/** A CSV row plus a stable key (rows can be edited, added and removed while details are looked up). */
interface SheetRow extends SommCsvRow {
  key: number;
  match?: MatchInfo;
}

interface ConvertedPlaylist {
  name: string;
  provider: string;
  rows: SheetRow[];
  errors: { row: number; message: string }[];
  notes: string[];
}

type Tab = 'paste' | 'file' | 'link';
type LinkSource = 'spotify' | 'youtube' | 'apple_music';

const EDITABLE: { key: 'title' | 'artist' | 'album' | 'genre' | 'year'; label: string; width: string }[] = [
  { key: 'title', label: 'Title', width: '23%' },
  { key: 'artist', label: 'Artist', width: '19%' },
  { key: 'album', label: 'Album', width: '18%' },
  { key: 'genre', label: 'Genre', width: '16%' },
  { key: 'year', label: 'Year', width: '10%' },
];
const PAGE = 50;
const MATCH_BATCH = 5;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 12 * 1024 * 1024;

const MATCH_BADGE: Record<MatchStatus, { label: string; cls: string }> = {
  matched: { label: '✓ Matched', cls: 'badge-verified' },
  check: { label: 'Check', cls: 'badge-orange' },
  needs_artist: { label: 'Add artist', cls: 'badge-inferred' },
  not_found: { label: 'Not found', cls: '' },
  error: { label: 'Try again', cls: 'badge-inferred' },
};

let nextKey = 1;
const keyed = (r: SommCsvRow): SheetRow => ({ ...r, key: nextKey++ });

const isComplete = (r: SommCsvRow) => r.title.trim() !== '' && r.artist.trim() !== '';
/** Rows "Find song details" can still help with. */
const wantsDetails = (r: SheetRow) =>
  r.title.trim() !== '' && r.match?.status !== 'matched' && r.match?.status !== 'check' && (!r.artist.trim() || !r.genre.trim() || !r.album.trim() || !r.year.trim());

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
          <strong>Quickest:</strong> in the Spotify app on a computer, open the playlist, click one song, press <kbd>Ctrl</kbd>+<kbd>A</kbd> (
          <kbd>⌘</kbd>+<kbd>A</kbd> on a Mac) and then <kbd>Ctrl</kbd>+<kbd>C</kbd>, and paste under “Paste a list”. SOMM reads each song’s title from
          its link; Spotify’s links do not include the artist, so use “Find song details” or type the artists. <strong>Most complete:</strong> request
          your data under <em>Privacy settings → Download your data</em> and upload <code>Playlist1.json</code> — every playlist becomes its own CSV,
          artists included. An Exportify CSV works too.
        </dd>
        <dt>YouTube and YouTube Music</dt>
        <dd>
          Whole playlists work under “Playlist link” when this server has a YouTube API key. You can always paste video links or video titles under
          “Paste a list” — titles like “Artist - Song (Official Video)” are cleaned up automatically.
        </dd>
        <dt>SoundCloud</dt>
        <dd>Paste track links (SOMM reads each track’s title and uploader) or track names. SoundCloud playlists cannot be read by link.</dd>
        <dt>Apple Music or iTunes</dt>
        <dd>
          In the Music app on a Mac or iTunes on Windows, select the playlist, then <em>File → Library → Export Playlist…</em> and save as text. Upload
          the <code>.txt</code> file here.
        </dd>
        <dt>VLC, foobar2000, MusicBee, Winamp and other players</dt>
        <dd>Save the playlist as M3U, M3U8 or XSPF and upload it. Only song details are read; file paths are ignored.</dd>
        <dt>Anything else</dt>
        <dd>Paste one song per line — “Artist - Title”, or just the song title — or a table copied from a spreadsheet whose first row names the columns.</dd>
      </dl>
    </details>
  );
}

function MatchBadge({ match }: { match?: MatchInfo }) {
  if (!match) return null;
  const b = MATCH_BADGE[match.status];
  const badge = (
    <span className={`badge ${b.cls}`} title={match.message}>
      {b.label}
    </span>
  );
  return (
    <>
      {match.url ? (
        <a href={match.url} target="_blank" rel="noopener noreferrer" aria-label={`${b.label}: open in MusicBrainz`}>
          {badge}
        </a>
      ) : (
        badge
      )}
      <span className="sr-only">{match.message}</span>
    </>
  );
}

function Sheet({ playlist, onChange }: { playlist: ConvertedPlaylist; onChange: (update: (rows: SheetRow[]) => SheetRow[]) => void }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(playlist.rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const start = current * PAGE;
  const shown = playlist.rows.slice(start, start + PAGE);
  const showStatus = playlist.rows.some((r) => r.match);

  const update = (key: number, field: keyof SommCsvRow, value: string) => onChange((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const remove = (key: number) => onChange((rows) => rows.filter((r) => r.key !== key));

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
              {showStatus && (
                <th scope="col" style={{ width: 112 }}>
                  Details
                </th>
              )}
              <th scope="col" style={{ width: 52 }}>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, j) => {
              const i = start + j;
              return (
                <tr key={row.key} className={isComplete(row) ? undefined : 'sheet-incomplete'}>
                  <td className="faint num">{i + 1}</td>
                  {EDITABLE.map((c) => (
                    <td key={c.key}>
                      <input
                        className="sheet-input"
                        value={row[c.key]}
                        aria-label={`${c.label}, song ${i + 1}`}
                        aria-invalid={(c.key === 'title' || c.key === 'artist') && !row[c.key].trim() ? true : undefined}
                        maxLength={c.key === 'year' ? 10 : 300}
                        onChange={(e) => update(row.key, c.key, e.target.value)}
                      />
                    </td>
                  ))}
                  {showStatus && (
                    <td>
                      <MatchBadge match={row.match} />
                    </td>
                  )}
                  <td>
                    <button type="button" className="icon-btn" aria-label={`Remove song ${i + 1}`} onClick={() => remove(row.key)}>
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => (onChange((rows) => [...rows, keyed(emptyCsvRow())]), setPage(Math.floor(playlist.rows.length / PAGE)))}>
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
  const providers = useApi<{ providers: ProviderStatus[]; enrichment: { enabled: boolean; reason: string | null } }>('/api/providers');
  const [tab, setTab] = useState<Tab>('paste');
  const [paste, setPaste] = useState('');
  const [pasteName, setPasteName] = useState('');
  const [linkSource, setLinkSource] = useState<LinkSource>('youtube');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<ConvertedPlaylist[] | null>(null);
  const [active, setActive] = useState(0);
  const [matching, setMatching] = useState<{ done: number; total: number } | null>(null);
  const stopMatching = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const native = isNativeApp();
  const matchingAvailable = providers.data?.enrichment?.enabled ?? false;

  const convert = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ playlists: (Omit<ConvertedPlaylist, 'rows'> & { rows: SommCsvRow[] })[] }>('/api/convert', body);
      setPlaylists(r.playlists.map((p) => ({ ...p, rows: p.rows.map(keyed) })));
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
  const lookupTargets = useMemo(() => playlist?.rows.filter(wantsDetails) ?? [], [playlist]);
  const csvFor = (p: ConvertedPlaylist) => toSommCsv(p.rows.filter(isComplete));

  const updateRows = (index: number, update: (rows: SheetRow[]) => SheetRow[]) =>
    setPlaylists((ps) => ps && ps.map((p, i) => (i === index ? { ...p, rows: update(p.rows) } : p)));
  const rename = (name: string) => setPlaylists((ps) => ps && ps.map((p, i) => (i === active ? { ...p, name } : p)));

  /** Looks songs up a few at a time so progress shows and the listener can stop. Only empty cells are filled. */
  const findDetails = async () => {
    const index = active;
    const targets = lookupTargets;
    if (targets.length === 0) return;
    stopMatching.current = false;
    setError(null);
    setMatching({ done: 0, total: targets.length });
    const tally: Record<MatchStatus, number> = { matched: 0, check: 0, needs_artist: 0, not_found: 0, error: 0 };
    for (let i = 0; i < targets.length && !stopMatching.current; i += MATCH_BATCH) {
      const batch = targets.slice(i, i + MATCH_BATCH);
      try {
        const r = await api.post<{ results: MatchResult[] }>('/api/convert/match', {
          rows: batch.map((b) => ({ title: b.title, artist: b.artist, album: b.album, year: b.year, genre: b.genre, isrc: b.isrc })),
        });
        updateRows(index, (rows) =>
          rows.map((row) => {
            const k = batch.findIndex((b) => b.key === row.key);
            const res = k >= 0 ? r.results[k] : undefined;
            if (!res) return row;
            tally[res.status]++;
            const fill = Object.fromEntries(Object.entries(res.fill).filter(([field, value]) => value && !row[field as keyof SommCsvRow].trim()));
            return { ...row, ...fill, match: { status: res.status, message: res.message, url: res.url } };
          }),
        );
      } catch (err) {
        setError(errorMessage(err));
        break;
      }
      setMatching({ done: Math.min(i + MATCH_BATCH, targets.length), total: targets.length });
    }
    setMatching(null);
    const parts = [
      tally.matched && `${tally.matched} matched`,
      tally.check && `${tally.check} to check`,
      tally.needs_artist && `${tally.needs_artist} need an artist`,
      tally.not_found && `${tally.not_found} not found`,
      tally.error && `${tally.error} to retry`,
    ].filter(Boolean);
    if (parts.length) toast(`Song details: ${parts.join(', ')}.`, tally.matched || tally.check ? 'success' : 'info');
  };

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
  const linkConfigured = !!linkStatus && (linkStatus.state === 'available' || linkStatus.state === 'connected');
  // YouTube links use the server's API key; Spotify and Apple Music read your own account.
  const linkNeedsSignIn = linkSource !== 'youtube' && !me;
  const linkUsable = linkConfigured && !linkNeedsSignIn;

  if (playlists && playlist) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <p className="eyebrow">Step 2 · Check every song</p>
            <h1>Your playlist as a CSV</h1>
            <p className="lead">Fix anything that was read wrongly, fill in missing details, and every row becomes one song when you import the file.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!matching} onClick={() => (setPlaylists(null), setError(null))}>
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
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActive(i)} disabled={p.rows.length === 0 || !!matching}>
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

          <div className="panel panel-tight stack" style={{ background: 'var(--surface-2)' }} aria-labelledby="find-title">
            <h3 id="find-title" style={{ margin: 0 }}>
              Find song details
            </h3>
            <p className="small muted" style={{ margin: 0 }}>
              Looks each song up in MusicBrainz, the open music database, and fills in a missing artist, album, year and genre — the genre is what
              places a song on your Music Map. Only empty cells are filled. Songs with an artist match best. For a title alone, SOMM asks Wikidata
              for the performer of the best-known song with that title and uses it only if MusicBrainz confirms it — check those rows.
            </p>
            {matching ? (
              <div className="stack" role="status" aria-live="polite">
                <progress max={matching.total} value={matching.done} style={{ width: '100%' }} />
                <div className="row-between small">
                  <span>
                    Looked up {matching.done} of {matching.total} songs…
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => (stopMatching.current = true)}>
                    Stop
                  </button>
                </div>
              </div>
            ) : matchingAvailable ? (
              <div className="row">
                <button type="button" className="btn btn-blue" disabled={lookupTargets.length === 0} onClick={() => void findDetails()}>
                  {lookupTargets.length === 0
                    ? 'All songs have details'
                    : `Find details for ${lookupTargets.length} song${lookupTargets.length === 1 ? '' : 's'}`}
                </button>
                {lookupTargets.length > 0 && <span className="small faint">About {Math.max(1, Math.ceil((lookupTargets.length * 2.5) / 60))} min — MusicBrainz allows one lookup a second.</span>}
              </div>
            ) : (
              <p className="small faint" style={{ margin: 0 }}>
                Song lookups are not available on this server{providers.data?.enrichment?.reason ? ` — ${providers.data.enrichment.reason}` : '.'}
              </p>
            )}
            <p className="xsmall faint" style={{ margin: 0 }}>
              Song details from <a href="https://musicbrainz.org" target="_blank" rel="noopener noreferrer">MusicBrainz</a> (core data CC0; genres CC BY-NC-SA
              3.0); artist suggestions for titles from <a href="https://www.wikidata.org" target="_blank" rel="noopener noreferrer">Wikidata</a> (CC0).
            </p>
          </div>

          <Sheet key={active} playlist={playlist} onChange={(update) => updateRows(active, update)} />
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
            <button type="button" className="btn btn-primary" disabled={complete.length === 0 || !!matching} onClick={importNow}>
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
            Turn a playlist from almost any app into SOMM’s CSV format — one row per song — then fill in the details, download it and import that same
            file. No account is needed to convert, and nothing you convert is stored.
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
                <label htmlFor="conv-paste">Song names, video titles or links — one per line</label>
                <textarea
                  id="conv-paste"
                  className="textarea"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder={'Artist - Title\nJust a song title\nArtist - Song (Official Video)\nhttps://open.spotify.com/track/…\nhttps://www.youtube.com/watch?v=…\nhttps://soundcloud.com/artist/track'}
                />
                <span className="hint">
                  Links from Spotify, YouTube and SoundCloud are turned into song names. A table copied from a spreadsheet with a header row works too.
                </span>
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
                  const ready = st && (st.state === 'available' || st.state === 'connected');
                  return (
                    <label key={value} className="choice">
                      <input type="radio" name="link-source" value={value} checked={linkSource === value} onChange={() => setLinkSource(value)} />
                      <strong>{label}</strong>
                      <span className="small muted">
                        {!st ? '…' : ready ? 'Ready' : st.state === 'needs_connection' ? 'Connect it on the Import page first' : 'Not set up on this server'}
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
                  disabled={!linkUsable}
                  placeholder={linkSource === 'youtube' ? 'https://www.youtube.com/playlist?list=…' : linkSource === 'spotify' ? 'https://open.spotify.com/playlist/…' : 'https://music.apple.com/…/playlist/…'}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy || !linkUsable || !url.trim()}>
                Convert
              </button>
              {!linkConfigured ? (
                <div className="small muted stack" style={{ gap: 'var(--space-2)' }}>
                  {linkSource === 'youtube' ? (
                    <p style={{ margin: 0 }}>
                      Reading a whole YouTube playlist needs a free YouTube Data API key on this server. Until it is added, paste the video links or
                      video titles under “Paste a list” — SOMM reads each video’s name and cleans up titles like “(Official Video)”.
                    </p>
                  ) : linkSource === 'spotify' ? (
                    <p style={{ margin: 0 }}>
                      Spotify playlist links cannot be read on this server. Instead, open the playlist in the Spotify app, click one song, press
                      Ctrl+A then Ctrl+C, and paste the song links under “Paste a list”.
                    </p>
                  ) : (
                    <p style={{ margin: 0 }}>Apple Music links need an Apple Developer key on this server. Export the playlist as text instead (see below).</p>
                  )}
                  <div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTab('paste')}>
                      Go to “Paste a list”
                    </button>
                  </div>
                </div>
              ) : linkNeedsSignIn ? (
                <p className="small muted" style={{ margin: 0 }}>
                  <Link to="/signin?next=%2Fconvert">Sign in</Link> to convert a Spotify or Apple Music playlist link. YouTube links, files and pasted lists
                  work without an account.
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
