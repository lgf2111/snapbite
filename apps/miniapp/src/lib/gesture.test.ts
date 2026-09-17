import { describe, expect, it } from 'vitest';
import {
  classifySwipe,
  nextTabIndex,
  pullDistance,
  revealOffset,
  shouldRefresh,
  shouldReveal,
} from './gesture.js';

describe('classifySwipe', () => {
  it('detects a clear horizontal left swipe', () => {
    expect(classifySwipe({ x: 200, y: 100 }, { x: 100, y: 105 })).toBe('left');
  });

  it('detects a clear horizontal right swipe', () => {
    expect(classifySwipe({ x: 100, y: 100 }, { x: 220, y: 108 })).toBe('right');
  });

  it('detects vertical swipes', () => {
    expect(classifySwipe({ x: 100, y: 100 }, { x: 105, y: 220 })).toBe('down');
    expect(classifySwipe({ x: 100, y: 220 }, { x: 105, y: 100 })).toBe('up');
  });

  it('returns null for movement below threshold', () => {
    expect(classifySwipe({ x: 100, y: 100 }, { x: 120, y: 100 })).toBeNull();
  });

  it('returns null for diagonal movement that fails the ratio test', () => {
    // 60px each way: neither axis dominates enough.
    expect(classifySwipe({ x: 100, y: 100 }, { x: 160, y: 160 })).toBeNull();
  });

  it('honors a custom threshold', () => {
    expect(classifySwipe({ x: 0, y: 0 }, { x: 30, y: 0 }, { threshold: 20 })).toBe('right');
  });
});

describe('nextTabIndex', () => {
  it('advances on left swipe and retreats on right swipe', () => {
    expect(nextTabIndex(1, 'left', 5)).toBe(2);
    expect(nextTabIndex(1, 'right', 5)).toBe(0);
  });

  it('clamps at the edges', () => {
    expect(nextTabIndex(0, 'right', 5)).toBe(0);
    expect(nextTabIndex(4, 'left', 5)).toBe(4);
  });

  it('does not move on vertical/null directions', () => {
    expect(nextTabIndex(2, 'up', 5)).toBe(2);
    expect(nextTabIndex(2, null, 5)).toBe(2);
  });
});

describe('revealOffset', () => {
  it('only reveals to the left and caps at max', () => {
    expect(revealOffset(-40, 80)).toBe(-40);
    expect(revealOffset(-200, 80)).toBe(-80);
    expect(revealOffset(30, 80)).toBe(0);
  });
});

describe('shouldReveal', () => {
  it('commits past half the reveal width', () => {
    expect(shouldReveal(-50, 80)).toBe(true);
    expect(shouldReveal(-20, 80)).toBe(false);
  });
});

describe('pullDistance', () => {
  it('is zero when pulling up', () => {
    expect(pullDistance(-30)).toBe(0);
  });

  it('applies resistance and caps at max', () => {
    expect(pullDistance(100, { max: 80, resistance: 0.5 })).toBe(50);
    expect(pullDistance(1000, { max: 80, resistance: 0.5 })).toBe(80);
  });
});

describe('shouldRefresh', () => {
  it('triggers past the threshold', () => {
    expect(shouldRefresh(60, 56)).toBe(true);
    expect(shouldRefresh(40, 56)).toBe(false);
  });
});
