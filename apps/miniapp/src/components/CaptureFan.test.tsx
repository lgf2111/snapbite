import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell.js';
import { CaptureFan } from './CaptureFan.js';
import { CaptureMenu } from './CaptureMenu.js';

// The button is 64px; centre it at (215, 872) like the phone layout.
const CX = 215;
const CY = 872;

function Harness({ onPick }: { onPick: (a: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <AppShell
        active="home"
        onNavigate={() => {}}
        menuOpen={open}
        onToggleMenu={() => setOpen((v) => !v)}
        captureRef={ref}
      >
        <p>home</p>
      </AppShell>
      <CaptureMenu open={open} onClose={() => setOpen(false)} onPick={onPick} triggerRef={ref} />
      <CaptureFan triggerRef={ref} enabled={!open} onPick={onPick} />
    </>
  );
}

const button = () => screen.getByRole('button', { name: /add a meal\. tap for options/i });
const fan = () => screen.queryByTestId('capture-fan');
const wedges = () => [
  ...document.querySelectorAll<SVGPathElement>('[data-testid=capture-fan] path[data-active]'),
];
const active = () => wedges().map((w) => w.dataset.active);
const label = () =>
  document.querySelector<HTMLElement>('[data-testid=capture-fan] span[class*=w-32]')?.textContent;

const pointer = (type: string, x: number, y: number) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    clientX: x,
    clientY: y,
  });
const fire = (el: Element, e: Event) =>
  act(() => {
    el.dispatchEvent(e);
  });
const hold = () =>
  act(() => {
    vi.advanceTimersByTime(200);
  });
/**
 * A finger lifting: pointerup always, then touchend (the event iOS accepts for
 * opening a picker). Both belong to one gesture.
 */
const release = (x: number, y: number) =>
  act(() => {
    button().dispatchEvent(pointer('pointerup', x, y));
    button().dispatchEvent(new Event('touchend', { bubbles: true }));
  });
/** A touch that never sends pointerup: only the touch release arrives. */
const touchRelease = () =>
  act(() => {
    button().dispatchEvent(new Event('touchend', { bubbles: true }));
  });
/** A point `r` px from the button's centre at `deg` (90 = straight up). */
const from = (deg: number, r = 100) => [
  CX + r * Math.cos((deg * Math.PI) / 180),
  CY - r * Math.sin((deg * Math.PI) / 180),
];

let onPick: ReturnType<typeof vi.fn>;
let vibrate: ReturnType<typeof vi.fn>;
const realMatchMedia = window.matchMedia;

beforeEach(() => {
  vi.useFakeTimers();
  onPick = vi.fn();
  vibrate = vi.fn();
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  render(<Harness onPick={onPick} />);
  vi.spyOn(button(), 'getBoundingClientRect').mockReturnValue({
    left: CX - 32,
    top: CY - 32,
    width: 64,
    height: 64,
    right: CX + 32,
    bottom: CY + 32,
    x: CX - 32,
    y: CY - 32,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.matchMedia = realMatchMedia;
  Reflect.deleteProperty(navigator, 'vibrate');
});

describe('hold and slide on the camera button', () => {
  it('describes both gestures to assistive tech and is set up for them', () => {
    expect(button().getAttribute('aria-label')).toBe(
      'Add a meal. Tap for options, or hold and slide to choose.',
    );
    expect(button().className).toContain('touch-none');
    expect(button().className).toContain('select-none');
    expect(button().className).toContain('[-webkit-touch-callout:none]');
  });

  it('a plain tap still opens the cards, and no fan', () => {
    fire(button(), pointer('pointerdown', CX, CY));
    act(() => {
      vi.advanceTimersByTime(60);
    });
    release(CX, CY);
    fireEvent.click(button());

    expect(fan()).toBeNull();
    expect(screen.getByRole('group', { name: /4 options/i })).toBeTruthy();
  });

  it('holding opens the fan and a tick, but not the cards', () => {
    fire(button(), pointer('pointerdown', CX, CY));
    expect(fan()).toBeNull();
    hold();

    expect(fan()).toBeTruthy();
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(label()).toBe('Slide to choose');
    expect(active()).toEqual(['false', 'false', 'false', 'false']);

    // Releasing with nothing chosen: no action, and the click that follows the
    // release must not open the cards either.
    release(CX, CY);
    fireEvent.click(button());
    expect(fan()).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: /4 options/i })).toBeNull();
  });

  it('sliding right highlights Take photo; releasing runs it, immediately', () => {
    fire(button(), pointer('pointerdown', CX, CY));
    hold();
    const [x, y] = from(20) as [number, number];
    fire(button(), pointer('pointermove', x, y));

    expect(active()).toEqual(['false', 'false', 'false', 'true']);
    expect(label()).toBe('Take photo');

    // No timers advanced: the action fires inside the release.
    release(x, y);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('photo');
    expect(fan()).toBeNull();
  });

  it('opens the picker from touchend, the touch event iOS trusts', () => {
    fire(button(), pointer('pointerdown', CX, CY));
    hold();
    const [x, y] = from(110) as [number, number];
    fire(button(), pointer('pointermove', x, y));

    // Only the touch release arrives: it must be enough on its own.
    touchRelease();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('upload');
    expect(fan()).toBeNull();
  });

  it('runs one action when pointerup and touchend report the same release', () => {
    fire(button(), pointer('pointerdown', CX, CY));
    hold();
    const [x, y] = from(20) as [number, number];
    fire(button(), pointer('pointermove', x, y));

    // iOS sends pointerup first; the fan defers the action to touchend.
    fire(button(), pointer('pointerup', x, y));
    expect(onPick).not.toHaveBeenCalled();
    touchRelease();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('photo');
  });

  it.each([
    [160, 0, 'Saved meals', 'saved'],
    [110, 1, 'Upload image', 'upload'],
    [70, 2, 'Manually log', 'manual'],
    [20, 3, 'Take photo', 'photo'],
  ])('at %i degrees the highlight is wedge %i (%s)', (deg, idx, title, action) => {
    fire(button(), pointer('pointerdown', CX, CY));
    hold();
    const [x, y] = from(deg) as [number, number];
    fire(button(), pointer('pointermove', x, y));

    // One highlight at a time, and the label names it.
    expect(active().filter((a) => a === 'true')).toHaveLength(1);
    expect(active()[idx]).toBe('true');
    expect(label()).toBe(title);

    release(x, y);
    expect(onPick).toHaveBeenCalledWith(action);
  });

  it('moves the highlight as the thumb crosses wedges, with a tick each time', () => {
    fire(button(), pointer('pointerdown', CX, CY));
    hold();
    expect(vibrate).toHaveBeenCalledTimes(1); // opening

    for (const deg of [160, 110, 70]) {
      const [x, y] = from(deg) as [number, number];
      fire(button(), pointer('pointermove', x, y));
    }
    expect(active()).toEqual(['false', 'false', 'true', 'false']);
    expect(vibrate).toHaveBeenCalledTimes(4); // open + three changes

    // Moving within a wedge is not a change.
    const [x, y] = from(75) as [number, number];
    fire(button(), pointer('pointermove', x, y));
    expect(vibrate).toHaveBeenCalledTimes(4);
  });

  it('cancels if the finger moves past the threshold before the hold completes', () => {
    fire(button(), pointer('pointerdown', CX, CY));
    fire(button(), pointer('pointermove', CX + 14, CY));
    hold();

    expect(fan()).toBeNull();
    release(CX + 14, CY);
    fireEvent.click(button());
    // A drag is neither a hold nor a tap.
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: /4 options/i })).toBeNull();
  });

  it('forgives a small wobble before the hold completes', () => {
    fire(button(), pointer('pointerdown', CX, CY));
    fire(button(), pointer('pointermove', CX + 6, CY - 4));
    hold();
    expect(fan()).toBeTruthy();
  });

  it('releasing in the dead zone, over the button, does nothing', () => {
    fire(button(), pointer('pointerdown', CX, CY));
    hold();
    release(CX + 8, CY - 8);

    expect(onPick).not.toHaveBeenCalled();
    expect(fan()).toBeNull();
  });

  it('sliding back to the centre clears the highlight, and releasing cancels', () => {
    fire(button(), pointer('pointerdown', CX, CY));
    hold();
    const [x, y] = from(20) as [number, number];
    fire(button(), pointer('pointermove', x, y));
    expect(active()[3]).toBe('true');

    fire(button(), pointer('pointermove', CX + 5, CY - 5));
    expect(active()).toEqual(['false', 'false', 'false', 'false']);
    expect(label()).toBe('Slide to choose');

    release(CX + 5, CY - 5);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('sliding straight down cancels', () => {
    fire(button(), pointer('pointerdown', CX, CY));
    hold();
    fire(button(), pointer('pointermove', CX, CY + 80));
    expect(active()).toEqual(['false', 'false', 'false', 'false']);
    release(CX, CY + 80);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('a pointercancel (the OS took the touch) closes the fan and runs nothing', () => {
    fire(button(), pointer('pointerdown', CX, CY));
    hold();
    const [x, y] = from(20) as [number, number];
    fire(button(), pointer('pointermove', x, y));
    fire(button(), pointer('pointercancel', x, y));

    expect(fan()).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('is off while the card menu is open: the button is just its ×', () => {
    fireEvent.click(button()); // open the cards
    const close = screen
      .getAllByRole('button', { name: /close add-meal menu/i })
      .find((b) => b.hasAttribute('aria-expanded')) as HTMLElement;
    fire(close, pointer('pointerdown', CX, CY));
    hold();
    expect(fan()).toBeNull();
  });

  it('still works under reduced motion: no animation classes, selection intact', () => {
    window.matchMedia = ((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;

    fire(button(), pointer('pointerdown', CX, CY));
    hold();
    // Every animation class is behind `motion-safe:`, so reduced motion gets none.
    const root = fan() as HTMLElement;
    expect(root.className).not.toMatch(/(^|\s)animate-in/);
    expect(root.className).toContain('motion-safe:animate-in');

    const [x, y] = from(110) as [number, number];
    fire(button(), pointer('pointermove', x, y));
    release(x, y);
    expect(onPick).toHaveBeenCalledWith('upload');
  });

  it('writes the highlight to the DOM without re-rendering React on each move', () => {
    fire(button(), pointer('pointerdown', CX, CY));
    hold();
    const wedgeEls = wedges();
    const root = fan();

    for (const deg of [170, 130, 100, 60, 30]) {
      const [x, y] = from(deg) as [number, number];
      fire(button(), pointer('pointermove', x, y));
    }
    // Same elements throughout: nothing was re-created by a render.
    expect(wedges()).toEqual(wedgeEls);
    expect(fan()).toBe(root);
  });
});

/* ------------------------------------------------------------------------ */
/* Where the fan stands: measured from the rendered boxes, per device shape. */
/* ------------------------------------------------------------------------ */

const rectOf = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

describe.each([
  { name: '430x932 (home indicator)', w: 430, h: 932, inset: 34, outer: 148 },
  { name: '375x667 (no home indicator)', w: 375, h: 667, inset: 0, outer: 148 },
  // So short that the full ring cannot fit above the bar: it shrinks, never overflows.
  { name: '320x200', w: 320, h: 200, inset: 0, outer: 107 },
])('the fan on $name', ({ w, h, inset, outer }) => {
  const barHeight = 72 + inset;
  const barTop = h - barHeight;
  const cx = w / 2;
  const realW = window.innerWidth;
  const realH = window.innerHeight;

  const open = () => {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
    // The button overhangs the bar by 20px and is 64px across.
    vi.spyOn(button(), 'getBoundingClientRect').mockReturnValue(
      rectOf(cx - 32, barTop - 20, 64, 64),
    );
    const nav = button().closest('nav') as HTMLElement;
    vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue(rectOf(0, barTop, w, barHeight));
    fire(button(), pointer('pointerdown', cx, barTop + 12));
    hold();
    const box = screen.getByTestId('capture-fan');
    const num = (v: string) => Number.parseFloat(v);
    return { top: num(box.style.top), left: num(box.style.left), height: num(box.style.height) };
  };

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: realW, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: realH, configurable: true });
  });

  it('keeps its lowest ink at least 8px above the tab bar', () => {
    const fanBox = open();
    const baseline = fanBox.top + fanBox.height;
    const lowestInk = baseline + 0.75; // half the 1.5px stroke
    expect(barTop - lowestInk).toBeGreaterThanOrEqual(8);
  });

  it('uses the full radius where it fits and a smaller one where it does not, inside the screen', () => {
    const fanBox = open();
    expect(fanBox.height).toBe(outer);
    expect(fanBox.top).toBeGreaterThanOrEqual(12);
    expect(fanBox.left).toBeGreaterThanOrEqual(0);
    expect(fanBox.left + fanBox.height * 2).toBeLessThanOrEqual(w);
  });

  it('leaves the button fully visible, inside the hollow, and tappable', () => {
    const fanBox = open();
    const baseline = fanBox.top + fanBox.height;
    const inner = Math.round((80 * fanBox.height) / 148);
    const btn = { left: cx - 32, top: barTop - 20, right: cx + 32, bottom: barTop + 44 };

    // On screen.
    expect(btn.left).toBeGreaterThanOrEqual(0);
    expect(btn.right).toBeLessThanOrEqual(w);
    expect(btn.bottom).toBeLessThanOrEqual(h);
    // No wedge touches it: every corner is under the baseline or inside the inner radius.
    for (const [x, y] of [
      [btn.left, btn.top],
      [btn.right, btn.top],
      [btn.left, btn.bottom],
      [btn.right, btn.bottom],
    ] as const) {
      expect(y >= baseline || Math.hypot(x - cx, y - baseline) <= inner).toBe(true);
    }
    // And nothing the fan draws can take its touches.
    expect(screen.getByTestId('capture-fan').className).toContain('pointer-events-none');
    expect(button().closest('nav')?.className).toContain('z-40');
    expect(screen.getByTestId('capture-fan').className).not.toContain('pointer-events-auto');
  });
});
