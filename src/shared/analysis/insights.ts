/**
 * Stage 4 — controlled natural-language summaries ("Your Music Mind").
 *
 * Every sentence is produced by a template from numbers already computed in
 * the MusicProfile. Nothing here can introduce a fact that is not in the
 * profile, and nothing describes personality, intelligence, mental health,
 * politics or any other non-musical trait. Statements about attributes that
 * rely on SOMM inference say "associated with" and are marked `inferred`.
 */
import { ATTRIBUTE_CATEGORY_LABELS, FAMILY_LABELS, genreDisplayName, type Family } from '../taxonomy';
import type { ConfidenceLevel, Insight, MusicProfile } from '../types';

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Confidence from sample size and metadata coverage. */
export function confidenceFor(sample: number, coverage: number): ConfidenceLevel {
  if (sample >= 20 && coverage >= 0.7) return 'high';
  if (sample >= 8 && coverage >= 0.4) return 'medium';
  return 'low';
}

function familyLabel(f: string): string {
  return FAMILY_LABELS[f as Family] ?? genreDisplayName(f);
}

const PLURAL_INSTRUMENTS = new Set(['synthesizer', 'guitar', 'drum machine', 'keyboards', 'strings', 'drums']);

const ATTRIBUTE_PHRASES: Record<string, (value: string) => string> = {
  instrument: (v) => (PLURAL_INSTRUMENTS.has(v) && !v.endsWith('s') ? `${v}s` : v),
  vocal: (v) => (v === 'instrumental' ? 'instrumental performance' : `${v} vocals`),
  texture: (v) => `${v} texture`,
  mood: (v) => `a ${v} mood`,
  rhythm: (v) => `${v} rhythm`,
  production: (v) => `${v} production`,
};

export function generateInsights(profile: MusicProfile): Insight[] {
  const insights: Insight[] = [];
  const n = profile.totals.tracks;

  if (n === 0) {
    return [
      {
        id: 'empty',
        text: 'Your library is empty. Import a playlist or add songs to generate your Music Mind.',
        confidence: 'low',
        basis: 'coverage',
        evidence: [],
      },
    ];
  }

  const genreKnown = n - profile.unknownGenreCount;

  // 1. Dominant family / broad spread.
  const top = profile.families[0];
  if (top && genreKnown > 0) {
    const conf = confidenceFor(genreKnown, profile.coverage.genre);
    if (top.share >= 0.5) {
      insights.push({
        id: 'dominant-family',
        text: `You have a strong preference for ${familyLabel(top.family).toLowerCase()} music: ${pct(top.share)} of the tracks with known genres belong to it.`,
        confidence: conf,
        basis: 'metadata',
        evidence: [
          { label: `${familyLabel(top.family)} tracks`, value: `${top.trackCount} of ${genreKnown}` },
          { label: 'Genre coverage', value: pct(profile.coverage.genre) },
        ],
      });
    } else if (top.share >= 0.3) {
      insights.push({
        id: 'leading-family',
        text: `${familyLabel(top.family)} is your most represented genre family (${pct(top.share)} of tracks with known genres).`,
        confidence: conf,
        basis: 'metadata',
        evidence: [{ label: `${familyLabel(top.family)} tracks`, value: `${top.trackCount} of ${genreKnown}` }],
      });
    }
  }

  const broadFamilies = profile.families.filter((f) => f.share >= 0.1);
  if (broadFamilies.length >= 3) {
    insights.push({
      id: 'breadth',
      text: `Your collection spans ${broadFamilies.length} distinct genre families, each making up at least 10% of your tracks with known genres.`,
      confidence: confidenceFor(genreKnown, profile.coverage.genre),
      basis: 'metadata',
      evidence: broadFamilies.map((f) => ({ label: familyLabel(f.family), value: pct(f.share) })),
    });
  }

  // 2. Specific genres.
  const topGenres = profile.genres.filter((g) => g.trackCount >= 2).slice(0, 3);
  if (topGenres.length > 0) {
    const names = topGenres.map((g) => genreDisplayName(g.name));
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    const allCommunity = topGenres.every((g) => g.kinds.every((k) => k === 'community'));
    insights.push({
      id: 'top-genres',
      text: `Your most frequent genres are ${list}.`,
      confidence: confidenceFor(genreKnown, profile.coverage.genre),
      basis: 'metadata',
      evidence: topGenres.map((g) => ({
        label: genreDisplayName(g.name),
        value: `${g.trackCount} tracks · sources: ${g.sources.join(', ')}${allCommunity ? ' (community tags)' : ''}`,
      })),
    });
  }

  // 3. Artist concentration vs diversity.
  const topArtist = profile.artists[0];
  if (topArtist && n >= 5) {
    if (profile.diversity.topFiveArtistShare >= 0.6) {
      insights.push({
        id: 'artist-focus',
        text: `You return to a small circle of artists: your five most frequent artists account for ${pct(profile.diversity.topFiveArtistShare)} of your tracks.`,
        confidence: confidenceFor(n, 1),
        basis: 'metadata',
        evidence: profile.artists.slice(0, 5).map((a) => ({ label: a.name, value: `${a.trackCount} tracks` })),
      });
    } else if (profile.diversity.uniqueArtistRatio >= 0.7) {
      insights.push({
        id: 'artist-diversity',
        text: `You explore widely across artists: ${profile.totals.artists} different artists appear across ${n} tracks.`,
        confidence: confidenceFor(n, 1),
        basis: 'metadata',
        evidence: [
          { label: 'Unique artists per track', value: profile.diversity.uniqueArtistRatio.toFixed(2) },
          { label: 'Artist evenness (entropy)', value: profile.diversity.artistEntropy.toFixed(2) },
        ],
      });
    }
    if (topArtist.trackCount >= 3) {
      insights.push({
        id: 'top-artist',
        text: `${topArtist.name} is the most represented artist in your library, with ${topArtist.trackCount} tracks.`,
        confidence: 'high',
        basis: 'metadata',
        evidence: [{ label: topArtist.name, value: `${topArtist.trackCount} of ${n} tracks` }],
      });
    }
  }

  // 4. Release periods.
  if (profile.years && profile.decades.length > 0) {
    const yearsKnown = Math.round(profile.coverage.year * n);
    const topDecade = [...profile.decades].sort((a, b) => b.trackCount - a.trackCount || a.decade - b.decade)[0]!;
    const share = topDecade.trackCount / yearsKnown;
    const conf = confidenceFor(yearsKnown, profile.coverage.year);
    if (share >= 0.4) {
      insights.push({
        id: 'era',
        text: `Most of your dated tracks (${pct(share)}) were released in the ${topDecade.decade}s.`,
        confidence: conf,
        basis: 'metadata',
        evidence: profile.decades.map((d) => ({ label: `${d.decade}s`, value: `${d.trackCount} tracks` })),
      });
    } else if (profile.decades.length >= 4) {
      insights.push({
        id: 'era-span',
        text: `Your library spans ${profile.decades.length} decades of releases, from ${profile.years.min} to ${profile.years.max}.`,
        confidence: conf,
        basis: 'metadata',
        evidence: profile.decades.map((d) => ({ label: `${d.decade}s`, value: `${d.trackCount} tracks` })),
      });
    }
  }

  // 5. Sound attributes — verified first, inferred clearly labelled.
  for (const attr of profile.attributes.slice(0, 12)) {
    if (attr.trackCount < 3 || attr.share < 0.2) continue;
    const phrase = (ATTRIBUTE_PHRASES[attr.category] ?? ((v: string) => v))(attr.value);
    const verifiedShare = attr.verifiedCount / n;
    const evidence = [
      { label: 'Tracks', value: `${attr.trackCount} of ${n} (${pct(attr.share)})` },
      { label: 'Verified metadata', value: `${attr.verifiedCount} tracks` },
      { label: 'Inferred only', value: `${attr.inferredCount} tracks` },
      ...attr.evidence.slice(0, 2).map((e) => ({ label: 'Evidence', value: e })),
    ];
    if (attr.verifiedCount >= 3 && verifiedShare >= 0.2) {
      insights.push({
        id: `attr-${attr.category}-${attr.value}`,
        text: `${pct(verifiedShare)} of your tracks carry credits or tags for ${phrase}, based on verified metadata.`,
        // Confidence depends on how much of the library has verified attribute metadata at all.
        confidence: confidenceFor(attr.verifiedCount, profile.coverage.verifiedAttributes),
        basis: 'metadata',
        evidence,
      });
    } else {
      insights.push({
        id: `attr-${attr.category}-${attr.value}`,
        text: `You frequently select tracks in genres associated with ${phrase} (${ATTRIBUTE_CATEGORY_LABELS[attr.category].toLowerCase()}, inferred from genre).`,
        confidence: 'low',
        basis: 'inferred',
        evidence,
      });
    }
    if (insights.filter((i) => i.id.startsWith('attr-')).length >= 4) break;
  }

  // 6. Versions.
  const versioned = profile.versions.reduce((s, v) => s + v.trackCount, 0);
  if (versioned >= 3 && versioned / n >= 0.15) {
    const lead = profile.versions[0]!;
    insights.push({
      id: 'versions',
      text: `${pct(versioned / n)} of your tracks are alternate versions — mostly ${lead.label === 'live' ? 'live recordings' : `${lead.label} versions`}.`,
      confidence: confidenceFor(n, 1),
      basis: 'metadata',
      evidence: profile.versions.map((v) => ({ label: v.label, value: `${v.trackCount} tracks` })),
    });
  }

  // 7. Tempo (only when real tempo metadata exists).
  if (profile.tempo && profile.tempo.trackCount >= 5) {
    insights.push({
      id: 'tempo',
      text: `Across ${profile.tempo.trackCount} tracks with tempo data, your median tempo is ${profile.tempo.medianBpm} BPM.`,
      confidence: confidenceFor(profile.tempo.trackCount, profile.coverage.tempo),
      basis: 'metadata',
      evidence: [
        { label: 'Range', value: `${profile.tempo.minBpm}–${profile.tempo.maxBpm} BPM` },
        { label: 'Tempo coverage', value: pct(profile.coverage.tempo) },
      ],
    });
  }

  // 8. Honest caveats.
  if (n < 10) {
    insights.push({
      id: 'small-library',
      text: `Your map is based on ${n} track${n === 1 ? '' : 's'}, so these observations are tentative. Import more music to sharpen them.`,
      confidence: 'high',
      basis: 'coverage',
      evidence: [{ label: 'Tracks analysed', value: String(n) }],
    });
  }
  if (profile.unknownGenreCount > 0) {
    insights.push({
      id: 'missing-genres',
      text: `Genre is unknown for ${profile.unknownGenreCount} of ${n} tracks (${pct(profile.unknownGenreCount / n)}). They appear on your map under “Genre unknown” and do not count towards genre statements.`,
      confidence: 'high',
      basis: 'coverage',
      evidence: [{ label: 'Genre coverage', value: pct(profile.coverage.genre) }],
    });
  }
  if (profile.coverage.attributes === 0 || !profile.attributes.some((a) => a.verifiedCount > 0)) {
    insights.push({
      id: 'no-verified-attributes',
      text: 'No verified instrument or sound-texture metadata is available for your tracks yet, so SOMM makes no firm claims about instrumentation.',
      confidence: 'high',
      basis: 'coverage',
      evidence: [{ label: 'Attribute coverage', value: pct(profile.coverage.attributes) }],
    });
  }

  return insights;
}
