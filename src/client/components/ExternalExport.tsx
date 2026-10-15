/**
 * Large guidance block: export playlists with an external tool (TuneMyMusic),
 * then bring the CSV into SOMM. Shown on the landing, convert and import pages.
 */
import { Link } from '../router';
import { Icon } from './Icon';

export const TUNEMYMUSIC_URL = 'https://www.tunemymusic.com/home';

export function ExternalExportCallout({ headingLevel = 2, target = 'convert' }: { headingLevel?: 2 | 3; target?: 'convert' | 'import' }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className="callout-xl" aria-labelledby="external-export-title" data-reveal>
      <p className="eyebrow">Get your playlists out</p>
      <Heading id="external-export-title" className="callout-title">
        Use an external tool to extract the songs from your playlists
      </Heading>
      <p className="callout-lead">
        Music apps rarely let you download a playlist. A playlist tool such as{' '}
        <a href={TUNEMYMUSIC_URL} target="_blank" rel="noopener noreferrer">
          TuneMyMusic
        </a>{' '}
        can read your playlists from most music services and export them as a CSV file — exactly the file SOMM needs.
      </p>
      <ol className="callout-steps">
        <li>
          <span className="step-num" aria-hidden="true">
            1
          </span>
          <span>
            Open <strong>TuneMyMusic</strong> and choose the service your playlist is on. You sign in to that service on their site — never on SOMM.
          </span>
        </li>
        <li>
          <span className="step-num" aria-hidden="true">
            2
          </span>
          <span>
            Pick your playlists and choose to <strong>export to a file</strong>, then download the <strong>CSV</strong>.
          </span>
        </li>
        <li>
          <span className="step-num" aria-hidden="true">
            3
          </span>
          <span>
            Upload that CSV here: <strong>Convert</strong> checks and completes every song, <strong>Import</strong> puts it straight on your map.
          </span>
        </li>
      </ol>
      <div className="row">
        <a className="btn btn-primary" href={TUNEMYMUSIC_URL} target="_blank" rel="noopener noreferrer" data-magnetic>
          Open TuneMyMusic <Icon name="link" size={18} />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        {target === 'convert' ? (
          <Link to="/convert" className="btn btn-ghost">
            Convert my CSV
          </Link>
        ) : (
          <Link to="/import" className="btn btn-ghost">
            Import my CSV
          </Link>
        )}
      </div>
      <p className="xsmall faint" style={{ margin: 0 }}>
        TuneMyMusic is an independent service, not part of SOMM; its own terms and any plan limits apply. SOMM never sees your music-service password.
      </p>
    </section>
  );
}
