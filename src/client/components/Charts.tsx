import type { MatchResult } from '../../shared/analysis/similarity';
import { FAMILY_COLORS, type Family } from '../../shared/taxonomy';

export function familyColor(family: string | null | undefined): string {
  return FAMILY_COLORS[(family ?? 'other') as Family] ?? FAMILY_COLORS.other;
}

export function Bars({ items, max, label }: { items: { key: string; label: string; value: number; display?: string; color?: string }[]; max?: number; label: string }) {
  const top = max ?? Math.max(0.0001, ...items.map((i) => i.value));
  return (
    <ul className="bars" aria-label={label}>
      {items.map((i) => (
        <li key={i.key} className="bar-row">
          <span className="truncate" title={i.label}>
            {i.label}
          </span>
          <span className="bar" aria-hidden="true">
            <span style={{ width: `${Math.max(2, (i.value / top) * 100)}%`, background: i.color ?? 'var(--yellow)' }} />
          </span>
          <span className="num small muted">{i.display ?? i.value}</span>
        </li>
      ))}
    </ul>
  );
}

const LABEL_TEXT: Record<string, string> = { strong: 'Strong match', good: 'Good match', possible: 'Possible match', low: 'Weak match' };

export function ScoreRing({ score, label }: { score: number; label?: string }) {
  const pct = Math.round(score * 100);
  const color = label === 'strong' ? 'var(--yellow)' : label === 'good' ? 'var(--orange)' : label === 'possible' ? '#8FB3FF' : '#6B7799';
  return (
    <div className="score-ring" style={{ ['--p' as string]: pct, ['--c' as string]: color }} role="img" aria-label={`Match score ${pct} out of 100${label ? `, ${LABEL_TEXT[label]}` : ''}`}>
      <span>
        {pct}
        <small>{label ? LABEL_TEXT[label]?.split(' ')[0] : 'score'}</small>
      </span>
    </div>
  );
}

export function matchLabel(label: string) {
  return LABEL_TEXT[label] ?? label;
}

/** Transparent component breakdown: raw similarity × evidence × weight = contribution. */
export function MatchBreakdown({ match }: { match: MatchResult }) {
  return (
    <div className="stack">
      <ul className="breakdown" aria-label="Score components">
        {match.components
          .filter((c) => c.weight > 0 || c.available)
          .map((c) => (
            <li key={c.key} data-available={c.available}>
              <span>
                {c.label}
                {c.available && c.sharedCount > 0 && <span className="faint xsmall"> · {c.sharedCount} shared</span>}
              </span>
              <span className="bar" style={{ height: 10, borderRadius: 999, background: 'var(--bg-deep)', overflow: 'hidden' }} aria-hidden="true">
                <span style={{ display: 'block', height: '100%', width: `${Math.round(c.score * 100)}%`, background: 'linear-gradient(90deg,var(--royal),var(--yellow))' }} />
              </span>
              <span className="num xsmall muted">
                {c.available ? `${Math.round(c.score * 100)}% × ${Math.round(c.effectiveWeight * 100)}% = ${(c.contribution * 100).toFixed(1)}` : 'not used'}
              </span>
            </li>
          ))}
      </ul>
      <details className="disclose small">
        <summary>How this was calculated</summary>
        <p className="muted">
          Each component is a cosine similarity (popular items count for less via inverse document frequency), multiplied by an evidence factor
          s/(s+k) that grows with the number of shared items. The total is the weighted average of the components that could be computed; missing
          components are left out and their weight redistributed rather than counted as zero.
        </p>
        <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr className="faint">
              <th align="left">Component</th>
              <th align="right">Similarity</th>
              <th align="right">Evidence</th>
              <th align="right">Weight</th>
              <th align="right">Contribution</th>
            </tr>
          </thead>
          <tbody>
            {match.components.map((c) => (
              <tr key={c.key}>
                <td>{c.label}</td>
                <td align="right" className="num">{c.available ? c.raw.toFixed(2) : '—'}</td>
                <td align="right" className="num">{c.available ? c.evidence.toFixed(2) : '—'}</td>
                <td align="right" className="num">{c.available ? c.effectiveWeight.toFixed(2) : `${c.weight.toFixed(2)} (unused)`}</td>
                <td align="right" className="num">{c.contribution.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {match.components
          .filter((c) => c.reason)
          .map((c) => (
            <p key={c.key} className="xsmall faint" style={{ marginTop: 8 }}>
              {c.label}: {c.reason}
            </p>
          ))}
        {match.gate && <p className="xsmall" style={{ color: 'var(--orange)' }}>Evidence gate: {match.gate}</p>}
      </details>
    </div>
  );
}
