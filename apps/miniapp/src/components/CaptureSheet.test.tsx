import type { Backend } from '@/lib/backend';
import { notifyLogged } from '@/lib/mealNotice';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureSheet, MAX_BATCH, PICKER_PROBE_MS } from './CaptureSheet.js';
import { Toaster } from './ui/sonner.js';

vi.mock('../lib/compress.js', () => ({
  compressPhoto: vi.fn(async (file: File) => ({
    base64: `b64:${file.name}`,
    mimeType: 'image/jpeg',
    bytes: 1,
    width: 1,
    height: 1,
  })),
}));

vi.mock('../lib/mealNotice.js', async (orig) => ({
  ...(await orig<typeof import('../lib/mealNotice.js')>()),
  notifyLogged: vi.fn(async () => true),
}));

function setup(open = true, over: Record<string, unknown> = {}, props = {}) {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  const backend = {
    mode: 'local' as const,
    listFavorites: vi.fn(async () => []),
    analyze: vi.fn(async () => RESULT),
    logWithPhoto: vi.fn(async () => {}),
    ...over,
  } as unknown as Backend;
  const onOpenChange = vi.fn();
  const onLogged = vi.fn();
  const onToast = vi.fn();
  const onBatchStatus = vi.fn();
  const onIntentHandled = vi.fn();
  const { container } = render(
    <>
      <CaptureSheet
        backend={backend}
        open={open}
        onOpenChange={onOpenChange}
        triggerRef={{ current: trigger }}
        onLogged={onLogged}
        onManualLogged={vi.fn()}
        onToast={onToast}
        onBatchStatus={onBatchStatus}
        onIntentHandled={onIntentHandled}
        {...props}
      />
      <Toaster />
    </>,
  );
  const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type=file]')];
  const camera = inputs.find((i) => i.hasAttribute('capture')) as HTMLInputElement;
  const library = inputs.find((i) => !i.hasAttribute('capture')) as HTMLInputElement;
  return {
    backend,
    onOpenChange,
    camera,
    library,
    trigger,
    onLogged,
    onToast,
    onBatchStatus,
    onIntentHandled,
  };
}

const RESULT = {
  foods: [],
  total: { energyKcal: 500, proteinG: 30, carbsG: 60, fatG: 12 },
  confidence: 0.9,
  needsConfirmation: false,
};

/** A pointer event from a finger, which the fan defers to touchend. */
const fanPointer = (type: string, x: number, y: number) =>
  new PointerEvent(type, {
    bubbles: true,
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    clientX: x,
    clientY: y,
  });

/**
 * Puts the trigger where the fan tests expect it (64px at 215, 600) and returns
 * the point `deg` degrees around the fan's baseline. There is no nav here, so
 * the baseline is `top + 20 - barGap(8) - 1` = 611.
 */
const fanPoint = (trigger: HTMLElement, deg: number) => {
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 183, y: 600, width: 64, height: 64 }),
  );
  const rad = (deg * Math.PI) / 180;
  return { x: 215 + 100 * Math.cos(rad), y: 611 - 100 * Math.sin(rad) };
};

/**
 * A sheet whose menu state is real, so the fan's picker backstop can open it.
 * The button lives outside the sheet, as it does under the tab bar.
 */
function setupFan() {
  const backend = {
    mode: 'local' as const,
    listFavorites: vi.fn(async () => []),
    analyze: vi.fn(async () => RESULT),
    logWithPhoto: vi.fn(async () => {}),
  } as unknown as Backend;

  function Host() {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={trigger} type="button">
          camera trigger
        </button>
        <CaptureSheet
          backend={backend}
          open={open}
          onOpenChange={setOpen}
          triggerRef={trigger}
          onLogged={vi.fn()}
          onManualLogged={vi.fn()}
          onToast={vi.fn()}
        />
      </>
    );
  }

  const { container } = render(<Host />);
  const trigger = container.querySelector('button') as HTMLButtonElement;
  const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type=file]')];
  const camera = inputs.find((i) => i.hasAttribute('capture')) as HTMLInputElement;
  const library = inputs.find((i) => !i.hasAttribute('capture')) as HTMLInputElement;
  return { trigger, camera, library };
}

const photo = (name: string) => new File([name], name, { type: 'image/jpeg' });
const pick = (input: HTMLInputElement, ...files: File[]) =>
  fireEvent.change(input, { target: { files } });

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
  vi.mocked(notifyLogged).mockClear();
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

  it('a touch release opens the picker from touchend, once, not again from pointerup', () => {
    vi.useFakeTimers();
    try {
      const { library, trigger } = setup(false);
      const libraryClick = vi.spyOn(library, 'click');
      const { x, y } = fanPoint(trigger, 110);

      act(() => {
        trigger.dispatchEvent(fanPointer('pointerdown', 215, 630));
        vi.advanceTimersByTime(200);
      });
      act(() => {
        trigger.dispatchEvent(fanPointer('pointermove', x, y));
        trigger.dispatchEvent(fanPointer('pointerup', x, y));
      });
      // iOS sends pointerup first, but it is not the gesture that opens a picker.
      expect(libraryClick).not.toHaveBeenCalled();

      act(() => {
        trigger.dispatchEvent(new Event('touchend', { bubbles: true }));
      });
      expect(libraryClick).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('when the fan cannot open a picker', () => {
  /** Holds, slides to `deg`, and lifts a finger. */
  function slideTo(trigger: HTMLElement, deg: number) {
    const { x, y } = fanPoint(trigger, deg);
    act(() => {
      trigger.dispatchEvent(fanPointer('pointerdown', 215, 630));
      vi.advanceTimersByTime(200);
    });
    act(() => {
      trigger.dispatchEvent(fanPointer('pointermove', x, y));
      trigger.dispatchEvent(fanPointer('pointerup', x, y));
      trigger.dispatchEvent(new Event('touchend', { bubbles: true }));
    });
  }

  it('reopens the cards with that action highlighted when no picker signal arrives', () => {
    vi.useFakeTimers();
    try {
      const { library, trigger } = setupFan();
      const libraryClick = vi.spyOn(library, 'click');
      slideTo(trigger, 110); // Upload image
      expect(libraryClick).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('capture-menu')).toBeNull();

      // No blur, no hidden page, no files: the platform refused the open.
      act(() => {
        vi.advanceTimersByTime(PICKER_PROBE_MS);
      });

      const menu = screen.getByTestId('capture-menu');
      const upload = within(menu).getByRole('button', { name: /upload image/i });
      expect(upload).toHaveAttribute('data-highlighted', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays closed when the picker does signal that it opened', () => {
    vi.useFakeTimers();
    try {
      const { trigger } = setupFan();
      slideTo(trigger, 110);

      act(() => {
        window.dispatchEvent(new Event('blur'));
        vi.advanceTimersByTime(PICKER_PROBE_MS);
      });
      expect(screen.queryByTestId('capture-menu')).toBeNull();
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

describe('uploading several photos from the library', () => {
  it('the library input takes many; the camera stays single', () => {
    const { camera, library } = setup(false);
    expect(library.multiple).toBe(true);
    expect(camera.multiple).toBe(false);
  });

  it('logs each photo as its own meal, in the order picked, one at a time', async () => {
    const calls: string[] = [];
    let release: Array<() => void> = [];
    const analyze = vi.fn(
      (base64: string) =>
        new Promise((resolve) => {
          calls.push(`analyze ${base64}`);
          release.push(() => resolve(RESULT));
        }),
    );
    const logWithPhoto = vi.fn(async (_r: unknown, p: { base64: string }) => {
      calls.push(`save ${p.base64}`);
    });
    const { library, onLogged } = setup(false, { analyze, logWithPhoto });

    pick(library, photo('a.jpg'), photo('b.jpg'), photo('c.jpg'));
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
    // Sequential: the second photo is not touched until the first is done.
    expect(calls).toEqual(['analyze b64:a.jpg']);

    for (const name of ['a.jpg', 'b.jpg', 'c.jpg']) {
      await waitFor(() => expect(release.length).toBe(1));
      release.shift()?.();
      await waitFor(() => expect(calls).toContain(`save b64:${name}`));
    }
    await waitFor(() => expect(onLogged).toHaveBeenCalledTimes(3));
    expect(calls).toEqual([
      'analyze b64:a.jpg',
      'save b64:a.jpg',
      'analyze b64:b.jpg',
      'save b64:b.jpg',
      'analyze b64:c.jpg',
      'save b64:c.jpg',
    ]);
    release = [];
  });

  it('a failure in the middle does not stop the rest, and the summary counts are right', async () => {
    const analyze = vi
      .fn()
      .mockResolvedValueOnce(RESULT)
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce(RESULT)
      .mockResolvedValueOnce(RESULT);
    const { library, onToast, onLogged } = setup(false, { analyze });

    pick(library, photo('1.jpg'), photo('2.jpg'), photo('3.jpg'), photo('4.jpg'));
    await waitFor(() => expect(onToast).toHaveBeenCalledTimes(1));

    expect(analyze).toHaveBeenCalledTimes(4);
    expect(onLogged).toHaveBeenCalledTimes(3);
    expect(onToast).toHaveBeenCalledWith('info', '3 logged, 1 failed');
  });

  it('reports the overflow notice without saving it into the meal', async () => {
    const onCreditNotice = vi.fn();
    const notice = 'Your key hit its limit — used 1 credit';
    const analyze = vi.fn(async () => ({ ...RESULT, notice }));
    const logWithPhoto = vi.fn(async (_meal: unknown, _photo: unknown) => {});
    const { camera } = setup(false, { analyze, logWithPhoto }, { onCreditNotice });

    pick(camera, photo('a.jpg'));
    await waitFor(() => expect(onCreditNotice).toHaveBeenCalledWith(notice));

    await userEvent.click(screen.getByRole('button', { name: 'Save meal' }));
    await waitFor(() => expect(logWithPhoto).toHaveBeenCalledTimes(1));
    expect(logWithPhoto.mock.calls[0]?.[0]).not.toHaveProperty('notice');
  });

  it('reports all-succeeded and all-failed plainly', async () => {
    const ok = setup(false);
    pick(ok.library, photo('a.jpg'), photo('b.jpg'));
    await waitFor(() => expect(ok.onToast).toHaveBeenCalledWith('success', '2 logged'));
    cleanup();

    const bad = setup(false, { analyze: vi.fn().mockRejectedValue(new Error('down')) });
    pick(bad.library, photo('a.jpg'), photo('b.jpg'));
    await waitFor(() => expect(bad.onToast).toHaveBeenCalledWith('error', '2 failed'));
  });

  it('says "Uploading 2 of 4" while it works and clears it when done', async () => {
    const { library, onBatchStatus, onToast, onOpenChange } = setup(false);
    pick(library, photo('1.jpg'), photo('2.jpg'), photo('3.jpg'), photo('4.jpg'));
    await waitFor(() => expect(onToast).toHaveBeenCalled());

    expect(onBatchStatus.mock.calls.map((c) => c[0])).toEqual([
      'Uploading 1 of 4',
      'Uploading 2 of 4',
      'Uploading 3 of 4',
      'Uploading 4 of 4',
      null,
    ]);
    // The menu is shut as soon as the batch starts.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it(`caps a pick at ${MAX_BATCH} and says so, rather than dropping files quietly`, async () => {
    const { library, backend, onToast } = setup(false);
    pick(library, ...Array.from({ length: 8 }, (_, i) => photo(`${i}.jpg`)));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('success', `${MAX_BATCH} logged`));

    expect(backend.analyze).toHaveBeenCalledTimes(MAX_BATCH);
    const told = onToast.mock.calls.find((c) => c[0] === 'info');
    expect(told?.[1]).toContain(`first ${MAX_BATCH} of 8`);
  });

  it('ignores another pick while a batch is running', async () => {
    let release: () => void = () => {};
    const analyze = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve(RESULT);
        }),
    );
    const { library, backend } = setup(false, { analyze });
    pick(library, photo('a.jpg'), photo('b.jpg'));
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));

    pick(library, photo('x.jpg'), photo('y.jpg'));
    release();
    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(2));
    release();
    await waitFor(() => expect(backend.logWithPhoto).toHaveBeenCalledTimes(2));
    expect(analyze).toHaveBeenCalledTimes(2);
  });
});

describe('launch intents and the after-save notification', () => {
  it('a camera shortcut opens the menu with Take photo highlighted, not the camera', async () => {
    const { onOpenChange, onIntentHandled, camera } = setup(
      true,
      {},
      {
        intent: { type: 'menu', highlight: 'photo' },
      },
    );
    const click = vi.spyOn(camera, 'click');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(true));
    expect(screen.getByRole('button', { name: /take photo/i })).toHaveAttribute(
      'data-highlighted',
      'true',
    );
    expect(click).not.toHaveBeenCalled();
    expect(onIntentHandled).toHaveBeenCalledTimes(1);
  });

  it('a photo shared to SnapBite goes straight into review with the photo attached', async () => {
    const { backend, onIntentHandled } = setup(
      false,
      {},
      {
        intent: { type: 'file', file: photo('shared.jpg') },
      },
    );

    await waitFor(() =>
      expect(backend.analyze).toHaveBeenCalledWith('b64:shared.jpg', 'image/jpeg'),
    );
    expect(await screen.findByText('Log this meal?')).toBeTruthy();
    // The same preview the upload path draws.
    expect(document.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
    expect(onIntentHandled).toHaveBeenCalledTimes(1);
  });

  it('posts the local notification only after a capture has been saved', async () => {
    const { library, backend } = setup(false);
    expect(notifyLogged).not.toHaveBeenCalled();

    pick(library, photo('lunch.jpg'));
    await screen.findByText('Log this meal?');
    expect(notifyLogged).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save meal' }));
    await waitFor(() => expect(backend.logWithPhoto).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(notifyLogged).toHaveBeenCalledWith('Meal logged', '500 kcal — Meal'),
    );
  });
});
