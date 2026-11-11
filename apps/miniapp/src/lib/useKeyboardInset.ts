import { useEffect } from 'react';

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

function start(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};

  let frame = 0;
  let last = '';
  const write = () => {
    frame = 0;
    const next = `${keyboardInset(vv)}px`;
    if (next === last) return;
    last = next;
    document.documentElement.style.setProperty(VAR, next);
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
 * calling component is mounted. Sheets size themselves from it in CSS:
 * `max-height: calc(100svh - var(--keyboard-inset, 0px) - 2rem)`.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    if (users === 0) stop = start();
    users += 1;
    return () => {
      users -= 1;
      if (users === 0) {
        stop?.();
        stop = null;
      }
    };
  }, []);
}
