import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOAST_OFFSET, Toaster } from './sonner.js';

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

afterEach(() => {
  cleanup();
  toast.dismiss();
});

describe('Toaster placement', () => {
  it('clears the tab bar and the bottom safe area', () => {
    expect(TOAST_OFFSET.bottom).toContain('var(--spacing-bar)');
    expect(TOAST_OFFSET.bottom).toContain('env(safe-area-inset-bottom');
  });

  it('keeps the sides off the curved edges', () => {
    expect(TOAST_OFFSET.left).toMatch(/max\(16px, env\(safe-area-inset-left/);
    expect(TOAST_OFFSET.right).toMatch(/max\(16px, env\(safe-area-inset-right/);
  });

  it('hands the same offsets to sonner for wide and narrow screens', async () => {
    const { container } = render(<Toaster />);
    act(() => {
      toast('Logged 612 kcal');
    });

    await waitFor(() => expect(document.querySelector('[data-sonner-toaster]')).toBeTruthy());
    const list = document.querySelector<HTMLElement>('[data-sonner-toaster]');
    const style = list?.getAttribute('style') ?? '';
    for (const prefix of ['--offset', '--mobile-offset']) {
      expect(style).toContain(`${prefix}-bottom: ${TOAST_OFFSET.bottom}`);
      expect(style).toContain(`${prefix}-left: ${TOAST_OFFSET.left}`);
      expect(style).toContain(`${prefix}-right: ${TOAST_OFFSET.right}`);
    }
    expect(container).toBeTruthy();
  });
});

describe('Toaster styling', () => {
  it('draws the toast on the level-2 surface and the action in brand text', async () => {
    render(<Toaster />);
    act(() => {
      toast('Meal deleted', { action: { label: 'Undo', onClick: () => {} } });
    });

    const message = await screen.findByText('Meal deleted');
    const li = message.closest('[data-sonner-toast]') as HTMLElement;
    const style = li.getAttribute('style') ?? '';
    expect(style).toContain('var(--card)');
    expect(style).toContain('var(--radius-surface)');
    expect(style).toContain('var(--lift)');

    const action = within(li).getByRole('button', { name: 'Undo' });
    expect(action.style.color).toBe('var(--primary-text)');
    expect(action.style.fontWeight).toBe('500');
  });

  it('names an error in words, with no red glyph', async () => {
    render(<Toaster />);
    act(() => {
      toast.error('Could not delete');
    });

    await screen.findByText('Could not delete');
    expect(css).toMatch(
      /\[data-sonner-toast\]\[data-type="error"\] \[data-icon\]\s*\{\s*display: none;/,
    );
  });
});

describe('Toaster dismissal gestures', () => {
  // jsdom has no pointer capture; sonner calls it on pointerdown.
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};

  const pointer = (type: string, x: number, y: number) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: x,
      clientY: y,
      buttons: type === 'pointerup' ? 0 : 1,
    });

  async function showToast() {
    const onDismiss = vi.fn();
    render(<Toaster />);
    act(() => {
      toast('Logged 612 kcal', { duration: Number.POSITIVE_INFINITY, onDismiss });
    });
    const message = await screen.findByText('Logged 612 kcal');
    const li = message.closest('[data-sonner-toast]') as HTMLElement;
    return { message, li, onDismiss };
  }

  /**
   * A drag from the message: down, a few moves, up. Each event gets its own
   * act(): sonner decides the axis in React state on the first move and reads it
   * on the next, so they cannot all land in one batch.
   */
  function drag(el: HTMLElement, dx: number, dy: number) {
    const fire = (e: Event) =>
      act(() => {
        el.dispatchEvent(e);
      });
    fire(pointer('pointerdown', 100, 100));
    for (let i = 1; i <= 6; i++) {
      fire(pointer('pointermove', 100 + (dx * i) / 6, 100 + (dy * i) / 6));
    }
    fire(pointer('pointerup', 100 + dx, 100 + dy));
  }

  it('dismisses on a horizontal drag, either way', async () => {
    for (const dx of [140, -140]) {
      const { message, onDismiss } = await showToast();
      drag(message, dx, 0);
      await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
      cleanup();
      toast.dismiss();
    }
  });

  it('ignores a vertical drag of the same distance: no move, no dismissal', async () => {
    const { message, li, onDismiss } = await showToast();
    drag(message, 0, 140);

    expect(li.style.getPropertyValue('--swipe-amount-y') || '0px').toBe('0px');
    expect(li.style.getPropertyValue('--swipe-amount-x') || '0px').toBe('0px');
    await new Promise((r) => setTimeout(r, 300));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.queryByText('Logged 612 kcal')).toBeTruthy();
  });

  it('locks onto the dominant axis: a mostly-vertical diagonal does nothing', async () => {
    const { message, onDismiss } = await showToast();
    drag(message, 30, 150);
    await new Promise((r) => setTimeout(r, 300));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses on a tap', async () => {
    const { message, onDismiss } = await showToast();
    act(() => {
      message.dispatchEvent(pointer('pointerdown', 100, 100));
      message.dispatchEvent(pointer('pointerup', 100, 100));
      message.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 100, clientY: 100 }));
    });
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
  });

  it('does not read the click that ends a vertical drag as a tap', async () => {
    const { message, onDismiss } = await showToast();
    act(() => {
      message.dispatchEvent(pointer('pointerdown', 100, 100));
      message.dispatchEvent(pointer('pointermove', 100, 200));
      message.dispatchEvent(pointer('pointerup', 100, 200));
      message.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 100, clientY: 200 }));
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('keeps a labelled, focusable close button for people who cannot swipe', async () => {
    const { li, onDismiss } = await showToast();
    const close = within(li).getByRole('button', { name: 'Close toast' });
    close.focus();
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
  });
});
