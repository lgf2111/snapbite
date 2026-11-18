import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * The share sheet in a real browser, at both target phone widths and with four
 * real JPEG aspect ratios. The generated photos are painted once and served to
 * the page, so the `<img>` decodes at its true 1:1, 3:4, 16:9 or 9:16 size and
 * the photo frame is measured against a real image, not a mock.
 *
 * The geometry assertions are the owner's four rules:
 *   (a) card, Share and Cancel never intersect;
 *   (b) the card ends above the footer;
 *   (c) the footer ends above the tab bar;
 *   (d) the image box equals the photo frame box for every source ratio.
 */

const OUT = path.join('test-results', 'share-preview');

const PHOTOS = [
  { name: '1x1', width: 900, height: 900 },
  { name: '3x4', width: 900, height: 1200 },
  { name: '16x9', width: 1600, height: 900 },
  { name: '9x16', width: 900, height: 1600 },
] as const;

const VIEWPORTS = [
  { width: 430, height: 932 },
  { width: 375, height: 667 },
] as const;

type Box = { x: number; y: number; width: number; height: number };

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test.beforeAll(async ({ browser }) => {
  await mkdir(path.join(OUT, 'photos'), { recursive: true });
  await mkdir(path.join(OUT, 'screenshots'), { recursive: true });

  const page = await browser.newPage();
  for (const photo of PHOTOS) {
    const dataUrl = await page.evaluate(({ width, height, name }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No 2D context');

      // A table, a plate and a meal, drawn large enough that a cover crop is
      // obvious in the screenshot. The four corner marks make any letterbox
      // or stretch visible at a glance.
      const bg = ctx.createLinearGradient(0, 0, width, height);
      bg.addColorStop(0, '#c98d5a');
      bg.addColorStop(0.55, '#8f5a36');
      bg.addColorStop(1, '#4b2e1f');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const plate = Math.min(width, height) * 0.36;
      ctx.fillStyle = '#f5f0e6';
      ctx.beginPath();
      ctx.arc(cx, cy, plate, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(6, plate * 0.035);
      ctx.strokeStyle = '#d9cdb8';
      ctx.stroke();

      const food = [
        ['#d6542f', -0.34, -0.12, 0.34],
        ['#e8b23a', 0.28, -0.26, 0.28],
        ['#3f7d3a', 0.05, 0.3, 0.32],
        ['#f2e2b8', -0.22, 0.34, 0.22],
      ] as const;
      for (const [color, dx, dy, size] of food) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx + plate * dx, cy + plate * dy, plate * size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `600 ${Math.round(Math.min(width, height) * 0.055)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, cx, cy);

      // Corner marks, 4% in from each edge.
      const m = Math.min(width, height) * 0.04;
      ctx.fillStyle = '#ff2d55';
      for (const [x, y] of [
        [0, 0],
        [width - m, 0],
        [0, height - m],
        [width - m, height - m],
      ] as const) {
        ctx.fillRect(x, y, m, m);
      }

      return canvas.toDataURL('image/jpeg', 0.92);
    }, photo);

    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    await writeFile(path.join(OUT, 'photos', `${photo.name}.jpg`), Buffer.from(base64, 'base64'));
  }
  await page.close();
});

for (const viewport of VIEWPORTS) {
  for (const photo of PHOTOS) {
    test(`composes at ${viewport.width}x${viewport.height} with a ${photo.name} photo`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);

      // The generated JPEG, served to the real `<img>`. Match the pathname, not
      // the whole URL: the page's own query string contains `/photos/...jpg`.
      await page.route(
        (url) => url.pathname.startsWith('/photos/'),
        async (route) => {
          const file = path.join(OUT, 'photos', `${photo.name}.jpg`);
          await route.fulfill({ path: file, contentType: 'image/jpeg' });
        },
      );

      await page.goto(`/e2e/share-preview.html?photo=/photos/${photo.name}.jpg`);
      await page.waitForSelector('[data-testid=share-card-photo-img]');
      await page.waitForFunction(() => {
        const img = document.querySelector<HTMLImageElement>('[data-testid=share-card-photo-img]');
        return img?.complete === true && img.naturalWidth > 0;
      });
      // Let the Radix slide-in finish before measuring or shooting.
      await page.waitForTimeout(300);
      // The sheet autofocuses Share; a touch open has no focus ring. Drop it so
      // the screenshot shows the surface, not the keyboard affordance.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

      const m = await page.evaluate(() => {
        const one = (selector: string) => {
          const el = document.querySelector<HTMLElement>(selector);
          if (!el) throw new Error(`Missing ${selector}`);
          return el;
        };
        const box = (el: Element): Box => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        const card = one('[data-testid=share-card]');
        const img = one('[data-testid=share-card-photo-img]') as HTMLImageElement;
        const macros = one('[data-testid=share-card-macros]');
        const kcal = card.querySelectorAll('p')[0]?.querySelector('span');
        const wordmark = one('[data-testid=share-card-wordmark]');

        const scrollContainers: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(
          '[data-slot=dialog-content], [data-slot=dialog-content] *',
        )) {
          const overflowY = getComputedStyle(el).overflowY;
          if (overflowY === 'auto' || overflowY === 'scroll') {
            scrollContainers.push(el.getAttribute('data-testid') ?? el.tagName.toLowerCase());
          }
        }

        return {
          sheet: box(one('[data-slot=dialog-content]')),
          region: box(one('[data-testid=share-card-region]')),
          footer: box(one('[data-testid=share-preview-footer]')),
          card: box(card),
          frame: box(one('[data-testid=share-card-photo]')),
          photo: box(img),
          share: box(
            [...document.querySelectorAll('button')].find(
              (b) => b.textContent?.trim() === 'Share meal',
            ) as HTMLElement,
          ),
          cancel: box(
            [...document.querySelectorAll('button')].find(
              (b) => b.textContent?.trim() === 'Cancel',
            ) as HTMLElement,
          ),
          tabBar: box(one('[data-testid=tab-bar]')),
          kcal: kcal ? box(kcal) : null,
          wordmark: box(wordmark),
          photoStyle: {
            fit: getComputedStyle(img).objectFit,
            position: getComputedStyle(img).objectPosition,
          },
          natural: { width: img.naturalWidth, height: img.naturalHeight },
          macros: [...macros.querySelectorAll('dt, dd')].map((el) => {
            const r = el.getBoundingClientRect();
            return {
              text: el.textContent,
              width: r.width,
              height: r.height,
              scrollWidth: el.scrollWidth,
              lineHeight: Number.parseFloat(getComputedStyle(el).lineHeight),
            };
          }),
          scrollContainers,
          viewport: { width: innerWidth, height: innerHeight },
        };
      });

      const screenshot = path.join(
        OUT,
        'screenshots',
        `${photo.name}-${viewport.width}x${viewport.height}.png`,
      );
      await page.screenshot({ path: screenshot });
      test.info().annotations.push({ type: 'screenshot', description: screenshot });
      console.log('share preview', photo.name, `${viewport.width}x${viewport.height}`, screenshot);

      // The real JPEG, at the ratio the case names.
      expect(m.natural).toEqual({ width: photo.width, height: photo.height });

      // The sheet is the 2 rem-inset column, centred.
      expect(m.sheet.width).toBeCloseTo(viewport.width - 32, 0);
      expect(m.sheet.x).toBeCloseTo(16, 0);

      // (a) The three actions never share a pixel.
      expect(intersects(m.card, m.share)).toBe(false);
      expect(intersects(m.card, m.cancel)).toBe(false);
      expect(intersects(m.share, m.cancel)).toBe(false);

      // (b) The card finishes above the footer, inside the card region.
      expect(m.card.y + m.card.height).toBeLessThanOrEqual(m.footer.y + 0.5);
      expect(m.card.y).toBeGreaterThanOrEqual(m.region.y - 0.5);
      expect(m.card.x).toBeGreaterThanOrEqual(m.region.x - 0.5);
      expect(m.card.x + m.card.width).toBeLessThanOrEqual(m.region.x + m.region.width + 0.5);

      // (c) The footer, and therefore both actions, clears the tab bar.
      expect(m.footer.y + m.footer.height).toBeLessThanOrEqual(m.tabBar.y + 0.5);
      expect(m.share.y + m.share.height).toBeLessThanOrEqual(m.tabBar.y + 0.5);
      expect(m.cancel.y + m.cancel.height).toBeLessThanOrEqual(m.tabBar.y + 0.5);

      // The sheet itself is not a scroller; nothing can push the footer away.
      expect(m.scrollContainers).toEqual([]);

      // (d) No letterboxing: the cover image fills the frame exactly.
      expect(m.photoStyle).toEqual({ fit: 'cover', position: '50% 50%' });
      expect(Math.abs(m.photo.x - m.frame.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(m.photo.y - m.frame.y)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(m.photo.width - m.frame.width)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(m.photo.height - m.frame.height)).toBeLessThanOrEqual(0.5);

      // The photo is the top 60% of the card.
      expect(Math.abs(m.frame.height - m.card.height * 0.6)).toBeLessThanOrEqual(1);

      // Type is composed, not cramped: the kcal numeral keeps 12 px from the
      // edge, the wordmark keeps its 12 px inset and 40% cap, and no macro
      // label or value wraps.
      expect(m.kcal).not.toBeNull();
      if (m.kcal) {
        expect(m.kcal.x - m.card.x).toBeGreaterThanOrEqual(11.5);
        expect(m.card.x + m.card.width - (m.kcal.x + m.kcal.width)).toBeGreaterThanOrEqual(11.5);
      }
      expect(m.wordmark.x - m.card.x).toBeCloseTo(12, 0);
      expect(m.wordmark.y - m.card.y).toBeCloseTo(12, 0);
      expect(m.wordmark.width).toBeLessThanOrEqual(m.card.width * 0.4 + 0.5);

      expect(m.macros).toHaveLength(6);
      for (const macro of m.macros) {
        expect(macro.scrollWidth).toBeLessThanOrEqual(Math.ceil(macro.width));
        expect(macro.height).toBeLessThanOrEqual(macro.lineHeight * 1.5);
      }
    });
  }
}

test('shrinks the whole card on a short screen instead of cropping it or the footer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 568 });
  await page.route(
    (url) => url.pathname.startsWith('/photos/'),
    (route) =>
      route.fulfill({
        path: path.join(OUT, 'photos', '9x16.jpg'),
        contentType: 'image/jpeg',
      }),
  );
  await page.goto('/e2e/share-preview.html?photo=/photos/9x16.jpg');
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>('[data-testid=share-card-photo-img]');
    return img?.complete === true && img.naturalWidth > 0;
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const m = await page.evaluate(() => {
    const one = (selector: string) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`Missing ${selector}`);
      return el;
    };
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const card = one('[data-testid=share-card]');
    const paragraphs = card.querySelectorAll('p');
    const caption = paragraphs[paragraphs.length - 1] as HTMLElement;
    return {
      card: box(card),
      footer: box(one('[data-testid=share-preview-footer]')),
      tabBar: box(one('[data-testid=tab-bar]')),
      frame: box(one('[data-testid=share-card-photo]')),
      photo: box(one('[data-testid=share-card-photo-img]')),
      caption: box(caption),
      macros: [...one('[data-testid=share-card-macros]').querySelectorAll('dt, dd')].map((el) => ({
        scrollWidth: el.scrollWidth,
        width: el.getBoundingClientRect().width,
      })),
    };
  });

  const screenshot = path.join(OUT, 'screenshots', '9x16-375x568.png');
  await page.screenshot({ path: screenshot });
  test.info().annotations.push({ type: 'screenshot', description: screenshot });

  // The natural card would be 341 px wide; here the height term wins and the
  // card keeps its 4:5 shape at a smaller width.
  expect(m.card.width).toBeLessThan(341);
  expect(m.card.width / m.card.height).toBeCloseTo(0.8, 1);

  // Nothing is cropped and the footer still clears the bar.
  expect(m.card.y + m.card.height).toBeLessThanOrEqual(m.footer.y + 0.5);
  expect(m.footer.y + m.footer.height).toBeLessThanOrEqual(m.tabBar.y + 0.5);
  expect(m.caption.y + m.caption.height).toBeLessThanOrEqual(m.card.y + m.card.height - 1);
  expect(m.photo.width).toBeCloseTo(m.frame.width, 0);
  expect(m.photo.height).toBeCloseTo(m.frame.height, 0);
  for (const macro of m.macros) {
    expect(macro.scrollWidth).toBeLessThanOrEqual(Math.ceil(macro.width));
  }
});
