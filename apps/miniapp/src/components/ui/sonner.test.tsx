import { act, cleanup, render, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it } from 'vitest';
import { TOAST_OFFSET, Toaster } from './sonner.js';

afterEach(cleanup);

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
