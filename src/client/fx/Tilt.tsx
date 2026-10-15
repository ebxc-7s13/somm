/**
 * 3D tilt card: leans towards the pointer with a moving glare (mouse only;
 * off with "reduce motion"). Children render normally everywhere else.
 */
import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { useReducedMotion } from './motion';

export function Tilt({ children, className = '', max = 9, style }: { children: ReactNode; className?: string; max?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType !== 'mouse') return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--rx', `${(-py * max).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(px * max).toFixed(2)}deg`);
    el.style.setProperty('--gx', `${((px + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty('--gy', `${((py + 0.5) * 100).toFixed(1)}%`);
  };

  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };

  return (
    <div ref={ref} className={`tilt ${className}`} style={style} onPointerMove={onMove} onPointerLeave={onLeave}>
      {children}
      <span className="tilt-glare" aria-hidden="true" />
    </div>
  );
}

/** Infinite ticker (decorative, hidden from assistive technology). */
export function Marquee({ items, reverse = false }: { items: string[]; reverse?: boolean }) {
  return (
    <div className={`marquee ${reverse ? 'marquee-reverse' : ''}`} aria-hidden="true">
      <div className="marquee-track">
        {[...items, ...items].map((t, i) => (
          <span key={i}>
            {t}
            <i>✦</i>
          </span>
        ))}
      </div>
    </div>
  );
}
