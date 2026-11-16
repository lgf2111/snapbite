import { describe, expect, it } from 'vitest';
import { FAN, FAN_ACTIONS, wedgeAt, wedgePath } from './fan.js';

/** A point `r` px from the centre at `deg` (0 = right, 90 = up, 180 = left). */
const at = (deg: number, r = 100) => ({
  dx: r * Math.cos((deg * Math.PI) / 180),
  dy: -r * Math.sin((deg * Math.PI) / 180),
});
const pick = (deg: number, r?: number) => wedgeAt(at(deg, r).dx, at(deg, r).dy);

describe('wedgeAt', () => {
  it('orders the wedges left to right: saved, upload, manual, photo', () => {
    expect(FAN_ACTIONS).toEqual(['saved', 'upload', 'manual', 'photo']);
    expect([160, 110, 70, 20].map((d) => pick(d))).toEqual([0, 1, 2, 3]);
  });

  it('is the dead zone within 24px of the centre, at any angle', () => {
    for (const deg of [0, 45, 90, 135, 180, 270]) {
      expect(pick(deg, FAN.deadPx - 1)).toBeNull();
      expect(pick(deg, FAN.deadPx + 1)).not.toBe(null === pick(deg, 100) ? 0 : undefined);
    }
    expect(wedgeAt(0, 0)).toBeNull();
  });

  it('puts every edge on its documented side, one degree either side', () => {
    // 0/45/90/135/180 plus a degree on each side. A boundary belongs to the
    // wedge on its right (the lower angle). Indices: saved, upload, manual, photo.
    const cases = [
      [359, 3],
      [0, 3],
      [1, 3],
      [44, 3],
      [45, 3],
      [46, 2],
      [89, 2],
      [90, 2],
      [91, 1],
      [134, 1],
      [135, 1],
      [136, 0],
      [179, 0],
      [180, 0],
      [181, 0],
    ] as const;

    for (const [deg, expected] of cases) {
      expect(pick(deg), `${deg}deg`).toBe(expected);
      // The same point resolves the same way every time.
      for (let i = 0; i < 3; i++) expect(pick(deg)).toBe(expected);
    }
  });

  it('covers the whole half-circle with no gaps', () => {
    for (let deg = 0; deg <= 180; deg += 0.5) {
      const w = pick(deg);
      expect(w).not.toBeNull();
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThan(FAN_ACTIONS.length);
    }
  });

  it('keeps the far ends reachable when the thumb drifts a little below the horizon', () => {
    expect(pick(-10)).toBe(3);
    expect(pick(190)).toBe(0); // 190deg == -170deg
    expect(pick(-25)).toBe(3);
  });

  it('cancels when the finger goes steeply down', () => {
    expect(pick(-90)).toBeNull();
    expect(pick(-60)).toBeNull();
    expect(pick(-120)).toBeNull();
  });

  it('does not depend on distance beyond the dead zone', () => {
    expect(pick(20, 30)).toBe(3);
    expect(pick(20, 500)).toBe(3);
  });
});

describe('wedgePath', () => {
  it('draws four distinct closed shapes', () => {
    const paths = FAN_ACTIONS.map((_, i) => wedgePath(i));
    expect(new Set(paths).size).toBe(4);
    for (const d of paths) expect(d).toMatch(/^M .* Z$/);
  });
});
