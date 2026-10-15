/**
 * Site-wide motion layer: aurora backdrop, reveal-on-scroll, a pointer
 * spotlight on glass surfaces, magnetic buttons, a cursor aura and a scroll
 * progress line. Purely decorative; it switches off with "reduce motion", and
 * content never depends on it (reveals only hide content when the browser can
 * reveal it again).
 */
import { useEffect, useRef } from 'react';
import { canHover, useReducedMotion } from './motion';

const SPOTLIGHT = '.panel, .tree-card, .rec-card, .list-item, .choice, .state, .btn, .hud-btn, .fx-card, .callout-xl, .orient-card, .modal';

export function GlobalFx() {
  const reduced = useReducedMotion();
  const progress = useRef<HTMLDivElement>(null);
  const aura = useRef<HTMLDivElement>(null);

  // Reveal on scroll.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('fx-motion', !reduced);
    if (reduced || typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') {
      html.classList.remove('fx-reveal');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
    );
    const scan = (root: ParentNode) => root.querySelectorAll('[data-reveal]:not(.is-in)').forEach((el) => io.observe(el));
    // Sections already on screen when this starts stay visible (hiding them now would flicker);
    // everything further down, and everything added later, reveals as it scrolls into view.
    document.querySelectorAll('[data-reveal]:not(.is-in)').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('is-in');
      else io.observe(el);
    });
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.matches('[data-reveal]:not(.is-in)')) io.observe(n);
          scan(n);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    html.classList.add('fx-reveal');
    return () => {
      io.disconnect();
      mo.disconnect();
      html.classList.remove('fx-reveal');
    };
  }, [reduced]);

  // Pointer: spotlight, magnetic buttons, cursor aura (mouse and trackpad only).
  useEffect(() => {
    if (reduced || !canHover()) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    let magnet: HTMLElement | null = null;
    const apply = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      if (aura.current) aura.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      const target = e.target instanceof Element ? (e.target.closest(SPOTLIGHT) as HTMLElement | null) : null;
      if (target) {
        const r = target.getBoundingClientRect();
        target.style.setProperty('--mx', `${e.clientX - r.left}px`);
        target.style.setProperty('--my', `${e.clientY - r.top}px`);
      }
      const m = e.target instanceof Element ? (e.target.closest('[data-magnetic]') as HTMLElement | null) : null;
      if (magnet && magnet !== m) magnet.style.translate = '';
      magnet = m;
      if (m) {
        const r = m.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        m.style.translate = `${(dx * 12).toFixed(1)}px ${(dy * 10).toFixed(1)}px`;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
      if (magnet) magnet.style.translate = '';
    };
  }, [reduced]);

  // Scroll progress line.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 4 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (progress.current) progress.current.style.transform = `scaleX(${p})`;
    };
    const on = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <div className="fx-backdrop" aria-hidden="true">
        <span className="aurora a1" />
        <span className="aurora a2" />
        <span className="aurora a3" />
        <span className="fx-grain" />
      </div>
      <div ref={progress} className="fx-progress" aria-hidden="true" />
      {!reduced && <div ref={aura} className="cursor-aura" aria-hidden="true" />}
    </>
  );
}
