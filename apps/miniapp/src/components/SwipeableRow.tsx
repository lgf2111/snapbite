import { Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
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

/**
 * A row that reveals a Delete action when swiped left. Uses react-swipeable,
 * which tracks both touch (mobile) and mouse (desktop) via `trackMouse`, so it
 * works on phone and Mac. Tapping Delete fires `onDelete`.
 *
 * The delete button is a rounded, outlined pill that sits behind the card and
 * extends slightly under it (OVERLAP), so when the card slides left the two
 * shapes tuck together cleanly instead of showing a rounded-corner notch.
 */
export function SwipeableRow({ children, onDelete }: SwipeableRowProps) {
  const [open, setOpen] = useState(false);

  const handlers = useSwipeable({
    onSwipedLeft: () => setOpen(true),
    onSwipedRight: () => setOpen(false),
    trackMouse: true,
    preventScrollOnSwipe: false,
    delta: 40,
  });

  return (
    <div className="relative">
      {/* Delete action behind the card. Overlaps under the card's right edge so
          no rounded gap shows; rounded + outlined to match the card. */}
      <button
        type="button"
        aria-label="Delete"
        onClick={() => {
          onDelete();
          setOpen(false);
        }}
        className={cn(
          'bg-destructive text-destructive-foreground border-destructive/60 absolute inset-y-0 right-0 flex items-center rounded-xl border shadow-sm transition-opacity',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={{ width: REVEAL + OVERLAP }}
      >
        {/* Center the icon within the visible (REVEAL) strip, not the full
            width — the extra OVERLAP is hidden under the card. */}
        <span className="flex items-center justify-center" style={{ width: REVEAL }}>
          <Trash2 className="size-5" />
        </span>
      </button>
      <div
        {...handlers}
        className="bg-background relative rounded-xl transition-transform"
        style={{ transform: `translateX(${open ? -REVEAL : 0}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
