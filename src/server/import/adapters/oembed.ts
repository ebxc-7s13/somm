/**
 * Song names for pasted track links, from each service's official oEmbed
 * endpoint (public, no key). Checked on 2026-10-14: none of the oEmbed paths is
 * disallowed by the services' robots.txt rules. oEmbed describes one track or
 * video at a time — it never lists a playlist's contents — so playlist links get
 * an explanation instead. Spotify's oEmbed gives the song title only.
 */
import { cleanDisplayText, parseYouTubeTitle, splitArtistList } from '../../../shared/normalize';
import { fetchJson, type FetchLike, ProviderError } from '../../http';
import { ImportError, IMPORT_LIMITS, type ImportRowError, type RawEntry, type RawPlaylist } from '../types';
import { parseNameLine } from './files';

export const MAX_LINKS = 300;
const CONCURRENCY = 4;

type Service = 'spotify' | 'youtube' | 'soundcloud';
export type ClassifiedLink = { service: Service; id: string; url: string } | { unsupported: string };

const SPOTIFY_TRACK = /^(?:https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/;
const SPOTIFY_OTHER = /^(?:https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(?:playlist|album|artist)\/|spotify:(?:playlist|album|artist):)/;
const YOUTUBE_VIDEO =
  /^https?:\/\/(?:(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const YOUTUBE_PLAYLIST = /^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/(?:playlist|watch)\?(?:[^#]*&)?list=/;
const SOUNDCLOUD = /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/([^/?#\s]+)\/([^/?#\s]+)(\/[^?#\s]*)?/;
const SOUNDCLOUD_RESERVED = new Set(['you', 'discover', 'search', 'stream', 'upload', 'charts', 'pages', 'settings', 'messages']);

export const LINK_HELP = {
  spotifyPlaylist:
    'Spotify playlist and album links cannot be read without Spotify’s API. In the Spotify app, open the playlist, click one song, press Ctrl+A (⌘A on a Mac) and then Ctrl+C (⌘C) to copy every song’s link, and paste them here.',
  youtubePlaylist: 'This is a YouTube playlist link. Use the “Playlist link” tab, or paste the links of the individual videos here.',
  soundcloudPlaylist: 'SoundCloud playlists cannot be listed without SoundCloud’s API. Paste the links of the individual tracks, or their names.',
};

export function classifyLink(line: string): ClassifiedLink | null {
  const v = line.trim();
  let m = v.match(SPOTIFY_TRACK);
  if (m) return { service: 'spotify', id: m[1]!, url: `https://open.spotify.com/track/${m[1]}` };
  if (SPOTIFY_OTHER.test(v)) return { unsupported: LINK_HELP.spotifyPlaylist };
  m = v.match(YOUTUBE_VIDEO);
  if (m) return { service: 'youtube', id: m[1]!, url: `https://www.youtube.com/watch?v=${m[1]}` };
  if (YOUTUBE_PLAYLIST.test(v)) return { unsupported: LINK_HELP.youtubePlaylist };
  m = v.match(SOUNDCLOUD);
  if (m && !SOUNDCLOUD_RESERVED.has(m[1]!.toLowerCase())) {
    if (m[2] === 'sets' || m[2] === 'albums' || m[2] === 'likes' || m[2] === 'tracks') return { unsupported: LINK_HELP.soundcloudPlaylist };
    if (m[3] && m[3] !== '/') return null;
    return { service: 'soundcloud', id: `${m[1]}/${m[2]}`, url: `https://soundcloud.com/${m[1]}/${m[2]}` };
  }
  return null;
}

const nonEmptyLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]\s+|[-*•]\s+)/, '').trim())
    .filter(Boolean);

/** Any line is a music link (track, video or playlist link). Names on other lines are still read. */
export function containsLinks(text: string): boolean {
  return nonEmptyLines(text).some((l) => classifyLink(l) !== null);
}

interface OEmbed {
  title?: unknown;
  author_name?: unknown;
}

function oembedUrl(service: Service, url: string): string {
  const u = encodeURIComponent(url);
  if (service === 'spotify') return `https://open.spotify.com/oembed?url=${u}`;
  if (service === 'youtube') return `https://www.youtube.com/oembed?format=json&url=${u}`;
  return `https://soundcloud.com/oembed?format=json&url=${u}`;
}

const SERVICE_NAME: Record<Service, string> = { spotify: 'Spotify', youtube: 'YouTube', soundcloud: 'SoundCloud' };

function toEntry(row: number, link: { service: Service; id: string; url: string }, data: OEmbed): RawEntry | null {
  const rawTitle = typeof data.title === 'string' ? cleanDisplayText(data.title) : '';
  const author = typeof data.author_name === 'string' ? cleanDisplayText(data.author_name) : '';
  if (!rawTitle) return null;
  const base = { row, sourceUrl: link.url };
  if (link.service === 'spotify') {
    return {
      ...base,
      title: rawTitle,
      artists: [],
      providerIds: [{ namespace: 'spotify:track', value: link.id, url: link.url }],
      parseConfidence: 'low',
      warnings: ['Spotify’s link details include the song title only.'],
    };
  }
  if (link.service === 'youtube') {
    const parsed = parseYouTubeTitle(rawTitle, author || null);
    return {
      ...base,
      title: parsed.title,
      artists: parsed.artist ? splitArtistList(parsed.artist) : [],
      providerIds: [{ namespace: 'youtube:video', value: link.id, url: link.url }],
      parseConfidence: parsed.confidence,
      warnings: parsed.confidence === 'low' ? ['Artist taken from the channel name — please check.'] : [],
    };
  }
  // SoundCloud titles look like "Song by Uploader" or "Artist - Song"; the uploader is often, not always, the artist.
  const withoutBy = author && rawTitle.toLowerCase().endsWith(` by ${author.toLowerCase()}`) ? rawTitle.slice(0, -(author.length + 4)).trim() : rawTitle;
  const parsed = parseYouTubeTitle(withoutBy, null);
  const artist = parsed.artist ?? author;
  return {
    ...base,
    title: parsed.title,
    artists: artist ? splitArtistList(artist) : [],
    parseConfidence: parsed.artist ? 'medium' : 'low',
    warnings: parsed.artist ? [] : ['Artist taken from the uploader’s name — please check.'],
  };
}

/**
 * Reads a pasted list where some lines are track links: links are named through
 * oEmbed, other lines are read as song names. Keeps the order of the list.
 */
export async function resolveLinkList(text: string, name: string, fetchImpl?: FetchLike): Promise<RawPlaylist> {
  const lines = nonEmptyLines(text);
  if (lines.length > IMPORT_LIMITS.maxEntries) throw new ImportError(`Lists are limited to ${IMPORT_LIMITS.maxEntries} songs.`, 'too_large', 413);
  const entries: (RawEntry | null)[] = new Array(lines.length).fill(null);
  const errors: ImportRowError[] = [];
  const counts: Record<Service, number> = { spotify: 0, youtube: 0, soundcloud: 0 };
  const jobs = lines.map((line, i) => ({ line, row: i + 1, link: classifyLink(line) }));
  const linkCount = jobs.filter((j) => j.link && !('unsupported' in j.link)).length;
  if (linkCount > MAX_LINKS) throw new ImportError(`Paste at most ${MAX_LINKS} links at a time — split longer lists.`, 'too_large', 413);

  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      const link = job.link;
      if (!link) {
        const named = parseNameLine(job.line, job.row);
        if (named && 'entry' in named) entries[job.row - 1] = named.entry;
        else if (named) errors.push({ row: job.row, message: named.error });
        continue;
      }
      if ('unsupported' in link) {
        errors.push({ row: job.row, message: link.unsupported });
        continue;
      }
      try {
        const data = await fetchJson<OEmbed>(oembedUrl(link.service, link.url), { headers: { Accept: 'application/json' } }, {
          provider: SERVICE_NAME[link.service],
          fetchImpl,
          retries: 1,
          timeoutMs: 10_000,
          maxRetryWaitMs: 5_000,
        });
        const entry = toEntry(job.row, link, data);
        if (entry) {
          entries[job.row - 1] = entry;
          counts[link.service]++;
        } else errors.push({ row: job.row, message: `${SERVICE_NAME[link.service]} returned no title for this link.` });
      } catch (err) {
        const gone = err instanceof ProviderError && ['not_found', 'forbidden', 'unauthorized', 'bad_response'].includes(err.code);
        errors.push({ row: job.row, message: gone ? 'This link is private, removed, or not a song.' : `Could not reach ${SERVICE_NAME[link.service]}. Try again later.` });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

  const found = entries.filter((e): e is RawEntry => e !== null);
  errors.sort((a, b) => a.row - b.row);
  if (found.length === 0) {
    const first = errors[0]?.message;
    throw new ImportError(first && errors.every((e) => e.message === first) ? first : 'None of these links could be read.', 'invalid_input');
  }
  const notes = [`Song names were read from each link’s public details (oEmbed). Nothing is fetched from the songs themselves.`];
  if (counts.spotify) notes.push('Spotify links give only the song title. Use “Find song details” to add the artist where the title is unambiguous, or type it.');
  if (counts.youtube || counts.soundcloud) notes.push('Artists come from video and track titles or channel names — check rows marked for review.');
  return { name, provider: 'text', entries: found, errors, notes };
}
