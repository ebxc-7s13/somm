import type { ReactNode } from 'react';
import { ApiError } from '../api';
import { Icon } from './Icon';

export function Loading({ label = 'Loading…', lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="stack" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: i === 0 ? 28 : 18, width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="row" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="small muted">{label}</span>
    </span>
  );
}

/** Small constellation illustration used in empty states. */
function Constellation() {
  return (
    <svg className="state-icon" viewBox="0 0 72 72" aria-hidden="true">
      <line x1="36" y1="36" x2="14" y2="20" stroke="rgba(234,240,255,.35)" strokeWidth="2" />
      <line x1="36" y1="36" x2="58" y2="24" stroke="rgba(234,240,255,.35)" strokeWidth="2" />
      <line x1="36" y1="36" x2="44" y2="60" stroke="rgba(234,240,255,.35)" strokeWidth="2" strokeDasharray="3 4" />
      <circle cx="36" cy="36" r="10" fill="#1747FF" />
      <circle cx="14" cy="20" r="6" fill="#FFD83D" />
      <circle cx="58" cy="24" r="5" fill="#FF7A24" />
      <circle cx="44" cy="60" r="4" fill="none" stroke="#B9C6F2" strokeWidth="2" strokeDasharray="2 2" />
    </svg>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className="state" aria-label={title}>
      <Constellation />
      <h2>{title}</h2>
      {children && <div className="muted" style={{ maxWidth: '56ch' }}>{children}</div>}
      {action}
    </section>
  );
}

export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const network = error instanceof ApiError && error.isNetwork;
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <section className="state state-error" role="alert">
      <Icon name="warning" size={40} />
      <h2>{title ?? (network ? 'You appear to be offline' : 'That did not work')}</h2>
      <p className="muted" style={{ maxWidth: '56ch' }}>
        {message}
      </p>
      {onRetry && (
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          <Icon name="refresh" /> Try again
        </button>
      )}
    </section>
  );
}
