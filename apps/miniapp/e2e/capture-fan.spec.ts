import { type CDPSession, type Page, expect, test } from '@playwright/test';

declare global {
  interface Window {
    __pickerClicks: string[];
    __pickerShows: string[];
    __pickerThrows: string[];
    __pickerEvents: string[];
    __lastPointerMove: { x: number; y: number } | null;
  }
}

/** Long enough for the 180ms hold, with room for a slow frame. */
const HOLD_MS = 260;
/** Let a file chooser dismiss itself before the next gesture or the teardown. */
const SETTLE_MS = 250;
/** The app's window for a picker to prove it opened, plus a slow frame. */
const PROBE_MS = 2500 + 600;

/** A valid profile in local mode keeps the welcome/onboarding gate closed. */
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

const WEDGES = ['saved', 'upload', 'manual', 'photo'] as const;
type Wedge = (typeof WEDGES)[number];

/** A touch finger driven through CDP, so Chrome treats it as a real gesture. */
class Finger {
  private constructor(private readonly cdp: CDPSession) {}

  static async on(page: Page): Promise<Finger> {
    return new Finger(await page.context().newCDPSession(page));
  }

  private point(x: number, y: number) {
    return [{ x, y, id: 1, radiusX: 10, radiusY: 10, force: 1 }];
  }

  async start(x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: this.point(x, y),
    });
  }

  async move(x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: this.point(x, y),
    });
  }

  async end(): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  async cancel(): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  }
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const centre = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** The file choosers the platform actually asked for, by input, in order. */
const choosers = new WeakMap<Page, Array<'camera' | 'library'>>();

async function openApp(page: Page): Promise<void> {
  await page.addInitScript((profile) => {
    localStorage.setItem('snapbite.profile.v1', JSON.stringify(profile));
  }, PROFILE);
  // Which API actually asked for the picker. The app prefers showPicker(); a
  // `click` event means it fell back. The wrapper stays synchronous, so the
  // activation the app relies on is untouched.
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
  const opened: Array<'camera' | 'library'> = [];
  choosers.set(page, opened);
  // Playwright intercepts the real file chooser the platform opens. Recording
  // it is the proof that `input.click()` was accepted; giving it no files is
  // the same evidence a dismissed sheet carries.
  page.on('filechooser', (chooser) => {
    void (async () => {
      const kind = await chooser
        .element()
        .evaluate((el) =>
          (el as HTMLInputElement).hasAttribute('capture') ? 'camera' : 'library',
        );
      opened.push(kind as 'camera' | 'library');
      await chooser.setFiles([]);
    })();
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /add a meal/i })).toBeVisible();
  await page.evaluate(() => {
    window.__pickerClicks = [];
    window.__pickerEvents = [];
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type=file]')) {
      const name = input.hasAttribute('capture') ? 'camera' : 'library';
      input.addEventListener('click', () => window.__pickerClicks.push(name));
      for (const type of ['cancel', 'change']) {
        input.addEventListener(type, () => window.__pickerEvents.push(`${name}:${type}`));
      }
    }
    window.addEventListener('blur', () => window.__pickerEvents.push('window:blur'));
    document.addEventListener('visibilitychange', () =>
      window.__pickerEvents.push(`document:${document.visibilityState}`),
    );
    // The document hears a pointermove after the button's own handler has
    // painted, so this echoes what the gesture actually saw.
    window.__lastPointerMove = null;
    document.addEventListener('pointermove', (e) => {
      window.__lastPointerMove = { x: e.clientX, y: e.clientY };
    });
  });
}

const button = (page: Page) => page.getByRole('button', { name: /add a meal/i });
const fan = (page: Page) => page.getByTestId('capture-fan');
const menu = (page: Page) => page.getByTestId('capture-menu');
const clicks = (page: Page) => page.evaluate(() => window.__pickerClicks.slice());
const shows = (page: Page) => page.evaluate(() => window.__pickerShows.slice());
const throws = (page: Page) => page.evaluate(() => window.__pickerThrows.slice());

async function hold(page: Page, finger: Finger, at: { x: number; y: number }): Promise<void> {
  await finger.start(at.x, at.y);
  await page.waitForTimeout(HOLD_MS);
  await expect(fan(page)).toBeVisible();
}

/** The fan's inline box, untouched by its zoom-in animation. */
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

/** A point at `deg` (90 = straight up) and `radius` from the fan's baseline. */
const at = (g: { cx: number; cy: number }, deg: number, radius: number) => ({
  x: g.cx + radius * Math.cos((deg * Math.PI) / 180),
  y: g.cy - radius * Math.sin((deg * Math.PI) / 180),
});

/**
 * Slide to a point and wait until the page has processed that move. Chrome
 * delivers touch moves asynchronously, so reading the highlight after a fixed
 * sleep can return the previous wedge (the 150deg probe once read the 134.9deg
 * upload). Waiting for the document to echo the point proves the button's
 * pointermove handler ran with it, and that the DOM is painted.
 */
async function slideTo(page: Page, finger: Finger, p: { x: number; y: number }): Promise<void> {
  await finger.move(p.x, p.y);
  await expect
    .poll(
      () =>
        page.evaluate((target) => {
          const last = window.__lastPointerMove;
          return last ? Math.hypot(last.x - target.x, last.y - target.y) : Number.POSITIVE_INFINITY;
        }, p),
      { intervals: [10, 20, 50], timeout: 2000 },
    )
    .toBeLessThanOrEqual(1.5);
}

async function activeWedge(page: Page): Promise<Wedge | null> {
  const index = await page.evaluate(() => {
    const paths = [
      ...document.querySelectorAll<SVGPathElement>('[data-testid=capture-fan] path[data-active]'),
    ];
    return paths.findIndex((p) => p.dataset.active === 'true');
  });
  return index < 0 ? null : (WEDGES[index] ?? null);
}

async function strokes(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<SVGPathElement>('[data-testid=capture-fan] path[data-active]'),
    ].map((p) => p.getAttribute('stroke-width') ?? ''),
  );
}

test('a slide-and-release asks showPicker() once per picker wedge, with no second tap', async ({
  page,
}) => {
  await openApp(page);
  const finger = await Finger.on(page);
  const start = centre((await button(page).boundingBox()) as Box);

  for (const [deg, expected, picker] of [
    [160, 'saved', null],
    [110, 'upload', 'library'],
    [70, 'manual', null],
    [20, 'photo', 'camera'],
  ] as const) {
    await hold(page, finger, start);
    const g = await geometry(page);
    const p = at(g, deg, (g.inner + g.outer) / 2);
    await finger.move(p.x, p.y);

    // The choice is visible before the release: the wedge carries the heavy
    // outline, and the label names it.
    await expect.poll(() => activeWedge(page)).toBe(expected);
    const widths = await strokes(page);
    expect(widths.filter((w) => w === '4')).toHaveLength(1);
    expect(widths).toHaveLength(4);

    const showsBefore = (await shows(page)).length;
    const clicksBefore = (await clicks(page)).length;
    const choosersBefore = (choosers.get(page) ?? []).length;
    await finger.end();
    await expect(fan(page)).toBeHidden();
    await page.waitForTimeout(SETTLE_MS);

    if (picker) {
      // Exactly one picker path per release, and it is showPicker() where the
      // engine has it. A click here would mean the fallback ran instead.
      await expect.poll(async () => (await shows(page)).length).toBe(showsBefore + 1);
      expect((await shows(page)).slice(-1)).toEqual([picker]);
      expect((await clicks(page)).length).toBe(clicksBefore);
      // Not just the handler: the platform accepted it and opened a chooser on
      // the right input.
      await expect.poll(() => (choosers.get(page) ?? []).length).toBe(choosersBefore + 1);
      expect((choosers.get(page) ?? []).at(-1)).toBe(picker);
      // Setting no files is the picker coming back with nothing: `change` (or
      // `cancel`) must reach the input and the app must stay quiet.
      await expect.poll(() => page.evaluate(() => window.__pickerEvents.length)).toBeGreaterThan(0);
      await expect(page.getByText(/could not open the photo picker/i)).toHaveCount(0);
    } else {
      // Saved meals and Manually log open the dialog, not a picker.
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      expect((await shows(page)).length).toBe(showsBefore);
      expect((await clicks(page)).length).toBe(clicksBefore);
      expect((choosers.get(page) ?? []).length).toBe(choosersBefore);
    }

    // The click that follows the touch must not toggle the card menu.
    await expect(menu(page)).toBeHidden();
  }

  expect(await shows(page)).toEqual(['library', 'camera']);
  expect(await clicks(page)).toEqual([]);
  expect(await throws(page)).toEqual([]);
  expect(choosers.get(page)).toEqual(['library', 'camera']);
  const events = await page.evaluate(() => window.__pickerEvents.slice());
  console.log('picker events after both pickers', JSON.stringify(events));
  test.info().annotations.push({ type: 'picker-events', description: JSON.stringify(events) });
});

test('a picker dismissed without a file is never reported as a failure', async ({ page }) => {
  await openApp(page);
  const finger = await Finger.on(page);
  const start = centre((await button(page).boundingBox()) as Box);

  await hold(page, finger, start);
  const g = await geometry(page);
  const p = at(g, 110, (g.inner + g.outer) / 2); // Upload image
  await finger.move(p.x, p.y);
  await expect.poll(() => activeWedge(page)).toBe('upload');
  await finger.end();

  // The chooser opened, and the platform's own answer came back (Playwright
  // closes it by selecting no files).
  await expect.poll(() => (choosers.get(page) ?? []).length).toBe(1);
  expect(await shows(page)).toEqual(['library']);
  expect(await clicks(page)).toEqual([]);
  await expect.poll(() => page.evaluate(() => window.__pickerEvents.length)).toBeGreaterThan(0);

  // Longer than the app's probe: silence is the correct outcome.
  await page.waitForTimeout(PROBE_MS);
  await expect(page.getByText(/could not open the photo picker/i)).toHaveCount(0);
  await expect(menu(page)).toBeHidden();

  const events = await page.evaluate(() => window.__pickerEvents.slice());
  console.log('picker events after a dismissed picker', JSON.stringify(events));
  test.info().annotations.push({ type: 'dismissed', description: JSON.stringify(events) });
});

test('a refused showPicker and click say so once, then open the cards on that action', async ({
  page,
}) => {
  await openApp(page);
  const warnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  // The platform refuses every programmatic open, as some iOS builds do.
  await page.evaluate(() => {
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type=file]')) {
      input.showPicker = () => {
        throw new DOMException('no transient activation', 'NotAllowedError');
      };
      input.click = () => {};
    }
  });

  const finger = await Finger.on(page);
  const start = centre((await button(page).boundingBox()) as Box);
  await hold(page, finger, start);
  const g = await geometry(page);
  const p = at(g, 110, (g.inner + g.outer) / 2); // Upload image
  await finger.move(p.x, p.y);
  await expect.poll(() => activeWedge(page)).toBe('upload');
  await finger.end();

  // Not at the old 400ms mark, and not before the window is up.
  await page.waitForTimeout(1500);
  await expect(page.getByText(/could not open the photo picker/i)).toHaveCount(0);

  const toast = page.getByText(/could not open the photo picker/i);
  await expect(toast).toBeVisible({ timeout: PROBE_MS });
  await expect(toast).toContainText(/tap the camera/i);

  // The way out is on screen, with the failed action highlighted.
  await expect(menu(page)).toBeVisible();
  const cards = page.getByRole('group', { name: /4 options/i });
  await expect(cards.getByRole('button', { name: /upload image/i })).toHaveAttribute(
    'data-highlighted',
    'true',
  );

  // It never opened anything, the API's error name was logged once, and the
  // failure is said once.
  await expect.poll(() => warnings.join('\n')).toContain('NotAllowedError');
  expect(await shows(page)).toEqual([]);
  expect(await clicks(page)).toEqual([]);
  expect(choosers.get(page)).toEqual([]);
});

test('hold and release with no slide does nothing, not even the cards', async ({ page }) => {
  await openApp(page);
  const finger = await Finger.on(page);
  const start = centre((await button(page).boundingBox()) as Box);

  await hold(page, finger, start);
  await finger.end();
  await expect(fan(page)).toBeHidden();
  await page.waitForTimeout(150);

  expect(await shows(page)).toEqual([]);
  expect(await clicks(page)).toEqual([]);
  await expect(menu(page)).toBeHidden();

  // A wobbly tap: still inside the button, still nothing.
  await hold(page, finger, start);
  await finger.move(start.x + 10, start.y - 10);
  await finger.end();
  await expect(fan(page)).toBeHidden();
  await page.waitForTimeout(150);

  expect(await shows(page)).toEqual([]);
  expect(await clicks(page)).toEqual([]);
  await expect(menu(page)).toBeHidden();
});

test('a release back over the button still runs the latched wedge, once', async ({ page }) => {
  await openApp(page);
  const finger = await Finger.on(page);
  const buttonBox = (await button(page).boundingBox()) as Box;
  const start = centre(buttonBox);

  await hold(page, finger, start);
  const g = await geometry(page);
  const p = at(g, 20, (g.inner + g.outer) / 2);
  await finger.move(p.x, p.y);
  expect(await activeWedge(page)).toBe('photo');

  // Back inside the button's bounds, without letting go.
  await finger.move(start.x + 10, start.y - 10);
  expect(await activeWedge(page)).toBe('photo');

  await finger.end();
  await expect.poll(async () => (await shows(page)).length).toBe(1);
  expect((await shows(page))[0]).toBe('camera');
  expect(await clicks(page)).toEqual([]);
  await expect(fan(page)).toBeHidden();
  await page.waitForTimeout(SETTLE_MS);
  expect((await shows(page)).length).toBe(1);
});

test('a cancelled touch runs nothing and fires no picker', async ({ page }) => {
  await openApp(page);
  const finger = await Finger.on(page);
  const start = centre((await button(page).boundingBox()) as Box);

  await hold(page, finger, start);
  const g = await geometry(page);
  const p = at(g, 110, (g.inner + g.outer) / 2);
  await finger.move(p.x, p.y);
  expect(await activeWedge(page)).toBe('upload');

  await finger.cancel();
  await expect(fan(page)).toBeHidden();
  await page.waitForTimeout(150);

  expect(await shows(page)).toEqual([]);
  expect(await clicks(page)).toEqual([]);
  await expect(menu(page)).toBeHidden();
});

test('every wedge boundary belongs to the documented side', async ({ page }) => {
  await openApp(page);
  const finger = await Finger.on(page);
  const start = centre((await button(page).boundingBox()) as Box);

  await hold(page, finger, start);
  const g = await geometry(page);
  const mid = (g.inner + g.outer) / 2;

  // 0, 45, 90, 135 and 180 degrees, each with a degree on either side. A
  // boundary belongs to the wedge to its right (the lower angle), so 45 is
  // photo, 90 manual and 135 upload. Below the horizon the two end wedges
  // continue for another 30 degrees. 150 is the wedge the failing run read as
  // upload: the left of the fan is saved.
  for (const [deg, expected] of [
    [359, 'photo'],
    [0, 'photo'],
    [1, 'photo'],
    [44, 'photo'],
    [45, 'photo'],
    [46, 'manual'],
    [89, 'manual'],
    [90, 'manual'],
    [91, 'upload'],
    [134, 'upload'],
    [135, 'upload'],
    [136, 'saved'],
    [150, 'saved'],
    [179, 'saved'],
    [180, 'saved'],
    [181, 'saved'],
  ] as const) {
    await slideTo(page, finger, at(g, deg, mid));
    expect(await activeWedge(page), `${deg}deg`).toBe(expected);
  }

  await finger.cancel();
});

test('measures the wedge geometry on a 430x932 touch screen', async ({ page }) => {
  await openApp(page);
  const finger = await Finger.on(page);
  const buttonBox = (await button(page).boundingBox()) as Box;
  const start = centre(buttonBox);

  await hold(page, finger, start);
  const g = await geometry(page);
  const mid = (g.inner + g.outer) / 2;

  // Below the horizon the end wedges keep going for 30 degrees.
  await slideTo(page, finger, at(g, -15, mid));
  expect(await activeWedge(page)).toBe('photo');
  await slideTo(page, finger, at(g, 195, mid));
  expect(await activeWedge(page)).toBe('saved');
  await finger.cancel();

  // Dead zone: press just under the button's top edge and creep up. The first
  // highlight is where the finger reaches the dead-zone radius from the centre.
  const topPress = { x: start.x, y: buttonBox.y + 2 };
  await hold(page, finger, topPress);
  let firstActive: number | null = null;
  for (let dy = 1; dy <= 40; dy += 1) {
    await slideTo(page, finger, { x: topPress.x, y: topPress.y - dy });
    if (firstActive == null && (await activeWedge(page)) != null) firstActive = topPress.y - dy;
  }
  await finger.cancel();
  expect(firstActive).not.toBeNull();
  const dead = Math.abs((firstActive as number) - g.cy);

  // Minimum travel: press just inside the button's right edge, level with the
  // fan's baseline, and leave it sideways. 11px is under the threshold, 13px
  // is over; the direction stays well inside the photo wedge.
  const sidePress = { x: buttonBox.x + buttonBox.width - 12, y: g.cy };
  await hold(page, finger, sidePress);
  await slideTo(page, finger, { x: sidePress.x + 11, y: sidePress.y });
  expect(await activeWedge(page)).toBeNull();
  await slideTo(page, finger, { x: sidePress.x + 13, y: sidePress.y });
  expect(await activeWedge(page)).toBe('photo');
  await finger.cancel();

  const report = {
    viewport: '430x932 DPR3',
    button: buttonBox,
    fan: { centre: { x: g.cx, y: g.cy }, outerRadius: g.outer, innerRadius: g.inner },
    angleBounds: {
      photo: '0..45 (45 belongs to photo)',
      manual: '45..90 (90 belongs to manual)',
      upload: '90..135 (135 belongs to upload)',
      saved: '135..180',
      belowHorizon: 'the ends extend to -30deg; -30..-150 cancels',
    },
    deadZoneRadius: dead,
    minimumTravel: 'between 11 and 13 (12 in source)',
  };
  test.info().annotations.push({ type: 'geometry', description: JSON.stringify(report) });
  console.log('capture-fan geometry', JSON.stringify(report));

  expect(g.outer).toBe(148);
  expect(g.inner).toBe(80);
  expect(dead).toBeGreaterThanOrEqual(23.5);
  expect(dead).toBeLessThanOrEqual(24.5);
  expect(g.cx).toBeCloseTo(215, 0);
});
