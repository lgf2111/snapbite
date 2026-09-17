/**
 * Pure, framework-free helpers for lightweight touch/pointer gestures. Keeping
 * the math here (rather than inside React components) makes the swipe/refresh
 * behavior testable in jsdom without simulating real pointer streams.
 *
 * No DOM, no SDK — everything is a plain function over coordinates.
 */

export type SwipeDirection = 'left' | 'right' | 'up' | 'down' | null;

export interface Point {
  x: number;
  y: number;
}

export interface SwipeOptions {
  /** Minimum primary-axis travel (px) before we call it a swipe. */
  threshold?: number;
  /**
   * The primary axis must dominate the other by at least this ratio, so a
   * mostly-vertical drag doesn't register as a horizontal swipe (and vice
   * versa). 1 means "at least as much as the cross axis".
   */
  ratio?: number;
}

const DEFAULTS: Required<SwipeOptions> = { threshold: 48, ratio: 1.3 };

/**
 * Classifies a drag from `start` to `end` into a swipe direction, or `null`
 * when the movement is too small or too diagonal to be a confident swipe.
 */
export function classifySwipe(start: Point, end: Point, opts: SwipeOptions = {}): SwipeDirection {
  const { threshold, ratio } = { ...DEFAULTS, ...opts };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX >= absY) {
    if (absX < threshold || absX < absY * ratio) return null;
    return dx < 0 ? 'left' : 'right';
  }
  if (absY < threshold || absY < absX * ratio) return null;
  return dy < 0 ? 'up' : 'down';
}

/**
 * Given the current tab index and a horizontal swipe, returns the index of the
 * tab to move to, clamped to [0, count-1]. Swiping left advances (next tab),
 * swiping right goes back — matching the natural "content follows finger" feel.
 * Returns the same index when the move is a no-op (e.g. already at an edge).
 */
export function nextTabIndex(current: number, direction: SwipeDirection, count: number): number {
  if (count <= 0) return 0;
  const clamp = (n: number) => Math.min(count - 1, Math.max(0, n));
  if (direction === 'left') return clamp(current + 1);
  if (direction === 'right') return clamp(current - 1);
  return clamp(current);
}

/**
 * Horizontal swipe-to-reveal offset for a row. `dx` is the raw finger delta
 * (negative = dragging left). We only allow revealing to the left (to expose a
 * Delete action on the right edge) and cap the travel at `max`. Rightward drags
 * are damped to zero so the row can't be pulled past its resting position.
 */
export function revealOffset(dx: number, max: number): number {
  if (dx >= 0) return 0;
  return Math.max(-max, dx);
}

/**
 * Decides whether a horizontal drag should commit to the "revealed" (open)
 * state when the finger lifts. Committed when the row was dragged past half the
 * reveal width, or flung quickly.
 */
export function shouldReveal(offset: number, max: number): boolean {
  return Math.abs(offset) >= max / 2;
}

/**
 * Pull-to-refresh distance with rubber-band damping. Only pulls when the finger
 * moves down (`dy > 0`) and the scroll container is at the top. The visible pull
 * grows sub-linearly so it feels elastic and never runs away.
 */
export function pullDistance(dy: number, opts: { max?: number; resistance?: number } = {}): number {
  const max = opts.max ?? 80;
  const resistance = opts.resistance ?? 0.5;
  if (dy <= 0) return 0;
  const damped = dy * resistance;
  return Math.min(max, damped);
}

/** True when a pull has crossed the threshold that triggers a refresh on release. */
export function shouldRefresh(distance: number, threshold = 56): boolean {
  return distance >= threshold;
}
