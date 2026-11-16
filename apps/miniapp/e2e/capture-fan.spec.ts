import { type CDPSession, type Page, expect, test } from '@playwright/test';

declare global {
  interface Window {
    __pickerClicks: string[];
    __lastPointerMove: { x: number; y: number } | null;
  }
}

/** Long enough for the 180ms hold, with room for a slow frame. */
const HOLD_MS = 260;
/** Let a file chooser dismiss itself before the next gesture or the teardown. */
const SETTLE_MS = 250;

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

async function openApp(page: Page): Promise<void> {
  await page.addInitScript((profile) => {
    localStorage.setItem('snapbite.profile.v1', JSON.stringify(profile));
  }, PROFILE);
  // A picker is handled, not left open: setting no files dismisses it and
  // sends the `change` the app's probe waits for.
  page.on('filechooser', (chooser) => void chooser.setFiles([]));
  await page.goto('/');
  await expect(page.getByRole('button', { name: /add a meal/i })).toBeVisible();
  await page.evaluate(() => {
    window.__pickerClicks = [];
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type=file]')) {
      const name = input.hasAttribute('capture') ? 'camera' : 'library';
      input.addEventListener('click', () => window.__pickerClicks.push(name));
    }
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

test('a slide-and-release runs its wedge exactly once, with no second tap', async ({ page }) => {
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

    const before = (await clicks(page)).length;
    await finger.end();
    await expect(fan(page)).toBeHidden();
    await page.waitForTimeout(SETTLE_MS);

    if (picker) {
      await expect.poll(async () => (await clicks(page)).length).toBe(before + 1);
      const all = await clicks(page);
      expect(all.slice(-1)).toEqual([picker]);
    } else {
      // Saved meals and Manually log open the dialog, not a picker.
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      expect((await clicks(page)).length).toBe(before);
    }

    // The click that follows the touch must not toggle the card menu.
    await expect(menu(page)).toBeHidden();
  }

  expect((await clicks(page)).length).toBe(2);
});

test('hold and release with no slide does nothing, not even the cards', async ({ page }) => {
  await openApp(page);
  const finger = await Finger.on(page);
  const start = centre((await button(page).boundingBox()) as Box);

  await hold(page, finger, start);
  await finger.end();
  await expect(fan(page)).toBeHidden();
  await page.waitForTimeout(150);

  expect(await clicks(page)).toEqual([]);
  await expect(menu(page)).toBeHidden();

  // A wobbly tap: still inside the button, still nothing.
  await hold(page, finger, start);
  await finger.move(start.x + 10, start.y - 10);
  await finger.end();
  await expect(fan(page)).toBeHidden();
  await page.waitForTimeout(150);

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
  await expect.poll(async () => (await clicks(page)).length).toBe(1);
  expect((await clicks(page))[0]).toBe('camera');
  await expect(fan(page)).toBeHidden();
  await page.waitForTimeout(SETTLE_MS);
  expect((await clicks(page)).length).toBe(1);
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
