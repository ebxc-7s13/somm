import { seededUnit } from '../../shared/hash';
import { familyColor } from './Charts';

/**
 * A Tree's visual identity, generated from its genre-family shares: one branch
 * per family, length ∝ share, with leaf nodes. Deterministic per Tree.
 */
export function TreeGlyph({ seed, families, size = 72, label }: { seed: string; families: { family: string; share: number }[]; size?: number; label?: string }) {
  const list = families.length ? families.slice(0, 6) : [{ family: 'other', share: 1 }];
  const total = list.reduce((s, f) => s + f.share, 0) || 1;
  const offset = seededUnit(seed) * Math.PI * 2;
  let angle = offset;
  const branches = list.map((f, i) => {
    const span = (f.share / total) * Math.PI * 2;
    const a = angle + span / 2;
    angle += span;
    const len = 14 + 18 * Math.sqrt(f.share / total) + seededUnit(`${seed}:${i}`) * 4;
    return { f, a, len, x: 40 + Math.cos(a) * len, y: 40 + Math.sin(a) * len };
  });
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" style={{ flex: 'none' }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="40" cy="40" r="38" fill="#0B2266" stroke="rgba(234,240,255,.14)" />
      {branches.map((b, i) => (
        <line key={`l${i}`} x1="40" y1="40" x2={b.x} y2={b.y} stroke={familyColor(b.f.family)} strokeWidth={1.5 + 4 * (b.f.share / total)} strokeLinecap="round" opacity={0.9} />
      ))}
      {branches.map((b, i) => (
        <circle key={`c${i}`} cx={b.x} cy={b.y} r={3 + 5 * Math.sqrt(b.f.share / total)} fill={familyColor(b.f.family)} />
      ))}
      <circle cx="40" cy="40" r="6.5" fill="#FFD83D" stroke="#071A52" strokeWidth="2" />
    </svg>
  );
}
