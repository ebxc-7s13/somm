/** Reading playlist files in the browser before they are sent for import or conversion. */

export type FileSource = 'csv' | 'm3u' | 'xspf' | 'json' | 'text';

/**
 * Decodes a playlist file. Apple Music / iTunes "Export Playlist" text files are
 * UTF-16 with a byte-order mark; spreadsheets often save CSV as Windows-1252.
 */
export async function readTextFile(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Picks the reader from the file extension. Text files with a header row are read as tables on the server. */
export function detectSource(name: string): FileSource {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'm3u' || ext === 'm3u8') return 'm3u';
  if (ext === 'xspf') return 'xspf';
  if (ext === 'json') return 'json';
  if (ext === 'txt') return 'text';
  return 'csv';
}

/** Hand-over of a converted CSV to the import page (same browser tab session). */
const HANDOFF_KEY = 'somm:converted-csv';

export interface ConvertedCsvHandoff {
  csv: string;
  fileName: string;
  name: string;
}

export function storeCsvHandoff(handoff: ConvertedCsvHandoff): boolean {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
    return true;
  } catch {
    return false;
  }
}

export function takeCsvHandoff(): ConvertedCsvHandoff | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    sessionStorage.removeItem(HANDOFF_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<ConvertedCsvHandoff>) : null;
    return v && typeof v.csv === 'string' ? { csv: v.csv, fileName: v.fileName ?? 'converted.csv', name: v.name ?? 'Converted playlist' } : null;
  } catch {
    return null;
  }
}
