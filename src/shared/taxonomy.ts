/**
 * Genre taxonomy, aliases and attribute vocabularies.
 *
 * This is a small, hand-curated table — not a claim about musicology. It exists
 * so that "Hip-Hop", "hiphop" and "hip hop" are counted as one genre, and so
 * that subgenres can be grouped into broad families for the Music Map.
 * Unknown genres are kept verbatim and assigned a family by keyword rules
 * (or "other"), never dropped.
 */
import { normalizeText } from './normalize';
import type { AttributeCategory } from './types';

export const FAMILIES = [
  'electronic',
  'ambient',
  'rock',
  'metal',
  'pop',
  'hip hop',
  'r&b & soul',
  'jazz',
  'blues',
  'classical',
  'folk & country',
  'indian',
  'latin',
  'reggae & caribbean',
  'african',
  'world',
  'experimental',
  'soundtrack',
  'other',
] as const;
export type Family = (typeof FAMILIES)[number];

export const FAMILY_LABELS: Record<Family, string> = {
  electronic: 'Electronic',
  ambient: 'Ambient',
  rock: 'Rock',
  metal: 'Metal',
  pop: 'Pop',
  'hip hop': 'Hip Hop',
  'r&b & soul': 'R&B & Soul',
  jazz: 'Jazz',
  blues: 'Blues',
  classical: 'Classical',
  'folk & country': 'Folk & Country',
  indian: 'Indian',
  latin: 'Latin',
  'reggae & caribbean': 'Reggae & Caribbean',
  african: 'African',
  world: 'World',
  experimental: 'Experimental',
  soundtrack: 'Soundtrack & Score',
  other: 'Other',
};

/**
 * Family colours for the Music Map. Built around the SOMM palette
 * (royal blue, yellow, orange) and extended with distinguishable hues that all
 * read on the deep electric blue (#071A52) canvas.
 */
export const FAMILY_COLORS: Record<Family | 'unknown', string> = {
  electronic: '#4D7CFF',
  ambient: '#8FB3FF',
  rock: '#FF7A24',
  metal: '#FF5A4E',
  pop: '#FFD83D',
  'hip hop': '#FFB13D',
  'r&b & soul': '#FF8FB1',
  jazz: '#C9A2FF',
  blues: '#6FA8FF',
  classical: '#F5F1E6',
  'folk & country': '#B5E36B',
  indian: '#FFA05C',
  latin: '#FF6FA0',
  'reggae & caribbean': '#7BE0A8',
  african: '#E8C15A',
  world: '#5FD8E0',
  experimental: '#A6F0FF',
  soundtrack: '#D4DBFF',
  other: '#B8C3E6',
  unknown: '#6B7799',
};

/** Canonical genre name â†’ family. Keys are normalised (see normalizeText). */
const GENRE_FAMILY: Record<string, Family> = {
  electronic: 'electronic', electronica: 'electronic', edm: 'electronic', house: 'electronic', 'deep house': 'electronic',
  'tech house': 'electronic', 'progressive house': 'electronic', techno: 'electronic', 'minimal techno': 'electronic',
  trance: 'electronic', 'drum and bass': 'electronic', jungle: 'electronic', dubstep: 'electronic', garage: 'electronic',
  'uk garage': 'electronic', idm: 'electronic', synthpop: 'electronic', synthwave: 'electronic', electro: 'electronic',
  'electro house': 'electronic', breakbeat: 'electronic', downtempo: 'electronic', 'trip hop': 'electronic',
  chillwave: 'electronic', 'future bass': 'electronic', hardstyle: 'electronic', 'big beat': 'electronic',
  'lo fi': 'electronic', 'lo fi hip hop': 'hip hop', vaporwave: 'electronic', 'nu disco': 'electronic', disco: 'pop',
  'dance pop': 'pop', dance: 'electronic', 'electronic dance music': 'electronic', 'bass music': 'electronic',
  ambient: 'ambient', 'dark ambient': 'ambient', drone: 'ambient', 'new age': 'ambient', 'ambient electronic': 'ambient',
  'space music': 'ambient', 'ambient pop': 'ambient',
  rock: 'rock', 'alternative rock': 'rock', 'indie rock': 'rock', 'progressive rock': 'rock', 'psychedelic rock': 'rock',
  'post rock': 'rock', 'hard rock': 'rock', 'classic rock': 'rock', punk: 'rock', 'punk rock': 'rock', 'post punk': 'rock',
  grunge: 'rock', shoegaze: 'rock', 'math rock': 'rock', 'art rock': 'rock', 'krautrock': 'rock', 'garage rock': 'rock',
  'stoner rock': 'rock', 'blues rock': 'rock', 'new wave': 'rock', alternative: 'rock', indie: 'rock', emo: 'rock', 'dream pop': 'pop',
  metal: 'metal', 'heavy metal': 'metal', 'black metal': 'metal', 'death metal': 'metal', 'doom metal': 'metal',
  'thrash metal': 'metal', 'progressive metal': 'metal', metalcore: 'metal', djent: 'metal', 'power metal': 'metal',
  'nu metal': 'metal', 'sludge metal': 'metal', 'post metal': 'metal',
  pop: 'pop', 'indie pop': 'pop', 'art pop': 'pop', 'k pop': 'pop', 'j pop': 'pop', 'electropop': 'pop', 'synth pop': 'electronic',
  'teen pop': 'pop', 'pop rock': 'pop', 'bedroom pop': 'pop', 'hyperpop': 'pop', 'city pop': 'pop',
  'hip hop': 'hip hop', rap: 'hip hop', trap: 'hip hop', drill: 'hip hop', grime: 'hip hop', 'boom bap': 'hip hop',
  'conscious hip hop': 'hip hop', 'jazz rap': 'hip hop', 'gangsta rap': 'hip hop', 'alternative hip hop': 'hip hop',
  'r and b': 'r&b & soul', 'contemporary r and b': 'r&b & soul', soul: 'r&b & soul', 'neo soul': 'r&b & soul',
  funk: 'r&b & soul', motown: 'r&b & soul', gospel: 'r&b & soul', 'quiet storm': 'r&b & soul',
  jazz: 'jazz', bebop: 'jazz', 'hard bop': 'jazz', 'cool jazz': 'jazz', 'free jazz': 'jazz', 'jazz fusion': 'jazz',
  fusion: 'jazz', swing: 'jazz', 'smooth jazz': 'jazz', 'modal jazz': 'jazz', 'nu jazz': 'jazz', 'vocal jazz': 'jazz',
  'spiritual jazz': 'jazz', 'acid jazz': 'jazz', 'latin jazz': 'jazz',
  blues: 'blues', 'delta blues': 'blues', 'chicago blues': 'blues', 'electric blues': 'blues',
  classical: 'classical', baroque: 'classical', romantic: 'classical', opera: 'classical', 'chamber music': 'classical',
  'contemporary classical': 'classical', minimalism: 'classical', 'modern classical': 'classical', orchestral: 'classical',
  'neoclassical': 'classical', 'choral': 'classical', 'early music': 'classical',
  folk: 'folk & country', 'indie folk': 'folk & country', country: 'folk & country', bluegrass: 'folk & country',
  americana: 'folk & country', 'singer songwriter': 'folk & country', 'folk rock': 'folk & country',
  'contemporary folk': 'folk & country', 'alt country': 'folk & country',
  'hindustani classical': 'indian', 'carnatic classical': 'indian', carnatic: 'indian', hindustani: 'indian',
  'indian classical': 'indian', bollywood: 'indian', filmi: 'indian', bhangra: 'indian', ghazal: 'indian',
  qawwali: 'indian', 'indian pop': 'indian', 'sufi': 'indian', 'indie indian': 'indian', 'tamil': 'indian', 'punjabi': 'indian',
  latin: 'latin', reggaeton: 'latin', salsa: 'latin', 'bossa nova': 'latin', samba: 'latin', cumbia: 'latin',
  bachata: 'latin', tango: 'latin', 'latin pop': 'latin', 'mpb': 'latin', 'flamenco': 'latin',
  reggae: 'reggae & caribbean', dub: 'reggae & caribbean', dancehall: 'reggae & caribbean', ska: 'reggae & caribbean',
  soca: 'reggae & caribbean', calypso: 'reggae & caribbean', 'roots reggae': 'reggae & caribbean',
  afrobeat: 'african', afrobeats: 'african', highlife: 'african', amapiano: 'african', 'afro house': 'african',
  'mbalax': 'african', 'soukous': 'african', 'desert blues': 'african',
  world: 'world', 'world music': 'world', celtic: 'world', 'fado': 'world', 'klezmer': 'world', 'gamelan': 'world',
  experimental: 'experimental', noise: 'experimental', 'avant garde': 'experimental', 'musique concrete': 'experimental',
  'sound art': 'experimental', 'glitch': 'experimental', 'free improvisation': 'experimental', industrial: 'experimental',
  soundtrack: 'soundtrack', score: 'soundtrack', 'film score': 'soundtrack', 'video game music': 'soundtrack',
  'film soundtrack': 'soundtrack', 'musical theatre': 'soundtrack', 'show tunes': 'soundtrack',
};

/** Spelling variants â†’ canonical genre key. */
const GENRE_ALIASES: Record<string, string> = {
  'hiphop': 'hip hop', 'hip hop rap': 'hip hop', 'rap hip hop': 'hip hop', 'hip hop music': 'hip hop',
  'rnb': 'r and b', 'r b': 'r and b', 'rhythm and blues': 'r and b', 'randb': 'r and b', 'r and b soul': 'r and b',
  'dnb': 'drum and bass', 'd and b': 'drum and bass', 'drum n bass': 'drum and bass', 'drumnbass': 'drum and bass',
  'synth pop': 'synthpop', 'electro pop': 'electropop', 'lofi': 'lo fi', 'lo fi beats': 'lo fi hip hop',
  'lofi hip hop': 'lo fi hip hop', 'postrock': 'post rock', 'post punk revival': 'post punk',
  'kpop': 'k pop', 'jpop': 'j pop', 'edm dance': 'edm', 'dance electronic': 'electronic', 'electronic music': 'electronic',
  'singer songwriters': 'singer songwriter', 'alt rock': 'alternative rock', 'alternative indie': 'indie',
  'hindustani classical music': 'hindustani classical', 'carnatic music': 'carnatic classical',
  'indian classical music': 'indian classical', 'bollywood music': 'bollywood', 'soundtracks': 'soundtrack',
  'original score': 'film score', 'classical music': 'classical', 'jazz music': 'jazz', 'rock music': 'rock',
  'pop music': 'pop', 'country music': 'country', 'folk music': 'folk', 'trip hop music': 'trip hop',
  'trip-hop': 'trip hop', 'triphop': 'trip hop', 'afro beat': 'afrobeat', 'afro beats': 'afrobeats',
  'neo classical': 'neoclassical',
};

const FAMILY_KEYWORDS: [RegExp, Family][] = [
  [/\b(hindustani|carnatic|bollywood|filmi|bhangra|raga|ghazal|qawwali|indian|tamil|telugu|punjabi|kollywood|tollywood)\b/, 'indian'],
  [/\b(ambient|drone|new age)\b/, 'ambient'],
  [/\b(metal|metalcore|deathcore|djent|grindcore)\b/, 'metal'],
  [/\b(hip hop|rap|trap|drill|grime|boom bap)\b/, 'hip hop'],
  [/\b(house|techno|trance|edm|electro|dubstep|drum and bass|garage|synth\w*|idm|electronica|breakbeat|downtempo|bass|rave|jungle|footwork|hardcore techno)\b/, 'electronic'],
  [/\b(jazz|bebop|bop|swing)\b/, 'jazz'],
  [/\b(soul|r and b|funk|motown|gospel)\b/, 'r&b & soul'],
  [/\b(blues)\b/, 'blues'],
  [/\b(classical|baroque|opera|orchestral|chamber|symphon\w*|choral|concerto)\b/, 'classical'],
  [/\b(folk|country|bluegrass|americana|singer songwriter)\b/, 'folk & country'],
  [/\b(reggaeton|salsa|bossa|samba|cumbia|bachata|tango|latin|mpb|flamenco)\b/, 'latin'],
  [/\b(reggae|dub|dancehall|ska|soca|calypso)\b/, 'reggae & caribbean'],
  [/\b(afro\w*|highlife|amapiano|soukous)\b/, 'african'],
  [/\b(experimental|noise|avant|concrete|glitch|industrial)\b/, 'experimental'],
  [/\b(soundtrack|score|video game)\b/, 'soundtrack'],
  [/\b(rock|punk|grunge|shoegaze|emo|indie)\b/, 'rock'],
  [/\b(pop)\b/, 'pop'],
  [/\b(world|celtic|fado|klezmer|gamelan)\b/, 'world'],
];

/** Normalise a raw genre string to its canonical key, or null when it is not usable. */
export function canonicalGenre(raw: string): string | null {
  const key = normalizeText(raw).replace(/\bmusic$/, '').trim();
  if (!key || key.length > 60) return null;
  return GENRE_ALIASES[key] ?? key;
}

export function genreFamily(canonical: string): Family {
  const direct = GENRE_FAMILY[canonical];
  if (direct) return direct;
  for (const [re, family] of FAMILY_KEYWORDS) {
    if (re.test(canonical)) return family;
  }
  return 'other';
}

export function genreDisplayName(canonical: string): string {
  const special: Record<string, string> = {
    'r and b': 'R&B', 'contemporary r and b': 'Contemporary R&B', edm: 'EDM', idm: 'IDM', 'k pop': 'K-Pop',
    'j pop': 'J-Pop', 'lo fi': 'Lo-Fi', 'lo fi hip hop': 'Lo-Fi Hip Hop', 'drum and bass': 'Drum & Bass',
    'uk garage': 'UK Garage', mpb: 'MPB', 'post rock': 'Post-Rock', 'post punk': 'Post-Punk', 'post metal': 'Post-Metal',
    'trip hop': 'Trip Hop', 'hip hop': 'Hip Hop', 'nu metal': 'Nu Metal', 'avant garde': 'Avant-Garde',
  };
  if (special[canonical]) return special[canonical];
  return canonical.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/** Attribute vocabulary for descriptive tags (e.g. MusicBrainz non-genre tags or user columns). */
const TAG_ATTRIBUTES: Record<string, { category: AttributeCategory; value: string }> = {
  instrumental: { category: 'vocal', value: 'instrumental' },
  'a cappella': { category: 'vocal', value: 'a cappella' },
  'acappella': { category: 'vocal', value: 'a cappella' },
  vocal: { category: 'vocal', value: 'vocal-led' },
  synth: { category: 'instrument', value: 'synthesizer' },
  synths: { category: 'instrument', value: 'synthesizer' },
  synthesizer: { category: 'instrument', value: 'synthesizer' },
  synthesiser: { category: 'instrument', value: 'synthesizer' },
  'modular synth': { category: 'instrument', value: 'synthesizer' },
  piano: { category: 'instrument', value: 'piano' },
  keyboards: { category: 'instrument', value: 'keyboards' },
  guitar: { category: 'instrument', value: 'guitar' },
  'electric guitar': { category: 'instrument', value: 'guitar' },
  'acoustic guitar': { category: 'instrument', value: 'acoustic guitar' },
  bass: { category: 'instrument', value: 'bass' },
  'bass guitar': { category: 'instrument', value: 'bass' },
  drums: { category: 'instrument', value: 'drums' },
  'drum machine': { category: 'instrument', value: 'drum machine' },
  saxophone: { category: 'instrument', value: 'saxophone' },
  sax: { category: 'instrument', value: 'saxophone' },
  trumpet: { category: 'instrument', value: 'trumpet' },
  violin: { category: 'instrument', value: 'violin' },
  cello: { category: 'instrument', value: 'cello' },
  strings: { category: 'instrument', value: 'strings' },
  sitar: { category: 'instrument', value: 'sitar' },
  tabla: { category: 'instrument', value: 'tabla' },
  sarod: { category: 'instrument', value: 'sarod' },
  veena: { category: 'instrument', value: 'veena' },
  flute: { category: 'instrument', value: 'flute' },
  bansuri: { category: 'instrument', value: 'bansuri' },
  harmonium: { category: 'instrument', value: 'harmonium' },
  organ: { category: 'instrument', value: 'organ' },
  'rhodes': { category: 'instrument', value: 'electric piano' },
  'electric piano': { category: 'instrument', value: 'electric piano' },
  harp: { category: 'instrument', value: 'harp' },
  atmospheric: { category: 'texture', value: 'atmospheric' },
  dreamy: { category: 'texture', value: 'dreamy' },
  ethereal: { category: 'texture', value: 'ethereal' },
  layered: { category: 'texture', value: 'layered' },
  lush: { category: 'texture', value: 'lush' },
  minimal: { category: 'texture', value: 'minimal' },
  'wall of sound': { category: 'texture', value: 'wall of sound' },
  warm: { category: 'texture', value: 'warm' },
  gritty: { category: 'texture', value: 'gritty' },
  melancholic: { category: 'mood', value: 'melancholic' },
  melancholy: { category: 'mood', value: 'melancholic' },
  sad: { category: 'mood', value: 'melancholic' },
  energetic: { category: 'mood', value: 'energetic' },
  uplifting: { category: 'mood', value: 'uplifting' },
  chill: { category: 'mood', value: 'calm' },
  chillout: { category: 'mood', value: 'calm' },
  calm: { category: 'mood', value: 'calm' },
  relaxing: { category: 'mood', value: 'calm' },
  dark: { category: 'mood', value: 'dark' },
  aggressive: { category: 'mood', value: 'aggressive' },
  happy: { category: 'mood', value: 'joyful' },
  groovy: { category: 'rhythm', value: 'groove-driven' },
  polyrhythmic: { category: 'rhythm', value: 'polyrhythmic' },
  'odd time signatures': { category: 'rhythm', value: 'odd time signatures' },
  'four on the floor': { category: 'rhythm', value: 'four-on-the-floor' },
  breakbeats: { category: 'rhythm', value: 'breakbeats' },
  downbeat: { category: 'rhythm', value: 'slow tempo' },
  'lo fi': { category: 'production', value: 'lo-fi' },
  lofi: { category: 'production', value: 'lo-fi' },
  'live recording': { category: 'production', value: 'live recording' },
  'field recordings': { category: 'production', value: 'field recordings' },
  sampling: { category: 'production', value: 'sample-based' },
  'sample based': { category: 'production', value: 'sample-based' },
  analog: { category: 'production', value: 'analog' },
};

export function tagToAttribute(rawTag: string): { category: AttributeCategory; value: string } | null {
  return TAG_ATTRIBUTES[normalizeText(rawTag)] ?? null;
}

/** Instrument names from performer credits (MusicBrainz instrument relationships) â†’ normalised value. */
export function normalizeInstrument(raw: string): string {
  const key = normalizeText(raw);
  const mapped = TAG_ATTRIBUTES[key];
  if (mapped && mapped.category === 'instrument') return mapped.value;
  return key;
}

/**
 * Low-confidence attribute inference from genre. These are associations, not facts:
 * a synthwave track usually features synthesizers, but SOMM labels the result as
 * "inferred from genre" with the confidence below and never as verified.
 */
export const GENRE_IMPLIED_ATTRIBUTES: Record<string, { category: AttributeCategory; value: string; confidence: number }[]> = {
  synthpop: [{ category: 'instrument', value: 'synthesizer', confidence: 0.5 }],
  synthwave: [{ category: 'instrument', value: 'synthesizer', confidence: 0.6 }],
  techno: [{ category: 'instrument', value: 'synthesizer', confidence: 0.45 }, { category: 'rhythm', value: 'four-on-the-floor', confidence: 0.5 }],
  house: [{ category: 'rhythm', value: 'four-on-the-floor', confidence: 0.5 }],
  'deep house': [{ category: 'rhythm', value: 'four-on-the-floor', confidence: 0.5 }],
  trance: [{ category: 'instrument', value: 'synthesizer', confidence: 0.5 }],
  'drum and bass': [{ category: 'rhythm', value: 'breakbeats', confidence: 0.55 }],
  jungle: [{ category: 'rhythm', value: 'breakbeats', confidence: 0.55 }],
  breakbeat: [{ category: 'rhythm', value: 'breakbeats', confidence: 0.6 }],
  ambient: [{ category: 'texture', value: 'atmospheric', confidence: 0.5 }],
  'dark ambient': [{ category: 'texture', value: 'atmospheric', confidence: 0.5 }],
  drone: [{ category: 'texture', value: 'atmospheric', confidence: 0.45 }],
  'post rock': [{ category: 'texture', value: 'atmospheric', confidence: 0.4 }, { category: 'instrument', value: 'guitar', confidence: 0.45 }],
  shoegaze: [{ category: 'texture', value: 'wall of sound', confidence: 0.45 }, { category: 'instrument', value: 'guitar', confidence: 0.5 }],
  'dream pop': [{ category: 'texture', value: 'dreamy', confidence: 0.45 }],
  'lo fi': [{ category: 'production', value: 'lo-fi', confidence: 0.55 }],
  'lo fi hip hop': [{ category: 'production', value: 'lo-fi', confidence: 0.55 }, { category: 'production', value: 'sample-based', confidence: 0.4 }],
  'boom bap': [{ category: 'production', value: 'sample-based', confidence: 0.45 }],
  'trip hop': [{ category: 'production', value: 'sample-based', confidence: 0.4 }, { category: 'texture', value: 'atmospheric', confidence: 0.35 }],
  'math rock': [{ category: 'rhythm', value: 'odd time signatures', confidence: 0.45 }],
  'progressive metal': [{ category: 'rhythm', value: 'odd time signatures', confidence: 0.35 }],
  djent: [{ category: 'rhythm', value: 'odd time signatures', confidence: 0.4 }, { category: 'instrument', value: 'guitar', confidence: 0.55 }],
  'hindustani classical': [{ category: 'rhythm', value: 'tala cycles', confidence: 0.5 }],
  'carnatic classical': [{ category: 'rhythm', value: 'tala cycles', confidence: 0.5 }],
  'bossa nova': [{ category: 'instrument', value: 'acoustic guitar', confidence: 0.45 }],
  'chamber music': [{ category: 'instrument', value: 'strings', confidence: 0.4 }],
  'film score': [{ category: 'instrument', value: 'orchestra', confidence: 0.35 }],
};

export const ATTRIBUTE_CATEGORY_LABELS: Record<AttributeCategory, string> = {
  instrument: 'Instruments',
  vocal: 'Vocals',
  texture: 'Sound texture',
  mood: 'Mood',
  rhythm: 'Rhythm',
  production: 'Production',
};
