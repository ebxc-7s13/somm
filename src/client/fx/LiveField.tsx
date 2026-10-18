/**
 * Live background: glowing sound-wave lines and drifting specks behind every page.
 * The lines bend toward the mouse (website) or a finger (phone), a tap or click
 * sends a ripple along them, and scrolling makes them flow. Decorative only: it
 * draws one still frame under "reduce motion", pauses while the page is hidden,
 * runs at half rate on touch screens and never blocks scrolling or taps.
 */
import { useEffect, useRef } from 'react';
import { useReducedMotion } from './motion';

export interface Ripple {
  x: number;
  y: number;
  /** Seconds since the ripple started. */
  age: number;
}

export interface FieldPointer {
  x: number;
  y: number;
  /** 0 (no pointer) to 1 (moving fast). */
  energy: number;
}

const LINES = [
  { color: [92, 242, 255], amp: 26, k: 0.0062, speed: 0.42, phase: 0 },
  { color: [155, 123, 255], amp: 34, k: 0.0048, speed: -0.31, phase: 1.7 },
  { color: [255, 90, 216], amp: 22, k: 0.0071, speed: 0.36, phase: 3.1 },
  { color: [92, 242, 255], amp: 30, k: 0.0054, speed: -0.27, phase: 4.4 },
  { color: [255, 216, 61], amp: 18, k: 0.0083, speed: 0.48, phase: 5.2 },
  { color: [155, 123, 255], amp: 28, k: 0.0059, speed: 0.22, phase: 2.4 },
] as const;

export const RIPPLE_LIFE = 2.4;
const RIPPLE_SPEED = 420;
const PULL_RADIUS = 190;

/** Height of a wave line at x: its own motion, the pointer's pull and any ripples passing by. */
export function waveY(x: number, baseY: number, line: number, t: number, scroll: number, pointer: FieldPointer | null, ripples: readonly Ripple[]): number {
  const l = LINES[line % LINES.length]!;
  let y = baseY + l.amp * Math.sin(x * l.k + t * l.speed + l.phase + scroll * 0.0021) + l.amp * 0.35 * Math.sin(x * l.k * 2.3 - t * l.speed * 1.7 + l.phase);
  if (pointer && pointer.energy > 0.001) {
    const dx = x - pointer.x;
    const dy = baseY - pointer.y;
    const near = Math.exp(-(dx * dx + dy * dy) / (2 * PULL_RADIUS * PULL_RADIUS));
    y += (pointer.y - baseY) * 0.32 * near * pointer.energy + Math.sin(x * 0.045 - t * 5) * 10 * near * pointer.energy;
  }
  for (const r of ripples) {
    const d = Math.hypot(x - r.x, baseY - r.y);
    const front = r.age * RIPPLE_SPEED;
    const band = Math.exp(-((d - front) ** 2) / (2 * 34 * 34));
    y += Math.sin((d - front) * 0.09) * 22 * band * Math.max(0, 1 - r.age / RIPPLE_LIFE);
  }
  return y;
}

interface Speck {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  tw: number;
}

export function LiveField() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = canvas.current;
    // jsdom and very old browsers have no 2D canvas: the static aurora stays.
    if (!el || typeof el.getContext !== 'function' || /jsdom/i.test(navigator.userAgent)) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const lowEnd = (navigator as Navigator & { deviceMemory?: number }).deviceMemory !== undefined && (navigator as Navigator & { deviceMemory?: number }).deviceMemory! <= 2;
    let w = 0;
    let h = 0;
    let specks: Speck[] = [];
    let grads: CanvasGradient[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.25 : 1.5);
      w = window.innerWidth;
      h = window.innerHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      grads = LINES.map((l) => {
        const g = ctx.createLinearGradient(0, 0, w, 0);
        const [r, gr, b] = l.color;
        g.addColorStop(0, `rgba(${r},${gr},${b},0)`);
        g.addColorStop(0.2, `rgba(${r},${gr},${b},0.2)`);
        g.addColorStop(0.55, `rgba(${r},${gr},${b},0.32)`);
        g.addColorStop(0.85, `rgba(${r},${gr},${b},0.16)`);
        g.addColorStop(1, `rgba(${r},${gr},${b},0)`);
        return g;
      });
      const count = Math.round(Math.min(lowEnd ? 28 : coarse ? 42 : 80, (w * h) / 16000));
      specks = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.6 + Math.random() * 1.4,
        vy: 6 + Math.random() * 16,
        sway: Math.random() * Math.PI * 2,
        tw: Math.random() * Math.PI * 2,
      }));
    };

    const pointer: FieldPointer & { tx: number; ty: number; seen: boolean } = { x: 0, y: 0, tx: 0, ty: 0, energy: 0, seen: false };
    let ripples: Ripple[] = [];
    let t = Math.random() * 100;

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const scroll = window.scrollY;
      const step = coarse ? 18 : 12;
      const active = pointer.seen ? pointer : null;
      ctx.lineWidth = coarse ? 1.3 : 1.15;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < LINES.length; i++) {
        const base = h * (0.16 + (0.68 * i) / (LINES.length - 1));
        ctx.strokeStyle = grads[i]!;
        ctx.beginPath();
        for (let x = -step; x <= w + step; x += step) {
          const y = waveY(x, base, i, t, scroll, active, ripples);
          if (x === -step) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (const s of specks) {
        const a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.6 + s.tw));
        ctx.fillStyle = `rgba(214,236,255,${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(s.x + Math.sin(t * 0.6 + s.sway) * 8, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    };

    resize();
    if (reduced) {
      // One still frame, redrawn when the window changes size.
      const still = () => (resize(), draw());
      draw();
      window.addEventListener('resize', still);
      return () => window.removeEventListener('resize', still);
    }

    let frame = 0;
    let last = performance.now();
    let skip = false;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      // Touch screens: 30 frames a second is plenty for a backdrop and saves battery.
      if (coarse && (skip = !skip)) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 7);
      pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 7);
      pointer.energy = Math.max(coarse ? 0 : 0.35 * Number(pointer.seen), pointer.energy - dt * 0.6);
      ripples = ripples.map((r) => ({ ...r, age: r.age + dt })).filter((r) => r.age < RIPPLE_LIFE);
      for (const s of specks) {
        s.y -= s.vy * dt;
        if (pointer.seen && pointer.energy > 0.05) {
          const dx = s.x - pointer.x;
          const dy = s.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 140 * 140 && d2 > 1) {
            const push = (1 - Math.sqrt(d2) / 140) * 90 * pointer.energy * dt;
            s.x += (dx / Math.sqrt(d2)) * push;
            s.y += (dy / Math.sqrt(d2)) * push;
          }
        }
        if (s.y < -10) {
          s.y = h + 10;
          s.x = Math.random() * w;
        }
      }
      draw();
    };

    const move = (x: number, y: number, boost: number) => {
      if (!pointer.seen) {
        pointer.x = x;
        pointer.y = y;
      }
      pointer.seen = true;
      pointer.energy = Math.min(1, pointer.energy + boost);
      pointer.tx = x;
      pointer.ty = y;
    };
    const ripple = (x: number, y: number) => {
      ripples.push({ x, y, age: 0 });
      if (ripples.length > 6) ripples.shift();
    };
    const onPointerMove = (e: PointerEvent) => move(e.clientX, e.clientY, e.pointerType === 'mouse' ? 0.08 : 0.2);
    const onPointerDown = (e: PointerEvent) => {
      move(e.clientX, e.clientY, 0.6);
      ripple(e.clientX, e.clientY);
    };
    // Finger drags that scroll the page stop sending pointer events; touch events keep coming.
    const onTouchMove = (e: TouchEvent) => {
      const p = e.touches[0];
      if (p) move(p.clientX, p.clientY, 0.15);
    };
    const onLeave = () => {
      pointer.seen = false;
    };
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 160);
    };
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (document.visibilityState === 'visible') {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(resizeTimer);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('touchmove', onTouchMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reduced]);

  return <canvas ref={canvas} className="fx-field" aria-hidden="true" />;
}
