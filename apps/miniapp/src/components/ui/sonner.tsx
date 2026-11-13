import { useRef } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * How far the toast's bottom edge sits above the bottom of the screen: past the
 * tab bar, the home-indicator inset, AND the camera button, which stands 1.25rem
 * above the bar's top edge (`-top-5` in AppShell). 2.75rem is that 1.25rem plus
 * 1.5rem of air. Measure from the button, not the bar: the first version of this
 * was bar + 12px, which put the toast on top of the button. This is the only
 * place the value is written; `toastClearance.test.tsx` checks it against the
 * button's real classes.
 */
export const TOAST_BOTTOM = 'calc(var(--spacing-bar) + 2.75rem + env(safe-area-inset-bottom, 0px))';

/**
 * Where toasts sit, in one place.
 *
 * Bottom: `TOAST_BOTTOM`. Sides: at least 16px, or the side safe-area inset when
 * that is larger (landscape). Sonner's `offset` covers wider screens and
 * `mobileOffset` covers <=600px; both get the same value.
 */
export const TOAST_OFFSET = {
  bottom: TOAST_BOTTOM,
  left: 'max(16px, env(safe-area-inset-left, 0px))',
  right: 'max(16px, env(safe-area-inset-right, 0px))',
} as const;

/** Further than this and a touch is a gesture, not a tap. */
const TAP_SLOP_PX = 8;

/**
 * App toaster.
 *
 * Dismissal is sideways. Sonner's default is a downward drag, which on an
 * iPhone starts at the bottom edge where the system's app-switcher gesture
 * lives, so the OS wins. `swipeDirections` limits sonner's own drag to left and
 * right; a vertical drag then neither moves nor dismisses the toast. A tap on
 * the toast dismisses it too, and the × is always visible (there is no hover on
 * a phone) for people who cannot swipe.
 */
function Toaster(props: ToasterProps) {
  const down = useRef<{ x: number; y: number } | null>(null);

  return (
    // Sonner renders its own fixed-position lists; this wrapper only listens.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard path is the × button
    <div
      style={{ display: 'contents' }}
      onPointerDownCapture={(e) => {
        down.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        const toastEl = target.closest('[data-sonner-toast]');
        if (!toastEl || target.closest('button, a')) return;
        const start = down.current;
        // A drag that ends over the toast also produces a click; that is not a tap.
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP_PX) return;
        toastEl.querySelector<HTMLButtonElement>('[data-close-button]')?.click();
      }}
    >
      <Sonner
        theme="dark"
        position="bottom-center"
        offset={TOAST_OFFSET}
        mobileOffset={TOAST_OFFSET}
        swipeDirections={['left', 'right']}
        closeButton
        // Sonner's own mobile rule is `left: <offset>` AND `width: 100%`, which
        // pushes the list 16px past the right edge. Size and centre the list
        // ourselves: as wide as fits between the side offsets, never wider than
        // 24rem so a long message wraps instead of spanning edge to edge.
        style={{
          left: '50%',
          right: 'auto',
          transform: 'translateX(-50%)',
          width: `min(24rem, calc(100vw - ${TOAST_OFFSET.left} - ${TOAST_OFFSET.right}))`,
        }}
        toastOptions={{
          style: {
            background: 'var(--card)',
            color: 'var(--foreground)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-surface)',
            boxShadow: 'var(--lift)',
            // Fill the list above (sonner's narrow-screen width subtracts the
            // offsets a second time).
            width: '100%',
          },
        }}
        {...props}
      />
    </div>
  );
}

export { Toaster };
