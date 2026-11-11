import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Where toasts sit, in one place.
 *
 * Bottom: clear of the tab bar (`--spacing-bar`) and the home-indicator inset,
 * plus a little air, so a toast is never on top of the bar or inside the curved
 * bottom corners. Sides: at least 16px, or the side safe-area inset when that
 * is larger (landscape). Sonner's `offset` covers wider screens and
 * `mobileOffset` covers <=600px; both get the same value.
 */
export const TOAST_OFFSET = {
  bottom: 'calc(var(--spacing-bar) + env(safe-area-inset-bottom, 0px) + 12px)',
  left: 'max(16px, env(safe-area-inset-left, 0px))',
  right: 'max(16px, env(safe-area-inset-right, 0px))',
} as const;

/** App toaster. Uses the dark theme to match the Telegram-style dark palette. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      offset={TOAST_OFFSET}
      mobileOffset={TOAST_OFFSET}
      toastOptions={{
        style: {
          background: 'var(--card)',
          color: 'var(--foreground)',
          border: '1px solid var(--border)',
          // A long message wraps instead of spanning edge to edge.
          maxWidth: '24rem',
          marginInline: 'auto',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
