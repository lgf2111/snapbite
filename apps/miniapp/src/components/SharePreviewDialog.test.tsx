import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharePreviewDialog } from './SharePreviewDialog.js';

afterEach(cleanup);

const CARD = {
  photoUrl: '/api/meal-photo/m1',
  title: 'Chicken rice bowl',
  calories: 512,
  proteinG: 32,
  carbsG: 61,
  fatG: 14,
};

function renderDialog(
  overrides: {
    sharing?: boolean;
    onShare?: () => void;
    onOpenChange?: (open: boolean) => void;
  } = {},
) {
  const onShare = overrides.onShare ?? vi.fn();
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  render(
    <SharePreviewDialog
      open
      onOpenChange={onOpenChange}
      card={CARD}
      sharing={overrides.sharing ?? false}
      onShare={onShare}
    />,
  );
  return { onShare, onOpenChange };
}

function parts() {
  return {
    sheet: document.querySelector('[data-slot=dialog-content]') as HTMLElement,
    region: screen.getByTestId('share-card-region'),
    footer: screen.getByTestId('share-preview-footer'),
    card: screen.getByTestId('share-card'),
  };
}

describe('SharePreviewDialog', () => {
  it('shows the card, a 48 px Share and a text Cancel with a 44 px target', () => {
    const { onShare, onOpenChange } = renderDialog();

    expect(screen.getByTestId('share-card')).toBeTruthy();

    const share = screen.getByRole('button', { name: 'Share meal' });
    expect(share.className).toContain('h-12');
    expect(share.className).toContain('w-full');

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    // A text link: no filled slab competing with the primary action.
    expect(cancel.className).toContain('min-h-11');
    expect(cancel.className).toContain('w-full');
    expect(cancel.className).toContain('text-primary-text');
    expect(cancel.className).not.toContain('bg-secondary');
    expect(cancel.className).not.toContain('bg-primary');

    // The sheet has no extra close X: Cancel is the way out.
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();

    fireEvent.click(share);
    expect(onShare).toHaveBeenCalledTimes(1);
    fireEvent.click(cancel);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('sits directly on the sheet surface: no second inner card, no padding frame', () => {
    renderDialog();
    const { sheet, card } = parts();

    expect(sheet.className).toContain('p-0');
    expect(sheet.className).toContain('gap-0');
    expect(sheet.className).toContain('rounded-t-surface');
    expect(sheet.className).toContain('rounded-b-none');
    expect(sheet.className).toContain('border');
    expect(sheet.className).toContain('bg-card');
    // The card itself is flush with the sheet, with no border of its own.
    expect(card.className).not.toContain('border');
    expect(card.className).not.toMatch(/\brounded\b/);
  });

  it('is one column: the card region, then a shrink-0 footer sibling', () => {
    renderDialog();
    const { sheet, region, footer, card } = parts();

    expect(sheet.className).toContain('flex');
    expect(sheet.className).toContain('flex-col');

    // The card lives inside the only region that may take the leftover height.
    expect(region.className).toContain('min-h-0');
    expect(region.className).toContain('flex-1');
    expect(region.className).toContain('overflow-hidden');
    expect(region.contains(card)).toBe(true);

    // The footer comes after the region, not inside it: it can never be
    // interleaved with the card or scrolled out from under the actions.
    expect(region.contains(footer)).toBe(false);
    expect(region.nextElementSibling).toBe(footer);
    expect(footer.className).toContain('shrink-0');
    expect(footer.contains(screen.getByRole('button', { name: 'Share meal' }))).toBe(true);
    expect(footer.contains(screen.getByRole('button', { name: 'Cancel' }))).toBe(true);
  });

  it('caps the sheet above the tab bar and never scrolls it', () => {
    renderDialog();
    const { sheet } = parts();

    // The shell is short enough to leave the 72 px bar plus the bottom inset
    // and a 1 rem gap free, and it sits above the bar instead of behind it.
    expect(sheet.className).toContain(
      'max-h-[calc(100svh-var(--spacing-bar)-env(safe-area-inset-bottom)-1rem)]',
    );
    expect(sheet.className).toContain(
      'bottom-[calc(var(--spacing-bar)+env(safe-area-inset-bottom)+1rem)]',
    );
    // One surface: the sheet itself is not a scroll container. The card scales
    // to fit, so no region needs to scroll at all.
    expect(sheet.className).toContain('overflow-hidden');
    expect(sheet.className).toContain('overflow-y-hidden');
    expect(sheet.className).not.toContain('overflow-y-auto');
  });

  it('sizes the card from the space the footer leaves, not the viewport width', () => {
    renderDialog();
    const { sheet } = parts();
    const sized = sheet.querySelector<HTMLElement>(
      '[class*="100svh"][class*="8.3125rem"]',
    ) as HTMLElement;

    expect(sized).toBeTruthy();
    // Height-driven 4:5 width: min(100%, (max sheet height - 133 px footer -
    // the 2 px sheet hairline) × 0.8).
    expect(sized.className).toContain('w-[min(100%,calc((100svh');
    expect(sized.className).toContain('8.3125rem_-_2px)_*_0.8)');
    expect(sized.querySelector('[data-testid="share-card"]')).toBeTruthy();
  });

  it('fits the natural card and footer above the bar on both target screens', () => {
    // calc(100% - 2rem) at each width, minus the 1 px border on each side.
    const sheetWidth = { 430: 430 - 32 - 2, 375: 375 - 32 - 2 };
    // hairline + p-4 + Share + gap + Cancel + p-4
    const footer = 1 + 16 + 48 + 8 + 44 + 16;
    for (const [viewport, width] of [
      [932, sheetWidth[430]],
      [667, sheetWidth[375]],
    ] as const) {
      const cardWidth = Math.min(width, (viewport - 72 - 16 - footer - 2) * (4 / 5));
      const sheetHeight = cardWidth * (5 / 4) + footer + 2;
      expect(cardWidth).toBe(width);
      expect(sheetHeight).toBeLessThanOrEqual(viewport - 72 - 16);
    }
  });

  it('scales the card down instead of cropping it when the screen is short', () => {
    // A 375×568 screen: the natural 341 px card is too tall, so the height term
    // takes over and the whole card scales to 4:5 of the space above the footer.
    const viewport = 568;
    const footer = 133;
    const naturalWidth = 375 - 32 - 2;
    const cardWidth = Math.min(naturalWidth, (viewport - 72 - 16 - footer - 2) * (4 / 5));
    const cardHeight = cardWidth * (5 / 4);
    expect(cardWidth).toBeLessThan(naturalWidth);
    expect(cardHeight + footer + 2).toBeLessThanOrEqual(viewport - 72 - 16);
  });

  it('shows the sharing state and disables both actions', () => {
    renderDialog({ sharing: true });
    expect(screen.getByRole('button', { name: 'Sharing…' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
  });
});
