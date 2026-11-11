import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { type ReactNode, useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';

/** Marks the history entry this layer pushed, so a real Back is told apart from our own. */
const MARK = 'sbSetup';

/**
 * Layers currently mounted. React's dev-mode StrictMode mounts, unmounts and
 * remounts every effect; without this, that unmount's `history.back()` (which
 * resolves a tick later, relative to the entry it was called on) would land on
 * the page before ours and read as a Back press, dismissing setup the moment it
 * opened.
 */
let mounted = 0;

interface Props {
  /** Escape, or Back on the phone. Same meaning the old dialog's dismissal had. */
  onDismiss: () => void;
  children: ReactNode;
}

/**
 * First-run setup as a full-screen layer, not a card over Home.
 *
 * A Dialog is a window: it has corners, margins and a backdrop that lets the
 * app behind it show. Setup should be the whole screen, so this is a plain
 * `fixed inset-0` surface. What a Dialog gave for free is rebuilt here:
 *
 *  - focus moves into the layer, Tab wraps inside it, and on exit focus goes
 *    back to whatever opened it (the caller makes Home `inert` meanwhile);
 *  - Escape dismisses;
 *  - Back dismisses: the layer owns one history entry while it is open, and a
 *    traversal away from it counts as a dismissal;
 *  - the page behind cannot scroll.
 */
export function SetupLayer({ onDismiss, children }: Props) {
  // The setup form has text fields; its panels size themselves from the inset.
  useKeyboardInset();
  const ref = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  // Focus in, focus back out.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus?.({ preventScroll: true });
    };
  }, []);

  // Freeze the page behind.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Back button / swipe-back / hardware back.
  useEffect(() => {
    mounted += 1;
    // A StrictMode remount finds the entry its first mount pushed: reuse it.
    if (!window.history.state?.[MARK]) window.history.pushState({ [MARK]: true }, '');
    const onPop = () => {
      // Our entry is still current (e.g. the traversal landed on a sibling
      // entry we pushed): not a dismissal.
      if (window.history.state?.[MARK]) return;
      dismiss.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      mounted -= 1;
      // Closed by a button, not by Back: take our entry off the stack so the
      // next Back leaves the app screen instead of re-visiting setup. Decided a
      // microtask later so a StrictMode remount can claim the entry first.
      queueMicrotask(() => {
        if (mounted === 0 && window.history.state?.[MARK]) window.history.back();
      });
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      dismiss.current();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => !el.hasAttribute('disabled') && !el.closest('[inert]'),
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={ref}
      // biome-ignore lint/a11y/useSemanticElements: a native <dialog> brings a ::backdrop and top-layer rules; this is a plain full-screen layer that manages its own focus and Back
      role="dialog"
      aria-modal="true"
      aria-label="Set up SnapBite"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // The screen inside owns scrolling, snapping and safe-area padding.
      className="fixed inset-0 z-50 overflow-hidden bg-background outline-none"
    >
      {children}
    </div>
  );
}
