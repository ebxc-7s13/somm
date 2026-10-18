import { describe, expect, it } from 'vitest';
import { RIPPLE_LIFE, waveY } from '../../src/client/fx/LiveField';

describe('live background waves', () => {
  it('stay near their baseline on their own', () => {
    for (let x = 0; x < 1200; x += 37) {
      const y = waveY(x, 400, 2, 12.5, 0, null, []);
      expect(Math.abs(y - 400)).toBeLessThan(40);
    }
  });

  it('bend toward a nearby pointer and ignore a far one', () => {
    const still = waveY(500, 400, 0, 3, 0, null, []);
    const near = waveY(500, 400, 0, 3, 0, { x: 500, y: 520, energy: 1 }, []);
    const far = waveY(500, 400, 0, 3, 0, { x: 2500, y: 520, energy: 1 }, []);
    expect(near - still).toBeGreaterThan(20);
    expect(Math.abs(far - still)).toBeLessThan(0.01);
  });

  it('ripple outward from a tap and fade away', () => {
    const at = (age: number, x: number) => waveY(x, 400, 1, 3, 0, null, [{ x: 0, y: 400, age }]) - waveY(x, 400, 1, 3, 0, null, []);
    // The ripple front is where the line moves; far ahead of it nothing happens yet.
    expect(Math.max(...[200, 205, 210, 215, 220].map((x) => Math.abs(at(0.5, x))))).toBeGreaterThan(1);
    expect(Math.abs(at(0.5, 900))).toBeLessThan(0.01);
    expect(Math.abs(at(RIPPLE_LIFE, 1008))).toBeLessThan(0.01);
  });

  it('flow when the page scrolls', () => {
    expect(waveY(300, 400, 3, 3, 0, null, [])).not.toBeCloseTo(waveY(300, 400, 3, 3, 600, null, []), 1);
  });
});
