import { type Locator, type Page, expect, test } from '@playwright/test';

/**
 * The same gesture as the Chromium suite, in mobile WebKit with the iPhone 15
 * Pro Max profile: the engine an installed PWA actually runs on iOS.
 *
 * Playwright cannot generate trusted touch *moves* in WebKit, so the moves and
 * the release are dispatched as events. That still exercises the exact code
 * under test: the fan's native listeners, the window-level `touchend`, and the
 * file input `click()`. A trusted tap is used separately to prove WebKit opens
 * a real chooser for these 1px inputs.
 *
 * The headless browser has no native photo sheet to dismiss, so `cancel` is
 * dispatched by hand; the tests report every event the inputs saw.
 */

declare global {
  interface Window {
    __picks: string[];
    __pickerShows: string[];
    __pickerThrows: string[];
    __pickerEvents: string[];
    /** Pointer/touch events the page saw, in order: the gesture's own trace. */
    __gestureEvents: string[];
  }
}

const PROFILE = {
  sex: 'male',
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate',
  goal: 'maintain',
  units: 'metric',
  mode: 'simple',
};

type ChooserKind = 'camera' | 'library';

/** The file choosers WebKit actually asked for, by input, in order. */
const choosers = new WeakMap<Page, ChooserKind[]>();
/** Whether the intercepted chooser should be closed by selecting no files. */
const answerChooser = new WeakSet<Page>();

/**
 * Open the app with both inputs instrumented.
 *
 * `forceClick` hides `showPicker()` from the app, so `openPicker()` takes its
 * `click()` fallback. WebKit no-ops `showPicker()` when it has no user
 * activation, without throwing and without a fallback, so the synthetic
 * gesture tests would otherwise observe nothing at all. The trusted-tap test
 * leaves it alone: that is the real iOS path, and it works there.
 */
async function openApp(
  page: Page,
  opts: { answer?: boolean; forceClick?: boolean } = {},
): Promise<void> {
  await page.addInitScript((profile) => {
    localStorage.setItem('snapbite.profile.v1', JSON.stringify(profile));
  }, PROFILE);
  // Record the API the app asks. This WebKit build exposes showPicker() but
  // does not route it to Playwright's chooser interception, so the call itself
  // is the evidence here; the trusted click probe below still opens a chooser.
  await page.addInitScript(() => {
    window.__pickerShows = [];
    window.__pickerThrows = [];
    const proto = HTMLInputElement.prototype;
    const original = proto.showPicker;
    if (typeof original !== 'function') return;
    proto.showPicker = function (this: HTMLInputElement) {
      const name = this.hasAttribute('capture') ? 'camera' : 'library';
      try {
        original.call(this);
        window.__pickerShows.push(name);
      } catch (err) {
        window.__pickerThrows.push(`${name}:${(err as DOMException).name}`);
        throw err;
      }
    };
  });
  const kinds: ChooserKind[] = [];
  choosers.set(page, kinds);
  if (opts.answer !== false) answerChooser.add(page);
  page.on('filechooser', (chooser) => {
    void (async () => {
      const kind = await chooser
        .element()
        .evaluate((el) =>
          (el as HTMLInputElement).hasAttribute('capture') ? 'camera' : 'library',
        );
      kinds.push(kind as ChooserKind);
      if (answerChooser.has(page)) await chooser.setFiles([]);
    })();
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /add a meal/i })).toBeVisible();
  await page.evaluate((forceClick) => {
    window.__picks = [];
    window.__pickerEvents = [];
    window.__gestureEvents = [];
    for (const type of [
      'pointerdown',
      'pointerup',
      'pointercancel',
      'lostpointercapture',
      'touchend',
      'touchcancel',
    ]) {
      window.addEventListener(type, () => window.__gestureEvents.push(type), true);
    }
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type=file]')) {
      const name = input.hasAttribute('capture') ? 'camera' : 'library';
      if (forceClick) Object.defineProperty(input, 'showPicker', { value: undefined });
      input.addEventListener('click', () => window.__picks.push(name));
      for (const type of ['cancel', 'change']) {
        input.addEventListener(type, () => window.__pickerEvents.push(`${name}:${type}`));
      }
    }
  }, opts.forceClick === true);
}

const button = (page: Page) => page.getByRole('button', { name: /add a meal/i });
const fan = (page: Page) => page.getByTestId('capture-fan');
const menu = (page: Page) => page.getByTestId('capture-menu');
const picks = (page: Page) => page.evaluate(() => window.__picks.slice());
const shows = (page: Page) => page.evaluate(() => window.__pickerShows.slice());
const thrown = (page: Page) => page.evaluate(() => window.__pickerThrows.slice());

const centre = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

/** The fan's inline box; the same measurement the Chromium suite uses. */
async function geometry(page: Page) {
  const g = await fan(page).evaluate((el) => ({
    left: Number.parseFloat((el as HTMLElement).style.left),
    top: Number.parseFloat((el as HTMLElement).style.top),
    width: Number.parseFloat((el as HTMLElement).style.width),
    height: Number.parseFloat((el as HTMLElement).style.height),
  }));
  const outer = g.width / 2;
  const cx = g.left + outer;
  const cy = g.top + g.height;
  const path = page.locator('[data-testid=capture-fan] path[data-active]').first();
  const d = (await path.getAttribute('d')) ?? '';
  const arc = [...d.matchAll(/A\s+([\d.]+)\s+([\d.]+)/g)].map((m) => Number(m[1]));
  return { cx, cy, outer, inner: arc[1] ?? 0 };
}

const at = (g: { cx: number; cy: number }, deg: number, radius: number) => ({
  x: g.cx + radius * Math.cos((deg * Math.PI) / 180),
  y: g.cy - radius * Math.sin((deg * Math.PI) / 180),
});

/** Press the button with the synthetic touch the fan listens for. */
async function pressButton(page: Page): Promise<{ x: number; y: number }> {
  const target = await button(page).boundingBox();
  if (!target) throw new Error('camera button has no box');
  const p = centre(target);
  await page.evaluate(({ x, y }) => {
    const btn = document.querySelector<HTMLButtonElement>('button[aria-label^="Add a meal"]');
    if (!btn) throw new Error('camera button missing');
    // Synthetic pointer ids have no active pointer to capture. This is also
    // the iOS case under test: the release is not retargeted to the button.
    btn.setPointerCapture = () => {};
    btn.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: x,
        clientY: y,
      }),
    );
  }, p);
  return p;
}

/** Press and hold the button; returns the fan's geometry. */
async function holdButton(
  page: Page,
): Promise<{ cx: number; cy: number; inner: number; outer: number }> {
  await pressButton(page);
  await page.waitForTimeout(300);
  await expect(fan(page)).toBeVisible();
  return geometry(page);
}

/**
 * Where the fan will stand, worked out before it opens from the button and the
 * bar: the same rule as `placeFan` (the bar's top less `barGapPx` and half the
 * stroke). The full radii fit on this screen; the Chromium geometry test pins
 * them, and the angle alone decides the wedge.
 */
async function fanLayout(
  page: Page,
): Promise<{ cx: number; cy: number; inner: number; outer: number }> {
  const b = await button(page).boundingBox();
  const nav = await page.locator('nav').boundingBox();
  if (!b || !nav) throw new Error('camera button or tab bar has no box');
  return { cx: b.x + b.width / 2, cy: nav.y - 9, inner: 80, outer: 148 };
}

async function slide(page: Page, p: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ x, y }) => {
    const btn = document.querySelector<HTMLButtonElement>('button[aria-label^="Add a meal"]');
    btn?.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: x,
        clientY: y,
      }),
    );
  }, p);
}

/**
 * Lift the finger where iOS does not give the button its release: both the
 * pointerup and the touchend land on the window.
 */
async function releaseOnWindow(page: Page, p: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: x,
        clientY: y,
      }),
    );
    window.dispatchEvent(new Event('touchend', { bubbles: true }));
  }, p);
}

/** One complete slide-and-release, ending on `deg`. */
async function pick(page: Page, deg: number): Promise<void> {
  const g = await holdButton(page);
  const p = at(g, deg, (g.inner + g.outer) / 2);
  await slide(page, p);
  await releaseOnWindow(page, p);
  await expect(fan(page)).toBeHidden();
}

/**
 * The owner's gesture: press, slide to `deg` at once (before the hold opens the
 * fan), then release once it is up. Returns the gesture surfaces' computed
 * `touch-action` while the fan is open.
 */
async function fastPick(page: Page, deg: number): Promise<{ container: string; svg: string }> {
  await pressButton(page);
  const g = await fanLayout(page);
  const p = at(g, deg, (g.inner + g.outer) / 2);
  await slide(page, p);
  // What the page saw before the hold had a chance to open the fan: the trace
  // that says whether this was a cancel or a gesture we dropped ourselves.
  console.log(
    'fast slide before the hold',
    JSON.stringify({
      target: p,
      events: await page.evaluate(() => window.__gestureEvents.slice()),
    }),
  );
  // A slide that started before the hold must still land: the fan opens with
  // this wedge already chosen. Before the fix it opened never, because the
  // move cancelled the hold, and the release ran nothing.
  await expect(fan(page)).toBeVisible({ timeout: 2000 });
  const actions = await fan(page).evaluate((el) => ({
    container: getComputedStyle(el).touchAction,
    svg: getComputedStyle(el.querySelector('svg') as SVGElement).touchAction,
  }));
  await releaseOnWindow(page, p);
  await expect(fan(page)).toBeHidden();
  return actions;
}

test('the first gesture lands when it slides at once, and so does the retry after an outside tap', async ({
  page,
}) => {
  await openApp(page, { forceClick: true });

  // The surface the gesture starts on must own it: without this iOS may
  // decide the slide is a pan, fire pointercancel, and drop the rest.
  expect(await button(page).evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');

  // A fresh page, no prior interaction: press and slide to Upload image
  // straight away, then release. This is the attempt the report says is lost.
  const fanActions = await fastPick(page, 110);
  expect(await picks(page)).toEqual(['library']);
  // Nothing under the thumb can start a pan, even while it is over the fan.
  expect(fanActions).toEqual({ container: 'none', svg: 'none' });

  // The retry as described: tap somewhere outside the button, then repeat.
  await page.touchscreen.tap(10, 200);
  await fastPick(page, 110);
  expect(await picks(page)).toEqual(['library', 'library']);

  // The same first-slide path on the other action from the report.
  await fastPick(page, 20);
  expect(await picks(page)).toEqual(['library', 'library', 'camera']);

  // The slide that lands must not also toggle the card menu.
  await expect(menu(page)).toBeHidden();

  // Each pick was accepted by the platform and came back with no files; let
  // the last intercepted chooser answer before the page closes.
  await expect.poll(() => page.evaluate(() => window.__pickerEvents.length)).toBe(3);

  const events = await page.evaluate(() => window.__gestureEvents.slice());
  console.log('fast-slide gesture events', JSON.stringify(events));
  test.info().annotations.push({
    type: 'fast-slide',
    description: JSON.stringify({ fanActions, events }),
  });
  // No pan means no cancel: if this ever fires on a normal slide, the gesture
  // is being taken away again.
  expect(events).not.toContain('pointercancel');
});

test('the pickers are rendered but invisible, and out of the tab order rather than aria-hidden', async ({
  page,
}) => {
  await openApp(page);
  const styles = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement>('input[type=file]')].map((input) => {
      const s = getComputedStyle(input);
      return {
        capture: input.hasAttribute('capture'),
        position: s.position,
        width: s.width,
        height: s.height,
        opacity: s.opacity,
        display: s.display,
        visibility: s.visibility,
        clip: s.clip,
        clipPath: s.clipPath,
        pointerEvents: s.pointerEvents,
        zIndex: s.zIndex,
        ariaHidden: input.getAttribute('aria-hidden'),
        tabIndex: input.tabIndex,
      };
    }),
  );

  expect(styles).toHaveLength(2);
  for (const s of styles) {
    expect(s.position).toBe('fixed');
    expect(s.width).toBe('1px');
    expect(s.height).toBe('1px');
    expect(s.opacity).toBe('0');
    // Not removed from rendering: the exact causes iOS has been known to refuse.
    expect(s.display).not.toBe('none');
    expect(s.visibility).not.toBe('hidden');
    expect(s.clip).toBe('auto');
    expect(s.clipPath).toBe('none');
    expect(s.pointerEvents).toBe('none');
    expect(s.zIndex).toBe('-1');
    expect(s.ariaHidden).toBeNull();
    expect(s.tabIndex).toBe(-1);
  }
  expect(styles.map((s) => s.capture)).toEqual([true, false]);
});

test('a slide-and-release asks the camera and the library inputs, even when the window gets the release', async ({
  page,
}) => {
  await openApp(page, { forceClick: true });

  await pick(page, 20); // Take photo
  await pick(page, 110); // Upload image

  // The patch that makes `pick()` work is that the action ran from the window's
  // touchend, not from a button release: this is the refused-capture path.
  expect(await picks(page)).toEqual(['camera', 'library']);
  await expect(menu(page)).toBeHidden();

  // Both intercepted choosers were closed with no files, so both inputs should
  // have answered with `change`.
  await expect.poll(() => page.evaluate(() => window.__pickerEvents.length)).toBe(2);

  const kinds = choosers.get(page) ?? [];
  const events = await page.evaluate(() => window.__pickerEvents.slice());
  console.log(
    'webkit picks',
    JSON.stringify({ picks: await picks(page), choosers: kinds, events }),
  );
  test.info().annotations.push({
    type: 'webkit-picker',
    description: JSON.stringify({ picks: await picks(page), choosers: kinds, events }),
  });
});

test('a trusted tap that calls click() opens a real chooser on both 1px inputs', async ({
  page,
}) => {
  await openApp(page);

  // Note: desktop WebKit also opens a chooser for the old `sr-only` style, and
  // even for `display:none` (measured separately), so the iOS-specific refusal
  // cannot be reproduced in this engine. What this test proves is that the new
  // rendered-but-invisible inputs are accepted, not that the old ones failed.
  //
  // Two real buttons, tapped by Playwright (a trusted gesture), each calls the
  // same input.click() the fan calls. This is the platform-acceptance check
  // for the invisible input: if WebKit refuses the input, no chooser appears.
  await page.evaluate(() => {
    let top = 8;
    for (const [name, capture] of [
      ['open camera probe', true],
      ['open library probe', false],
    ] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      // Above the fixed app shell: a button after it would sit below the
      // viewport and Playwright could never reach it.
      b.style.cssText = `position:fixed;top:${top}px;left:8px;z-index:9999;padding:4px 8px;background:#fff;color:#000`;
      top += 40;
      b.addEventListener('click', () => {
        const selector = capture ? 'input[capture]' : 'input[type=file]:not([capture])';
        document.querySelector<HTMLInputElement>(selector)?.click();
      });
      document.body.append(b);
    }
  });

  await page.getByRole('button', { name: 'open camera probe' }).click();
  await expect.poll(() => (choosers.get(page) ?? []).length).toBe(1);
  await page.getByRole('button', { name: 'open library probe' }).click();
  await expect.poll(() => (choosers.get(page) ?? []).length).toBe(2);

  const kinds = choosers.get(page) ?? [];
  console.log('webkit trusted clicks', JSON.stringify({ kinds }));
  expect(kinds).toEqual(['camera', 'library']);
});

test('a dismissed picker is silent: cancel is the proof, not an error', async ({ page }) => {
  // Do not answer the chooser: the sheet is left for us to dismiss.
  await openApp(page, { answer: false, forceClick: true });
  await pick(page, 110); // Upload image

  await expect.poll(() => (choosers.get(page) ?? []).length).toBe(1);
  expect(await picks(page)).toEqual(['library']);

  // iOS 16+ fires `cancel` on the input when the sheet is dismissed.
  await page.evaluate(() => {
    document
      .querySelector<HTMLInputElement>('input[type=file]:not([capture])')
      ?.dispatchEvent(new Event('cancel'));
  });

  // Past the 2.5s probe: no accusation while the person is looking at a picker.
  await page.waitForTimeout(3400);
  await expect(page.getByText(/could not open the photo picker/i)).toHaveCount(0);
  await expect(menu(page)).toBeHidden();

  const events = await page.evaluate(() => window.__pickerEvents.slice());
  console.log('webkit dismissed picker', JSON.stringify({ events }));
  test.info().annotations.push({ type: 'webkit-cancel', description: JSON.stringify(events) });
  expect(events).toContain('library:cancel');
});
