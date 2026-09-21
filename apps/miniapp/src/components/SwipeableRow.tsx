import { Trash2 } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useSwipeable } from 'react-swipeable';
import { cn } from '@/lib/utils';

interface SwipeableRowProps {
  children: ReactNode;
  onDelete: () => void;
}

/** How far the row slides open to reveal the delete action. */
const REVEAL = 76;
/**
 * The delete button extends this far under the card's right edge so the card's
 * rounded corner never leaves a visible gap over the button when open.
 */
const OVERLAP = 20;

/** Collapse animation duration (ms) — kept in sync with the CSS transition. */
const COLLAPSE_MS = 260;

/**
 * A row that reveals a Delete action when swiped left. Uses react-swipeable,
 * which tracks both touch (mobile) and mouse (desktop) via `trackMouse`, so it
 * works on phone and Mac. Tapping Delete animates the row out — it collapses
 * its own height + fades, so the rows below slide up to fill the gap — then
 * fires `onDelete` to remove it from the data.
 *
 * The delete button is a rounded, outlined pill that sits behind the card and
 * extends slightly under it (OVERLAP), so when the card slides left the two
 * shapes tuck together cleanly instead of showing a rounded-corner notch.
 */
export function SwipeableRow({ children, onDelete }: SwipeableRowProps) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const handlers = useSwipeable({
    onSwipedLeft: () => setOpen(true),
    onSwipedRight: () => setOpen(false),
    trackMouse: true,
    preventScrollOnSwipe: false,
    delta: 40,
  });

  function beginRemove() {
    if (removing) return;
    // Pin the current height so the transition to 0 is smooth (auto/content
    // heights don't animate).
    const el = rootRef.current;
    if (el) el.style.maxHeight = `${el.scrollHeight}px`;
    setOpen(false);
    // Next frame: flip to the collapsed state so the transition runs.
    requestAnimationFrame(() => {
      setRemoving(true);
    });
    // Remove from data after the collapse finishes.
    window.setTimeout(onDelete, COLLAPSE_MS);
  }

  return (
    <div
      ref={rootRef}
      // mb-2 provides the inter-row spacing here (the parent list has no gap),
      // so it can collapse to 0 with the row when removed — closing the gap.
      className={cn('relative mb-2 overflow-hidden', removing && 'pointer-events-none')}
      style={{
        transition: `max-height ${COLLAPSE_MS}ms ease, opacity ${COLLAPSE_MS}ms ease, margin ${COLLAPSE_MS}ms ease`,
        ...(removing ? { maxHeight: 0, opacity: 0, marginTop: 0, marginBottom: 0 } : {}),
      }}
    >
      {/* Delete action behind the card. Overlaps under the card's right edge so
          no rounded gap shows; rounded + outlined to match the card. */}
      <button
        type="button"
        aria-label="Delete"
        onClick={beginRemove}
        className={cn(
          'bg-destructive text-destructive-foreground border-destructive/60 absolute inset-y-0 right-0 flex items-center justify-end rounded-xl border shadow-sm transition-opacity',
          open && !removing ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={{ width: REVEAL + OVERLAP }}
      >
        {/* The button is anchored right and its left OVERLAP px hide under the
            card. Center the icon within the visible (rightmost REVEAL) strip. */}
        <span className="flex items-center justify-center" style={{ width: REVEAL }}>
          <Trash2 className="size-5" />
        </span>
      </button>
      <div
        {...handlers}
        className="bg-background relative rounded-xl transition-transform"
        style={{
          transform: `translateX(${removing ? '-110%' : open ? `-${REVEAL}px` : '0'})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
