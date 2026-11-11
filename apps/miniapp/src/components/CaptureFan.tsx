import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FAN, FAN_ACTIONS, wedgeAt, wedgeCentre, wedgePath } from '../lib/fan.js';
import { hapticImpact } from '../lib/telegram.js';
import { CAPTURE_ACTIONS, type CaptureAction } from './CaptureMenu.js';

const SIZE = FAN.outerPx * 2;

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
 * Press and hold the camera button, slide to a wedge, release to run it.
 *
 * The listeners are native pointer listeners on the button, and the highlight
 * is written straight to the DOM from the pointer-move handler, so sliding a
 * thumb around causes no React render. React renders twice per gesture: when
 * the fan opens and when it closes.
 *
 * It is a shortcut, never the only route: the tap-for-cards menu does the same
 * four things with labels.
 */
export function CaptureFan({ triggerRef, enabled, onPick }: Props) {
  const [origin, setOrigin] = useState<{ cx: number; cy: number } | null>(null);
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
      if (paths.current[i]) (paths.current[i] as SVGPathElement).dataset.active = on;
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
    let centre = { x: 0, y: 0 };
    let held = false;
    let timer = 0;
    /** The click that follows a hold or a drag must not also toggle the card menu. */
    let swallowClick = false;

    const closeFan = () => {
      window.clearTimeout(timer);
      start = null;
      held = false;
      current.current = null;
      setOrigin(null);
    };

    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0) return;
      swallowClick = false;
      start = { x: e.clientX, y: e.clientY };
      held = false;
      current.current = null;
      button.setPointerCapture?.(e.pointerId);
      timer = window.setTimeout(() => {
        const r = button.getBoundingClientRect();
        centre = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        held = true;
        swallowClick = true;
        tick();
        setOrigin({ cx: centre.x, cy: centre.y });
      }, FAN.holdMs);
    };

    const onMove = (e: PointerEvent) => {
      if (!start) return;
      if (!held) {
        // A drag or a scroll, not a hold: forget the hold, and the tap with it.
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > FAN.slopPx) {
          window.clearTimeout(timer);
          start = null;
          swallowClick = true;
        }
        return;
      }
      const idx = wedgeAt(e.clientX - centre.x, e.clientY - centre.y);
      if (idx !== current.current) {
        current.current = idx;
        paint.current();
        if (idx != null) tick();
      }
    };

    const onUp = () => {
      if (!start) return;
      const chosen = held ? current.current : null;
      const wasHeld = held;
      closeFan();
      // Released over a wedge: run it now, inside this event, so a file picker
      // is still opened from a user gesture.
      if (wasHeld && chosen != null) pick.current(FAN_ACTIONS[chosen] as CaptureAction);
    };

    const onCancel = () => {
      if (start) closeFan();
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
    button.addEventListener('pointercancel', onCancel);
    button.addEventListener('lostpointercapture', onCancel);
    button.addEventListener('click', onClick);
    button.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.clearTimeout(timer);
      button.removeEventListener('pointerdown', onDown);
      button.removeEventListener('pointermove', onMove);
      button.removeEventListener('pointerup', onUp);
      button.removeEventListener('pointercancel', onCancel);
      button.removeEventListener('lostpointercapture', onCancel);
      button.removeEventListener('click', onClick);
      button.removeEventListener('contextmenu', onContextMenu);
      closeFan();
    };
  }, [enabled, triggerRef]);

  if (!origin) return null;

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-30 bg-black/40 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
      />
      {/* Centred on the button, bottom edge on its centre: only the half above it exists.
          Above the tab bar so the wedge ends are not clipped by it. */}
      <div
        aria-hidden
        data-testid="capture-fan"
        className="pointer-events-none fixed z-[45] origin-bottom motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:duration-150"
        style={{
          left: origin.cx - FAN.outerPx,
          top: origin.cy - FAN.outerPx,
          width: SIZE,
          height: FAN.outerPx,
        }}
      >
        <svg
          aria-hidden="true"
          width={SIZE}
          height={FAN.outerPx}
          viewBox={`0 0 ${SIZE} ${FAN.outerPx}`}
          className="overflow-visible"
        >
          {FAN_ACTIONS.map((id, i) => (
            <path
              key={id}
              ref={(el) => {
                paths.current[i] = el;
              }}
              d={wedgePath(i)}
              data-active="false"
              strokeWidth={1.5}
              className="fill-card stroke-border data-[active=true]:fill-primary data-[active=true]:stroke-primary"
            />
          ))}
        </svg>
        {FAN_ACTIONS.map((id, i) => {
          const { Icon } = CAPTURE_ACTIONS[id];
          const c = wedgeCentre(i);
          return (
            <span
              key={id}
              ref={(el) => {
                icons.current[i] = el;
              }}
              data-active="false"
              className="text-primary-text data-[active=true]:text-primary-foreground absolute flex size-8 items-center justify-center"
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
          style={{ left: FAN.outerPx - 64, top: FAN.outerPx - 70 }}
        >
          Slide to choose
        </span>
      </div>
    </>
  );
}
