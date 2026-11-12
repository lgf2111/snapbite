import { useEffect, useState } from 'react';

const VAR = '--keyboard-inset';

/**
 * How much of the bottom of the LAYOUT viewport the on-screen keyboard covers.
 *
 * iOS does not shrink the layout viewport for the keyboard (so `100svh` and
 * `position: fixed; bottom: 0` still run underneath it); only the visual viewport
 * knows. The part of the layout viewport below the visual viewport is the keyboard.
 */
export function keyboardInset(vv: Pick<VisualViewport, 'height' | 'offsetTop'>): number {
  return Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
}

/*
 * One subscription shared by every sheet that asks for it: two open sheets must
 * not fight over the variable, and closing one must not clear it under the other.
 */
let users = 0;
let stop: (() => void) | null = null;
let current = 0;
let last = '';
const listeners = new Set<(inset: number) => void>();

function start(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};

  let frame = 0;
  const write = () => {
    frame = 0;
    const next = keyboardInset(vv);
    const css = `${next}px`;
    if (css !== last) {
      last = css;
      document.documentElement.style.setProperty(VAR, css);
    }
    if (next !== current) {
      current = next;
      for (const notify of listeners) notify(next);
    }
  };
  // visualViewport fires resize and scroll in bursts; one write per frame is enough.
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(write);
  };

  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  write();

  return () => {
    vv.removeEventListener('resize', schedule);
    vv.removeEventListener('scroll', schedule);
    if (frame) cancelAnimationFrame(frame);
    // A stale inset would leave the next sheet floating above nothing.
    document.documentElement.style.removeProperty(VAR);
  };
}

/**
 * Publishes the keyboard's height as `--keyboard-inset` on <html> while the
 * calling component is mounted, and returns it in pixels. Sheets size themselves
 * from the variable and lift above the keyboard from the returned value:
 * `max-height: calc(100svh - var(--keyboard-inset, 0px) - 2rem)`.
 */
export function useKeyboardInset(): number {
  // Start from the shared value so a second sheet does not flash mid-screen.
  const [inset, setInset] = useState(current);

  useEffect(() => {
    listeners.add(setInset);
    // A second sheet opening while the keyboard is already up must know at once.
    setInset(current);
    if (users === 0) stop = start();
    users += 1;
    return () => {
      listeners.delete(setInset);
      users -= 1;
      if (users === 0) {
        stop?.();
        stop = null;
        current = 0;
        last = '';
      }
    };
  }, []);

  return inset;
}
