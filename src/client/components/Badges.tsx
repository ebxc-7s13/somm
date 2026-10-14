import type { ConfidenceLevel } from '../../shared/types';

const KIND_LABELS: Record<string, { label: string; cls: string; title: string }> = {
  provided: { label: 'Provider', cls: 'badge-verified', title: 'Catalogue metadata supplied by the music service' },
  credited: { label: 'Credited', cls: 'badge-verified', title: 'An explicit performer credit (e.g. MusicBrainz instrument relationship)' },
  community: { label: 'Community', cls: 'badge-community', title: 'Community-voted metadata (e.g. MusicBrainz genre votes)' },
  user: { label: 'Your file', cls: 'badge-user', title: 'Supplied by you in an import file' },
  inferred: { label: 'Inferred', cls: 'badge-inferred', title: 'Derived by a documented SOMM rule — an association, not a verified fact' },
};

export function KindBadge({ kind }: { kind: string }) {
  const k = KIND_LABELS[kind] ?? { label: kind, cls: '', title: kind };
  return (
    <span className={`badge ${k.cls}`} title={k.title}>
      {k.label}
    </span>
  );
}

export function SourceLabel({ source }: { source: string }) {
  const names: Record<string, string> = {
    musicbrainz: 'MusicBrainz',
    'musicbrainz:artist': 'MusicBrainz (artist-level)',
    'spotify:artist': 'Spotify (artist-level)',
    'spotify (via export file)': 'Spotify via export file',
    apple_music: 'Apple Music',
    itunes: 'iTunes Search',
    'somm-rules': 'SOMM rule',
    'your file': 'your file',
  };
  return <span className="faint xsmall">via {names[source] ?? source}</span>;
}

export function Confidence({ level, label = true }: { level: ConfidenceLevel; label?: boolean }) {
  return (
    <span className="conf" data-level={level} title={`Confidence: ${level}`}>
      <i />
      <i />
      <i />
      {label ? <span>{level} confidence</span> : <span className="sr-only">{level} confidence</span>}
    </span>
  );
}

export function DemoBadge({ what = 'Fictional demo' }: { what?: string }) {
  return (
    <span className="badge badge-demo" title="Created by SOMM's demo mode. Not a real person or real music.">
      {what}
    </span>
  );
}

export function ProviderName({ id }: { id: string }) {
  const names: Record<string, string> = {
    spotify: 'Spotify',
    youtube: 'YouTube',
    apple_music: 'Apple Music',
    csv: 'CSV file',
    text: 'Pasted list',
    m3u: 'M3U file',
    xspf: 'XSPF file',
    json: 'JSON file',
    manual: 'Added manually',
  };
  return <>{names[id] ?? id}</>;
}
