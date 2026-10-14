import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api';
import { ErrorState, Loading, Spinner } from '../components/States';
import { useApi, useDocumentTitle, useInterval } from '../hooks';
import { Link } from '../router';
import type { JobProgress } from '../types';

export function JobProgressView({ jobId, compact = false, onDone }: { jobId: string; compact?: boolean; onDone?: (job: JobProgress) => void }) {
  const { data, error, loading, reload } = useApi<{ job: JobProgress; enrichment: { enabled: boolean; reason: string | null } }>(`/api/imports/jobs/${jobId}`);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const job = data?.job;
  const running = job?.status === 'enriching';
  useInterval(reload, 1500, running);
  const [notified, setNotified] = useState(false);
  useEffect(() => {
    if (job && !running && !notified) {
      setNotified(true);
      onDone?.(job);
    }
  }, [job, running, notified, onDone]);

  if (loading && !data) return <Loading label="Loading import progress…" />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!job) return null;

  const processed = job.total - job.counts.pending;
  const pct = job.total ? Math.round((processed / job.total) * 100) : 100;

  return (
    <div className="stack">
      <div className="panel panel-accent">
        <div className="row-between">
          <div>
            <p className="eyebrow">{running ? 'Enriching metadata' : job.status === 'partial' ? 'Finished with gaps' : 'Import complete'}</p>
            <h2 style={{ margin: 0 }}>{job.playlistName ?? 'Your import'}</h2>
          </div>
          {running && <Spinner label="Working…" />}
        </div>
        <div className="meter" style={{ marginTop: 'var(--space-4)' }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Import progress">
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          {processed} of {job.total} tracks processed · {Math.round(job.genreCoverage * 100)}% have genre information so far
        </p>
        <div className="stats" style={{ marginTop: 'var(--space-4)' }}>
          <div className="stat"><b className="num">{job.total}</b><span>imported</span></div>
          <div className="stat"><b className="num">{job.merged}</b><span>matched existing</span></div>
          <div className="stat"><b className="num">{job.counts.done}</b><span>enriched</span></div>
          <div className="stat"><b className="num">{job.counts.notFound}</b><span>not found</span></div>
          <div className="stat"><b className="num">{job.skipped}</b><span>skipped rows</span></div>
        </div>
      </div>

      {data?.enrichment && !data.enrichment.enabled && (
        <div className="panel panel-tight" role="note">
          <strong className="small">Genre lookup is off on this server</strong>
          <p className="small muted" style={{ margin: 0 }}>
            {data.enrichment.reason} Your map uses the metadata from your file and provider; tracks without genres appear under “Genre unknown”.
          </p>
        </div>
      )}

      {job.message && !compact && (
        <div className="panel panel-tight" role="note">
          <p className="small muted" style={{ margin: 0 }}>
            {job.message}
          </p>
        </div>
      )}

      {job.errors.length > 0 && (
        <details className="disclose">
          <summary>
            {job.errors.length} unreadable row{job.errors.length === 1 ? '' : 's'} in the source
          </summary>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            {job.errors.slice(0, 50).map((e) => (
              <li key={e.row}>
                Row {e.row}: {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {(job.enrichmentErrors.length > 0 || job.counts.error > 0) && (
        <div className="panel panel-tight" role="alert">
          <strong>Some lookups failed</strong>
          <ul className="small muted" style={{ margin: '6px 0', paddingLeft: 18 }}>
            {job.enrichmentErrors.slice(0, 5).map((e, i) => (
              <li key={i}>
                {e.title}: {e.message}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-blue btn-sm"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              setRetryError(null);
              try {
                await api.post(`/api/imports/jobs/${jobId}/retry`);
                setNotified(false);
                reload();
              } catch (err) {
                setRetryError(errorMessage(err));
              } finally {
                setRetrying(false);
              }
            }}
          >
            Retry failed lookups
          </button>
          {retryError && <p className="error-text">{retryError}</p>}
        </div>
      )}

      {!compact && (
        <div className="row">
          <Link to="/map" className="btn btn-primary">
            {running ? 'See the map so far' : 'Open my Music Map'}
          </Link>
          <Link to={job.playlistId ? `/library?playlist=${job.playlistId}` : '/library'} className="btn btn-ghost">
            Inspect the tracks
          </Link>
          <Link to="/import" className="btn btn-ghost">
            Import another
          </Link>
        </div>
      )}
    </div>
  );
}

export function ImportJobPage({ params }: { params: { id: string } }) {
  useDocumentTitle('Import progress');
  return (
    <div className="page">
      <JobProgressView jobId={params.id} />
    </div>
  );
}
