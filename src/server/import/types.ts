import type { AttributeCategory, ProviderId } from '../../shared/types';

/** One entry as read from a source, before identity resolution. */
export interface RawEntry {
  /** 1-based row/position in the source. */
  row: number;
  title: string;
  /** Primary artist first. */
  artists: string[];
  album?: string | null;
  durationMs?: number | null;
  isrc?: string | null;
  /** "YYYY" or "YYYY-MM-DD". */
  releaseDate?: string | null;
  explicit?: boolean | null;
  /** Genres supplied by the source. */
  genres?: string[];
  /** `user` = typed by the user in their own file; `provider` = catalogue metadata from the provider. */
  genreKind?: 'user' | 'provider';
  genreSource?: string;
  attributes?: { category: AttributeCategory; value: string }[];
  bpm?: number | null;
  providerIds?: { namespace: string; value: string; url?: string | null }[];
  artistIds?: { namespace: string; value: string }[];
  sourceUrl?: string | null;
  artworkUrl?: string | null;
  /** How reliably title/artist were parsed (e.g. YouTube video titles are 'low' or 'medium'). */
  parseConfidence?: 'high' | 'medium' | 'low';
  warnings?: string[];
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface RawPlaylist {
  name: string;
  provider: ProviderId;
  sourceRef?: string | null;
  sourceUrl?: string | null;
  entries: RawEntry[];
  errors: ImportRowError[];
  /** Honest notes about provider limitations relevant to this import. */
  notes: string[];
  /** Provider data that must be refreshed or deleted after N days (YouTube: 30). */
  retentionDays?: number | null;
}

export class ImportError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_input'
      | 'empty'
      | 'too_large'
      | 'unsupported_source'
      | 'needs_credentials'
      | 'needs_connection'
      | 'not_authorized'
      | 'not_found'
      | 'rate_limited'
      | 'provider_unavailable',
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export const IMPORT_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxEntries: 5000,
  maxFieldLength: 300,
};
