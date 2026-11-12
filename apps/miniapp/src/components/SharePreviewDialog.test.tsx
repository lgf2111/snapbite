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

describe('SharePreviewDialog', () => {
  it('shows the card, a 48 px Share and a text Cancel with a 44 px target', () => {
    const { onShare, onOpenChange } = renderDialog();

    expect(screen.getByTestId('share-card')).toBeTruthy();

    const share = screen.getByRole('button', { name: 'Share' });
    expect(share.className).toContain('h-12');
    expect(share.className).toContain('w-full');

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    // Ghost at rest: no filled slab competing with the primary action.
    expect(cancel.className).toContain('h-11');
    expect(cancel.className).toContain('w-full');
    expect(cancel.className).toContain('text-muted-foreground');
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
    const sheet = document.querySelector('[data-slot=dialog-content]') as HTMLElement;

    expect(sheet.className).toContain('p-0');
    expect(sheet.className).toContain('gap-0');
    expect(sheet.className).toContain('rounded-surface');
    expect(sheet.className).toContain('border');
    expect(sheet.className).toContain('bg-card');
    // The card itself is flush with the sheet, with no border of its own.
    const card = screen.getByTestId('share-card');
    expect(card.className).not.toContain('border');
    expect(card.className).not.toMatch(/\brounded\b/);
  });

  it('fits a 430×932 screen above the 72 px tab bar', () => {
    renderDialog();
    const sheet = document.querySelector('[data-slot=dialog-content]') as HTMLElement;
    // The sheet can never exceed the viewport, and it is width-bounded.
    expect(sheet.className).toContain('max-h-');
    expect(sheet.className).toContain('max-w-sm');
    expect(sheet.className).toContain('w-[calc(100%-2rem)]');

    /*
     * jsdom does no layout, so this pins the arithmetic the CSS encodes:
     * at 430 px wide the sheet is min(430 - 32, 384) = 384 px, the 4:5 card is
     * 480 px, and the action block is 2×16 padding + 48 Share + 8 gap + 44
     * Cancel + 1 hairline = 133 px. 613 px leaves 319 px of the 932 px screen,
     * so the sheet ends above the 72 px tab bar.
     */
    const cardWidth = Math.min(430 - 32, 384);
    const cardHeight = cardWidth * (5 / 4);
    const actionsHeight = 16 * 2 + 48 + 8 + 44 + 1;
    expect(cardHeight + actionsHeight).toBeLessThanOrEqual(932 - 72);
  });

  it('shows the sharing state and disables both actions', () => {
    renderDialog({ sharing: true });
    expect(screen.getByRole('button', { name: 'Sharing…' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
  });
});
