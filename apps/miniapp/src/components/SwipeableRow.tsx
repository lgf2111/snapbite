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
 * The reveal is the row's own background, not a block behind the card. The
 * root is one clipped surface with the card's radius and a full-bleed
 * destructive layer (`absolute inset-0`, no radius). The card slides over it
 * with no radius or shadow of its own, so every pixel between the card edge
 * and the trash strip is red — there is no page-coloured seam at any offset.
 * The trash strip is exactly REVEAL wide, flush right, and transparent so the
 * row background shows through it.
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
      // from the action can show above or below the row. The red is only
      // painted while the action is out, so its antialiased edge cannot tint
      // the rounded corners of a resting row.
      className={cn(
        'relative mb-2 overflow-hidden rounded-surface',
        revealed ? 'bg-destructive' : 'bg-card',
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
        The red is the row: one full-bleed layer under everything, with no
        radius of its own. The root's rounded-surface clip shapes it, so the card
        and the action always share the same outside corners. It is painted
        only while the action is out; at rest the row is card-coloured and the
        layer is invisible.
      */}
      <div
        aria-hidden
        data-testid="swipe-action-surface"
        className={cn(
          'bg-destructive pointer-events-none absolute inset-0',
          revealed ? 'opacity-100' : 'opacity-0',
          // Follow the thumb without a fade; on release, let the red fade as
          // the card slides back so the action leaves with the strip.
          drag === null
            ? 'transition-opacity duration-[120ms] motion-reduce:transition-none'
            : 'transition-none',
        )}
      />

      {/*
        The trash strip is only the part the card uncovers: exactly REVEAL
        wide, full height, flush right, and transparent so the row's red
        surface is the colour, not a separate block. No radius; the root clip
        rounds the outside corners.
      */}
      <button
        type="button"
        data-testid="swipe-delete"
        aria-label="Delete"
        aria-hidden={!revealed || removing}
        tabIndex={revealed && !removing ? 0 : -1}
        onClick={beginRemove}
        className={cn(
          'text-destructive-foreground absolute inset-y-0 right-0 flex items-center justify-center transition-opacity duration-[120ms] active:bg-destructive/90 motion-reduce:transition-none',
          revealed && !removing ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={{ width: REVEAL }}
      >
        <Trash2 className="size-5" aria-hidden />
      </button>

      <div
        {...handlers}
        data-testid="swipe-card"
        className="bg-card relative transition-transform duration-200 ease-[var(--ease-out-quint)] motion-reduce:transition-none"
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
