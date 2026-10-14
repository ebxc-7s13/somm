/**
 * SOMM's CSV playlist format: the file the converter produces and the CSV
 * importer reads. One row per song; multiple artists or genres are separated
 * with "; ". Shared by the server (tests, conversion) and the browser (download).
 */

export const SOMM_CSV_COLUMNS = ['title', 'artist', 'album', 'genre', 'year', 'duration', 'isrc', 'bpm', 'instruments', 'mood', 'tags', 'link'] as const;

export type SommCsvColumn = (typeof SOMM_CSV_COLUMNS)[number];
export type SommCsvRow = Record<SommCsvColumn, string>;

export const emptyCsvRow = (): SommCsvRow => Object.fromEntries(SOMM_CSV_COLUMNS.map((c) => [c, ''])) as SommCsvRow;

/**
 * Spreadsheet apps run cells that start with = + - @ (or a tab/CR) as formulas.
 * Such cells get a leading apostrophe, which SOMM's importer removes again.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function neutralizeCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

export function restoreCell(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

function quote(value: string): string {
  const v = neutralizeCell(value.replace(/\r\n?/g, '\n'));
  return /[",\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Serialise rows as RFC 4180 CSV (CRLF line endings, UTF-8 BOM so Excel reads accents correctly). */
export function toSommCsv(rows: SommCsvRow[]): string {
  const lines = [SOMM_CSV_COLUMNS.join(','), ...rows.map((r) => SOMM_CSV_COLUMNS.map((c) => quote(r[c] ?? '')).join(','))];
  return String.fromCharCode(0xfeff) + lines.join('\r\n') + '\r\n';
}

/** "3:05" or "1:02:03" from milliseconds. */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** A safe file name for a playlist's CSV. */
export function csvFileName(playlistName: string): string {
  const base = playlistName
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9 _-]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .toLowerCase();
  return `${base || 'playlist'}-somm.csv`;
}
