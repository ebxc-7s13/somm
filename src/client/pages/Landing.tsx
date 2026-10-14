import { useMemo, useState } from 'react';
import { buildMusicMap } from '../../shared/analysis/map';
import { computeProfile } from '../../shared/analysis/profile';
import { LISTENERS, listenerTracks } from '../../shared/demoCatalog';
import { canonicalGenre, genreFamily } from '../../shared/taxonomy';
import type { LibraryTrack } from '../../shared/types';
import { api, errorMessage } from '../api';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { MusicMap } from '../components/MusicMap';
import { TreeGlyph } from '../components/TreeGlyph';
import { useDocumentTitle } from '../hooks';
import { Link, useNavigate } from '../router';
import { useAuth } from '../state';

/** A fictional library built in the browser with the real analysis engine. */
function useDemoMap() {
  return useMemo(() => {
    const picks = [0, 3, 6].flatMap((i) => listenerTracks(LISTENERS[i]!, i).slice(0, 14));
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
    return buildMusicMap(tracks, profile, { rootLabel: 'A Music Mind', maxTracks: 0, includeTracks: false, maxAttributes: 5 });
  }, []);
}

const EXAMPLE_TREES = [
  { name: 'Electronic Sound Explorers', families: [{ family: 'electronic', share: 0.6 }, { family: 'ambient', share: 0.3 }, { family: 'experimental', share: 0.1 }] },
  { name: 'Jazz & Improvisation Circle', families: [{ family: 'jazz', share: 0.7 }, { family: 'hip hop', share: 0.2 }, { family: 'r&b & soul', share: 0.1 }] },
  { name: 'Indian Classical Explorers', families: [{ family: 'indian', share: 0.75 }, { family: 'ambient', share: 0.15 }, { family: 'jazz', share: 0.1 }] },
  { name: 'Metal & Heavy Riffs', families: [{ family: 'metal', share: 0.8 }, { family: 'rock', share: 0.2 }] },
];

export function Landing() {
  useDocumentTitle('');
  const map = useDemoMap();
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/demo');
      await refresh();
      navigate('/welcome');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="landing-nav">
        <Link to="/" aria-label="SOMM — Sound of My Mind" style={{ color: 'var(--white)', textDecoration: 'none' }}>
          <Logo size={28} />
        </Link>
        <span style={{ flex: 1 }} />
        <nav className="row hide-sm" aria-label="Sections">
          <a href="#how" className="btn btn-ghost btn-sm">
            How it works
          </a>
          <a href="#trees" className="btn btn-ghost btn-sm">
            Trees
          </a>
          <a href="#honest" className="btn btn-ghost btn-sm">
            Principles
          </a>
        </nav>
        {me ? (
          <Link to="/map" className="btn btn-primary btn-sm">
            Open my map
          </Link>
        ) : (
          <>
            <Link to="/signin" className="btn btn-ghost btn-sm">
              Sign in
            </Link>
            <Link to="/signup" className="btn btn-primary btn-sm hide-sm">
              Map my music
            </Link>
          </>
        )}
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div>
            <p className="eyebrow">SOMM — Sound of My Mind</p>
            <h1 id="hero-title">
              You Are <span className="accent">What You</span> Consume
            </h1>
            <p className="tagline">Map your music. Discover your sound. Find your people.</p>
            <p className="lead">
              Bring a playlist from a file, Spotify, YouTube or Apple Music. SOMM turns its metadata into an interactive map of your musical identity —
              and connects you with listeners whose maps overlap yours.
            </p>
            <div className="row" style={{ marginTop: 'var(--space-5)' }}>
              {me ? (
                <Link to="/map" className="btn btn-primary btn-lg">
                  Open my Music Map
                </Link>
              ) : (
                <>
                  <Link to="/signup" className="btn btn-primary btn-lg">
                    Map my music
                  </Link>
                  <button type="button" className="btn btn-ghost btn-lg" onClick={startDemo} disabled={busy}>
                    {busy ? 'Starting demo…' : 'Try the demo'}
                  </button>
                </>
              )}
            </div>
            {error && (
              <p className="error-text" role="alert" style={{ marginTop: 'var(--space-3)' }}>
                {error}
              </p>
            )}
            <p className="small faint" style={{ marginTop: 'var(--space-4)' }}>
              No email required. SOMM never asks for your Spotify, YouTube or Apple password.
            </p>
          </div>
          <figure className="hero-map" style={{ margin: 0 }}>
            <MusicMap map={map} ariaLabel="Example Music Map generated from a fictional library" interactive={false} compact showControls={false} labels="minimal" />
            <figcaption>Illustrative map · generated live from a fictional library</figcaption>
          </figure>
        </section>

        <section className="section-pale" id="how" aria-labelledby="how-title">
          <div className="section">
            <p className="eyebrow">How it works</p>
            <h2 id="how-title">From playlist to people, in four connected steps</h2>
            <p className="lead">No questionnaire. Your first map appears as soon as your tracks are read.</p>
            <ol className="flow">
              <li>
                <span className="node-num">1</span>
                <h3>Import</h3>
                <p className="muted">Upload a CSV, M3U or XSPF, paste a list, or connect a supported service. SOMM deduplicates carefully and keeps remixes and live versions separate.</p>
              </li>
              <li>
                <span className="node-num">2</span>
                <h3>Map</h3>
                <p className="muted">Genres, artists, tracks and sound attributes become a navigable constellation. Node size is track count; lines show how your tastes connect.</p>
              </li>
              <li>
                <span className="node-num">3</span>
                <h3>Mind</h3>
                <p className="muted">Readable observations about your listening — each with its evidence, its source and how confident SOMM is.</p>
              </li>
              <li>
                <span className="node-num">4</span>
                <h3>Trees</h3>
                <p className="muted">Communities formed from genuinely overlapping libraries, with a transparent match score and a shared chat.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="section" id="trees" aria-labelledby="trees-title">
          <p className="eyebrow">Trees</p>
          <h2 id="trees-title">A Social Mind for Audiophiles</h2>
          <p className="lead">
            When enough listeners share artists, tracks and genre balance, SOMM proposes a Tree — a shared musical world with its own map and
            discussion. One popular song in common is never enough.
          </p>
          <div className="tree-showcase">
            {EXAMPLE_TREES.map((t) => (
              <div key={t.name} className="tree-card" style={{ gridTemplateColumns: '1fr', justifyItems: 'start' }}>
                <TreeGlyph seed={t.name} families={t.families} size={88} />
                <h3>{t.name}</h3>
                <p className="small muted">Example label — real Trees are named from their members’ actual data.</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section" id="honest" aria-labelledby="honest-title">
          <p className="eyebrow">Honest by design</p>
          <h2 id="honest-title">Musical identity — not a personality test</h2>
          <div className="principles">
            <div className="panel">
              <Icon name="note" size={28} />
              <h3>Music metadata only</h3>
              <p className="muted small">No age, gender, location, contacts or demographics. A pseudonymous handle is all you need.</p>
            </div>
            <div className="panel">
              <Icon name="check" size={28} />
              <h3>Every fact has a source</h3>
              <p className="muted small">Genres and attributes are tagged as provider, credited, community, your file — or clearly inferred, with confidence.</p>
            </div>
            <div className="panel">
              <Icon name="shield" size={28} />
              <h3>You decide what is shared</h3>
              <p className="muted small">Playlists are private until you choose. Trees only ever show what at least two members have in common.</p>
            </div>
            <div className="panel">
              <Icon name="warning" size={28} />
              <h3>Honest integrations</h3>
              <p className="muted small">
                Spotify only exposes playlists you own or collaborate on; YouTube gives titles, not genres. SOMM says so instead of faking it.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <span>
            <strong style={{ color: 'var(--white)' }}>SOMM</strong> · Sound of My Mind · You Are What You Consume
          </span>
          <span>
            Metadata from MusicBrainz (CC0 / CC BY-NC-SA) and the services you connect. SOMM never stores or streams audio.
          </span>
        </div>
      </footer>
    </div>
  );
}
