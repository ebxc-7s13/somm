/**
 * File and text import adapters. These always work — no credentials needed —
 * so nobody is blocked from SOMM by a provider integration.
 *
 * Nothing here fetches URLs found inside files (M3U/XSPF locations are ignored),
 * and XML input with DTDs/entities is rejected outright.
 */
import { cleanDisplayText, splitArtistList } from '../../../shared/normalize';
import { tagToAttribute } from '../../../shared/taxonomy';
import type { AttributeCategory } from '../../../shared/types';
import { IMPORT_LIMITS, ImportError, type ImportRowError, type RawEntry, type RawPlaylist } from '../types';

function assertSize(text: string) {
  if (Buffer.byteLength(text, 'utf8') > IMPORT_LIMITS.maxBytes) {
    throw new ImportError(`File is larger than ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB.`, 'too_large', 413);
  }
}

function field(v: string | undefined | null): string {
  return cleanDisplayText(v ?? '', IMPORT_LIMITS.maxFieldLength);
}

export function parseDuration(raw: string | undefined | null): number | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    // Heuristic: values under 10,000 are seconds, otherwise milliseconds.
    const ms = n < 10_000 ? n * 1000 : n;
    return ms > 0 && ms < 6 * 3600 * 1000 ? ms : null;
  }
  const m = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/);
  if (m) {
    const ms = ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
    return ms > 0 ? ms : null;
  }
  return null;
}

export function parseExplicit(raw: string | undefined | null): boolean | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (['true', 'yes', '1', 'explicit', 'y'].includes(v)) return true;
  if (['false', 'no', '0', 'clean', 'n'].includes(v)) return false;
  return null;
}

export function parseReleaseDate(raw: string | undefined | null): string | null {
  const v = (raw ?? '').trim();
  const m = v.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1800 || year > new Date().getUTCFullYear() + 1) return null;
  return m[0];
}

export function parseIsrc(raw: string | undefined | null): string | null {
  const v = (raw ?? '').replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(v) ? v : null;
}

function parseBpm(raw: string | undefined | null): number | null {
  const n = Number((raw ?? '').trim());
  return Number.isFinite(n) && n >= 20 && n <= 400 ? Math.round(n * 10) / 10 : null;
}

function splitList(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(/[;,|/]/)
    .map((s) => field(s))
    .filter((s) => s.length > 0 && s.length <= 60)
    .slice(0, 12);
}

// ------------------------------------------------------------------- CSV

/** RFC 4180 CSV parser with quote handling and delimiter auto-detection. */
export function parseCsvRows(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const firstLine = input.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': 0, ';': 0, '\t': 0 } as Record<string, number>;
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]!++;
  }
  const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0]
    : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADER_ALIASES: Record<string, string[]> = {
  title: ['title', 'track', 'track name', 'song', 'song name', 'song title', 'name', 'track title'],
  artist: ['artist', 'artists', 'artist name', 'artist name(s)', 'artist names', 'performer', 'track artist', 'creator'],
  album: ['album', 'album name', 'album title', 'release'],
  duration: ['duration', 'duration (ms)', 'duration_ms', 'track duration (ms)', 'length', 'time'],
  isrc: ['isrc'],
  date: ['year', 'release date', 'release_date', 'album release date', 'date', 'released'],
  genre: ['genre', 'genres', 'artist genres'],
  explicit: ['explicit'],
  bpm: ['bpm', 'tempo'],
  instruments: ['instruments', 'instrument'],
  mood: ['mood', 'moods'],
  tags: ['tags', 'tag'],
  uri: ['track uri', 'spotify uri', 'uri', 'url', 'link', 'spotify url', 'track url'],
};

function mapHeaders(header: string[]): Record<string, number> {
  const normalized = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '));
  const map: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx >= 0) map[key] = idx;
  }
  return map;
}

function providerIdFromUri(raw: string): RawEntry['providerIds'] {
  const v = raw.trim();
  let m = v.match(/^spotify:track:([A-Za-z0-9]{22})$/) ?? v.match(/^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})/);
  if (m) return [{ namespace: 'spotify:track', value: m[1]!, url: `https://open.spotify.com/track/${m[1]}` }];
  m = v.match(/^https:\/\/(?:www\.|music\.)?youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})/) ?? v.match(/^https:\/\/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return [{ namespace: 'youtube:video', value: m[1]!, url: `https://www.youtube.com/watch?v=${m[1]}` }];
  m = v.match(/^https:\/\/music\.apple\.com\/[a-z]{2}\/(?:album\/[^?]+\?i=|song\/[^/]+\/)(\d+)/);
  if (m) return [{ namespace: 'apple_music:song', value: m[1]!, url: v.split('#')[0] }];
  return [];
}

export function parseCsv(text: string, fileName = 'Imported CSV'): RawPlaylist {
  assertSize(text);
  const rows = parseCsvRows(text);
  if (rows.length === 0) throw new ImportError('The file is empty.', 'empty');
  const headers = mapHeaders(rows[0]!);
  if (headers.title === undefined || headers.artist === undefined) {
    throw new ImportError(
      'Could not find a title and an artist column. Use a header row such as: title,artist,album,genre,year',
      'invalid_input',
    );
  }
  const isExportify = rows[0]!.some((h) => h.trim().toLowerCase() === 'artist name(s)');
  const body = rows.slice(1);
  if (body.length === 0) throw new ImportError('The file has a header row but no tracks.', 'empty');
  if (body.length > IMPORT_LIMITS.maxEntries) {
    throw new ImportError(`Imports are limited to ${IMPORT_LIMITS.maxEntries} tracks per file.`, 'too_large', 413);
  }

  const entries: RawEntry[] = [];
  const errors: ImportRowError[] = [];
  body.forEach((cells, i) => {
    const row = i + 2; // 1-based, header is row 1
    const get = (key: string) => (headers[key] !== undefined ? cells[headers[key]!] : undefined);
    const title = field(get('title'));
    const artistRaw = field(get('artist'));
    if (!title || !artistRaw) {
      errors.push({ row, message: !title ? 'Missing title.' : 'Missing artist.' });
      return;
    }
    // Exportify joins multiple artists with commas; other files use ; or |.
    const artists = isExportify ? artistRaw.split(/\s*,\s*/).filter(Boolean) : splitArtistList(artistRaw);
    const attributes: { category: AttributeCategory; value: string }[] = [];
    for (const v of splitList(get('instruments'))) {
      // Known vocabulary keeps its real category ("instrumental" is a vocal attribute, not an instrument).
      const mapped = tagToAttribute(v);
      attributes.push(mapped ?? { category: 'instrument', value: v.toLowerCase() });
    }
    for (const v of splitList(get('mood'))) attributes.push({ category: 'mood', value: v.toLowerCase() });
    for (const v of splitList(get('tags'))) {
      const mapped = tagToAttribute(v);
      if (mapped) attributes.push(mapped);
    }
    const genres = splitList(get('genre'));
    const uri = get('uri');
    entries.push({
      row,
      title,
      artists,
      album: field(get('album')) || null,
      durationMs: parseDuration(get('duration')),
      isrc: parseIsrc(get('isrc')),
      releaseDate: parseReleaseDate(get('date')),
      explicit: parseExplicit(get('explicit')),
      // Exportify's "Artist Genres" column comes from Spotify (artist-level), not from the user.
      genres,
      genreKind: isExportify ? 'provider' : 'user',
      genreSource: isExportify ? 'spotify (via export file)' : 'your file',
      attributes,
      bpm: parseBpm(get('bpm')),
      providerIds: uri ? providerIdFromUri(uri) : [],
      sourceUrl: uri ? providerIdFromUri(uri)?.[0]?.url ?? null : null,
      parseConfidence: 'high',
    });
  });
  if (entries.length === 0) throw new ImportError('No valid tracks found — every row was missing a title or artist.', 'empty');
  return {
    name: field(fileName.replace(/\.[a-z0-9]+$/i, '')) || 'Imported CSV',
    provider: 'csv',
    sourceRef: field(fileName),
    entries,
    errors,
    notes: isExportify ? ['Detected an Exportify (Spotify export) file; multiple artists were split on commas.'] : [],
  };
}

// ------------------------------------------------------------------ text

const LINE_PATTERNS: [RegExp, (m: RegExpMatchArray) => { artist: string; title: string }][] = [
  [/^(.+?)\s+[-–—]\s+(.+)$/, (m) => ({ artist: m[1]!, title: m[2]! })],
  [/^(.+?)\t(.+)$/, (m) => ({ title: m[1]!, artist: m[2]! })],
  [/^["“](.+?)["”]\s+by\s+(.+)$/i, (m) => ({ title: m[1]!, artist: m[2]! })],
  [/^(.+?)\s+by\s+(.+)$/i, (m) => ({ title: m[1]!, artist: m[2]! })],
];

/** Pasted lists: "Artist - Title", "Title by Artist", or "Title<TAB>Artist", one per line. */
export function parseText(text: string, name = 'Pasted list'): RawPlaylist {
  assertSize(text);
  const lines = text.split(/\r?\n/);
  const entries: RawEntry[] = [];
  const errors: ImportRowError[] = [];
  lines.forEach((rawLine, i) => {
    const line = rawLine.replace(/^\s*(?:\d+[.)]\s+|[-*•]\s+)/, '').trim();
    if (!line || line.startsWith('#')) return;
    for (const [re, pick] of LINE_PATTERNS) {
      const m = line.match(re);
      if (m) {
        const { artist, title } = pick(m);
        const t = field(title);
        const artists = splitArtistList(artist);
        if (t && artists.length) {
          entries.push({ row: i + 1, title: t, artists, parseConfidence: 'medium' });
          return;
        }
      }
    }
    errors.push({ row: i + 1, message: 'Could not read this line. Use “Artist - Title”.' });
  });
  if (entries.length > IMPORT_LIMITS.maxEntries) throw new ImportError(`Imports are limited to ${IMPORT_LIMITS.maxEntries} tracks.`, 'too_large', 413);
  if (entries.length === 0) throw new ImportError('No tracks found. Paste one “Artist - Title” per line.', 'empty');
  return { name: field(name) || 'Pasted list', provider: 'text', entries, errors, notes: [] };
}

// ------------------------------------------------------------------- M3U

/** Extended M3U: reads #EXTINF metadata. File paths/URLs are ignored and never fetched or stored. */
export function parseM3u(text: string, fileName = 'Imported M3U'): RawPlaylist {
  assertSize(text);
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const entries: RawEntry[] = [];
  const errors: ImportRowError[] = [];
  let playlistName: string | null = null;
  let pending: { row: number; durationMs: number | null; label: string } | null = null;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith('#PLAYLIST:')) {
      playlistName = field(line.slice(10));
      return;
    }
    if (line.startsWith('#EXTINF:')) {
      const m = line.match(/^#EXTINF:(-?\d+(?:\.\d+)?)[^,]*,(.*)$/);
      if (!m) {
        errors.push({ row: i + 1, message: 'Malformed #EXTINF line.' });
        return;
      }
      const secs = Number(m[1]);
      pending = { row: i + 1, durationMs: secs > 0 ? Math.round(secs * 1000) : null, label: m[2]! };
      return;
    }
    if (line.startsWith('#')) return;
    // A media path/URL line. Use the EXTINF label, or the file's base name as a last resort.
    const label = pending?.label ?? decodeURIComponent(line.split(/[\\/]/).pop() ?? '').replace(/\.[a-z0-9]{2,4}$/i, '');
    const m = field(label).match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (m) {
      entries.push({
        row: pending?.row ?? i + 1,
        title: field(m[2]),
        artists: splitArtistList(m[1]!),
        durationMs: pending?.durationMs ?? null,
        parseConfidence: pending ? 'medium' : 'low',
      });
    } else {
      errors.push({ row: pending?.row ?? i + 1, message: 'No “Artist - Title” information for this entry.' });
    }
    pending = null;
  });
  if (entries.length > IMPORT_LIMITS.maxEntries) throw new ImportError(`Imports are limited to ${IMPORT_LIMITS.maxEntries} tracks.`, 'too_large', 413);
  if (entries.length === 0) throw new ImportError('No tracks with artist and title information were found in this M3U file.', 'empty');
  return {
    name: playlistName ?? (field(fileName.replace(/\.m3u8?$/i, '')) || 'Imported M3U'),
    provider: 'm3u',
    sourceRef: field(fileName),
    entries,
    errors,
    notes: ['File locations in the playlist were ignored; SOMM never reads or stores local paths or audio.'],
  };
}

// ------------------------------------------------------------------ XSPF

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function xmlTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeXml(m[1]!.trim()) : null;
}

/** XSPF (XML Shareable Playlist Format). DTDs and entity declarations are rejected. */
export function parseXspf(text: string, fileName = 'Imported XSPF'): RawPlaylist {
  assertSize(text);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ImportError('XML files with DTD or entity declarations are not accepted.', 'invalid_input');
  if (!/<playlist[\s>]/i.test(text)) throw new ImportError('This does not look like an XSPF playlist.', 'invalid_input');
  const trackList = xmlTag(text, 'trackList') === null ? '' : text.slice(text.search(/<trackList/i));
  const blocks = [...trackList.matchAll(/<track(?:\s[^>]*)?>([\s\S]*?)<\/track>/gi)].map((m) => m[1]!);
  const entries: RawEntry[] = [];
  const errors: ImportRowError[] = [];
  blocks.forEach((block, i) => {
    const title = field(xmlTag(block, 'title'));
    const creator = field(xmlTag(block, 'creator'));
    if (!title || !creator) {
      errors.push({ row: i + 1, message: 'Track is missing <title> or <creator>.' });
      return;
    }
    const duration = Number(xmlTag(block, 'duration'));
    const identifiers = [...block.matchAll(/<identifier>([\s\S]*?)<\/identifier>/gi)].map((m) => decodeXml(m[1]!.trim()));
    const isrc = identifiers.map((id) => parseIsrc(id.replace(/^urn:isrc:/i, '').replace(/^isrc:/i, ''))).find(Boolean) ?? null;
    entries.push({
      row: i + 1,
      title,
      artists: splitArtistList(creator),
      album: field(xmlTag(block, 'album')) || null,
      durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
      isrc,
      parseConfidence: 'high',
    });
  });
  if (entries.length > IMPORT_LIMITS.maxEntries) throw new ImportError(`Imports are limited to ${IMPORT_LIMITS.maxEntries} tracks.`, 'too_large', 413);
  if (entries.length === 0) throw new ImportError('The XSPF playlist contains no usable tracks.', 'empty');
  const playlistTitle = xmlTag(text.slice(0, text.search(/<trackList/i) > 0 ? text.search(/<trackList/i) : text.length), 'title');
  return {
    name: field(playlistTitle) || field(fileName.replace(/\.xspf$/i, '')) || 'Imported XSPF',
    provider: 'xspf',
    sourceRef: field(fileName),
    entries,
    errors,
    notes: [],
  };
}

// ------------------------------------------------------------------ JSON

interface JsonTrack {
  title?: unknown;
  name?: unknown;
  artist?: unknown;
  artists?: unknown;
  album?: unknown;
  durationMs?: unknown;
  duration?: unknown;
  isrc?: unknown;
  year?: unknown;
  releaseDate?: unknown;
  genres?: unknown;
  genre?: unknown;
  explicit?: unknown;
  bpm?: unknown;
}

/** SOMM JSON export, or any array of {title, artist(s), ...} objects. */
export function parseJson(text: string, fileName = 'Imported JSON'): RawPlaylist {
  assertSize(text);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('The file is not valid JSON.', 'invalid_input');
  }
  let name = field(fileName.replace(/\.json$/i, '')) || 'Imported JSON';
  let list: unknown = data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as { name?: unknown; tracks?: unknown; playlists?: unknown };
    if (typeof obj.name === 'string') name = field(obj.name) || name;
    list = Array.isArray(obj.tracks)
      ? obj.tracks
      : Array.isArray(obj.playlists)
        ? (obj.playlists as { tracks?: unknown[] }[]).flatMap((p) => (Array.isArray(p.tracks) ? p.tracks : []))
        : null;
  }
  if (!Array.isArray(list)) throw new ImportError('Expected an array of tracks or an object with a "tracks" array.', 'invalid_input');
  if (list.length > IMPORT_LIMITS.maxEntries) throw new ImportError(`Imports are limited to ${IMPORT_LIMITS.maxEntries} tracks.`, 'too_large', 413);
  const entries: RawEntry[] = [];
  const errors: ImportRowError[] = [];
  list.forEach((item, i) => {
    const t = (item ?? {}) as JsonTrack;
    const title = field(typeof t.title === 'string' ? t.title : typeof t.name === 'string' ? t.name : '');
    const artists = Array.isArray(t.artists)
      ? t.artists
          .map((a) => (typeof a === 'string' ? a : a && typeof a === 'object' && typeof (a as { name?: unknown }).name === 'string' ? (a as { name: string }).name : ''))
          .map((a) => field(a))
          .filter(Boolean)
      : typeof t.artist === 'string'
        ? splitArtistList(t.artist)
        : [];
    if (!title || artists.length === 0) {
      errors.push({ row: i + 1, message: !title ? 'Missing title.' : 'Missing artist.' });
      return;
    }
    const genres = Array.isArray(t.genres) ? t.genres.filter((g): g is string => typeof g === 'string') : typeof t.genre === 'string' ? splitList(t.genre) : [];
    entries.push({
      row: i + 1,
      title,
      artists,
      album: typeof t.album === 'string' ? field(t.album) || null : null,
      durationMs: typeof t.durationMs === 'number' ? t.durationMs : typeof t.duration === 'string' || typeof t.duration === 'number' ? parseDuration(String(t.duration)) : null,
      isrc: typeof t.isrc === 'string' ? parseIsrc(t.isrc) : null,
      releaseDate: parseReleaseDate(typeof t.releaseDate === 'string' ? t.releaseDate : t.year !== undefined ? String(t.year) : null),
      explicit: typeof t.explicit === 'boolean' ? t.explicit : null,
      genres: genres.map((g) => field(g)).filter(Boolean).slice(0, 12),
      genreKind: 'user',
      genreSource: 'your file',
      bpm: typeof t.bpm === 'number' ? parseBpm(String(t.bpm)) : null,
      parseConfidence: 'high',
    });
  });
  if (entries.length === 0) throw new ImportError('No valid tracks found in the JSON file.', 'empty');
  return { name, provider: 'json', sourceRef: field(fileName), entries, errors, notes: [] };
}

// ---------------------------------------------------------------- manual

export interface ManualEntryInput {
  title: string;
  artist: string;
  album?: string;
  year?: string;
  genre?: string;
}

export function parseManual(items: ManualEntryInput[], name = 'Added manually'): RawPlaylist {
  if (!Array.isArray(items) || items.length === 0) throw new ImportError('Add at least one song.', 'empty');
  if (items.length > 500) throw new ImportError('Add at most 500 songs at a time.', 'too_large', 413);
  const entries: RawEntry[] = [];
  const errors: ImportRowError[] = [];
  items.forEach((item, i) => {
    const title = field(item.title);
    const artists = splitArtistList(item.artist ?? '');
    if (!title || artists.length === 0) {
      errors.push({ row: i + 1, message: !title ? 'Missing title.' : 'Missing artist.' });
      return;
    }
    entries.push({
      row: i + 1,
      title,
      artists,
      album: field(item.album) || null,
      releaseDate: parseReleaseDate(item.year),
      genres: splitList(item.genre),
      genreKind: 'user',
      genreSource: 'entered by you',
      parseConfidence: 'high',
    });
  });
  if (entries.length === 0) throw new ImportError('Every song needs a title and an artist.', 'invalid_input');
  return { name: field(name) || 'Added manually', provider: 'manual', entries, errors, notes: [] };
}
