import { cn } from '@/lib/utils';
import { Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useSwipeable } from 'react-swipeable';

interface SwipeableRowProps {
  children: ReactNode;
  onDelete: () => void;
  /** When true, the row animates in (expand + fade) on mount. */
  animateIn?: boolean;
}

/** How far the row slides open to reveal the delete action. */
export const REVEAL = 76;
/** Past this share of the action it settles open; otherwise it springs back. */
const OPEN_AT = 0.4;

/** Collapse animation duration (ms) — kept in sync with the CSS transition. */
const COLLAPSE_MS = 260;

/**
 * A row that reveals a Delete action when swiped left. Uses react-swipeable,
 * which tracks both touch (mobile) and mouse (desktop) via `trackMouse`, so it
 * works on phone and Mac.
 *
 * The reveal is part of the row, not a layer behind it. The root clips all of
 * it with the card's radius, so nothing can peek above or below; the red action
 * is a full-height strip flush to the right edge, with no radius of its own on
 * the outside (the root does the rounding). The card slides over it, so at rest
 * no red is visible and at full reveal red is exactly the action's width.
 *
 * The drag follows the thumb, and on release it snaps to open or closed — a
 * short, fast flick cannot leave the row half-open. Tapping Delete animates the
 * row out (collapses height + fades) and then fires `onDelete`; Home offers an
 * undo before the removal is committed.
 */
export function SwipeableRow({ children, onDelete, animateIn = false }: SwipeableRowProps) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  /** Live drag offset in px (negative), or null when not dragging. */
  const [drag, setDrag] = useState<number | null>(null);
  // Starts true when this row should animate in; flipped off after mount so it
  // expands from collapsed → full (the reverse of the delete collapse).
  const [entering, setEntering] = useState(animateIn);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Where the row was when the current drag started. */
  const startOffset = useRef(0);

  useEffect(() => {
    if (!animateIn) return;
    const id = requestAnimationFrame(() => setEntering(false));
    return () => cancelAnimationFrame(id);
  }, [animateIn]);

  const clamped = (x: number) => Math.min(0, Math.max(-REVEAL, x));

  const handlers = useSwipeable({
    onSwipeStart: () => {
      if (removing) return;
      startOffset.current = open ? -REVEAL : 0;
    },
    onSwiping: ({ deltaX }) => {
      if (removing) return;
      setDrag(clamped(startOffset.current + deltaX));
    },
    // Fires for any direction, including a right swipe that closes an open row.
    // The position decides: past 40% it stays open, otherwise it springs shut.
    onSwiped: ({ deltaX }) => {
      if (removing) return;
      const settled = clamped(startOffset.current + deltaX);
      setOpen(settled <= -REVEAL * OPEN_AT);
      setDrag(null);
    },
    trackMouse: true,
    preventScrollOnSwipe: false,
    delta: 12,
  });

  function beginRemove() {
    if (removing) return;
    // Pin the current height so the transition to 0 is smooth (auto/content
    // heights don't animate).
    const el = rootRef.current;
    if (el) el.style.maxHeight = `${el.scrollHeight}px`;
    setOpen(false);
    setDrag(null);
    // Next frame: flip to the collapsed state so the transition runs.
    requestAnimationFrame(() => {
      setRemoving(true);
    });
    // Remove from data after the collapse finishes.
    window.setTimeout(onDelete, COLLAPSE_MS);
  }

  const offset = drag ?? (open ? -REVEAL : 0);
  const revealed = open || drag !== null;

  return (
    <div
      ref={rootRef}
      data-testid="swipe-row"
      // mb-2 provides the inter-row spacing here (the parent list has no gap),
      // so it can collapse to 0 with the row when removed — closing the gap.
      // overflow-hidden + the card radius are the reveal's only clip: nothing
      // from the action can show above or below the row.
      className={cn(
        'relative mb-2 overflow-hidden rounded-xl bg-background',
        removing && 'pointer-events-none',
      )}
      style={{
        transition: `max-height ${COLLAPSE_MS}ms ease, opacity ${COLLAPSE_MS}ms ease, margin ${COLLAPSE_MS}ms ease`,
        // Collapsed state for both removing (out) and entering (in, pre-frame).
        ...(removing || entering
          ? { maxHeight: 0, opacity: 0, marginTop: 0, marginBottom: 0 }
          : { maxHeight: 500 }),
      }}
    >
      {/*
        The action: one continuous red surface, exactly as tall as the row (inset-y-0),
        flush to the right edge (right-0), and exactly REVEAL wide. It has no radius of
        its own — the root's rounded-xl clips the right corners to match the card.
      */}
      <button
        type="button"
        data-testid="swipe-delete"
        aria-label="Delete"
        aria-hidden={!revealed || removing}
        tabIndex={revealed && !removing ? 0 : -1}
        onClick={beginRemove}
        className={cn(
          'bg-destructive text-destructive-foreground absolute inset-y-0 right-0 flex items-center justify-center transition-opacity duration-[120ms] active:bg-destructive/90 motion-reduce:transition-none',
          revealed && !removing ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={{ width: REVEAL }}
      >
        <Trash2 className="size-5" aria-hidden />
      </button>

      <div
        {...handlers}
        data-testid="swipe-card"
        className="bg-background relative rounded-xl transition-transform duration-200 ease-[var(--ease-out-quint)] motion-reduce:transition-none"
        style={{
          transform: `translateX(${removing ? '-110%' : `${offset}px`})`,
          // 1:1 with the thumb while dragging; animate only on release.
          ...(drag !== null ? { transition: 'none' } : {}),
        }}
      >
        {children}
      </div>
    </div>
  );
}
