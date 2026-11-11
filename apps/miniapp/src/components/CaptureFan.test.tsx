import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FAN } from '../lib/fan.js';
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

const button = () => screen.getByRole('button', { name: /add a meal — tap for options/i });
const fan = () => screen.queryByTestId('capture-fan');
const wedges = () => [
  ...document.querySelectorAll<SVGPathElement>('[data-testid=capture-fan] path[data-active]'),
];
const active = () => wedges().map((w) => w.dataset.active);
const label = () => screen.queryByTestId('capture-fan-label')?.textContent;

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
      'Add a meal — tap for options, hold and slide to choose',
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
    fire(button(), pointer('pointerup', CX, CY));
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
    expect(label()).toBe('');
    expect(active()).toEqual(['false', 'false', 'false', 'false']);

    // Releasing with nothing chosen: no action, and the click that follows the
    // release must not open the cards either.
    fire(button(), pointer('pointerup', CX, CY));
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

    // No timers advanced: the action fires inside the pointerup.
    fire(button(), pointer('pointerup', x, y));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('photo');
    expect(fan()).toBeNull();
  });

  it.each([
    [160, 0, 'Use saved meals', 'saved'],
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

    fire(button(), pointer('pointerup', x, y));
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
    fire(button(), pointer('pointerup', CX + 14, CY));
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
    fire(button(), pointer('pointerup', CX + 8, CY - 8));

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
    expect(label()).toBe('');

    fire(button(), pointer('pointerup', CX + 5, CY - 5));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('sliding straight down cancels', () => {
    fire(button(), pointer('pointerdown', CX, CY));
    hold();
    fire(button(), pointer('pointermove', CX, CY + 80));
    expect(active()).toEqual(['false', 'false', 'false', 'false']);
    fire(button(), pointer('pointerup', CX, CY + 80));
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
    fire(button(), pointer('pointerup', x, y));
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
/* The label's geometry: measured from the rendered boxes, not eyeballed.   */
/* ------------------------------------------------------------------------ */

type Rect = { left: number; top: number; right: number; bottom: number };

/** The label's box on screen, from the inline geometry it was rendered with. */
function labelRect(): Rect {
  const el = screen.getByTestId('capture-fan-label');
  const box = screen.getByTestId('capture-fan');
  const px = (v: string) => Number.parseFloat(v);
  const left = px(box.style.left) + px(el.style.left);
  const top = px(box.style.top) + px(el.style.top);
  return { left, top, right: left + px(el.style.width), bottom: top + px(el.style.height) };
}

const intersects = (a: Rect, b: Rect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

function placeButton(cx: number, cy: number) {
  vi.spyOn(button(), 'getBoundingClientRect').mockReturnValue({
    left: cx - 32,
    top: cy - 32,
    width: 64,
    height: 64,
    right: cx + 32,
    bottom: cy + 32,
    x: cx - 32,
    y: cy - 32,
    toJSON: () => ({}),
  } as DOMRect);
}

describe.each([
  { name: '430x932', w: 430, h: 932 },
  { name: '375x667', w: 375, h: 667 },
])('the label in the hollow at $name', ({ w, h }) => {
  const cx = w / 2;
  const cy = h - 48;
  const open = () => {
    placeButton(cx, cy);
    fire(button(), pointer('pointerdown', cx, cy));
    hold();
  };
  const slideTo = (deg: number) =>
    fire(
      button(),
      pointer(
        'pointermove',
        cx + 100 * Math.cos((deg * Math.PI) / 180),
        cy - 100 * Math.sin((deg * Math.PI) / 180),
      ),
    );

  it.each([
    ['leftmost', 170, 'Use saved meals'],
    ['rightmost', 10, 'Take photo'],
  ])('clears the button and the arc for the %s wedge', (_, deg, title) => {
    open();
    slideTo(deg);
    expect(label()).toBe(title);

    const r = labelRect();
    const buttonRect: Rect = { left: cx - 32, top: cy - 32, right: cx + 32, bottom: cy + 32 };
    expect(intersects(r, buttonRect)).toBe(false);
    // The band starts 8px above the button's top edge.
    expect(buttonRect.top - r.bottom).toBeGreaterThanOrEqual(FAN.labelGapPx);

    // Every corner is inside the arc's inner edge, by the gap.
    for (const [x, y] of [
      [r.left, r.top],
      [r.right, r.top],
      [r.left, r.bottom],
      [r.right, r.bottom],
    ] as const) {
      expect(Math.hypot(x - cx, y - cy)).toBeLessThanOrEqual(FAN.innerPx - FAN.labelGapPx);
    }
    // Above the horizon, and on screen.
    expect(r.bottom).toBeLessThan(cy);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(w);
  });

  it('is one truncating line, so a long name is clipped, never wrapped or overlapping', () => {
    open();
    slideTo(170);
    const el = screen.getByTestId('capture-fan-label');
    expect(el.className).toContain('truncate');
    expect(el.className).toContain('text-caption');
    expect(Number.parseFloat(el.style.height)).toBe(FAN.labelHeightPx);
    expect(Number.parseFloat(el.style.lineHeight)).toBe(FAN.labelHeightPx);
  });

  it('does not move or resize between nothing, the leftmost and the rightmost wedge', () => {
    open();
    const geometry = () => {
      const el = screen.getByTestId('capture-fan-label');
      return [el.style.left, el.style.top, el.style.width, el.style.height].join('|');
    };
    const idle = geometry();
    slideTo(170);
    const left = geometry();
    slideTo(10);
    const right = geometry();
    slideTo(270);
    expect(label()).toBe('');
    expect(new Set([idle, left, right, geometry()]).size).toBe(1);
  });
});

describe('the fan is still readable in both themes', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
  const block = (mode: 'light' | 'dark') => {
    const re =
      mode === 'light'
        ? /:root\s*\{([^}]*)\}/
        : /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/;
    const vars: Record<string, string> = {};
    for (const m of (re.exec(css)?.[1] ?? '').matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) {
      vars[m[1] as string] = m[2] as string;
    }
    return vars;
  };
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => {
      const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
  };
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  /** The page under the 40% black scrim. */
  const dimmed = (hex: string) => lumOfBlend(hex);
  function lumOfBlend(hex: string) {
    const chan = [1, 3, 5].map((i) => Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * 0.6));
    return lum(`#${chan.map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  }

  it.each(['light', 'dark'] as const)('%s: label text on the dimmed page is >= 4.5:1', (mode) => {
    const v = block(mode);
    expect(
      ratio(lum(v.foreground as string), dimmed(v.background as string)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['light', 'dark'] as const)(
    '%s: the chosen wedge stays distinct and its icon legible',
    (mode) => {
      const v = block(mode);
      // Icon on the chosen fill.
      expect(
        ratio(lum(v['primary-foreground'] as string), lum(v.primary as string)),
      ).toBeGreaterThanOrEqual(4.5);
      // Chosen fill against an unchosen wedge (card): a non-text distinction of 3:1.
      expect(ratio(lum(v.primary as string), lum(v.card as string))).toBeGreaterThanOrEqual(3);
    },
  );
});
