/**
 * SOMM wordmark: S, an orbit-ring "O" carrying a yellow node, and two Ms linked
 * by a thin orange line — the Music Map motif in the logo itself.
 */
export function Logo({ size = 34, withName = true, className }: { size?: number; withName?: boolean; className?: string }) {
  const h = size;
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <svg width={h * 3.25} height={h} viewBox="0 0 130 40" role="img" aria-label="SOMM">
        <text x="0" y="33" fontFamily="var(--font-logo)" fontWeight={800} fontSize="38" fill="currentColor" letterSpacing="-1">
          S
        </text>
        <circle cx="39" cy="20" r="12.5" fill="none" stroke="currentColor" strokeWidth="6.5" />
        <g className="logo-orbit">
          <line x1="48" y1="11" x2="68" y2="4" stroke="#FF7A24" strokeWidth="2" strokeLinecap="round" />
          <circle cx="48" cy="11" r="5" fill="#FFD83D" />
          <circle cx="68" cy="4" r="2.6" fill="#FF7A24" />
        </g>
        <text x="56" y="33" fontFamily="var(--font-logo)" fontWeight={800} fontSize="38" fill="currentColor" letterSpacing="-2">
          MM
        </text>
      </svg>
      {withName && (
        <span style={{ display: 'grid', lineHeight: 1.05 }}>
          <span className="sr-only">SOMM — </span>
          <span style={{ font: '700 0.7rem/1.1 var(--font-ui)', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            Sound of
            <br />
            My Mind
          </span>
        </span>
      )}
    </span>
  );
}
