/**
 * Playlist → SOMM CSV conversion. Reuses the import adapters, so a converted
 * CSV imports back to exactly the songs that were read. Nothing is stored.
 */
import { emptyCsvRow, formatDuration, type SommCsvRow } from '../../shared/csv';
import type { ImportRowError, RawEntry, RawPlaylist } from './types';

export interface ConvertedPlaylist {
  name: string;
  provider: string;
  rows: SommCsvRow[];
  /** Source rows that could not be read (row numbers refer to the source). */
  errors: ImportRowError[];
  notes: string[];
}

export function entryToCsvRow(e: RawEntry): SommCsvRow {
  const attrs = e.attributes ?? [];
  const of = (category: string) => attrs.filter((a) => a.category === category).map((a) => a.value);
  return {
    ...emptyCsvRow(),
    title: e.title,
    artist: e.artists.join('; '),
    album: e.album ?? '',
    genre: (e.genres ?? []).join('; '),
    year: e.releaseDate ?? '',
    duration: formatDuration(e.durationMs),
    isrc: e.isrc ?? '',
    bpm: e.bpm ? String(e.bpm) : '',
    instruments: of('instrument').join('; '),
    mood: of('mood').join('; '),
    tags: attrs.filter((a) => a.category !== 'instrument' && a.category !== 'mood').map((a) => a.value).join('; '),
    link: e.sourceUrl ?? e.providerIds?.[0]?.url ?? '',
  };
}

export function toConverted(p: RawPlaylist): ConvertedPlaylist {
  const notes = [...p.notes];
  if (p.entries.some((e) => e.genreKind === 'provider' && (e.genres?.length ?? 0) > 0)) {
    notes.push('Genres supplied by the service (for example Spotify’s artist genres) are kept. Once imported from this CSV they count as genres from your file.');
  }
  if (p.retentionDays) notes.push(`Data from this service must be refreshed or deleted within ${p.retentionDays} days of being fetched.`);
  return { name: p.name, provider: p.provider, rows: p.entries.map(entryToCsvRow), errors: p.errors, notes };
}
