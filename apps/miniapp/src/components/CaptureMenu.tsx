import { cn } from '@/lib/utils';
import { Camera, ImageIcon, Keyboard, type LucideIcon, Star } from 'lucide-react';
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type CaptureAction = 'saved' | 'manual' | 'upload' | 'photo';

/** Titles, hints and icons for the four actions; the menu and the fan both draw from this. */
export const CAPTURE_ACTIONS: Record<
  CaptureAction,
  { title: string; hint: string; Icon: LucideIcon }
> = {
  saved: { title: 'Use saved meals', hint: 'Re-log a favourite', Icon: Star },
  manual: { title: 'Manually log', hint: 'Type it in', Icon: Keyboard },
  upload: { title: 'Upload image', hint: 'From your photos', Icon: ImageIcon },
  photo: { title: 'Take photo', hint: 'Use the camera', Icon: Camera },
};

/** Reading order is DOM order: top-left, top-right, bottom-left, bottom-right. */
const CARDS = (['saved', 'manual', 'upload', 'photo'] as const).map((id) => ({
  id,
  ...CAPTURE_ACTIONS[id],
}));

const OPEN_MS = 220;
const OPEN_STAGGER_MS = 25;
const CLOSE_MS = 180;
const CLOSE_STAGGER_MS = 20;
/** The unmount waits for the slowest card to finish. */
const UNMOUNT_MS = CLOSE_MS + CLOSE_STAGGER_MS * (CARDS.length - 1) + 40;

/** Marks the history entry the open menu owns, so Back closes it instead of leaving the page. */
const MARK = 'sbMenu';
/** Open menus right now; lets a StrictMode remount reuse the entry (see SetupLayer). */
let mounted = 0;

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const nextFrame = (fn: () => void) =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(fn)
    : window.setTimeout(fn, 16);
const cancelFrame = (id: number) =>
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : window.clearTimeout(id);

interface Props {
  open: boolean;
  /** Dismissed without choosing: scrim, Escape, Back. */
  onClose: () => void;
  onPick: (action: CaptureAction) => void;
  /** The camera button: the origin the cards grow from, and where focus returns. */
  triggerRef: RefObject<HTMLElement | null>;
}

/**
 * The add-a-meal menu: four cards in a 2x2 cluster that grow out of the camera
 * button instead of listing options in a sheet.
 *
 * Open: cards start at the button's centre (scale .6, transparent) and spring
 * to their cells, staggered in reading order. Close runs the same thing
 * backwards before unmounting. Under reduced motion there is no travel, stagger
 * or fade: it simply appears and disappears.
 */
export function CaptureMenu({ open, onClose, onPick, triggerRef }: Props) {
  const [present, setPresent] = useState(open);
  const [shown, setShown] = useState(false);
  const [origins, setOrigins] = useState<Array<{ x: number; y: number }>>([]);
  const cells = useRef<Array<HTMLDivElement | null>>([]);
  const cards = useRef<Array<HTMLButtonElement | null>>([]);
  const reduced = useRef(false);
  const group = useRef<HTMLDivElement | null>(null);
  /** A card was chosen, so something else (a picker, a dialog) takes focus. */
  const picked = useRef(false);

  const dismiss = () => {
    onClose();
    triggerRef.current?.focus({ preventScroll: true });
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  // Mount, then (a frame later, so the start pose is painted) animate in; or
  // animate out, then unmount.
  useEffect(() => {
    reduced.current = reducedMotion();
    if (open) {
      setPresent(true);
      if (reduced.current) {
        setShown(true);
        return;
      }
      const id = nextFrame(() => nextFrame(() => setShown(true)));
      return () => cancelFrame(id);
    }
    setShown(false);
    // Closed from outside (the router's Back handler can win the race against
    // ours): give focus back, but only if it was in the menu and nothing else
    // has claimed it.
    const active = document.activeElement;
    if (!picked.current && (active === document.body || group.current?.contains(active))) {
      triggerRef.current?.focus({ preventScroll: true });
    }
    picked.current = false;
    if (reduced.current) {
      setPresent(false);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), UNMOUNT_MS);
    return () => window.clearTimeout(timer);
  }, [open, triggerRef]);

  // Where each card must start from: the button's centre. Measured on the
  // untransformed grid cells, so reopening measures the same as the first time.
  useLayoutEffect(() => {
    if (!present) return;
    const t = triggerRef.current?.getBoundingClientRect();
    if (!t) return;
    const cx = t.left + t.width / 2;
    const cy = t.top + t.height / 2;
    setOrigins(
      CARDS.map((_, i) => {
        const r = cells.current[i]?.getBoundingClientRect();
        return r
          ? { x: cx - (r.left + r.width / 2), y: cy - (r.top + r.height / 2) }
          : { x: 0, y: 0 };
      }),
    );
  }, [present, triggerRef]);

  // Focus into the first card on open.
  useEffect(() => {
    if (open && present) cards.current[0]?.focus({ preventScroll: true });
  }, [open, present]);

  // Back closes the menu instead of leaving the page.
  useEffect(() => {
    if (!open) return;
    mounted += 1;
    if (!window.history.state?.[MARK]) window.history.pushState({ [MARK]: true }, '');
    const onPop = () => {
      if (window.history.state?.[MARK]) return;
      dismissRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      mounted -= 1;
      // Closed some other way: take our entry off so the next Back is a real one.
      queueMicrotask(() => {
        if (mounted === 0 && window.history.state?.[MARK]) window.history.back();
      });
    };
  }, [open]);

  // Escape, wherever focus is.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!present) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const first = cards.current[0];
    const last = cards.current[CARDS.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const instant = reduced.current;

  return (
    <>
      {/* Dims Home, under the tab bar so the camera button stays in view. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close add-meal menu"
        data-testid="capture-scrim"
        onClick={dismiss}
        className={cn(
          'fixed inset-0 z-30 cursor-default bg-black/50',
          instant ? '' : 'transition-opacity duration-200',
          shown ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      {/*
        Above the tab bar, its safe-area inset and the button's overhang
        (`--scroll-reserve`); held below the status bar / Dynamic Island by `top`. Taps in
        the gaps fall through to the scrim.
      */}
      <div
        className="pointer-events-none fixed inset-x-0 z-[35] flex flex-col justify-end overflow-y-auto"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          bottom: 'var(--scroll-reserve)',
        }}
      >
        <div
          ref={group}
          // biome-ignore lint/a11y/useSemanticElements: a plain group of buttons, not a fieldset
          role="group"
          aria-label="Add a meal, 4 options"
          data-testid="capture-menu"
          onKeyDown={onKeyDown}
          className="mx-auto grid w-full max-w-md grid-cols-2 gap-3 px-4"
        >
          {CARDS.map(({ id, title, hint, Icon }, i) => {
            const o = origins[i] ?? { x: 0, y: 0 };
            return (
              <div
                key={id}
                ref={(el) => {
                  cells.current[i] = el;
                }}
              >
                <button
                  type="button"
                  ref={(el) => {
                    cards.current[i] = el;
                  }}
                  onClick={() => {
                    picked.current = true;
                    onPick(id);
                  }}
                  className="flex min-h-24 w-full flex-col items-start gap-2 rounded-lg border border-border bg-card p-4 text-left text-card-foreground shadow-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  style={{
                    pointerEvents: shown ? 'auto' : 'none',
                    opacity: shown ? 1 : 0,
                    transform: shown ? 'none' : `translate(${o.x}px, ${o.y}px) scale(0.6)`,
                    transitionProperty: instant ? 'none' : 'transform, opacity',
                    transitionDuration: shown
                      ? `${OPEN_MS}ms, ${OPEN_MS - 60}ms`
                      : `${CLOSE_MS}ms, ${CLOSE_MS}ms`,
                    transitionDelay: shown
                      ? `${i * OPEN_STAGGER_MS}ms`
                      : `${(CARDS.length - 1 - i) * CLOSE_STAGGER_MS}ms`,
                    transitionTimingFunction: shown
                      ? 'var(--ease-spring), ease-out'
                      : 'cubic-bezier(0.4, 0, 1, 1), ease-in',
                  }}
                >
                  <Icon className="text-primary-text size-6" aria-hidden />
                  <span className="flex flex-col">
                    <span className="text-body font-medium leading-tight">{title}</span>
                    <span className="text-muted-foreground text-caption">{hint}</span>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
