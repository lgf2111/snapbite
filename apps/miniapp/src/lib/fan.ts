import type { CaptureAction } from '../components/CaptureMenu.js';

/**
 * Press-and-slide on the camera button: geometry and timing for the fan.
 *
 * The fan is a half-ring opening upward from the button, split into four
 * wedges. Which wedge the finger is in is decided by its ANGLE from the
 * button's centre, never by hit-testing the drawn shapes, so a finger resting
 * on a boundary still resolves to exactly one wedge and nothing between the
 * wedges can eat the touch.
 */

/** Left to right across the fan. Mirrors the cards' order; Take photo is where the thumb rests. */
export const FAN_ACTIONS: readonly CaptureAction[] = ['saved', 'upload', 'manual', 'photo'];

export const FAN = {
  /** Press-and-hold time before the fan opens. */
  holdMs: 180,
  /** Movement before the hold completes that turns it into a scroll/drag, not a hold. */
  slopPx: 10,
  /** Within this of the button's centre, releasing cancels. */
  deadPx: 24,
  /** Half-ring radii. The inner hollow holds the label. */
  innerPx: 80,
  outerPx: 148,
  /** Clear space between the lowest ink of the arc and the tab bar's top edge. */
  barGapPx: 8,
  /** Clear space between the arc and the top / sides of the screen. */
  edgePx: 12,
  /** Below this the wedges are too small to hit, so it overflows rather than shrinks further. */
  minOuterPx: 96,
  /** Below the horizon, a finger within this many degrees of it still picks the nearer end wedge. */
  belowHorizonDeg: 30,
} as const;

const WEDGE_DEG = 180 / FAN_ACTIONS.length;

/**
 * The wedge under a finger at (dx, dy) from the button's centre (screen
 * coordinates, y down), or null in the dead zone / when pointing steeply down.
 * Boundaries belong to the wedge on their right, so there is always one answer.
 */
export function wedgeAt(dx: number, dy: number): number | null {
  if (Math.hypot(dx, dy) < FAN.deadPx) return null;
  // 0deg = right, 90deg = up, 180deg = left.
  const theta = (Math.atan2(-dy, dx) * 180) / Math.PI;
  if (theta < 0) {
    // Thumbs drift a little below the horizon at the far ends; sliding straight
    // down is a cancel.
    if (theta < -FAN.belowHorizonDeg && theta > -(180 - FAN.belowHorizonDeg)) return null;
    return dx >= 0 ? FAN_ACTIONS.length - 1 : 0;
  }
  return Math.min(FAN_ACTIONS.length - 1, Math.floor((180 - theta) / WEDGE_DEG));
}

/** The half-ring's radii for one opening of the fan. */
export interface FanRadii {
  inner: number;
  outer: number;
}

export const FULL_RADII: FanRadii = { inner: FAN.innerPx, outer: FAN.outerPx };

/**
 * The radii that fit: the full size, or smaller when the room above the baseline
 * or to either side is less than that. Both radii scale together so the wedges
 * keep their proportions.
 */
export function fanRadii(roomAbovePx: number, roomSidePx: number): FanRadii {
  const outer = Math.max(FAN.minOuterPx, Math.min(FAN.outerPx, roomAbovePx, roomSidePx));
  return { outer, inner: Math.round((FAN.innerPx * outer) / FAN.outerPx) };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** SVG path of wedge `i`, in a box where the fan's baseline centre is (outer, outer). */
export function wedgePath(i: number, radii: FanRadii = FULL_RADII): string {
  const { inner: r, outer: R } = radii;
  const a0 = 180 - i * WEDGE_DEG; // left edge of the wedge
  const a1 = a0 - WEDGE_DEG; // right edge
  const at = (radius: number, deg: number) =>
    `${(R + radius * Math.cos(rad(deg))).toFixed(2)} ${(R - radius * Math.sin(rad(deg))).toFixed(2)}`;
  return `M ${at(R, a0)} A ${R} ${R} 0 0 1 ${at(R, a1)} L ${at(r, a1)} A ${r} ${r} 0 0 0 ${at(r, a0)} Z`;
}

/** Where a wedge's icon sits (box coordinates), at the middle of its ring. */
export function wedgeCentre(i: number, radii: FanRadii = FULL_RADII): { x: number; y: number } {
  const mid = 180 - (i + 0.5) * WEDGE_DEG;
  const radius = (radii.inner + radii.outer) / 2;
  return {
    x: radii.outer + radius * Math.cos(rad(mid)),
    y: radii.outer - radius * Math.sin(rad(mid)),
  };
}
