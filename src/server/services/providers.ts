/**
 * Provider availability, OAuth connections and authenticated clients.
 * Availability is reported honestly: an integration without credentials says
 * so instead of pretending to work.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { AppConfig } from '../config';
import { get, newId, nowIso, run, type DB } from '../db';
import type { FetchLike } from '../http';
import { AppleMusicClient, createAppleDeveloperToken } from '../import/adapters/applemusic';
import { exchangeSpotifyCode, refreshSpotifyToken, SpotifyClient, spotifyAuthorizeUrl } from '../import/adapters/spotify';
import { YouTubeClient } from '../import/adapters/youtube';
import { ImportError } from '../import/types';
import { TokenVault } from '../security';

export const PROVIDERS_VERIFIED_AT = '2026-10-13';

export type ProviderState = 'available' | 'connected' | 'needs_connection' | 'needs_credentials' | 'unavailable';

export interface ProviderStatus {
  id: 'spotify' | 'youtube' | 'apple_music' | 'files' | 'manual' | 'musicbrainz' | 'itunes';
  label: string;
  role: 'import' | 'enrichment';
  state: ProviderState;
  summary: string;
  capabilities: string[];
  limitations: string[];
  docsUrl: string;
  verifiedAt: string;
}

export class ProviderService {
  readonly vault: TokenVault | null;
  readonly vaultIsEphemeral: boolean;
  private appleToken: { token: string; expires: number } | null = null;

  constructor(
    private readonly db: DB,
    private readonly config: AppConfig,
    private readonly fetchImpl?: FetchLike,
  ) {
    if (config.tokenEncryptionKey) {
      this.vault = new TokenVault(config.tokenEncryptionKey);
      this.vaultIsEphemeral = false;
    } else if (!config.isProduction) {
      // Development convenience: tokens survive only until restart.
      this.vault = new TokenVault(randomBytes(32));
      this.vaultIsEphemeral = true;
    } else {
      this.vault = null;
      this.vaultIsEphemeral = false;
    }
  }

  get spotifyConfigured() {
    return !!(this.config.spotify.clientId && this.config.spotify.redirectUri && this.vault);
  }

  get appleConfigured() {
    const a = this.config.appleMusic;
    return !!(a.teamId && a.keyId && a.privateKeyPath && existsSync(a.privateKeyPath));
  }

  connection(userId: string, provider: string) {
    return get<{ id: string; access_token_enc: string; refresh_token_enc: string | null; expires_at: string | null; scope: string | null; created_at: string }>(
      this.db,
      'SELECT id, access_token_enc, refresh_token_enc, expires_at, scope, created_at FROM provider_connections WHERE user_id = ? AND provider = ?',
      [userId, provider],
    );
  }

  statuses(userId: string | null): ProviderStatus[] {
    const spotifyConnected = userId ? !!this.connection(userId, 'spotify') : false;
    const appleConnected = userId ? !!this.connection(userId, 'apple_music') : false;
    return [
      {
        id: 'files',
        label: 'Files & pasted lists',
        role: 'import',
        state: 'available',
        summary: 'CSV (including Exportify exports of Spotify playlists), M3U/M3U8, XSPF, JSON, or a pasted “Artist - Title” list.',
        capabilities: ['Title, artist, album, duration, ISRC, year', 'Your own genre, mood, instrument and BPM columns'],
        limitations: ['Metadata is only as complete as the file.'],
        docsUrl: '/docs/MUSIC_IMPORTS.md',
        verifiedAt: PROVIDERS_VERIFIED_AT,
      },
      {
        id: 'manual',
        label: 'Add songs manually',
        role: 'import',
        state: 'available',
        summary: 'Type songs in one at a time, with optional album, year and genre.',
        capabilities: ['Always available'],
        limitations: [],
        docsUrl: '/docs/MUSIC_IMPORTS.md',
        verifiedAt: PROVIDERS_VERIFIED_AT,
      },
      {
        id: 'spotify',
        label: 'Spotify',
        role: 'import',
        state: !this.spotifyConfigured ? 'needs_credentials' : spotifyConnected ? 'connected' : 'needs_connection',
        summary: this.spotifyConfigured
          ? spotifyConnected
            ? 'Connected. You can import playlists you own or collaborate on.'
            : 'Connect with Spotify (OAuth) to import playlists you own or collaborate on.'
          : 'Not configured on this server: needs SPOTIFY_CLIENT_ID and SPOTIFY_REDIRECT_URI.',
        capabilities: ['Track, artists, album, duration, ISRC, explicit flag', 'Artist-level genres (deprecated field, often empty)'],
        limitations: [
          'Tracks are returned only for playlists you own or collaborate on (Web API rules since Feb 2026).',
          'Development-mode apps: the app owner needs Spotify Premium and at most 5 allow-listed users.',
          'Audio features (tempo, energy) are unavailable to new apps; SOMM does not claim them.',
          'Workaround for other playlists: export with Exportify and import the CSV.',
        ],
        docsUrl: 'https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide',
        verifiedAt: PROVIDERS_VERIFIED_AT,
      },
      {
        id: 'youtube',
        label: 'YouTube / YouTube Music',
        role: 'import',
        state: this.config.youtube.apiKey ? 'available' : 'needs_credentials',
        summary: this.config.youtube.apiKey
          ? 'Paste a public or unlisted playlist link.'
          : 'Not configured on this server: needs YOUTUBE_API_KEY.',
        capabilities: ['Video titles and channel names (parsed into artist and title)'],
        limitations: [
          'No genres or structured song metadata — SOMM parses titles and looks genres up in MusicBrainz.',
          'Private playlists, “Liked videos” and auto-generated Mixes cannot be read with an API key.',
          'YouTube-derived data is refreshed or deleted within 30 days (YouTube Developer Policies).',
        ],
        docsUrl: 'https://developers.google.com/youtube/v3/docs/playlistItems/list',
        verifiedAt: PROVIDERS_VERIFIED_AT,
      },
      {
        id: 'apple_music',
        label: 'Apple Music',
        role: 'import',
        state: !this.appleConfigured ? 'needs_credentials' : appleConnected ? 'connected' : 'available',
        summary: this.appleConfigured
          ? 'Paste an Apple Music catalogue playlist link; connect MusicKit for library playlists.'
          : 'Not configured on this server: needs an Apple Developer Program MusicKit key (team ID, key ID, .p8 file).',
        capabilities: ['Catalogue genres (genreNames), ISRC, album, duration'],
        limitations: [
          'Requires a paid Apple Developer Program membership.',
          'Library playlists need the user to authorise MusicKit and an Apple Music subscription.',
          'Implemented against Apple’s documented API and tested with mocks only — not yet verified live.',
        ],
        docsUrl: 'https://developer.apple.com/documentation/applemusicapi',
        verifiedAt: PROVIDERS_VERIFIED_AT,
      },
      {
        id: 'musicbrainz',
        label: 'MusicBrainz',
        role: 'enrichment',
        state: this.config.musicbrainz.enabled && this.config.musicbrainz.contact ? 'available' : 'unavailable',
        summary:
          this.config.musicbrainz.enabled && this.config.musicbrainz.contact
            ? 'Looks up genres, release years and instrument credits for imported tracks (1 request per second).'
            : 'Disabled: set MUSICBRAINZ_CONTACT so requests carry a contact User-Agent, as MusicBrainz requires.',
        capabilities: ['Community genre votes', 'Performer instrument credits', 'First release date'],
        limitations: ['Rate limited to about 1 request per second', 'Genre/tag data is CC BY-NC-SA 3.0 (non-commercial)'],
        docsUrl: 'https://musicbrainz.org/doc/MusicBrainz_API',
        verifiedAt: PROVIDERS_VERIFIED_AT,
      },
      {
        id: 'itunes',
        label: 'Apple iTunes Search',
        role: 'enrichment',
        state: this.config.itunesLookupEnabled ? 'available' : 'unavailable',
        summary: this.config.itunesLookupEnabled
          ? 'Fallback primary-genre lookup when MusicBrainz has none.'
          : 'Off (ITUNES_LOOKUP_ENABLED=false).',
        capabilities: ['Primary store genre'],
        limitations: ['About 20 calls per minute', 'Artwork and previews are not used (promotional-use terms)'],
        docsUrl: 'https://performance-partners.apple.com/search-api',
        verifiedAt: PROVIDERS_VERIFIED_AT,
      },
    ];
  }

  // ----------------------------------------------------------- Spotify OAuth

  spotifyAuthorize(userId: string): string {
    if (!this.spotifyConfigured) throw new ImportError('Spotify is not configured on this server.', 'needs_credentials', 503);
    const state = randomBytes(24).toString('base64url');
    const { url, verifier } = spotifyAuthorizeUrl(this.config.spotify.clientId!, this.config.spotify.redirectUri!, state);
    run(this.db, 'DELETE FROM oauth_states WHERE created_at < ?', [nowIso(-15 * 60 * 1000)]);
    run(this.db, 'INSERT INTO oauth_states (state, user_id, provider, code_verifier, created_at) VALUES (?, ?, ?, ?, ?)', [state, userId, 'spotify', verifier, nowIso()]);
    return url;
  }

  async spotifyCallback(userId: string, code: string, state: string): Promise<void> {
    const row = get<{ user_id: string; code_verifier: string; created_at: string }>(
      this.db,
      "SELECT user_id, code_verifier, created_at FROM oauth_states WHERE state = ? AND provider = 'spotify'",
      [state],
    );
    run(this.db, 'DELETE FROM oauth_states WHERE state = ?', [state]);
    if (!row || row.user_id !== userId || row.created_at < nowIso(-10 * 60 * 1000)) {
      throw new ImportError('The Spotify sign-in link expired or does not belong to this session. Please try again.', 'not_authorized', 400);
    }
    const tokens = await exchangeSpotifyCode({
      clientId: this.config.spotify.clientId!,
      redirectUri: this.config.spotify.redirectUri!,
      code,
      verifier: row.code_verifier,
      fetchImpl: this.fetchImpl,
    });
    this.storeTokens(userId, 'spotify', tokens.accessToken, tokens.refreshToken, tokens.expiresAt, tokens.scope);
  }

  storeTokens(userId: string, provider: string, access: string, refresh: string | null, expiresAt: string | null, scope: string | null) {
    if (!this.vault) throw new ImportError('Token storage is not configured (TOKEN_ENCRYPTION_KEY).', 'needs_credentials', 503);
    const now = nowIso();
    run(
      this.db,
      `INSERT INTO provider_connections (id, user_id, provider, access_token_enc, refresh_token_enc, scope, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, provider) DO UPDATE SET access_token_enc = excluded.access_token_enc,
         refresh_token_enc = COALESCE(excluded.refresh_token_enc, refresh_token_enc), scope = excluded.scope,
         expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
      [newId(), userId, provider, this.vault.encrypt(access), refresh ? this.vault.encrypt(refresh) : null, scope, expiresAt, now, now],
    );
  }

  disconnect(userId: string, provider: string): boolean {
    return run(this.db, 'DELETE FROM provider_connections WHERE user_id = ? AND provider = ?', [userId, provider]).changes > 0;
  }

  async spotifyClient(userId: string): Promise<SpotifyClient> {
    if (!this.spotifyConfigured) throw new ImportError('Spotify is not configured on this server.', 'needs_credentials', 503);
    const conn = this.connection(userId, 'spotify');
    if (!conn) throw new ImportError('Connect your Spotify account first.', 'needs_connection', 401);
    let access: string;
    try {
      access = this.vault!.decrypt(conn.access_token_enc);
    } catch {
      this.disconnect(userId, 'spotify');
      throw new ImportError('Your Spotify connection expired (server key changed). Please reconnect.', 'needs_connection', 401);
    }
    if (conn.expires_at && conn.expires_at < nowIso(60_000) && conn.refresh_token_enc) {
      const refreshed = await refreshSpotifyToken({ clientId: this.config.spotify.clientId!, refreshToken: this.vault!.decrypt(conn.refresh_token_enc), fetchImpl: this.fetchImpl });
      this.storeTokens(userId, 'spotify', refreshed.accessToken, refreshed.refreshToken, refreshed.expiresAt, refreshed.scope);
      access = refreshed.accessToken;
    }
    return new SpotifyClient(access, this.fetchImpl);
  }

  youtubeClient(): YouTubeClient {
    if (!this.config.youtube.apiKey) throw new ImportError('YouTube import is not configured on this server (YOUTUBE_API_KEY).', 'needs_credentials', 503);
    return new YouTubeClient(this.config.youtube.apiKey, this.fetchImpl);
  }

  appleDeveloperToken(): string {
    if (!this.appleConfigured) throw new ImportError('Apple Music is not configured on this server.', 'needs_credentials', 503);
    if (!this.appleToken || this.appleToken.expires < Date.now() + 60_000) {
      const a = this.config.appleMusic;
      this.appleToken = { token: createAppleDeveloperToken({ teamId: a.teamId!, keyId: a.keyId!, privateKeyPath: a.privateKeyPath! }), expires: Date.now() + 11 * 3600 * 1000 };
    }
    return this.appleToken.token;
  }

  appleClient(userId: string): AppleMusicClient {
    const devToken = this.appleDeveloperToken();
    const conn = this.connection(userId, 'apple_music');
    let userToken: string | null = null;
    if (conn && this.vault) {
      try {
        userToken = this.vault.decrypt(conn.access_token_enc);
      } catch {
        userToken = null;
      }
    }
    return new AppleMusicClient(devToken, userToken, this.fetchImpl);
  }
}
