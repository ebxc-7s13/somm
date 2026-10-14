/**
 * Apple Music API adapter.
 *
 * Requirements (Apple developer documentation; the page renders client-side, so
 * these were cross-checked against Apple's published MusicKit requirements on
 * 2026-10-13 — re-verify before enabling):
 * - A paid Apple Developer Program membership, a MusicKit identifier and a .p8
 *   private key. SOMM signs an ES256 developer token (max lifetime ~6 months;
 *   SOMM uses 12 hours).
 * - Catalogue playlists (IDs "pl.…") need only the developer token.
 * - A user's library playlists (IDs "p.…") also need a Music User Token from
 *   MusicKit JS, and the user needs an active Apple Music subscription.
 * - Catalogue songs carry `genreNames` and `isrc`, which SOMM stores as
 *   provider metadata. The genre "Music" is a store-level placeholder and is dropped.
 *
 * This adapter is implemented and tested with mocked responses only; it has not
 * been run against the live API because no credentials were available.
 */
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fetchJson, type FetchLike, ProviderError } from '../../http';
import { ImportError, IMPORT_LIMITS, type RawEntry, type RawPlaylist } from '../types';

const API = 'https://api.music.apple.com/v1';

export function createAppleDeveloperToken(opts: { teamId: string; keyId: string; privateKeyPath: string; ttlSeconds?: number }): string {
  const key = createPrivateKey(readFileSync(opts.privateKeyPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: opts.keyId })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: opts.teamId, iat: now, exp: now + (opts.ttlSeconds ?? 12 * 3600) })).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

interface AppleSong {
  id: string;
  type: string;
  attributes?: {
    name: string;
    artistName: string;
    albumName?: string;
    durationInMillis?: number;
    isrc?: string;
    releaseDate?: string;
    genreNames?: string[];
    contentRating?: string;
    url?: string;
    playParams?: { catalogId?: string };
  };
}

export class AppleMusicClient {
  constructor(
    private readonly developerToken: string,
    private readonly musicUserToken: string | null,
    private readonly fetchImpl?: FetchLike,
    private readonly sleep?: (ms: number) => Promise<void>,
  ) {}

  private get<T>(path: string) {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.developerToken}` };
    if (this.musicUserToken) headers['Music-User-Token'] = this.musicUserToken;
    return fetchJson<T>(path.startsWith('http') ? path : `${API}${path}`, { headers }, { provider: 'Apple Music', fetchImpl: this.fetchImpl, sleep: this.sleep });
  }

  async listLibraryPlaylists(): Promise<{ id: string; name: string }[]> {
    if (!this.musicUserToken) throw new ImportError('Connect Apple Music first to list your library playlists.', 'needs_connection', 401);
    const data = await this.get<{ data: { id: string; attributes?: { name?: string } }[] }>('/me/library/playlists?limit=100');
    return data.data.map((p) => ({ id: p.id, name: p.attributes?.name ?? 'Untitled' }));
  }

  async getPlaylist(ref: { id: string; storefront: string; library: boolean }): Promise<RawPlaylist> {
    if (ref.library && !this.musicUserToken) {
      throw new ImportError('Library playlists require connecting your Apple Music account (MusicKit).', 'needs_connection', 401);
    }
    const base = ref.library ? `/me/library/playlists/${encodeURIComponent(ref.id)}` : `/catalog/${ref.storefront}/playlists/${encodeURIComponent(ref.id)}`;
    let name = 'Apple Music playlist';
    try {
      const meta = await this.get<{ data: { attributes?: { name?: string; url?: string } }[] }>(base);
      name = meta.data[0]?.attributes?.name ?? name;
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'not_found') throw new ImportError('Apple Music could not find that playlist.', 'not_found', 404);
      if (err instanceof ProviderError && (err.code === 'unauthorized' || err.code === 'forbidden')) {
        throw new ImportError('Apple Music rejected the request. Check the developer token and, for library playlists, reconnect your account.', 'not_authorized', 403);
      }
      throw err;
    }
    const entries: RawEntry[] = [];
    let next: string | null = `${base}/tracks?limit=100`;
    let row = 0;
    while (next && entries.length < IMPORT_LIMITS.maxEntries) {
      const data: { data: AppleSong[]; next?: string } = await this.get(next.startsWith('/v1/') ? `https://api.music.apple.com${next}` : next);
      for (const s of data.data) {
        row++;
        const a = s.attributes;
        if (!a || (s.type !== 'songs' && s.type !== 'library-songs')) continue;
        const catalogId = s.type === 'songs' ? s.id : a.playParams?.catalogId;
        entries.push({
          row,
          title: a.name,
          artists: [a.artistName],
          album: a.albumName ?? null,
          durationMs: a.durationInMillis ?? null,
          isrc: a.isrc ?? null,
          releaseDate: a.releaseDate ?? null,
          explicit: a.contentRating ? a.contentRating === 'explicit' : null,
          genres: (a.genreNames ?? []).filter((g) => g !== 'Music'),
          genreKind: 'provider',
          genreSource: 'apple_music',
          providerIds: catalogId ? [{ namespace: 'apple_music:song', value: catalogId, url: a.url ?? null }] : [],
          sourceUrl: a.url ?? null,
          parseConfidence: 'high',
        });
      }
      next = data.next ?? null;
    }
    if (entries.length === 0) throw new ImportError('This Apple Music playlist has no importable songs.', 'empty');
    return {
      name,
      provider: 'apple_music',
      sourceRef: ref.id,
      sourceUrl: ref.library ? null : `https://music.apple.com/${ref.storefront}/playlist/${ref.id}`,
      entries,
      errors: [],
      notes: ['Genres come from Apple Music catalogue metadata (genreNames).'],
    };
  }
}
