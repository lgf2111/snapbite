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
  innerPx: 100,
  outerPx: 148,
  /** The camera button's radius (it is 4rem across). */
  buttonPx: 32,
  /** Clear space between the label band and the button, and between it and the arc. */
  labelGapPx: 8,
  /** One caption line. */
  labelHeightPx: 20,
  /** Radius the wedge icons sit at, kept where they were before the inner radius grew. */
  iconPx: 114,
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

const rad = (deg: number) => (deg * Math.PI) / 180;

/** SVG path of wedge `i`, in a box where the button's centre is (outerPx, outerPx). */
export function wedgePath(i: number): string {
  const { innerPx: r, outerPx: R } = FAN;
  const a0 = 180 - i * WEDGE_DEG; // left edge of the wedge
  const a1 = a0 - WEDGE_DEG; // right edge
  const at = (radius: number, deg: number) =>
    `${(R + radius * Math.cos(rad(deg))).toFixed(2)} ${(R - radius * Math.sin(rad(deg))).toFixed(2)}`;
  return `M ${at(R, a0)} A ${R} ${R} 0 0 1 ${at(R, a1)} L ${at(r, a1)} A ${r} ${r} 0 0 0 ${at(r, a0)} Z`;
}

/**
 * The label's box, in the same coordinates as `wedgePath`. It lives in the hollow:
 * its bottom edge is `labelGapPx` above the button's top, and its top corners are
 * `labelGapPx` inside the arc's inner edge, so it can touch neither. The width is
 * whatever that leaves at the top of the box; a longer name is truncated.
 */
export function labelBox(): { left: number; top: number; width: number; height: number } {
  const bottom = FAN.buttonPx + FAN.labelGapPx;
  const top = bottom + FAN.labelHeightPx;
  const reach = FAN.innerPx - FAN.labelGapPx;
  const half = Math.floor(Math.sqrt(reach * reach - top * top));
  return {
    left: FAN.outerPx - half,
    top: FAN.outerPx - top,
    width: half * 2,
    height: FAN.labelHeightPx,
  };
}

/** Where a wedge's icon sits (box coordinates), at the middle of its ring. */
export function wedgeCentre(i: number): { x: number; y: number } {
  const mid = 180 - (i + 0.5) * WEDGE_DEG;
  const radius = FAN.iconPx;
  return {
    x: FAN.outerPx + radius * Math.cos(rad(mid)),
    y: FAN.outerPx - radius * Math.sin(rad(mid)),
  };
}
