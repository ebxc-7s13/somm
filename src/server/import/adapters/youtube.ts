/**
 * YouTube Data API v3 adapter (verified against developers.google.com on 2026-10-13).
 *
 * - API-key requests can read public (and unlisted) playlists via
 *   playlistItems.list (1 quota unit per call, maxResults ≤ 50). Default quota
 *   is 10,000 units/day for most endpoints.
 * - YouTube exposes video titles and channel names, not artist/title/genre.
 *   SOMM parses "Artist - Title" from the video title, flags low-confidence
 *   parses for review, and looks genres up in MusicBrainz instead.
 * - Developer Policies III.E.4: stored API data must be refreshed or deleted
 *   within 30 days, so YouTube-derived playlist rows carry a 30-day expiry.
 * - YouTube Music playlists with music.youtube.com URLs use the same playlist
 *   IDs; auto-generated "Mix" (RD…) lists are not readable.
 */
import { parseYouTubeTitle } from '../../../shared/normalize';
import { fetchJson, type FetchLike, ProviderError } from '../../http';
import { ImportError, IMPORT_LIMITS, type RawEntry, type RawPlaylist } from '../types';

const API = 'https://www.googleapis.com/youtube/v3';

interface PlaylistItemsResponse {
  nextPageToken?: string;
  items: {
    snippet: {
      title: string;
      position: number;
      videoOwnerChannelTitle?: string;
      resourceId: { kind: string; videoId?: string };
    };
    status?: { privacyStatus?: string };
  }[];
}

export class YouTubeClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl?: FetchLike,
    private readonly sleep?: (ms: number) => Promise<void>,
  ) {}

  private get<T>(path: string, params: Record<string, string>) {
    const qs = new URLSearchParams({ ...params, key: this.apiKey });
    return fetchJson<T>(`${API}${path}?${qs}`, {}, { provider: 'YouTube', fetchImpl: this.fetchImpl, sleep: this.sleep });
  }

  async getPlaylist(playlistId: string): Promise<RawPlaylist> {
    let title: string;
    try {
      const meta = await this.get<{ items: { snippet: { title: string } }[] }>('/playlists', { part: 'snippet', id: playlistId, maxResults: '1' });
      if (!meta.items?.length) throw new ImportError('YouTube could not find that playlist, or it is private.', 'not_found', 404);
      title = meta.items[0]!.snippet.title;
    } catch (err) {
      if (err instanceof ProviderError && (err.code === 'forbidden' || err.code === 'not_found')) {
        throw new ImportError('YouTube refused access to this playlist. Only public or unlisted playlists can be imported.', 'not_authorized', 403);
      }
      throw err;
    }

    const entries: RawEntry[] = [];
    let skipped = 0;
    let lowConfidence = 0;
    let pageToken: string | undefined;
    do {
      const data: PlaylistItemsResponse = await this.get('/playlistItems', {
        part: 'snippet,status',
        playlistId,
        maxResults: '50',
        ...(pageToken ? { pageToken } : {}),
      });
      for (const it of data.items ?? []) {
        const videoId = it.snippet.resourceId?.videoId;
        const privacy = it.status?.privacyStatus;
        if (!videoId || it.snippet.title === 'Private video' || it.snippet.title === 'Deleted video' || privacy === 'private') {
          skipped++;
          continue;
        }
        const parsed = parseYouTubeTitle(it.snippet.title, it.snippet.videoOwnerChannelTitle ?? null);
        if (!parsed.artist) {
          skipped++;
          continue;
        }
        if (parsed.confidence === 'low') lowConfidence++;
        entries.push({
          row: it.snippet.position + 1,
          title: parsed.title,
          artists: [parsed.artist],
          providerIds: [{ namespace: 'youtube:video', value: videoId, url: `https://www.youtube.com/watch?v=${videoId}` }],
          sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
          parseConfidence: parsed.confidence,
          warnings: parsed.confidence === 'low' ? ['Artist guessed from the channel name — please review.'] : [],
        });
        if (entries.length >= IMPORT_LIMITS.maxEntries) break;
      }
      pageToken = entries.length >= IMPORT_LIMITS.maxEntries ? undefined : data.nextPageToken;
    } while (pageToken);

    if (entries.length === 0) throw new ImportError('No readable videos were found in this playlist.', 'empty');
    const notes = [
      'YouTube provides video titles, not structured song metadata. Artist and title were parsed from each video title.',
      'YouTube-derived entries are kept for at most 30 days unless refreshed, as required by the YouTube API Services Developer Policies.',
    ];
    if (skipped) notes.push(`${skipped} private, deleted or unparseable video(s) were skipped.`);
    if (lowConfidence) notes.push(`${lowConfidence} entr${lowConfidence === 1 ? 'y has' : 'ies have'} a low-confidence artist guess; review them in the preview.`);
    return {
      name: title,
      provider: 'youtube',
      sourceRef: playlistId,
      sourceUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
      entries,
      errors: [],
      notes,
      retentionDays: 30,
    };
  }
}
