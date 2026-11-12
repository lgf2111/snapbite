import type { Backend } from '@/lib/backend';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualMealDialog } from './ManualMealDialog.js';

afterEach(cleanup);

const LONG = 'MYPROTEIN CLEAR Whey Protein PEACH TEA FLAVOUR 25g scoop with a splash of oat milk';

const FIELD_IDS = ['mm-food', 'mm-energyKcal', 'mm-proteinG', 'mm-carbsG', 'mm-fatG'];

const FAVORITE = {
  id: 'f1',
  label: LONG,
  energyKcal: 103,
  createdAt: 1,
  meal: {
    foods: [],
    total: { energyKcal: 103, proteinG: 20, carbsG: 2, fatG: 1 },
    confidence: 0.9,
    needsConfirmation: false,
  },
};

function setup() {
  const backend = {
    mode: 'local' as const,
    listFavorites: vi.fn(async () => [FAVORITE]),
    logManual: vi.fn(async () => {}),
    removeFavorite: vi.fn(async () => {}),
  } as unknown as Backend;
  const onOpenChange = vi.fn();
  const onLogged = vi.fn();
  render(
    <ManualMealDialog backend={backend} open onOpenChange={onOpenChange} onLogged={onLogged} />,
  );
  return { backend, onOpenChange, onLogged };
}

/** Render and wait for the saved-meal list, which is fetched on open. */
async function renderDialog() {
  const tools = setup();
  await screen.findByTitle(LONG);
  return tools;
}

const field = (id: string) => document.getElementById(id) as HTMLInputElement;

type Box = { top: number; left: number; width: number; height: number };

function rectOf({ top, left, width, height }: Box): DOMRect {
  return {
    top,
    left,
    width,
    height,
    bottom: top + height,
    right: left + width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('the sheet is a header / body / footer flex column', () => {
  it('has exactly three children, and the footer is the body’s sibling', async () => {
    await renderDialog();
    const sheet = document.querySelector('[data-slot=dialog-content]') as HTMLElement;
    const header = sheet.querySelector(':scope > [data-slot=manual-header]') as HTMLElement;
    const body = sheet.querySelector(':scope > [data-slot=manual-body]') as HTMLElement;
    const footer = sheet.querySelector(':scope > [data-slot=manual-footer]') as HTMLElement;

    // Header, body, footer — nothing else. The close control lives in the
    // header, not as a floating fourth child of the sheet.
    expect([...sheet.children]).toEqual([header, body, footer]);
    expect(sheet.className).toContain('flex');
    expect(sheet.className).toContain('flex-col');
    expect(sheet.className).toContain('p-0');
    expect(sheet.className).toContain('gap-0');
    expect(sheet.className).toContain('overflow-hidden');
    // The shared panel's grid and outer scroller are replaced, not layered on
    // top: the body must be the only scrolling element in this sheet.
    const tokens = sheet.className.split(/\s+/);
    expect(tokens).not.toContain('grid');
    expect(tokens).not.toContain('overflow-y-auto');

    expect(header.className).toContain('shrink-0');
    expect(within(header).getByRole('button', { name: 'Close' })).toBeTruthy();

    // The body is the one and only scrolling region.
    expect(body.className).toContain('flex-1');
    expect(body.className).toContain('min-h-0');
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).toContain('overscroll-contain');
    expect(header.querySelector('[data-slot=manual-body]')).toBeNull();

    // The footer is outside the scrolling body, so no amount of scrolling can
    // put it over a field, and it is not lifted out of flow either.
    expect(body.contains(footer)).toBe(false);
    expect(footer.parentElement).toBe(sheet);
    expect(footer.className).toContain('shrink-0');
    expect(footer.className).not.toContain('sticky');
    expect(footer.className).not.toContain('absolute');
    expect(footer.className).not.toContain('fixed');
    expect(footer.className).not.toMatch(/-m[tbyxl]?-/);

    // Saved meals and all five fields belong to the body, never the header or
    // the footer.
    for (const id of FIELD_IDS) {
      expect(body.contains(field(id)), id).toBe(true);
    }
    expect(screen.getByTitle(LONG)).toBeTruthy();
    expect(body.contains(screen.getByTitle(LONG))).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Log meal' }).closest('[data-slot=manual-body]'),
    ).toBe(null);
  });

  it('caps its height from the keyboard inset, so the body scrolls and the footer stays up', async () => {
    await renderDialog();
    const sheet = document.querySelector('[data-slot=dialog-content]') as HTMLElement;
    expect(sheet.className).toContain('max-h-[calc(100svh-var(--keyboard-inset,0px)-2rem)]');
    expect(sheet.className).toContain('overflow-hidden');

    const body = sheet.querySelector('[data-slot=manual-body]') as HTMLElement;
    expect(body.className).toContain('flex-1');
    expect(body.className).toContain('min-h-0');
    expect(body.className).toContain('overflow-y-auto');
  });
});

/*
 * jsdom has no layout engine: every getBoundingClientRect is 0×0. The rects
 * below were measured in headless Chrome at 430×932 with `--keyboard-inset:
 * 336px`, and are asserted against the structure that produces them. The test
 * fails at the structure assertions first if the footer moves inside the body
 * (the original bug) or is taken out of flow, so it cannot pass while the
 * footer is able to cover a field.
 */
describe('the footer cannot cover a field', () => {
  it('leaves Carbs and Fat fully visible in the body after scrolling to the end', async () => {
    await renderDialog();
    const sheet = document.querySelector('[data-slot=dialog-content]') as HTMLElement;
    const header = sheet.querySelector(':scope > [data-slot=manual-header]') as HTMLElement;
    const body = sheet.querySelector(':scope > [data-slot=manual-body]') as HTMLElement;
    const footer = sheet.querySelector(':scope > [data-slot=manual-footer]') as HTMLElement;

    // Refuse to model a layout that is not a three-part column with the footer
    // after the scrolling body.
    expect([...sheet.children]).toEqual([header, body, footer]);
    expect(body.contains(footer)).toBe(false);

    // 430×932, keyboard 336px high, 1rem gap above it, 1rem from the top.
    const border = 1;
    const sheetTop = 16;
    const sheetHeight = 932 - 336 - 16 - sheetTop; // 564
    const headerHeight = 81;
    const footerHeight = 133;
    const headerTop = sheetTop + border; // 17
    const bodyTop = headerTop + headerHeight; // 98
    const bodyHeight = sheetHeight - 2 * border - headerHeight - footerHeight; // 348
    const bodyBottom = bodyTop + bodyHeight; // 446
    const width = 398;

    for (const [el, top, height] of [
      [sheet, sheetTop, sheetHeight],
      [header, headerTop, headerHeight],
      [body, bodyTop, bodyHeight],
      [footer, bodyBottom, footerHeight],
    ] as const) {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
        rectOf({ top, left: 16, width, height }),
      );
    }

    // Body content is taller than the space left by the keyboard.
    const contentHeight = 512;
    Object.defineProperty(body, 'scrollHeight', { value: contentHeight, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: bodyHeight, configurable: true });
    const maxScroll = contentHeight - bodyHeight; // 164
    expect(maxScroll).toBeGreaterThan(0);

    // Where each input starts inside the body's content, in DOM order. Carbs
    // and Fat are the last row and start below the visible body.
    const offsets: Record<string, number> = {
      'mm-food': 316,
      'mm-energyKcal': 390,
      'mm-proteinG': 390,
      'mm-carbsG': 460,
      'mm-fatG': 460,
    };

    const place = (scrollTop: number) => {
      Object.defineProperty(body, 'scrollTop', { value: scrollTop, configurable: true });
      for (const [id, offset] of Object.entries(offsets)) {
        vi.spyOn(field(id), 'getBoundingClientRect').mockReturnValue(
          rectOf({ top: bodyTop + offset - scrollTop, left: 16, width: 160, height: 36 }),
        );
      }
    };

    const visibleInBody = (id: string) => {
      const input = field(id).getBoundingClientRect();
      const viewport = body.getBoundingClientRect();
      return input.top >= viewport.top && input.bottom <= viewport.bottom;
    };

    place(0);
    // Before scrolling, the last row is under the footer's area — which is why
    // the body has to be the scroll container.
    expect(visibleInBody('mm-carbsG')).toBe(false);
    expect(visibleInBody('mm-fatG')).toBe(false);

    // Scroll to the end: every field, including the last row, is entirely
    // inside the body.
    place(maxScroll);
    for (const id of FIELD_IDS) {
      expect(visibleInBody(id), id).toBe(true);
    }
    expect(visibleInBody('mm-carbsG')).toBe(true);
    expect(visibleInBody('mm-fatG')).toBe(true);

    // The footer starts where the body ends; it never overlaps the viewport
    // that holds the fields.
    const bodyBox = body.getBoundingClientRect();
    const footerBox = footer.getBoundingClientRect();
    expect(footerBox.top).toBeGreaterThanOrEqual(bodyBox.bottom);

    for (const id of FIELD_IDS) {
      const input = field(id).getBoundingClientRect();
      expect(input.bottom, id).toBeLessThanOrEqual(footerBox.top);
      expect(input.top, id).toBeLessThan(footerBox.top);
    }
  });
});

describe('the meal-name field does not look like a contact', () => {
  it('turns autofill off and carries no person-like name attribute', async () => {
    await renderDialog();
    const input = field('mm-food');

    expect(screen.getByLabelText('What did you eat?')).toBe(input);
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('autocapitalize', 'sentences');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(input.getAttribute('name')).toBeNull();
  });
});

describe('Log meal is gated on the name and calories', () => {
  const log = () => screen.getByRole('button', { name: 'Log meal' }) as HTMLButtonElement;

  it('stays disabled until both are valid', async () => {
    await renderDialog();
    const name = field('mm-food');
    const kcal = field('mm-energyKcal');

    expect(log().disabled).toBe(true);

    fireEvent.change(name, { target: { value: 'Chicken rice' } });
    expect(log().disabled).toBe(true);

    fireEvent.change(kcal, { target: { value: '420' } });
    expect(log().disabled).toBe(false);

    fireEvent.change(name, { target: { value: '   ' } });
    expect(log().disabled).toBe(true);

    fireEvent.change(name, { target: { value: 'Chicken rice' } });
    fireEvent.change(kcal, { target: { value: '-1' } });
    expect(log().disabled).toBe(true);

    fireEvent.change(kcal, { target: { value: '' } });
    expect(log().disabled).toBe(true);
  });

  it('focuses the first field that needs fixing when submit is attempted', async () => {
    await renderDialog();
    const form = document.getElementById('manual-meal-form') as HTMLFormElement;

    fireEvent.submit(form);
    expect(document.activeElement).toBe(field('mm-food'));

    fireEvent.change(field('mm-food'), { target: { value: 'Chicken rice' } });
    fireEvent.submit(form);
    expect(document.activeElement).toBe(field('mm-energyKcal'));
  });

  it('gives Enter the same validation path as the button', async () => {
    const { backend } = await renderDialog();

    fireEvent.keyDown(field('mm-food'), { key: 'Enter' });
    expect(document.activeElement).toBe(field('mm-food'));
    expect(backend.logManual).not.toHaveBeenCalled();

    fireEvent.change(field('mm-food'), { target: { value: 'Chicken rice' } });
    fireEvent.keyDown(field('mm-food'), { key: 'Enter' });
    expect(document.activeElement).toBe(field('mm-energyKcal'));

    fireEvent.change(field('mm-energyKcal'), { target: { value: '420' } });
    fireEvent.keyDown(field('mm-energyKcal'), { key: 'Enter' });
    await waitFor(() => expect(backend.logManual).toHaveBeenCalledTimes(1));
  });

  it('logs once both fields are valid', async () => {
    const { backend, onLogged } = await renderDialog();
    const form = document.getElementById('manual-meal-form') as HTMLFormElement;

    fireEvent.change(field('mm-food'), { target: { value: 'Chicken rice' } });
    fireEvent.change(field('mm-energyKcal'), { target: { value: '420' } });
    fireEvent.submit(form);

    await waitFor(() => expect(backend.logManual).toHaveBeenCalledTimes(1));
    expect(onLogged).toHaveBeenCalledTimes(1);
  });
});

describe('the sheet cannot be wider than the screen', () => {
  it('constrains its grid track, so no child can widen the sheet', async () => {
    await renderDialog();
    const dialog = document.querySelector('[data-slot=dialog-content]') as HTMLElement;
    expect(dialog.className).toContain('grid-cols-[minmax(0,1fr)]');
    expect(dialog.className).toContain('w-[calc(100%-2rem)]');
    expect(dialog.className).toContain('max-w-sm');
  });

  it('truncates a long saved-meal label to one line and keeps the full text on hover', async () => {
    await renderDialog();
    const chip = screen.getByTitle(LONG);
    const label = chip.querySelector('span') as HTMLElement;
    expect(label.textContent).toBe(LONG);
    expect(label.className).toContain('truncate');
    expect(label.className).toContain('min-w-0');
    expect(chip.getAttribute('title')).toBe(LONG);
    // Every flex ancestor up to the dialog may shrink below its content.
    for (let el = chip as HTMLElement | null; el && !el.dataset.slot; el = el.parentElement) {
      if (el.className.includes('flex') && el !== chip.parentElement?.parentElement) {
        expect(el.className, el.className).toMatch(/min-w-0|overflow-y-auto/);
      }
    }
    expect(chip.parentElement?.className).toContain('min-w-0');
  });

  it('keeps the fields and the primary button full width inside the sheet', async () => {
    await renderDialog();
    for (const id of FIELD_IDS) {
      const input = field(id);
      expect(input.className).toContain('w-full');
      expect(input.className).toContain('min-w-0');
      expect(input.parentElement?.className).toContain('min-w-0');
    }
    const log = screen.getByRole('button', { name: 'Log meal' });
    expect(log.className).toContain('w-full');
    expect(log.className).toContain('h-12');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });
});
