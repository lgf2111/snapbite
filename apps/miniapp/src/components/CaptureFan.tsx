import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  FAN,
  FAN_ACTIONS,
  type FanRadii,
  fanRadii,
  wedgeAt,
  wedgeCentre,
  wedgePath,
} from '../lib/fan.js';
import { hapticImpact } from '../lib/telegram.js';
import { CAPTURE_ACTIONS, type CaptureAction } from './CaptureMenu.js';

/** The notch / status-bar inset, which CSS knows and layout code has to ask for. */
function safeAreaTop(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top,0px)';
  document.body.append(probe);
  const px = Number.parseFloat(getComputedStyle(probe).paddingTop);
  probe.remove();
  return Number.isFinite(px) ? px : 0;
}

/**
 * Where the fan opens for this button, and how big it can be.
 *
 * The baseline is NOT the button's centre: the button overhangs the bar by 20px,
 * so its centre is 12px below the bar's top edge and a half-ring standing on it
 * is half under the bar. The baseline is `barGapPx` above the bar's top edge
 * (the nav element, safe-area padding included), and the radius shrinks to what
 * fits between there and the top of the screen, and the sides.
 */
function placeFan(button: HTMLElement): { cx: number; cy: number; radii: FanRadii } {
  const r = button.getBoundingClientRect();
  const bar = button.closest('nav')?.getBoundingClientRect();
  // The button stands 20px (-top-5) above the bar if the bar cannot be measured.
  const barTop = bar && bar.height > 0 ? bar.top : r.top + 20;
  const cx = r.left + r.width / 2;
  // One more px for half the stroke, so the lowest ink clears the gap too.
  const cy = barTop - FAN.barGapPx - 1;
  const roomAbove = cy - safeAreaTop() - FAN.edgePx;
  const roomSide = Math.min(cx, window.innerWidth - cx) - FAN.edgePx;
  return { cx, cy, radii: fanRadii(roomAbove, roomSide) };
}

/** A light tick where the platform has one (Telegram's haptics, Android's vibrate). */
function tick(): void {
  hapticImpact('light');
  try {
    navigator.vibrate?.(8);
  } catch {
    // no vibration motor, or not allowed
  }
}

interface Props {
  /** The camera button the gesture is attached to. */
  triggerRef: RefObject<HTMLElement | null>;
  /** False while something else (the card menu) owns the button. */
  enabled: boolean;
  onPick: (action: CaptureAction) => void;
}

/**
 * How long a touch release waits for its `touchend`. The event follows
 * `pointerup` immediately on every browser that sends both; this is only a
 * safety net so a missing one cannot leave the fan on screen.
 */
const TOUCH_END_GRACE_MS = 500;

/**
 * Press and hold the camera button, slide to a wedge, release to run it.
 *
 * The listeners are native pointer listeners on the button, plus one window
 * `touchend` listener for the length of each touch gesture, and the highlight
 * is written straight to the DOM from the pointer-move handler, so sliding a
 * thumb around causes no React render. React renders twice per gesture: when
 * the fan opens and when it closes.
 *
 * A touch release runs its action from `touchend`, not `pointerup`: iOS only
 * opens a file picker from a touch event, even though `pointerup` arrives
 * first. Mouse and pen releases stay on `pointerup`. One flag per gesture
 * makes sure the action runs once, whichever path gets there.
 *
 * The choice is latched as soon as the finger leaves the button, and only then:
 * a release back over the button still runs the highlighted wedge, while a
 * hold and release without a slide stays in the dead zone and does nothing.
 *
 * It is a shortcut, never the only route: the tap-for-cards menu does the same
 * four things with labels.
 */
export function CaptureFan({ triggerRef, enabled, onPick }: Props) {
  const [origin, setOrigin] = useState<{ cx: number; cy: number; radii: FanRadii } | null>(null);
  const paths = useRef<Array<SVGPathElement | null>>([]);
  const icons = useRef<Array<HTMLElement | null>>([]);
  const label = useRef<HTMLElement | null>(null);
  /** The highlighted wedge. Lives in a ref: it changes with every pointer move. */
  const current = useRef<number | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  /** Paint the highlight onto the elements. No React involved. */
  const paint = useRef(() => {});
  paint.current = () => {
    const idx = current.current;
    FAN_ACTIONS.forEach((_, i) => {
      const on = String(i === idx);
      const path = paths.current[i];
      if (path) {
        path.dataset.active = on;
        // The chosen wedge is the biggest thing in the fan: primary fill plus a
        // 4px outline, against 1.5px for the rest. Colour alone is too quiet
        // under a thumb.
        path.setAttribute('stroke-width', i === idx ? '4' : '1.5');
      }
      if (icons.current[i]) (icons.current[i] as HTMLElement).dataset.active = on;
    });
    const el = label.current;
    if (el) {
      el.textContent =
        idx == null ? 'Slide to choose' : CAPTURE_ACTIONS[FAN_ACTIONS[idx] as CaptureAction].title;
      el.dataset.active = String(idx != null);
    }
  };

  // The elements appear with the fan; apply whatever was chosen before they did.
  useLayoutEffect(() => {
    if (origin) paint.current();
  }, [origin]);

  useEffect(() => {
    const button = triggerRef.current;
    if (!button || !enabled) return;

    let start: { x: number; y: number } | null = null;
    let bounds = { left: 0, top: 0, right: 0, bottom: 0 };
    let centre = { x: 0, y: 0 };
    let held = false;
    /**
     * The finger has left the button, so the wedge is chosen and stays chosen
     * even if the finger drifts back over the button. This is what makes a
     * release inside the button run the highlighted action instead of cancel.
     */
    let latched = false;
    let timer = 0;
    /**
     * A touch release waits for `touchend`: iOS opens a picker from a touch
     * event, not from `pointerup`, even though `pointerup` arrives first.
     */
    let awaitTouchEnd = false;
    let touchTimer = 0;
    /** One action per gesture, whichever release path runs it. */
    let picked = false;
    /** The click that follows a hold or a drag must not also toggle the card menu. */
    let swallowClick = false;

    const closeFan = () => {
      window.clearTimeout(timer);
      window.clearTimeout(touchTimer);
      // The window-level release listener lives only as long as this gesture.
      window.removeEventListener('touchend', onTouchEnd, true);
      awaitTouchEnd = false;
      start = null;
      held = false;
      latched = false;
      current.current = null;
      setOrigin(null);
    };

    /** Runs the highlighted action, at most once for this gesture. */
    const runChosen = () => {
      if (picked || !held || current.current == null) return;
      picked = true;
      pick.current(FAN_ACTIONS[current.current] as CaptureAction);
    };

    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0) return;
      const r = button.getBoundingClientRect();
      bounds = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      swallowClick = false;
      picked = false;
      awaitTouchEnd = false;
      window.clearTimeout(touchTimer);
      start = { x: e.clientX, y: e.clientY };
      held = false;
      latched = false;
      current.current = null;
      button.setPointerCapture?.(e.pointerId);
      // The release may not come back to the button: iOS can deliver it to the
      // window once the finger has slid off, whether or not pointer capture
      // survived the drag. Listen on the window for the length of the gesture,
      // in the capture phase, so the action still runs. `closeFan` removes it.
      window.addEventListener('touchend', onTouchEnd, true);
      timer = window.setTimeout(() => {
        const placed = placeFan(button);
        centre = { x: placed.cx, y: placed.cy };
        held = true;
        swallowClick = true;
        tick();
        setOrigin(placed);
      }, FAN.holdMs);
    };

    const onMove = (e: PointerEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const travel = Math.hypot(dx, dy);
      if (!held) {
        // A drag or a scroll, not a hold: forget the hold, and the tap with it.
        if (travel > FAN.slopPx) {
          window.clearTimeout(timer);
          start = null;
          swallowClick = true;
        }
        return;
      }
      // A tap that wobbles inside the button never becomes a choice.
      if (travel < FAN.travelPx) return;
      // Once the finger is out of the button it is a slide, not a tap. Latch
      // here rather than at the fan's edge: coming back to the button before
      // releasing must still run what was highlighted.
      if (
        e.clientX < bounds.left ||
        e.clientX > bounds.right ||
        e.clientY < bounds.top ||
        e.clientY > bounds.bottom
      ) {
        latched = true;
      }
      if (!latched) return;
      const idx = wedgeAt(e.clientX - centre.x, e.clientY - centre.y);
      // The centre hollow keeps the current choice: it is a dead zone, not a cancel.
      if (idx == null) return;
      if (idx !== current.current) {
        current.current = idx;
        paint.current();
        tick();
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!start) return;
      if (e.pointerType === 'touch') {
        // The picker must open from `touchend` on iOS. Keep the gesture (and
        // the highlight) alive until then; the fallback only closes a fan whose
        // touchend never arrived. It never runs the action: a timer is not the
        // user gesture a picker needs.
        awaitTouchEnd = true;
        window.clearTimeout(touchTimer);
        touchTimer = window.setTimeout(closeFan, TOUCH_END_GRACE_MS);
        return;
      }
      runChosen();
      closeFan();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!start) return;
      // Only the last finger up ends the gesture: a second finger tapping the
      // button must not fire the wedge the first one is still choosing.
      if ((e.touches?.length ?? 0) > 0) return;
      awaitTouchEnd = false;
      runChosen();
      closeFan();
    };

    const onCancel = () => {
      if (start) closeFan();
    };

    const onLostCapture = () => {
      // Releasing a touch also releases its capture, and that fires before
      // `touchend`. It is not a cancel while the touch release is pending.
      if (awaitTouchEnd || picked) return;
      onCancel();
    };

    // Backgrounding the app kills the gesture outright (iOS may not send a
    // pointercancel before the webview is frozen).
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onCancel();
    };

    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };

    // No callout / context menu from the long press.
    const onContextMenu = (e: Event) => e.preventDefault();

    button.addEventListener('pointerdown', onDown);
    button.addEventListener('pointermove', onMove);
    button.addEventListener('pointerup', onUp);
    button.addEventListener('touchend', onTouchEnd);
    button.addEventListener('pointercancel', onCancel);
    button.addEventListener('lostpointercapture', onLostCapture);
    button.addEventListener('click', onClick);
    button.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(touchTimer);
      button.removeEventListener('pointerdown', onDown);
      button.removeEventListener('pointermove', onMove);
      button.removeEventListener('pointerup', onUp);
      button.removeEventListener('touchend', onTouchEnd);
      button.removeEventListener('pointercancel', onCancel);
      button.removeEventListener('lostpointercapture', onLostCapture);
      button.removeEventListener('click', onClick);
      button.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('visibilitychange', onVisibility);
      closeFan();
    };
  }, [enabled, triggerRef]);

  if (!origin) return null;
  const { radii } = origin;
  const size = radii.outer * 2;

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-30 bg-[var(--scrim)] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
      />
      {/* Centred on the button, bottom edge on its centre: only the half above it exists.
          Above the tab bar so the wedge ends are not clipped by it. */}
      <div
        aria-hidden
        data-testid="capture-fan"
        className="pointer-events-none fixed z-[45] origin-bottom motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:duration-150"
        style={{
          left: origin.cx - radii.outer,
          top: origin.cy - radii.outer,
          width: size,
          height: radii.outer,
        }}
      >
        <svg
          aria-hidden="true"
          width={size}
          height={radii.outer}
          viewBox={`0 0 ${size} ${radii.outer}`}
          className="overflow-visible"
        >
          {FAN_ACTIONS.map((id, i) => (
            <path
              key={id}
              ref={(el) => {
                paths.current[i] = el;
              }}
              d={wedgePath(i, radii)}
              data-active="false"
              strokeWidth={1.5}
              className="fill-card stroke-border data-[active=true]:fill-primary data-[active=true]:stroke-primary"
            />
          ))}
        </svg>
        {FAN_ACTIONS.map((id, i) => {
          const { Icon } = CAPTURE_ACTIONS[id];
          const c = wedgeCentre(i, radii);
          return (
            <span
              key={id}
              ref={(el) => {
                icons.current[i] = el;
              }}
              data-active="false"
              className="text-primary-text data-[active=true]:text-primary-foreground absolute flex size-8 items-center justify-center motion-safe:transition-transform motion-safe:duration-100 data-[active=true]:scale-125"
              style={{ left: c.x - 16, top: c.y - 16 }}
            >
              <Icon className="size-6" aria-hidden />
            </span>
          );
        })}
        {/* In the hollow above the button: what releasing now would do. */}
        <span
          ref={label}
          data-active="false"
          className="text-muted-foreground data-[active=true]:text-foreground text-caption absolute w-32 text-center font-medium"
          style={{ left: radii.outer - 64, top: radii.outer - (radii.inner - 10) }}
        >
          Slide to choose
        </span>
      </div>
    </>
  );
}
