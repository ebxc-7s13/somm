/**
 * Strict parsing of playlist references. SOMM never fetches a user-supplied
 * URL: it extracts a provider ID from an allow-listed host and calls the
 * provider's official API with that ID. Anything else is rejected.
 */
import { ImportError } from '../types';

export type PlaylistRef =
  | { provider: 'spotify'; id: string }
  | { provider: 'youtube'; id: string }
  | { provider: 'apple_music'; id: string; storefront: string; library: boolean };

function asUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

export function parseSpotifyPlaylist(input: string): PlaylistRef {
  const v = input.trim();
  let m = v.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
  if (m) return { provider: 'spotify', id: m[1]! };
  if (/^[A-Za-z0-9]{22}$/.test(v)) return { provider: 'spotify', id: v };
  const url = asUrl(v);
  if (url && url.hostname === 'open.spotify.com') {
    m = url.pathname.match(/^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?playlist\/([A-Za-z0-9]{22})\/?$/i);
    if (m) return { provider: 'spotify', id: m[1]! };
  }
  throw new ImportError('That is not a Spotify playlist link. Expected https://open.spotify.com/playlist/…', 'invalid_input');
}

const YT_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

export function parseYouTubePlaylist(input: string): PlaylistRef {
  const v = input.trim();
  let id: string | null = null;
  if (/^[A-Za-z0-9_-]{12,64}$/.test(v)) id = v;
  else {
    const url = asUrl(v);
    if (url && YT_HOSTS.has(url.hostname)) id = url.searchParams.get('list');
  }
  if (!id || !/^[A-Za-z0-9_-]{12,64}$/.test(id)) {
    throw new ImportError('That is not a YouTube playlist link. Expected a URL containing “list=…”.', 'invalid_input');
  }
  if (id.startsWith('RD')) {
    throw new ImportError(
      'YouTube “Mix” playlists (IDs starting with RD) are generated per viewer and cannot be read through the YouTube Data API.',
      'unsupported_source',
    );
  }
  if (id === 'LL' || id === 'WL') {
    throw new ImportError('“Liked videos” and “Watch later” are private lists that the YouTube Data API does not expose to API keys.', 'unsupported_source');
  }
  return { provider: 'youtube', id };
}

export function parseAppleMusicPlaylist(input: string): PlaylistRef {
  const url = asUrl(input);
  if (url && url.hostname === 'music.apple.com') {
    const m = url.pathname.match(/^\/([a-z]{2})\/playlist\/(?:[^/]+\/)?(pl\.[A-Za-z0-9-]+|p\.[A-Za-z0-9]+)\/?$/);
    if (m) return { provider: 'apple_music', storefront: m[1]!, id: m[2]!, library: m[2]!.startsWith('p.') };
  }
  throw new ImportError('That is not an Apple Music playlist link. Expected https://music.apple.com/{country}/playlist/…/pl.…', 'invalid_input');
}
