import { useMemo } from 'react';
import { buildMusicMap } from '../../shared/analysis/map';
import { computeProfile } from '../../shared/analysis/profile';
import { LISTENERS, listenerTracks } from '../../shared/demoCatalog';
import { canonicalGenre, genreFamily } from '../../shared/taxonomy';
import type { LibraryTrack } from '../../shared/types';
import { ExternalExportCallout } from '../components/ExternalExport';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { TreeGlyph } from '../components/TreeGlyph';
import { Marquee, Tilt } from '../fx/Tilt';
import { useDocumentTitle } from '../hooks';
import { MusicMap3D } from '../map3d/MusicMap3D';
import { Link } from '../router';
import { useAuth } from '../state';

/** A fictional library built in the browser with the real analysis engine. */
function useDemoMap() {
  return useMemo(() => {
    const picks = [0, 3, 6, 9].flatMap((i) => listenerTracks(LISTENERS[i % LISTENERS.length]!, i).slice(0, 14));
    const tracks: LibraryTrack[] = picks.map((t, i) => {
      const g = canonicalGenre(t.genre)!;
      const artistId = `demo-${t.artist}`;
      return {
        id: `demo-${i}-${t.title}`,
        title: t.title,
        version: null,
        artists: [{ id: artistId, name: t.artist, role: 'primary' }],
        album: null,
        releaseYear: t.year,
        durationMs: null,
        explicit: null,
        genres: i % 9 === 8 ? [] : [{ name: g, family: genreFamily(g), source: 'demo', kind: 'user', confidence: 1 }],
        attributes: t.attributes.map((a) => ({ ...a, source: 'demo', kind: 'user' as const, confidence: 1 })),
        tempoBpm: null,
      };
    });
    const profile = computeProfile(tracks);
    return buildMusicMap(tracks, profile, { rootLabel: 'A Music Mind', maxTracks: 60, includeTracks: true, maxAttributes: 6 });
  }, []);
}

const EXAMPLE_TREES = [
  { name: 'Electronic Sound Explorers', families: [{ family: 'electronic', share: 0.6 }, { family: 'ambient', share: 0.3 }, { family: 'experimental', share: 0.1 }] },
  { name: 'Jazz & Improvisation Circle', families: [{ family: 'jazz', share: 0.7 }, { family: 'hip hop', share: 0.2 }, { family: 'r&b & soul', share: 0.1 }] },
  { name: 'Indian Classical Explorers', families: [{ family: 'indian', share: 0.75 }, { family: 'ambient', share: 0.15 }, { family: 'jazz', share: 0.1 }] },
  { name: 'Metal & Heavy Riffs', families: [{ family: 'metal', share: 0.8 }, { family: 'rock', share: 0.2 }] },
];

const GENRES_A = ['Synthwave', 'Filmi', 'Hard bop', 'Dream pop', 'Drum & Bass', 'Afrobeats', 'Shoegaze', 'Carnatic', 'Lo-Fi Hip Hop', 'Trip Hop', 'Bossa nova', 'Techno'];
const GENRES_B = ['Ambient', 'K-Pop', 'Neo-soul', 'Post-rock', 'Ghazal', 'Reggaeton', 'Cool jazz', 'Grime', 'Indie folk', 'Hyperpop', 'Dub', 'Baroque'];

const STEPS = [
  { n: '01', title: 'Import', icon: 'import', text: 'Upload a CSV, M3U or XSPF, paste a list, or convert any playlist. SOMM deduplicates carefully and keeps remixes and live versions separate.' },
  { n: '02', title: 'Map', icon: 'map', text: 'Genres, artists, songs and sound attributes become a 3D constellation you can spin, zoom, fly through — and save as a poster.' },
  { n: '03', title: 'Mind', icon: 'mind', text: 'Readable observations about your listening — each with its evidence, its source and how confident SOMM is.' },
  { n: '04', title: 'Trees', icon: 'trees', text: 'Communities formed from genuinely overlapping libraries, with a transparent match score and a shared chat.' },
] as const;

export function Landing() {
  useDocumentTitle('');
  const map = useDemoMap();
  const { me } = useAuth();

  return (
    <div className="landing">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="landing-nav">
        <Link to="/" aria-label="SOMM — Sound of My Mind" className="brand" style={{ color: 'var(--white)', textDecoration: 'none' }}>
          <Logo size={28} />
        </Link>
        <span style={{ flex: 1 }} />
        <nav className="row hide-sm" aria-label="Sections">
          <a href="#how" className="nav-chip">
            How it works
          </a>
          <a href="#bring" className="nav-chip">
            Your playlists
          </a>
          <a href="#trees" className="nav-chip">
            Trees
          </a>
          <a href="#honest" className="nav-chip">
            Principles
          </a>
        </nav>
        {me ? (
          <Link to="/map" className="btn btn-primary btn-sm" data-magnetic>
            Open my map
          </Link>
        ) : (
          <>
            <Link to="/signin" className="btn btn-ghost btn-sm">
              Sign in
            </Link>
            <Link to="/signup" className="btn btn-primary btn-sm hide-sm" data-magnetic>
              Map my music
            </Link>
          </>
        )}
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="y2k-floor" aria-hidden="true" />
          <div className="hero-copy">
            <p className="eyebrow">SOMM — Sound of My Mind</p>
            <h1 id="hero-title" className="hero-title">
              <span className="word" style={{ ['--i' as string]: 0 }}>You</span> <span className="word" style={{ ['--i' as string]: 1 }}>Are</span>{' '}
              <span className="word accent" style={{ ['--i' as string]: 2 }}>What</span> <span className="word accent" style={{ ['--i' as string]: 3 }}>You</span>{' '}
              <span className="word" style={{ ['--i' as string]: 4 }}>Consume</span>
            </h1>
            <p className="tagline">Map your music. Discover your sound. Find your people.</p>
            <p className="lead">
              Bring a playlist from a file, Spotify, YouTube or Apple Music. SOMM turns its metadata into a living 3D map of your musical identity — and
              connects you with listeners whose maps overlap yours.
            </p>
            <div className="row cta-row">
              {me ? (
                <Link to="/map" className="btn btn-primary btn-lg" data-magnetic>
                  Open my Music Map
                </Link>
              ) : (
                <>
                  <Link to="/signup" className="btn btn-primary btn-lg" data-magnetic>
                    Map my music
                  </Link>
                  <Link to="/signin" className="btn btn-ghost btn-lg">
                    Sign in
                  </Link>
                </>
              )}
            </div>
            <p className="small faint" style={{ marginTop: 'var(--space-4)' }}>
              Free. No email required. SOMM never asks for your Spotify, YouTube or Apple password.
            </p>
            <p className="small" style={{ marginTop: 'var(--space-2)' }}>
              <Link to="/convert" className="chip-link">
                Convert a playlist to CSV
              </Link>{' '}
              <span className="faint">— free, no account needed.</span>
            </p>
          </div>
          <figure className="hero-orb">
            <div className="orb-rings" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <MusicMap3D showcase autoRotate map={map} ariaLabel="Example Music Map generated from a fictional library" depth={1.15} className="hero-map3d" />
            <figcaption>Illustrative map · generated live from a fictional library</figcaption>
          </figure>
          <a href="#how" className="scroll-cue" aria-label="Scroll to how it works">
            <span />
          </a>
        </section>

        <div className="marquee-band">
          <Marquee items={GENRES_A} />
          <Marquee items={GENRES_B} reverse />
        </div>

        <section className="section" id="how" aria-labelledby="how-title">
          <div data-reveal>
            <p className="eyebrow">How it works</p>
            <h2 id="how-title">From playlist to people, in four connected steps</h2>
            <p className="lead">No questionnaire. Your first map appears as soon as your tracks are read.</p>
          </div>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.n} data-reveal style={{ ['--i' as string]: i }}>
                <Tilt className="step-card fx-card">
                  <span className="step-n" aria-hidden="true">
                    {s.n}
                  </span>
                  <span className="step-icon" aria-hidden="true">
                    <Icon name={s.icon} size={26} />
                  </span>
                  <h3>{s.title}</h3>
                  <p className="muted small">{s.text}</p>
                </Tilt>
              </li>
            ))}
          </ol>
        </section>

        <section className="section" id="bring">
          <ExternalExportCallout />
        </section>

        <section className="section" id="trees" aria-labelledby="trees-title">
          <div data-reveal>
            <p className="eyebrow">Trees</p>
            <h2 id="trees-title">A Social Mind for Audiophiles</h2>
            <p className="lead">
              When enough listeners share artists, tracks and genre balance, SOMM proposes a Tree — a shared musical world with its own map and
              discussion. One popular song in common is never enough.
            </p>
          </div>
          <div className="tree-showcase">
            {EXAMPLE_TREES.map((t, i) => (
              <div key={t.name} data-reveal style={{ ['--i' as string]: i }}>
                <Tilt className="tree-card fx-card" style={{ gridTemplateColumns: '1fr', justifyItems: 'start' }}>
                  <TreeGlyph seed={t.name} families={t.families} size={88} />
                  <h3>{t.name}</h3>
                  <p className="small muted">Example label — real Trees are named from their members’ actual data.</p>
                </Tilt>
              </div>
            ))}
          </div>
        </section>

        <section className="section" id="honest" aria-labelledby="honest-title">
          <div data-reveal>
            <p className="eyebrow">Honest by design</p>
            <h2 id="honest-title">Musical identity — not a personality test</h2>
          </div>
          <div className="principles">
            {(
              [
                ['note', 'Music metadata only', 'No age, gender, location, contacts or demographics. A pseudonymous handle is all you need.'],
                ['check', 'Every fact has a source', 'Genres and attributes are tagged as provider, credited, community, your file — or clearly inferred, with confidence.'],
                ['shield', 'You decide what is shared', 'Playlists are private until you choose. Trees only ever show what at least two members have in common.'],
                [
                  'warning',
                  'Honest integrations',
                  'Spotify only exposes playlists you own or collaborate on; YouTube gives titles, not genres. SOMM says so instead of faking it.',
                ],
              ] as const
            ).map(([icon, title, text], i) => (
              <div key={title} data-reveal style={{ ['--i' as string]: i }}>
                <Tilt className="panel fx-card principle">
                  <span className="principle-icon" aria-hidden="true">
                    <Icon name={icon} size={26} />
                  </span>
                  <h3>{title}</h3>
                  <p className="muted small">{text}</p>
                </Tilt>
              </div>
            ))}
          </div>
        </section>

        <section className="cta-band" aria-labelledby="cta-title" data-reveal>
          <h2 id="cta-title">
            Your sound, <span className="holo-text">mapped in 3D</span>.
          </h2>
          <p className="lead">Import a playlist, spin your map, save it as a poster with your @handle — then find your people.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link to={me ? '/map' : '/signup'} className="btn btn-primary btn-lg" data-magnetic>
              {me ? 'Open my Music Map' : 'Start my map'}
            </Link>
            <Link to="/convert" className="btn btn-ghost btn-lg">
              Convert a playlist
            </Link>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>
            <strong style={{ color: 'var(--white)' }}>SOMM</strong> · Sound of My Mind · You Are What You Consume
          </span>
          <span>Metadata from MusicBrainz (CC0 / CC BY-NC-SA) and the services you connect. SOMM never stores or streams audio.</span>
        </div>
      </footer>
    </div>
  );
}
