/**
 * A wholly fictional music catalogue for demo mode. Every artist and title here
 * was invented for SOMM; none refers to a real recording. Demo listeners built
 * from it are flagged `is_demo = 2` and labelled "fictional" everywhere in the UI.
 */
import type { AttributeCategory } from './types';

export interface DemoScene {
  key: string;
  artists: string[];
  genres: string[];
  words: [string[], string[]];
  years: [number, number];
  attributes: { category: AttributeCategory; value: string }[];
}

export const SCENES: DemoScene[] = [
  {
    key: 'electronic',
    artists: ['Nova Lattice', 'Pulse Garden', 'Kilo Ray', 'Velvet Static', 'Orbit Choir', 'Lumen Fade'],
    genres: ['techno', 'synthwave', 'deep house', 'idm'],
    words: [['Neon', 'Glass', 'Pulse', 'Static', 'Signal', 'Circuit', 'Prism', 'Vapor'], ['Garden', 'Tides', 'Relay', 'Bloom', 'Engine', 'Horizon', 'Cascade', 'Arc']],
    years: [2012, 2025],
    attributes: [{ category: 'instrument', value: 'synthesizer' }, { category: 'instrument', value: 'drum machine' }],
  },
  {
    key: 'ambient',
    artists: ['Mira Sol', 'Slow Meridian', 'Fjord Hum', 'Cloud Archive', 'Pale Lighthouse'],
    genres: ['ambient', 'drone', 'new age', 'dark ambient'],
    words: [['Fog', 'Still', 'Low', 'Distant', 'Quiet', 'Hollow', 'Snow', 'Salt'], ['Index', 'Field', 'Room', 'Shore', 'Weather', 'Hours', 'Breath', 'Hymn']],
    years: [2005, 2024],
    attributes: [{ category: 'texture', value: 'atmospheric' }, { category: 'vocal', value: 'instrumental' }],
  },
  {
    key: 'jazz',
    artists: ['Teo Vance', 'Blue Lantern', 'Mono Quartet', 'Ada Brightwater Trio', 'Night Shift Sextet'],
    genres: ['hard bop', 'cool jazz', 'modal jazz', 'spiritual jazz'],
    words: [['Quiet', 'Blue', 'Late', 'Velvet', 'Smoke', 'Midnight', 'Copper', 'Indigo'], ['Engine', 'Hour', 'Avenue', 'Ballad', 'Steps', 'Lantern', 'Theme', 'Walk']],
    years: [1956, 1972],
    attributes: [{ category: 'instrument', value: 'piano' }, { category: 'instrument', value: 'saxophone' }],
  },
  {
    key: 'folk',
    artists: ['Ivy Marlowe', 'Willow & Wire', 'Harbour Choir', 'Juniper Lane', 'Old Ferry Road'],
    genres: ['indie folk', 'singer songwriter', 'americana', 'contemporary folk'],
    words: [['Harbour', 'Paper', 'Juniper', 'Lantern', 'Cedar', 'River', 'Kitchen', 'Wool'], ['Lights', 'Letters', 'Song', 'Porch', 'Rain', 'Hymn', 'Coat', 'Morning']],
    years: [2006, 2024],
    attributes: [{ category: 'instrument', value: 'acoustic guitar' }],
  },
  {
    key: 'metal',
    artists: ['Iron Vale', 'Ash Crown', 'Grave Signal', 'Black Orchard', 'Rust Cathedral'],
    genres: ['death metal', 'doom metal', 'black metal', 'progressive metal'],
    words: [['Iron', 'Ash', 'Grave', 'Obsidian', 'Thorn', 'Ember', 'Rust', 'Storm'], ['Throne', 'Rite', 'Furnace', 'Wake', 'Crown', 'Abyss', 'March', 'Oath']],
    years: [1992, 2024],
    attributes: [{ category: 'instrument', value: 'guitar' }, { category: 'mood', value: 'aggressive' }],
  },
  {
    key: 'hiphop',
    artists: ['MC Paraphrase', 'Boom Theory', 'Kid Lattice', 'The Quiet Cypher', 'Verse Library'],
    genres: ['boom bap', 'jazz rap', 'conscious hip hop', 'lo fi hip hop'],
    words: [['Paper', 'Concrete', 'Sample', 'Corner', 'Late', 'Golden', 'Vinyl', 'Block'], ['Verses', 'Theory', 'Cypher', 'Loops', 'Library', 'Bars', 'Dreams', 'Tapes']],
    years: [1994, 2024],
    attributes: [{ category: 'production', value: 'sample-based' }],
  },
  {
    key: 'indian',
    artists: ['Sitar Meridian', 'Shruti Lines', 'Tala Collective', 'Raga Lantern', 'Monsoon Strings'],
    genres: ['hindustani classical', 'carnatic classical', 'indian classical'],
    words: [['Dawn', 'Monsoon', 'River', 'Evening', 'Temple', 'Saffron', 'Moon', 'Garden'], ['Alaap', 'Raga', 'Cycle', 'Drone', 'Tala', 'Meditation', 'Rasa', 'Bandish']],
    years: [1975, 2024],
    attributes: [{ category: 'instrument', value: 'sitar' }, { category: 'instrument', value: 'tabla' }],
  },
  {
    key: 'experimental',
    artists: ['Noise Atlas', 'Concrete Choir', 'Glitch Botanist', 'Tape Weather'],
    genres: ['experimental', 'glitch', 'musique concrete', 'noise'],
    words: [['Broken', 'Found', 'Magnetic', 'Paper', 'Hiss', 'Static', 'Splice', 'Wire'], ['Atlas', 'Botany', 'Studies', 'Weather', 'Archive', 'Loops', 'Fragments', 'Rooms']],
    years: [1998, 2025],
    attributes: [{ category: 'production', value: 'field recordings' }],
  },
];

export interface DemoListener {
  handle: string;
  displayName: string;
  bio: string;
  mix: Partial<Record<string, number>>;
  size: number;
}

export const LISTENERS: DemoListener[] = [
  { handle: 'aurora.wave', displayName: 'Aurora Wave', bio: 'Synths after midnight.', mix: { electronic: 0.8, ambient: 0.2 }, size: 34 },
  { handle: 'circuit.fern', displayName: 'Circuit Fern', bio: 'Warehouse techno and long drives.', mix: { electronic: 0.9, experimental: 0.1 }, size: 30 },
  { handle: 'prism.walker', displayName: 'Prism Walker', bio: 'Collecting drum machines and deep house.', mix: { electronic: 0.75, ambient: 0.25 }, size: 28 },
  { handle: 'fog.index', displayName: 'Fog Index', bio: 'Field recordings and slow weather.', mix: { ambient: 0.85, experimental: 0.15 }, size: 26 },
  { handle: 'still.shore', displayName: 'Still Shore', bio: 'Drones for reading.', mix: { ambient: 0.9, electronic: 0.1 }, size: 24 },
  { handle: 'snow.hymn', displayName: 'Snow Hymn', bio: 'Quiet rooms, long tones.', mix: { ambient: 0.8, indian: 0.2 }, size: 22 },
  { handle: 'blue.hour', displayName: 'Blue Hour', bio: 'Hard bop on vinyl.', mix: { jazz: 0.9, hiphop: 0.1 }, size: 30 },
  { handle: 'copper.keys', displayName: 'Copper Keys', bio: 'Pianists first, always.', mix: { jazz: 1 }, size: 26 },
  { handle: 'midnight.walk', displayName: 'Midnight Walk', bio: 'Modal and spiritual jazz.', mix: { jazz: 0.8, indian: 0.2 }, size: 28 },
  { handle: 'cedar.porch', displayName: 'Cedar Porch', bio: 'Songs with wood in them.', mix: { folk: 0.95, ambient: 0.05 }, size: 24 },
  { handle: 'paper.letters', displayName: 'Paper Letters', bio: 'Singer-songwriters and rain.', mix: { folk: 0.9, jazz: 0.1 }, size: 22 },
  { handle: 'river.morning', displayName: 'River Morning', bio: 'Americana road trips.', mix: { folk: 1 }, size: 20 },
  { handle: 'iron.oath', displayName: 'Iron Oath', bio: 'Doom, death and everything slow and heavy.', mix: { metal: 1 }, size: 30 },
  { handle: 'ember.throne', displayName: 'Ember Throne', bio: 'Progressive metal nerd.', mix: { metal: 0.9, experimental: 0.1 }, size: 26 },
  { handle: 'storm.rite', displayName: 'Storm Rite', bio: 'Black metal and blizzards.', mix: { metal: 0.95, ambient: 0.05 }, size: 22 },
  { handle: 'vinyl.verses', displayName: 'Vinyl Verses', bio: 'Boom bap archivist.', mix: { hiphop: 0.85, jazz: 0.15 }, size: 28 },
  { handle: 'golden.loops', displayName: 'Golden Loops', bio: 'Jazz rap and dusty samples.', mix: { hiphop: 0.7, jazz: 0.3 }, size: 26 },
  { handle: 'corner.cypher', displayName: 'Corner Cypher', bio: 'Lyrics first.', mix: { hiphop: 1 }, size: 24 },
  { handle: 'saffron.dawn', displayName: 'Saffron Dawn', bio: 'Morning ragas.', mix: { indian: 0.9, ambient: 0.1 }, size: 24 },
  { handle: 'monsoon.tala', displayName: 'Monsoon Tala', bio: 'Tabla cycles and sitar.', mix: { indian: 1 }, size: 22 },
  { handle: 'temple.rasa', displayName: 'Temple Rasa', bio: 'Carnatic and Hindustani.', mix: { indian: 0.85, jazz: 0.15 }, size: 20 },
  { handle: 'tape.botany', displayName: 'Tape Botany', bio: 'Everything sideways.', mix: { experimental: 0.4, electronic: 0.2, jazz: 0.2, metal: 0.2 }, size: 30 },
];

/** Mulberry32 — tiny deterministic PRNG so the demo is identical on every install. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoTrack {
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: number;
  attributes: { category: AttributeCategory; value: string }[];
}

/** The fixed song pool of a scene (deterministic). */
export function sceneTracks(scene: DemoScene, count = 40): DemoTrack[] {
  const rand = prng(scene.key.split('').reduce((s, c) => s * 31 + c.charCodeAt(0), 7));
  const out: DemoTrack[] = [];
  const seen = new Set<string>();
  while (out.length < count) {
    const title = `${scene.words[0][Math.floor(rand() * scene.words[0].length)]} ${scene.words[1][Math.floor(rand() * scene.words[1].length)]}`;
    const artist = scene.artists[Math.floor(rand() * scene.artists.length)]!;
    const key = `${title}|${artist}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const year = scene.years[0] + Math.floor(rand() * (scene.years[1] - scene.years[0] + 1));
    out.push({
      title,
      artist,
      album: `${title.split(' ')[1]} Sessions`,
      genre: scene.genres[Math.floor(rand() * scene.genres.length)]!,
      year,
      attributes: rand() < 0.7 ? scene.attributes : [],
    });
  }
  return out;
}

export function listenerTracks(listener: DemoListener, index: number): DemoTrack[] {
  const rand = prng(1000 + index * 7919);
  const picks: DemoTrack[] = [];
  for (const [key, share] of Object.entries(listener.mix)) {
    const scene = SCENES.find((s) => s.key === key)!;
    const pool = sceneTracks(scene);
    const n = Math.max(2, Math.round(listener.size * (share ?? 0)));
    const shuffled = [...pool].sort(() => rand() - 0.5);
    picks.push(...shuffled.slice(0, n));
  }
  return picks;
}

/** Fictional sample library offered on the import page (overlaps the electronic, ambient and jazz scenes). */
export function sampleLibraryCsv(): string {
  const rows: string[] = ['title,artist,album,genre,year,instruments,tags'];
  const take = (key: string, n: number, keepGenre: (i: number) => boolean) => {
    const scene = SCENES.find((s) => s.key === key)!;
    sceneTracks(scene)
      .slice(0, n)
      .forEach((t, i) => {
        const instruments = t.attributes.filter((a) => a.category === 'instrument').map((a) => a.value);
        const tags = t.attributes.filter((a) => a.category !== 'instrument').map((a) => a.value);
        const cells = [t.title, t.artist, t.album, keepGenre(i) ? t.genre : '', String(t.year), instruments.join(';'), tags.join(';')];
        rows.push(cells.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','));
      });
  };
  take('electronic', 16, (i) => i % 5 !== 4);
  take('ambient', 8, () => true);
  take('jazz', 6, (i) => i !== 0);
  rows.push('Glass Tides (Nightline Remix),Nova Lattice,Tides Remixed,synthwave,2023,synthesizer,');
  rows.push('Unlabelled Demo Track,Lumen Fade,,,,,');
  return rows.join('\n');
}
