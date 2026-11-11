import type { Backend } from '@/lib/backend';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureSheet } from './CaptureSheet.js';
import { Toaster } from './ui/sonner.js';

function setup(open = true) {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  const backend = {
    mode: 'local' as const,
    listFavorites: vi.fn(async () => []),
  } as unknown as Backend;
  const onOpenChange = vi.fn();
  const { container } = render(
    <>
      <CaptureSheet
        backend={backend}
        open={open}
        onOpenChange={onOpenChange}
        triggerRef={{ current: trigger }}
        onLogged={vi.fn()}
        onManualLogged={vi.fn()}
        onToast={vi.fn()}
      />
      <Toaster />
    </>,
  );
  const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type=file]')];
  const camera = inputs.find((i) => i.hasAttribute('capture')) as HTMLInputElement;
  const library = inputs.find((i) => !i.hasAttribute('capture')) as HTMLInputElement;
  return { backend, onOpenChange, camera, library, trigger };
}

const card = (name: RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: q.includes('reduce'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  toast.dismiss();
  for (const el of document.querySelectorAll('body > button')) el.remove();
});

describe('the file pickers', () => {
  it('are in the DOM while the menu is closed, and hidden by position, not display:none', () => {
    const { camera, library } = setup(false);
    expect(screen.queryByTestId('capture-menu')).toBeNull();
    for (const input of [camera, library]) {
      expect(input.isConnected).toBe(true);
      expect(input.className).toContain('sr-only');
      expect(input.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    }
    expect(camera.getAttribute('capture')).toBe('environment');
    expect(camera.accept).toBe('image/*');
    expect(library.hasAttribute('capture')).toBe(false);
    expect(library.accept).toBe('image/*');
  });

  it('release over the Take photo wedge opens the camera inside the same event', () => {
    vi.useFakeTimers();
    try {
      const { camera, library, trigger } = setup(false);
      const cameraClick = vi.spyOn(camera, 'click');
      const libraryClick = vi.spyOn(library, 'click');
      vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ x: 183, y: 600, width: 64, height: 64 }),
      );
      const ptr = (type: string, x: number, y: number) =>
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          isPrimary: true,
          clientX: x,
          clientY: y,
        });

      act(() => {
        trigger.dispatchEvent(ptr('pointerdown', 215, 632));
        vi.advanceTimersByTime(200);
      });
      // Right-hand wedge (Take photo), well above the baseline.
      act(() => {
        trigger.dispatchEvent(
          ptr('pointermove', 215 + 100 * Math.cos(0.35), 590 - 100 * Math.sin(0.35)),
        );
      });
      // No act(), no timers: whatever the release triggers must happen before it returns.
      trigger.dispatchEvent(
        ptr('pointerup', 215 + 100 * Math.cos(0.35), 590 - 100 * Math.sin(0.35)),
      );

      expect(cameraClick).toHaveBeenCalledTimes(1);
      expect(libraryClick).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CaptureSheet (the add-a-meal flow)', () => {
  it('Take photo opens the camera input and closes the menu at once', () => {
    const { camera, library, onOpenChange } = setup();
    const cameraClick = vi.spyOn(camera, 'click');
    const libraryClick = vi.spyOn(library, 'click');

    fireEvent.click(card(/take photo/i));

    expect(cameraClick).toHaveBeenCalledTimes(1);
    expect(libraryClick).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Upload image opens the library input and closes the menu at once', () => {
    const { camera, library, onOpenChange } = setup();
    const cameraClick = vi.spyOn(camera, 'click');
    const libraryClick = vi.spyOn(library, 'click');

    fireEvent.click(card(/upload image/i));

    expect(libraryClick).toHaveBeenCalledTimes(1);
    expect(cameraClick).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Manually log opens the manual form', async () => {
    const { backend, onOpenChange } = setup();
    fireEvent.click(card(/manually log/i));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Add a meal')).toBeTruthy();
    expect(within(dialog).getByLabelText(/what did you eat/i)).toBeTruthy();
    await waitFor(() => expect(backend.listFavorites).toHaveBeenCalled());
  });

  it('Saved meals opens the existing dialog, whose saved-meals list is unchanged', async () => {
    const { backend } = setup();
    fireEvent.click(card(/saved meals/i));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Add a meal')).toBeTruthy();
    // The list is the one ManualMealDialog already loads.
    await waitFor(() => expect(backend.listFavorites).toHaveBeenCalled());
    // No new picker or empty state: the plain form is there.
    expect(within(dialog).getByLabelText(/what did you eat/i)).toBeTruthy();
    expect(within(dialog).queryByText(/no saved meals yet/i)).toBeNull();
  });

  it('keeps the four cards where they are when a toast appears', async () => {
    setup();
    const menu = screen.getByTestId('capture-menu');
    const before = menu.parentElement?.getAttribute('style');

    act(() => {
      toast('Logged 612 kcal');
    });
    await screen.findByText('Logged 612 kcal');

    expect(within(menu).getAllByRole('button')).toHaveLength(4);
    expect(menu.parentElement?.getAttribute('style')).toBe(before);
    // The toaster sits above the menu layers.
    expect(document.querySelector('[data-sonner-toaster]')).toBeTruthy();
  });
});
