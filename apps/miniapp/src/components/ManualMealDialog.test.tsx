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
    expect(within(header).getByText('Add a meal')).toBeTruthy();
    // The one-line explanation belongs to the fixed header, not the body.
    expect(within(header).getByText(/no photo or AI key needed/)).toBeTruthy();
    expect(within(header).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(within(body).queryByText(/no photo or AI key needed/)).toBeNull();

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

    // Saved meals and all five fields belong to the body, in the order the
    // user fills them in.
    for (const id of FIELD_IDS) {
      expect(body.contains(field(id)), id).toBe(true);
    }
    expect([...body.querySelectorAll('input')].map((input) => input.id)).toEqual(FIELD_IDS);
    const saved = screen.getByTitle(LONG);
    expect(body.contains(saved)).toBe(true);
    expect(body.contains(field('mm-food'))).toBe(true);
    expect(
      saved.compareDocumentPosition(field('mm-food')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      field('mm-food').compareDocumentPosition(field('mm-energyKcal')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Log meal' }).closest('[data-slot=manual-body]'),
    ).toBe(null);
  });

  it('renders exactly one primary action and one Cancel, both in the footer', async () => {
    await renderDialog();
    const footer = document.querySelector('[data-slot=manual-footer]') as HTMLElement;

    // The duplicate action block in the middle of the form is what broke this
    // sheet; there must be no second Log meal anywhere in the tree.
    expect(screen.getAllByRole('button', { name: /log meal/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^cancel$/i })).toHaveLength(1);
    expect(document.querySelectorAll('[data-slot=manual-footer]')).toHaveLength(1);
    expect(footer.contains(screen.getByRole('button', { name: 'Log meal' }))).toBe(true);
    expect(footer.contains(screen.getByRole('button', { name: 'Cancel' }))).toBe(true);

    // A 48px primary slab over a 44px text Cancel: one weight of action, not
    // two equal slabs. The footer's pt-4 is the 16px above the buttons.
    expect(footer.className).toContain('flex-col');
    expect(footer.className).toContain('pt-4');
    const actions = footer.querySelector('[data-slot=dialog-actions]') as HTMLElement;
    expect(actions.className).toContain('flex-col');
    expect(actions.className).toContain('gap-2');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const primary = screen.getByRole('button', { name: 'Log meal' });
    expect(cancel.className).toContain('h-11');
    expect(cancel.className).toContain('w-full');
    expect(cancel.className).toContain('text-muted-foreground');
    expect(cancel.className).not.toContain('bg-secondary');
    expect(primary.className).toContain('h-12');
    expect(primary.className).toContain('w-full');
    expect(primary.className).toContain('bg-primary');
  });

  it('stacks the macro fields on a phone and pairs them from sm up', async () => {
    await renderDialog();
    const grid = field('mm-energyKcal').closest('div.grid') as HTMLElement;

    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('sm:grid-cols-2');
    expect(grid.className).toContain('gap-4');
    expect([...grid.querySelectorAll('input')].map((input) => input.id)).toEqual([
      'mm-energyKcal',
      'mm-proteinG',
      'mm-carbsG',
      'mm-fatG',
    ]);
  });

  it('leaves 16px between fields and makes every input 44px tall', async () => {
    await renderDialog();
    const form = document.getElementById('manual-meal-form') as HTMLFormElement;
    expect(form.className).toContain('gap-4');

    for (const id of FIELD_IDS) {
      expect(field(id).className).toContain('h-11');
      expect(field(id).className).toContain('ring-inset');
    }
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
 * 336px` and the single-column macro layout, and are asserted against the
 * structure that produces them. The test fails at the structure assertions
 * first if the footer moves inside the body (the original bug) or is taken out
 * of flow, so it cannot pass while the footer is able to cover a field.
 */
describe('the footer cannot cover a field', () => {
  it('leaves the Fat field above the footer after scrolling to the end', async () => {
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
    const headerHeight = 94;
    // 1px border + 16px pt + 48px primary + 8px gap + 44px Cancel + 16px pb.
    const footerHeight = 133;
    const headerTop = sheetTop + border; // 17
    const bodyTop = headerTop + headerHeight; // 111
    const bodyHeight = sheetHeight - 2 * border - headerHeight - footerHeight; // 335
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
    const contentHeight = 652;
    Object.defineProperty(body, 'scrollHeight', { value: contentHeight, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: bodyHeight, configurable: true });
    const maxScroll = contentHeight - bodyHeight; // 265
    expect(maxScroll).toBeGreaterThan(0);

    // Where each input starts inside the body's content, in DOM order. Fat is
    // the last field and starts below the visible body.
    const offsets: Record<string, number> = {
      'mm-food': 248,
      'mm-energyKcal': 334,
      'mm-proteinG': 420,
      'mm-carbsG': 506,
      'mm-fatG': 592,
    };

    const place = (scrollTop: number) => {
      Object.defineProperty(body, 'scrollTop', { value: scrollTop, configurable: true });
      for (const [id, offset] of Object.entries(offsets)) {
        vi.spyOn(field(id), 'getBoundingClientRect').mockReturnValue(
          rectOf({ top: bodyTop + offset - scrollTop, left: 16, width: 160, height: 44 }),
        );
      }
    };

    const visibleInBody = (id: string) => {
      const input = field(id).getBoundingClientRect();
      const viewport = body.getBoundingClientRect();
      return input.top >= viewport.top && input.bottom <= viewport.bottom;
    };

    place(0);
    const fatBefore = field('mm-fatG').getBoundingClientRect();
    expect(fatBefore.bottom).toBeGreaterThan(bodyBottom);

    // Every field can be scrolled fully into the body.
    for (const [id, offset] of Object.entries(offsets)) {
      place(Math.min(offset, maxScroll));
      expect(visibleInBody(id), id).toBe(true);
    }

    // Scrolled to the end, Fat sits entirely above the footer's top edge,
    // inside the body.
    place(maxScroll);
    const bodyBox = body.getBoundingClientRect();
    const footerBox = footer.getBoundingClientRect();
    const fat = field('mm-fatG').getBoundingClientRect();
    expect(fat.bottom).toBeLessThanOrEqual(bodyBox.bottom);
    expect(fat.bottom).toBeLessThanOrEqual(footerBox.top);
    expect(fat.top).toBeLessThan(footerBox.top);

    // The footer starts where the body ends; it never overlaps the viewport
    // that holds the fields.
    expect(footerBox.top).toBeGreaterThanOrEqual(bodyBox.bottom);

    for (const id of FIELD_IDS) {
      const input = field(id).getBoundingClientRect();
      expect(input.bottom, id).toBeLessThanOrEqual(footerBox.top);
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

    // A meal with no calories is not loggable; 0 is not a valid amount.
    fireEvent.change(kcal, { target: { value: '0' } });
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

  it('keeps the fields full width and matches the shared sheet radius', async () => {
    await renderDialog();
    for (const id of FIELD_IDS) {
      const input = field(id);
      expect(input.className).toContain('w-full');
      expect(input.className).toContain('min-w-0');
      expect(input.className).toContain('h-11');
      expect(input.parentElement?.className).toContain('min-w-0');
    }
    const dialog = document.querySelector('[data-slot=dialog-content]') as HTMLElement;
    expect(dialog.className).toContain('rounded-surface');

    const primary = screen.getByRole('button', { name: 'Log meal' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(primary.className).toContain('h-12');
    expect(primary.className).toContain('w-full');
    expect(cancel.className).toContain('h-11');
    expect(cancel.className).toContain('w-full');
  });
});
