/**
 * WCAG 2.1 contrast for the text/background token pairs used in the UI,
 * computed from src/client/styles/tokens.css (so changing a token re-checks it).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/client/styles/tokens.css', import.meta.url), 'utf8');
const token = (name: string): string => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} not found`);
  return m[1]!;
};

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

describe('colour contrast (WCAG AA, 4.5:1 for body text)', () => {
  const pairs: [string, string][] = [
    ['text', 'bg'],
    ['text', 'surface-1'],
    ['text', 'surface-2'],
    ['text', 'surface-3'],
    ['text-muted', 'bg'],
    ['text-muted', 'surface-1'],
    ['text-muted', 'surface-2'],
    ['text-muted', 'surface-3'],
    ['text-faint', 'bg'],
    ['text-faint', 'surface-1'],
    ['link', 'bg'],
    ['link', 'surface-1'],
    ['text-on-yellow', 'yellow'],
    ['text-on-pale', 'pale'],
    ['royal', 'pale'],
    ['white', 'royal'],
    ['charcoal', 'orange'],
    ['danger', 'bg'],
    ['ok', 'bg'],
    ['orange', 'bg'],
  ];
  for (const [fg, bg] of pairs) {
    it(`--${fg} on --${bg}`, () => {
      expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('uses the SOMM brand palette', () => {
    expect(token('royal').toLowerCase()).toBe('#1747ff');
    expect(token('electric').toLowerCase()).toBe('#071a52');
    expect(token('yellow').toLowerCase()).toBe('#ffd83d');
    expect(token('orange').toLowerCase()).toBe('#ff7a24');
    expect(token('pale').toLowerCase()).toBe('#eaf0ff');
    expect(token('charcoal').toLowerCase()).toBe('#101629');
  });
});
