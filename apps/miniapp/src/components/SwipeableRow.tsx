import { type ReactNode, useRef, useState } from 'react';
import { revealOffset, shouldReveal } from '../lib/gesture.js';

interface SwipeableRowProps {
  children: ReactNode;
  /** Called when the revealed Delete action is tapped. */
  onDelete: () => void;
}

const MAX_REVEAL = 88;

/**
 * A row that reveals a Delete action when swiped left (touch). The row content
 * slides to expose the action; tapping Delete fires `onDelete`. Falls back
 * gracefully with a pointer/mouse too. Pure-gesture math lives in gesture.ts.
 */
export function SwipeableRow({ children, onDelete }: SwipeableRowProps) {
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const startX = useRef<number | null>(null);
  const dragging = useRef(false);

  function onStart(x: number) {
    startX.current = x;
    dragging.current = true;
  }
  function onMove(x: number) {
    if (!dragging.current || startX.current === null) return;
    const base = open ? -MAX_REVEAL : 0;
    setOffset(revealOffset(base + (x - startX.current), MAX_REVEAL));
  }
  function onEnd() {
    if (!dragging.current) return;
    dragging.current = false;
    startX.current = null;
    const willOpen = shouldReveal(offset, MAX_REVEAL);
    setOpen(willOpen);
    setOffset(willOpen ? -MAX_REVEAL : 0);
  }

  return (
    <div className="swipe-row">
      <button
        type="button"
        className="swipe-delete"
        aria-label="Delete"
        onClick={() => {
          onDelete();
          setOpen(false);
          setOffset(0);
        }}
      >
        Delete
      </button>
      <div
        className="swipe-content"
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={(e) => onStart(e.touches[0]?.clientX ?? 0)}
        onTouchMove={(e) => onMove(e.touches[0]?.clientX ?? 0)}
        onTouchEnd={onEnd}
      >
        {children}
      </div>
    </div>
  );
}
