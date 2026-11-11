import type { Backend } from '@/lib/backend';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualMealDialog } from './ManualMealDialog.js';

afterEach(cleanup);

const LONG = 'MYPROTEIN CLEAR Whey Protein PEACH TEA FLAVOUR 25g scoop with a splash of oat milk';

function renderDialog() {
  const backend = {
    mode: 'local' as const,
    listFavorites: vi.fn(async () => [
      {
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
      },
    ]),
  } as unknown as Backend;
  render(<ManualMealDialog backend={backend} open onOpenChange={vi.fn()} onLogged={vi.fn()} />);
  return screen.findByTitle(LONG);
}

/*
 * jsdom does no layout: scrollWidth and clientWidth are both 0 there, so a
 * `scrollWidth <= clientWidth` check would pass whatever the CSS did. What blew
 * the sheet out on a phone was a grid track sized to its widest child's
 * min-content (a long nowrap label), so these assert the rules that prevent it.
 * The measured overflow check was done in a real browser at 375 and 430.
 */
describe('the manual-log dialog cannot be wider than the screen', () => {
  it('constrains its grid track, so no child can widen the sheet', async () => {
    await renderDialog();
    const dialog = document.querySelector('[data-slot=dialog-content]') as HTMLElement;
    expect(dialog.className).toContain('grid-cols-[minmax(0,1fr)]');
    expect(dialog.className).toContain('w-[calc(100%-2rem)]');
    expect(dialog.className).toContain('max-w-sm');
  });

  it('truncates a long saved-meal label to one line and keeps the full text on hover', async () => {
    const chip = await renderDialog();
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
    for (const id of ['mm-name', 'mm-energyKcal', 'mm-proteinG', 'mm-carbsG', 'mm-fatG']) {
      const input = document.getElementById(id) as HTMLElement;
      expect(input.className).toContain('w-full');
      expect(input.className).toContain('min-w-0');
      expect(input.parentElement?.className).toContain('min-w-0');
    }
    const footer = document.querySelector('[data-slot=dialog-footer]') as HTMLElement;
    expect(footer.className).toContain('flex-col');
    expect(screen.getByRole('button', { name: /log meal/i })).toBeTruthy();
  });

  it('scrolls inside the viewport and keeps its bottom padding, for the keyboard', async () => {
    await renderDialog();
    const dialog = document.querySelector('[data-slot=dialog-content]') as HTMLElement;
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]');
    expect(dialog.className).toContain('overflow-y-auto');
    // Bottom padding = 1.25rem + the home-indicator inset (see index.css).
    expect(dialog.className).toContain('sheet-safe');
    await waitFor(() => expect(screen.getByRole('button', { name: /log meal/i })).toBeTruthy());
  });
});
