import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMealShareCard } from './shareCard.js';

/*
 * jsdom has no canvas rasterizer. The fake context records what the card asks
 * it to draw, which is enough to pin the parts of the design that a screenshot
 * would show: the title below the photo, the calorie line, three centred macro
 * columns at equal centres, and the wordmark as the only text over the photo.
 * The sheet's 430×932 layout is pinned by class/arithmetic in
 * SharePreviewDialog.test.tsx (jsdom does no layout).
 */

interface TextCall {
  text: string;
  x: number;
  y: number;
  align: string;
  font: string;
}

let calls: TextCall[];
let canvas: HTMLCanvasElement | null;

function makeContext(): CanvasRenderingContext2D {
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    fill() {},
    stroke() {},
    save() {},
    restore() {},
    clip() {},
    rect() {},
    drawImage() {},
    fillText(text: string, x: number, y: number) {
      calls.push({ text, x, y, align: ctx.textAlign, font: ctx.font });
    },
    measureText(text: string) {
      // A deterministic width is all truncation needs: 0.5 em per character.
      const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? '10');
      return { width: text.length * size * 0.5 } as TextMetrics;
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  calls = [];
  canvas = null;

  const createElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = createElement(tag);
    if (tag === 'canvas') canvas = el as HTMLCanvasElement;
    return el;
  });

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(makeContext());
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
    cb(new Blob(['png'], { type: 'image/png' }));
  });

  // Both the logo and the meal photo load through `new Image()`. Resolve on the
  // next microtask, with dimensions a cover-crop can use.
  vi.stubGlobal(
    'Image',
    class {
      width = 1600;
      height = 1200;
      crossOrigin = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        Promise.resolve().then(() => this.onload?.());
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CARD = {
  photoUrl: '/api/meal-photo/m1',
  title: 'Chicken rice bowl',
  calories: 512,
  proteinG: 32,
  carbsG: 61,
  fatG: 14,
};

describe('renderMealShareCard', () => {
  it('draws a 4:5 card with the title below the photo and centred macro columns', async () => {
    const blob = await renderMealShareCard(CARD);

    expect(blob.type).toBe('image/png');
    expect(canvas?.width).toBe(1080);
    expect(canvas?.height).toBe(1350);

    // The photo is the top 60% (810 px); the title starts below it.
    const title = calls.find((c) => c.text === 'Chicken rice bowl');
    expect(title).toBeDefined();
    expect(title?.x).toBe(45);
    expect(title?.y).toBeGreaterThan(810);

    const kcal = calls.find((c) => c.text === '512');
    expect(kcal).toBeDefined();
    expect(kcal?.y).toBeGreaterThan(title?.y ?? 0);
    expect(calls.some((c) => c.text === 'kcal')).toBe(true);

    const columns = [
      ['Protein', '32g'],
      ['Carbs', '61g'],
      ['Fat', '14g'],
    ] as const;
    const centres = columns.map(([label, value]) => {
      const labelCall = calls.find((c) => c.text === label);
      const valueCall = calls.find((c) => c.text === value);
      expect(labelCall).toBeDefined();
      expect(valueCall).toBeDefined();
      // Both the label and its number are centred at the same x.
      expect(labelCall?.align).toBe('center');
      expect(valueCall?.align).toBe('center');
      expect(valueCall?.x).toBeCloseTo(labelCall?.x ?? 0);
      expect(valueCall?.y).toBeGreaterThan(labelCall?.y ?? 0);
      return valueCall?.x ?? 0;
    });
    // Three equal columns: (1080 - 2×45) / 3 = 330 wide, centres at 210/540/870.
    expect(centres[0]).toBeCloseTo(210);
    expect(centres[1]).toBeCloseTo(540);
    expect(centres[2]).toBeCloseTo(870);
  });

  it('keeps the meal title off the photo: only the wordmark pill sits over it', async () => {
    await renderMealShareCard(CARD);

    const overPhoto = calls.filter((c) => c.y < 810);
    expect(overPhoto.some((c) => c.text === 'Chicken rice bowl')).toBe(false);
    expect(overPhoto.some((c) => c.text === 'SnapBite')).toBe(true);
  });

  it('draws the secondary panel with the wordmark when there is no photo', async () => {
    await renderMealShareCard({ ...CARD, photoUrl: null });

    expect(calls.some((c) => c.text === 'SnapBite')).toBe(true);
    expect(calls.some((c) => c.text === 'Chicken rice bowl')).toBe(true);
    expect(calls.some((c) => c.text === '512')).toBe(true);
  });

  it('ellipsizes a title that cannot fit on one line', async () => {
    await renderMealShareCard({ ...CARD, title: 'A'.repeat(80) });
    const title = calls.find((c) => c.text.endsWith('…'));
    expect(title).toBeDefined();
  });
});
