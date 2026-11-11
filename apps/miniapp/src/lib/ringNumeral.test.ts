import { describe, expect, it } from 'vitest';
import {
  FIT_DIGITS,
  HERO_BASE_REM,
  formatRingNumeral,
  numeralUnits,
  ringNumeralSizeRem,
} from './ringNumeral.js';

describe('formatRingNumeral', () => {
  it('leaves up to four digits alone, so Daily looks as it always did', () => {
    for (const [n, s] of [
      [0, '0'],
      [7, '7'],
      [2110, '2110'],
      [9999, '9999'],
    ] as const) {
      expect(formatRingNumeral(n)).toBe(s);
    }
  });

  it('groups thousands from five digits up', () => {
    expect(formatRingNumeral(12810)).toBe('12,810');
    expect(formatRingNumeral(123456)).toBe('123,456');
    expect(formatRingNumeral(999999)).toBe('999,999');
  });

  it('rounds, and never shows a negative', () => {
    expect(formatRingNumeral(12809.6)).toBe('12,810');
    expect(formatRingNumeral(-5)).toBe('0');
  });
});

describe('ringNumeralSizeRem', () => {
  it('keeps the current size for up to four characters', () => {
    for (const t of ['0', '88', '840', '2110', '9999'])
      expect(ringNumeralSizeRem(t)).toBe(HERO_BASE_REM);
  });

  it('steps down for five and six digits, in order', () => {
    const four = ringNumeralSizeRem('9999');
    const five = ringNumeralSizeRem('12,810');
    const six = ringNumeralSizeRem('123,456');
    expect(five).toBeLessThan(four);
    expect(six).toBeLessThan(five);
    // Still readable: not below ~24px at 16px/rem.
    expect(six * 16).toBeGreaterThan(24);
  });

  it('is never wider than four digits at the base size, for any value up to six digits', () => {
    for (let v = 0; v <= 999999; v += 37) {
      const t = formatRingNumeral(v);
      expect(numeralUnits(t) * ringNumeralSizeRem(t)).toBeLessThanOrEqual(
        FIT_DIGITS * HERO_BASE_REM + 1e-9,
      );
    }
  });
});

describe('the numeral stays inside the ring', () => {
  // Hero ring geometry (ProgressRing size 132): stroke = max(6, round(size * 0.09)).
  const SIZE = 132;
  const stroke = Math.max(6, Math.round(SIZE * 0.09));
  const innerRadius = SIZE / 2 - stroke;
  // Worst digit advance measured in the real font (9s, New York): 0.546em; a little slack.
  const DIGIT_EM = 0.56;
  // The digits' own height is about 0.72em, so half of it is the vertical extent from centre.
  const INK_HALF_HEIGHT_EM = 0.36;

  it.each([0, 840, 2110, 9999, 12810, 13930, 99999, 123456, 999999])(
    'at %i the glyphs are inside the inner circle, clear of the stroke',
    (v) => {
      const text = formatRingNumeral(v);
      const px = ringNumeralSizeRem(text) * 16;
      const width = numeralUnits(text) * DIGIT_EM * px;
      const corner = Math.hypot(width / 2, INK_HALF_HEIGHT_EM * px);
      expect(corner).toBeLessThanOrEqual(innerRadius - 2);
    },
  );
});
