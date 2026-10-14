/**
 * Text normalisation for track identity and matching.
 *
 * Rules are deliberately conservative: they make spelling variants comparable
 * ("Beyoncé" ≈ "Beyonce", "Drum & Bass" ≈ "drum and bass") while keeping
 * non-Latin scripts intact (Devanagari vowel signs are combining marks, so we
 * only strip marks that follow Latin letters).
 */

const LATIN_MARKS = /(\p{Script=Latin})\p{M}+/gu;

export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(LATIN_MARKS, '$1')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[‘’‛′`]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove control characters and trim; keeps the user's original casing. */
export function cleanDisplayText(input: string, maxLength = 300): string {
  // eslint-disable-next-line no-control-regex
  const stripped = input.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped.length > maxLength ? stripped.slice(0, maxLength) : stripped;
}

/** Version labels SOMM distinguishes. A remix is never merged with its original. */
export const VERSION_LABELS = [
  'remix',
  'live',
  'acoustic',
  'instrumental',
  'demo',
  'edit',
  'extended',
  'remaster',
  'cover',
  'unplugged',
  'orchestral',
  'reprise',
  'slowed',
  'sped up',
  'karaoke',
  'session',
] as const;
export type VersionLabel = (typeof VERSION_LABELS)[number];

const VERSION_PATTERNS: [RegExp, VersionLabel][] = [
  [/\b(re-?mix|rmx|bootleg|rework|re-?edit|vip mix|dub mix|club mix)\b/i, 'remix'],
  [/\b(live|in concert|live at|live from)\b/i, 'live'],
  [/\bunplugged\b/i, 'unplugged'],
  [/\bacoustic\b/i, 'acoustic'],
  [/\binstrumental\b/i, 'instrumental'],
  [/\bkaraoke\b/i, 'karaoke'],
  [/\bdemo\b/i, 'demo'],
  [/\b(extended|12" ?mix|12 inch)\b/i, 'extended'],
  [/\b(radio edit|single edit|edit)\b/i, 'edit'],
  [/\bremaster(ed)?\b/i, 'remaster'],
  [/\bcover\b/i, 'cover'],
  [/\borchestral\b/i, 'orchestral'],
  [/\breprise\b/i, 'reprise'],
  [/\bslowed\b/i, 'slowed'],
  [/\bsped up\b/i, 'sped up'],
  [/\b(session|sessions)\b/i, 'session'],
];

/** Segments that carry no identity information. */
const NEUTRAL_SEGMENT = /^(original( mix| version)?|album version|single version|mono|stereo|explicit|clean|bonus track)$/i;
const FEATURING = /^(?:feat\.?|ft\.?|featuring|with)\s+(.+)$/i;

export interface ParsedTitle {
  /** Title without version/featuring segments, original casing. */
  baseTitle: string;
  version: VersionLabel | null;
  /** The raw segment that produced the version label, e.g. "Bicep Remix". */
  versionDetail: string | null;
  featuring: string[];
}

/**
 * Split "Song (feat. X) [Live at Y]" or "Song - 2011 Remaster" into a base title,
 * a version label and featured artists.
 */
export function parseTitle(rawTitle: string): ParsedTitle {
  let title = cleanDisplayText(rawTitle);
  const segments: string[] = [];

  // Bracketed segments: (...) and [...]
  title = title.replace(/\s*[([]([^()[\]]+)[)\]]/g, (_m, inner: string) => {
    segments.push(inner.trim());
    return '';
  });

  // Trailing " - Something" segments (common in Spotify/Apple titles).
  const dash = title.match(/^(.*\S)\s+[-–—]\s+(.+)$/);
  if (dash && dash[1] && dash[2]) {
    const tail = dash[2].trim();
    if (VERSION_PATTERNS.some(([re]) => re.test(tail)) || NEUTRAL_SEGMENT.test(tail) || FEATURING.test(tail)) {
      title = dash[1];
      segments.push(tail);
    }
  }

  // Inline "Song feat. X" without brackets.
  const inlineFeat = title.match(/^(.*\S)\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i);
  if (inlineFeat && inlineFeat[1] && inlineFeat[2]) {
    title = inlineFeat[1];
    segments.push(`feat. ${inlineFeat[2]}`);
  }

  let version: VersionLabel | null = null;
  let versionDetail: string | null = null;
  const featuring: string[] = [];

  for (const segment of segments) {
    const feat = segment.match(FEATURING);
    if (feat && feat[1]) {
      featuring.push(...splitArtistList(feat[1]));
      continue;
    }
    if (NEUTRAL_SEGMENT.test(segment)) continue;
    if (version === null) {
      for (const [re, label] of VERSION_PATTERNS) {
        if (re.test(segment)) {
          version = label;
          versionDetail = segment;
          break;
        }
      }
    }
  }

  const baseTitle = title.trim() || cleanDisplayText(rawTitle);
  return { baseTitle, version, versionDetail, featuring };
}

/**
 * Split an artist credit into individual artists. Only unambiguous delimiters
 * are used: ";", "|", " / " and featuring markers. "&" and "," are NOT split,
 * because names such as "Simon & Garfunkel" or "Tyler, The Creator" contain them.
 */
export function splitArtistList(raw: string): string[] {
  const parts = cleanDisplayText(raw)
    .split(/\s*(?:;|\||\s\/\s|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    const key = normalizeText(part);
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(part);
    }
  }
  return result;
}

/** Fallback identity key for a recording when no provider id or ISRC exists. */
export function fallbackTrackKey(title: string, primaryArtist: string, version: string | null): string {
  return `${normalizeText(title)}|${normalizeText(primaryArtist)}|${version ?? ''}`;
}

const YOUTUBE_NOISE =
  /\s*[([](?:official(?: music)? (?:video|audio|visuali[sz]er|lyric video)|official|lyrics?|lyric video|audio|video|(?:4k|hd|hq)(?: (?:remaster(?:ed)?|video|upgrade))?|remastered in (?:4k|hd)|visuali[sz]er|music video|mv|explicit)[)\]]/gi;

/**
 * Best-effort split of a YouTube video title into artist and title.
 * Returns `confidence: 'low'` when the title has no "Artist - Title" structure,
 * so the import preview can flag it for review instead of guessing silently.
 */
export function parseYouTubeTitle(
  videoTitle: string,
  channelTitle: string | null,
): { artist: string | null; title: string; confidence: 'medium' | 'low' } {
  const cleaned = cleanDisplayText(videoTitle)
    .replace(YOUTUBE_NOISE, '')
    .replace(/\s+(?:official (?:music )?video|official audio)$/i, '')
    .trim();
  const channelArtist = channelTitle
    ? cleanDisplayText(channelTitle)
        .replace(/\s*-\s*Topic$/i, '')
        .replace(/VEVO$/i, '')
        .trim() || null
    : null;
  const split = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (split && split[1] && split[2]) {
    return { artist: split[1].trim(), title: split[2].trim(), confidence: 'medium' };
  }
  if (channelTitle && /-\s*Topic$/i.test(channelTitle) && channelArtist) {
    // Auto-generated "Artist - Topic" channels carry the artist name reliably.
    return { artist: channelArtist, title: cleaned, confidence: 'medium' };
  }
  return { artist: channelArtist, title: cleaned, confidence: 'low' };
}

export function slugify(input: string): string {
  const base = normalizeText(input).replace(/\s+/g, '-').slice(0, 60);
  return base || 'tree';
}
