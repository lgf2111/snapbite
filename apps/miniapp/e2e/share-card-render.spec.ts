import { expect, test } from '@playwright/test';

/**
 * A real-canvas test for the exported meal card. jsdom has no rasterizer and a
 * screenshot of the share sheet would depend on the device, the CSS theme and
 * the sheet's layout, so the card is painted at its export size (1080×1350)
 * into an offscreen canvas with a synthetic photo, and the pixels are read
 * back. `drawMealCard` is exported for exactly this: no image loading, no
 * `toBlob`, no device.
 *
 * The source photo is 3:4 portrait, 900×1200, in 100 px red/green bands.
 * `object-fit: cover` at 1080×810 scales it 1.2× to 1080×1440, so it overflows
 * the photo band by 315 px above and below: enough to cover the title, the
 * kcal line and the macros if the draw is not clipped.
 */

const CARD = { width: 1080, height: 1350, photoHeight: 810 };
const SOURCE = { width: 900, height: 1200, band: 100 };

/** The card's fallback light theme, passed explicitly so pixels are exact. */
const THEME = {
  card: '#edf2fb',
  foreground: '#0f172a',
  muted: '#5a6780',
  secondary: '#e3eaf7',
  border: '#b6c7e3',
};

const CARD_RGB = [237, 242, 251];
const BORDER_RGB = [182, 199, 227];

type Rgb = [number, number, number];

test('the cover photo is clipped to the photo band and never paints over the text', async ({
  page,
}) => {
  await page.goto('/');

  const report = await page.evaluate(
    async ({ card, source, theme }) => {
      // The module the app actually ships, through the dev server. A variable
      // specifier keeps the test runner from trying to bundle it.
      const moduleUrl = '/src/lib/shareCard.ts';
      const mod = await import(moduleUrl);

      // The synthetic photo: alternating red/green horizontal bands.
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = source.width;
      sourceCanvas.height = source.height;
      const sourceCtx = sourceCanvas.getContext('2d');
      if (!sourceCtx) throw new Error('No 2D context for the source');
      for (let y = 0; y < source.height; y += source.band) {
        sourceCtx.fillStyle = (y / source.band) % 2 === 0 ? '#ff0000' : '#00ff00';
        sourceCtx.fillRect(0, y, source.width, source.band);
      }
      const photo = new Image();
      photo.src = sourceCanvas.toDataURL('image/png');
      await photo.decode();

      const canvas = document.createElement('canvas');
      canvas.width = card.width;
      canvas.height = card.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No 2D context for the card');

      mod.drawMealCard(
        ctx,
        { title: 'Chicken rice bowl', calories: 512, proteinG: 32, carbsG: 61, fatG: 14 },
        { photo, logo: null },
        theme,
      );

      const data = ctx.getImageData(0, 0, card.width, card.height).data;
      const at = (x: number, y: number): Rgb => {
        const i = (y * card.width + x) * 4;
        return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
      };
      const isStripe = ([r, g, b]: Rgb) =>
        (r > 200 && g < 60 && b < 60) || (g > 200 && r < 60 && b < 60);
      const countStripes = (x0: number, x1: number, y0: number, y1: number) => {
        let n = 0;
        for (let y = y0; y <= y1; y += 1) {
          for (let x = x0; x <= x1; x += 1) {
            if (isStripe(at(x, y))) n += 1;
          }
        }
        return n;
      };
      const same = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
      const cardRgb: Rgb = [237, 242, 251];

      // The title's alphabetic baseline: top-aligned at 844, ~0.8em down.
      const titleRow = card.photoHeight + 34 + 36;

      // The lowest row below the photo that carries any ink, excluding the
      // hairline itself (rows H-2 and H-1). If the footer or macros crossed
      // the bottom, this would reach the border.
      let lastInkRow = -1;
      for (let y = card.photoHeight + 1; y < card.height - 2; y += 1) {
        for (let x = 3; x < card.width - 3; x += 1) {
          if (!same(at(x, y), cardRgb)) {
            lastInkRow = y;
            break;
          }
        }
      }

      return {
        belowPhoto: [at(90, 814), at(540, 814), at(990, 814)],
        insidePhoto: at(540, 400),
        insidePhotoIsStripe: isStripe(at(540, 400)),
        titleRow,
        titleRowStripes: countStripes(0, card.width - 1, titleRow, titleRow),
        titleBandStripes: countStripes(0, card.width - 1, 844, 898),
        // Everything below the photo band, up to the hairline.
        textAreaStripes: countStripes(0, card.width - 1, card.photoHeight + 1, card.height - 3),
        lastInkRow,
        hairlineTop: at(540, card.height - 2),
        hairlineBottom: at(540, card.height - 1),
      };
    },
    { card: CARD, source: SOURCE, theme: THEME },
  );

  console.log('share card pixels', JSON.stringify(report));
  test.info().annotations.push({ type: 'pixels', description: JSON.stringify(report) });

  // Just below the photo band, left/centre/right: the card surface, no stripe.
  expect(report.belowPhoto).toEqual([CARD_RGB, CARD_RGB, CARD_RGB]);

  // Inside the band the cover crop is a stripe, so the sample is meaningful.
  expect(report.insidePhotoIsStripe).toBe(true);

  // The title's baseline row, and its whole band, carry no photo pixels.
  expect(report.titleRowStripes).toBe(0);
  expect(report.titleBandStripes).toBe(0);

  // Nothing from the photo reaches the title, kcal line, macros or footer.
  expect(report.textAreaStripes).toBe(0);

  // The macro row and footer finish above the hairline, which is intact.
  expect(report.lastInkRow).toBeGreaterThan(900);
  expect(report.lastInkRow).toBeLessThan(CARD.height - 2);
  expect(report.hairlineTop).toEqual(BORDER_RGB);
  expect(report.hairlineBottom).toEqual(BORDER_RGB);
});
