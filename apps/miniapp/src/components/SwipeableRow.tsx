import { Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useSwipeable } from 'react-swipeable';
import { cn } from '@/lib/utils';

interface SwipeableRowProps {
  children: ReactNode;
  onDelete: () => void;
}

const REVEAL = 88;

/**
 * A row that reveals a Delete action when swiped left. Uses react-swipeable,
 * which tracks both touch (mobile) and mouse (desktop) via `trackMouse`, so it
 * works on phone and Mac. Tapping Delete fires `onDelete`.
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
    <div className="relative overflow-hidden rounded-xl">
      <button
        type="button"
        aria-label="Delete"
        onClick={() => {
          onDelete();
          setOpen(false);
        }}
        className="bg-destructive text-destructive-foreground absolute inset-y-0 right-0 flex w-22 items-center justify-center gap-1 text-sm font-medium"
        style={{ width: REVEAL }}
      >
        <Trash2 className="size-4" />
      </button>
      <div
        {...handlers}
        className={cn('bg-background relative transition-transform')}
        style={{ transform: `translateX(${open ? -REVEAL : 0}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
