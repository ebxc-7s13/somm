import { useCallback, useState } from 'react';
import { api } from '../api';
import { useDocumentTitle } from '../hooks';
import { Link } from '../router';
import { useAuth } from '../state';
import { ImportFlow } from './Import';
import { JobProgressView } from './ImportJob';
import type { JobProgress } from '../types';

const STEPS = ['Bring music', 'Process', 'See your map', 'Find your Tree'];

export function Onboarding() {
  useDocumentTitle('Welcome');
  const { me, refresh } = useAuth();
  const [jobId, setJobId] = useState<string | null>(null);
  const [done, setDone] = useState<JobProgress | null>(null);
  const step = done ? 2 : jobId ? 1 : 0;

  const onDone = useCallback(
    async (job: JobProgress) => {
      setDone(job);
      await api.patch('/api/me', { onboarded: true }).catch(() => undefined);
      void refresh();
    },
    [refresh],
  );

  return (
    <div className="page">
      <p className="eyebrow">A Social Mind for Audiophiles</p>
      <h1>Welcome, {me?.user.displayName}</h1>
      <p className="lead">Import → process → map → Trees. No questionnaire: your first Music Map appears as soon as your tracks are read.</p>
      <ol className="row" aria-label="Progress" style={{ listStyle: 'none', padding: 0, margin: 'var(--space-5) 0' }}>
        {STEPS.map((s, i) => (
          <li key={s} className="badge" aria-current={i === step ? 'step' : undefined} style={i === step ? { background: 'var(--yellow)', color: 'var(--charcoal)' } : i < step ? { background: 'var(--royal)' } : undefined}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      {!jobId && (
        <div className="stack">
          <ImportFlow onCommitted={setJobId} />
        </div>
      )}
      {jobId && <JobProgressView jobId={jobId} compact onDone={onDone} />}
      {done && (
        <div className="panel panel-accent" style={{ marginTop: 'var(--space-5)' }}>
          <h2>Your Music Map is ready</h2>
          <p className="muted">Explore it, read the evidence behind your Music Mind, then see which Trees match you — and why.</p>
          <div className="row">
            <Link to="/map" className="btn btn-primary">
              Open my Music Map
            </Link>
            <Link to="/mind" className="btn btn-ghost">
              Read my Music Mind
            </Link>
            <Link to="/trees" className="btn btn-blue">
              Find my Trees
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
