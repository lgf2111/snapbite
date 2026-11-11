import type { Backend } from '@/lib/backend';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureSheet } from './CaptureSheet.js';
import { Toaster } from './ui/sonner.js';

function setup() {
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
        open
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
  return { backend, onOpenChange, camera, library };
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

  it('Use saved meals opens the saved-meals list, not the blank form', async () => {
    setup();
    fireEvent.click(card(/use saved meals/i));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Saved meals')).toBeTruthy();
    expect(await within(dialog).findByText(/no saved meals yet/i)).toBeTruthy();
    expect(within(dialog).queryByLabelText(/what did you eat/i)).toBeNull();
    // A way out of an empty list.
    fireEvent.click(within(dialog).getByRole('button', { name: /enter a meal by hand/i }));
    expect(await within(dialog).findByLabelText(/what did you eat/i)).toBeTruthy();
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
