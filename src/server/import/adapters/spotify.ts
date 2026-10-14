/**
 * Spotify Web API adapter (verified against developer.spotify.com on 2026-10-13).
 *
 * - OAuth 2.0 Authorization Code with PKCE; scopes playlist-read-private and
 *   playlist-read-collaborative only. SOMM never sees a Spotify password.
 * - Since the February 2026 changes (applied to existing development-mode apps
 *   on 2026-03-09) playlist items come from GET /playlists/{id}/items and are
 *   returned ONLY for playlists the user owns or collaborates on (403 otherwise);
 *   each item's track is under `item` (`track` is deprecated).
 * - Development-mode apps: the app owner needs Spotify Premium and at most five
 *   allow-listed users. Extended quota is limited to organisations (May 2025).
 * - Audio features / analysis are unavailable to new apps (Nov 2024), so SOMM
 *   does not request tempo/energy from Spotify. Artist `genres` is deprecated;
 *   when present it is stored as artist-level provider metadata.
 */
import { pkcePair } from '../../security';
import { fetchJson, type FetchLike, ProviderError } from '../../http';
import { ImportError, IMPORT_LIMITS, type RawEntry, type RawPlaylist } from '../types';

const API = 'https://api.spotify.com/v1';
const ACCOUNTS = 'https://accounts.spotify.com';
export const SPOTIFY_SCOPES = ['playlist-read-private', 'playlist-read-collaborative'];

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scope: string;
}

export function spotifyAuthorizeUrl(clientId: string, redirectUri: string, state: string) {
  const { verifier, challenge } = pkcePair();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES.join(' '),
    state,
  });
  return { url: `${ACCOUNTS}/authorize?${params}`, verifier };
}

async function tokenRequest(body: URLSearchParams, fetchImpl?: FetchLike): Promise<SpotifyTokens> {
  const data = await fetchJson<{ access_token: string; refresh_token?: string; expires_in: number; scope: string }>(
    `${ACCOUNTS}/api/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
    { provider: 'Spotify', fetchImpl, retries: 1 },
  );
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    scope: data.scope,
  };
}

export function exchangeSpotifyCode(opts: { clientId: string; redirectUri: string; code: string; verifier: string; fetchImpl?: FetchLike }) {
  return tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      code_verifier: opts.verifier,
    }),
    opts.fetchImpl,
  );
}

export async function refreshSpotifyToken(opts: { clientId: string; refreshToken: string; fetchImpl?: FetchLike }) {
  const t = await tokenRequest(
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: opts.refreshToken, client_id: opts.clientId }),
    opts.fetchImpl,
  );
  return { ...t, refreshToken: t.refreshToken ?? opts.refreshToken };
}

interface SpotifyArtist {
  id: string | null;
  name: string;
}
interface SpotifyTrack {
  type?: string;
  id: string | null;
  name: string;
  artists: SpotifyArtist[];
  album?: { id: string | null; name: string; release_date?: string; images?: { url: string; width?: number }[] };
  duration_ms?: number;
  explicit?: boolean;
  is_local?: boolean;
  external_ids?: { isrc?: string };
  external_urls?: { spotify?: string };
}
interface SpotifyPlaylistItem {
  is_local?: boolean;
  item?: SpotifyTrack | null;
  /** Deprecated alias of `item`, still sent for compatibility. */
  track?: SpotifyTrack | null;
}
interface Paging<T> {
  items: T[];
  next: string | null;
  total: number;
}

export interface SpotifyPlaylistSummary {
  id: string;
  name: string;
  owner: string;
  ownedByUser: boolean;
  collaborative: boolean;
  /** Whether SOMM can read the tracks under current API rules. */
  importable: boolean;
  trackCount: number | null;
}

export class SpotifyClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl?: FetchLike,
    private readonly sleep?: (ms: number) => Promise<void>,
  ) {}

  private get<T>(url: string) {
    return fetchJson<T>(url.startsWith('http') ? url : `${API}${url}`, { headers: { Authorization: `Bearer ${this.accessToken}` } }, {
      provider: 'Spotify',
      fetchImpl: this.fetchImpl,
      sleep: this.sleep,
    });
  }

  async me(): Promise<{ id: string; display_name: string | null }> {
    return this.get('/me');
  }

  async listPlaylists(limitPages = 10): Promise<SpotifyPlaylistSummary[]> {
    const me = await this.me();
    const out: SpotifyPlaylistSummary[] = [];
    let url: string | null = '/me/playlists?limit=50';
    for (let page = 0; url && page < limitPages; page++) {
      const data: Paging<{ id: string; name: string; collaborative: boolean; owner: { id: string; display_name?: string }; items?: { total?: number }; tracks?: { total?: number } }> = await this.get(url);
      for (const p of data.items) {
        const owned = p.owner?.id === me.id;
        out.push({
          id: p.id,
          name: p.name,
          owner: p.owner?.display_name ?? p.owner?.id ?? 'unknown',
          ownedByUser: owned,
          collaborative: p.collaborative,
          importable: owned || p.collaborative,
          trackCount: p.items?.total ?? p.tracks?.total ?? null,
        });
      }
      url = data.next;
    }
    return out;
  }

  async getPlaylist(playlistId: string): Promise<RawPlaylist> {
    let meta: { name: string; external_urls?: { spotify?: string } };
    try {
      meta = await this.get(`/playlists/${encodeURIComponent(playlistId)}?fields=name,external_urls`);
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'not_found') throw new ImportError('Spotify could not find that playlist.', 'not_found', 404);
      throw err;
    }
    const entries: RawEntry[] = [];
    const notes: string[] = [];
    const artistIds = new Set<string>();
    let url: string | null = `/playlists/${encodeURIComponent(playlistId)}/items?limit=50&additional_types=track`;
    let row = 0;
    let skippedNonTracks = 0;
    let skippedLocal = 0;
    try {
      while (url) {
        const data: Paging<SpotifyPlaylistItem> = await this.get(url);
        for (const it of data.items) {
          row++;
          const t = it.item ?? it.track;
          if (!t) continue;
          if (t.type && t.type !== 'track') {
            skippedNonTracks++;
            continue;
          }
          if (it.is_local || t.is_local || !t.id) {
            skippedLocal++;
            continue;
          }
          for (const a of t.artists) if (a.id) artistIds.add(a.id);
          entries.push({
            row,
            title: t.name,
            artists: t.artists.map((a) => a.name).filter(Boolean),
            artistIds: t.artists.filter((a) => a.id).map((a) => ({ namespace: 'spotify:artist', value: a.id! })),
            album: t.album?.name ?? null,
            durationMs: t.duration_ms ?? null,
            isrc: t.external_ids?.isrc ?? null,
            releaseDate: t.album?.release_date ?? null,
            explicit: t.explicit ?? null,
            providerIds: [{ namespace: 'spotify:track', value: t.id, url: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}` }],
            sourceUrl: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}`,
            artworkUrl: t.album?.images?.sort((a, b) => (a.width ?? 0) - (b.width ?? 0)).find((i) => (i.width ?? 0) >= 160)?.url ?? null,
            parseConfidence: 'high',
          });
          if (entries.length >= IMPORT_LIMITS.maxEntries) break;
        }
        url = entries.length >= IMPORT_LIMITS.maxEntries ? null : data.next;
      }
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'forbidden') {
        throw new ImportError(
          'Spotify only returns tracks for playlists you own or collaborate on (Web API rules since February 2026). ' +
            'Copy the songs into a playlist you own, or export it with a tool such as Exportify and import the CSV.',
          'not_authorized',
          403,
        );
      }
      throw err;
    }
    if (skippedLocal) notes.push(`${skippedLocal} local file(s) were skipped — they have no Spotify catalogue identity.`);
    if (skippedNonTracks) notes.push(`${skippedNonTracks} podcast episode(s) were skipped.`);
    if (entries.length === 0) throw new ImportError('This Spotify playlist has no importable tracks.', 'empty');

    // Artist genres (deprecated field; may be empty). Batch endpoint removed in 2026, so fetch individually and cap.
    const genresByArtist = await this.artistGenres([...artistIds].slice(0, 50));
    let withGenres = 0;
    for (const e of entries) {
      const genres = new Set<string>();
      for (const a of e.artistIds ?? []) for (const g of genresByArtist.get(a.value) ?? []) genres.add(g);
      if (genres.size) {
        withGenres++;
        e.genres = [...genres].slice(0, 6);
        e.genreKind = 'provider';
        e.genreSource = 'spotify:artist';
      }
    }
    notes.push(
      withGenres
        ? `Genres for ${withGenres} track(s) come from Spotify's artist-level genres (a deprecated field), not per-track data.`
        : 'Spotify returned no artist genres; SOMM will look up genres from MusicBrainz where possible.',
    );
    if (artistIds.size > 50) notes.push('Artist genres were requested for the first 50 artists only, to respect Spotify rate limits.');

    return {
      name: meta.name || 'Spotify playlist',
      provider: 'spotify',
      sourceRef: playlistId,
      sourceUrl: meta.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlistId}`,
      entries,
      errors: [],
      notes,
    };
  }

  private async artistGenres(ids: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    for (const id of ids) {
      try {
        const a = await this.get<{ genres?: string[] }>(`/artists/${encodeURIComponent(id)}`);
        if (a.genres?.length) out.set(id, a.genres);
      } catch (err) {
        if (err instanceof ProviderError && err.code === 'rate_limited') break;
      }
    }
    return out;
  }
}
