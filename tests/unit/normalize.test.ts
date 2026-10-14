import { describe, expect, it } from 'vitest';
import { fallbackTrackKey, normalizeText, parseTitle, parseYouTubeTitle, splitArtistList } from '../../src/shared/normalize';
import { canonicalGenre, genreFamily, tagToAttribute } from '../../src/shared/taxonomy';

describe('normalizeText', () => {
  it('folds case, diacritics, ampersands and punctuation', () => {
    expect(normalizeText('Beyoncé')).toBe('beyonce');
    expect(normalizeText('Drum & Bass')).toBe('drum and bass');
    expect(normalizeText("  Don't  Stop—Me!! ")).toBe('dont stop me');
  });

  it('keeps non-Latin scripts intact, including Devanagari vowel signs', () => {
    expect(normalizeText('राग यमन')).toBe('राग यमन');
    expect(normalizeText('東京')).toBe('東京');
  });
});

describe('parseTitle — alternate versions', () => {
  it('detects remix, live, acoustic and remaster versions', () => {
    expect(parseTitle('Glass Orbit (Nightline Remix)')).toMatchObject({ baseTitle: 'Glass Orbit', version: 'remix', versionDetail: 'Nightline Remix' });
    expect(parseTitle('Glass Orbit - Live at the Harbour Hall')).toMatchObject({ baseTitle: 'Glass Orbit', version: 'live' });
    expect(parseTitle('Glass Orbit [Acoustic]').version).toBe('acoustic');
    expect(parseTitle('Glass Orbit - 2011 Remaster').version).toBe('remaster');
  });

  it('treats neutral segments as the original recording', () => {
    expect(parseTitle('Glass Orbit (Original Mix)')).toMatchObject({ baseTitle: 'Glass Orbit', version: null });
    expect(parseTitle('Glass Orbit - Radio Edit').version).toBe('edit');
  });

  it('extracts featured artists without treating them as a version', () => {
    const parsed = parseTitle('Paper Comets (feat. Ivy Marlowe & Teo Vance)');
    expect(parsed.baseTitle).toBe('Paper Comets');
    expect(parsed.version).toBeNull();
    expect(parsed.featuring).toEqual(['Ivy Marlowe & Teo Vance']);
    expect(parseTitle('Paper Comets feat. Ivy Marlowe').featuring).toEqual(['Ivy Marlowe']);
  });

  it('gives different identity keys to a song and its remix', () => {
    const a = parseTitle('Glass Orbit');
    const b = parseTitle('Glass Orbit (Nightline Remix)');
    expect(fallbackTrackKey(a.baseTitle, 'Nova Lattice', a.version)).not.toBe(fallbackTrackKey(b.baseTitle, 'Nova Lattice', b.version));
    expect(fallbackTrackKey('Glass  Orbit', 'NOVA LATTICE', null)).toBe(fallbackTrackKey('glass orbit', 'Nova Lattice', null));
  });

  it('handles very long titles without throwing', () => {
    const long = 'A'.repeat(2000);
    expect(parseTitle(long).baseTitle.length).toBeLessThanOrEqual(300);
  });
});

describe('splitArtistList', () => {
  it('splits only on unambiguous delimiters', () => {
    expect(splitArtistList('Simon & Garfunkel')).toEqual(['Simon & Garfunkel']);
    expect(splitArtistList('Tyler, The Creator')).toEqual(['Tyler, The Creator']);
    expect(splitArtistList('Nova Lattice; Ivy Marlowe')).toEqual(['Nova Lattice', 'Ivy Marlowe']);
    expect(splitArtistList('Nova Lattice feat. Ivy Marlowe')).toEqual(['Nova Lattice', 'Ivy Marlowe']);
    expect(splitArtistList('Nova Lattice | nova lattice')).toEqual(['Nova Lattice']);
  });
});

describe('parseYouTubeTitle', () => {
  it('splits "Artist - Title" and strips video noise', () => {
    expect(parseYouTubeTitle('Nova Lattice - Glass Orbit (Official Music Video)', 'NovaLatticeVEVO')).toEqual({
      artist: 'Nova Lattice',
      title: 'Glass Orbit',
      confidence: 'medium',
    });
  });

  it('uses "- Topic" channels as the artist', () => {
    expect(parseYouTubeTitle('Glass Orbit', 'Nova Lattice - Topic')).toEqual({ artist: 'Nova Lattice', title: 'Glass Orbit', confidence: 'medium' });
  });

  it('flags titles without structure as low confidence', () => {
    expect(parseYouTubeTitle('my favourite song ever', 'Random Uploads').confidence).toBe('low');
  });
});

describe('genre taxonomy', () => {
  it('normalises spelling variants to one canonical genre', () => {
    expect(canonicalGenre('Hip-Hop')).toBe('hip hop');
    expect(canonicalGenre('hiphop')).toBe('hip hop');
    expect(canonicalGenre('R&B')).toBe('r and b');
    expect(canonicalGenre('DnB')).toBe('drum and bass');
    expect(canonicalGenre('Electronic Music')).toBe('electronic');
    expect(canonicalGenre('   ')).toBeNull();
  });

  it('maps known and unknown genres to families', () => {
    expect(genreFamily('deep house')).toBe('electronic');
    expect(genreFamily('hindustani classical')).toBe('indian');
    expect(genreFamily('blackgaze metal')).toBe('metal');
    expect(genreFamily('swedish dark ambient')).toBe('ambient');
    expect(genreFamily('zzz unknown style')).toBe('other');
  });

  it('maps descriptive tags to attributes only when they are in the vocabulary', () => {
    expect(tagToAttribute('Synthesizer')).toEqual({ category: 'instrument', value: 'synthesizer' });
    expect(tagToAttribute('Instrumental')).toEqual({ category: 'vocal', value: 'instrumental' });
    expect(tagToAttribute('seen live')).toBeNull();
  });
});
