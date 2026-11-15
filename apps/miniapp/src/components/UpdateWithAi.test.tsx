import { ApiError } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import type { MealResult } from '@snapbite/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviseWithAiDialog } from './UpdateWithAi.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'visualViewport');
});

const DRAFT: MealResult = {
  foods: [],
  total: { energyKcal: 500, proteinG: 30, carbsG: 60, fatG: 12, source: 'mixed' },
  confidence: 0.9,
  needsConfirmation: false,
};

function setup(
  over: Record<string, unknown> = {},
  revise: () => Promise<MealResult> = async () => DRAFT,
) {
  const reviseDraft = vi.fn(revise);
  const backend = { mode: 'local' as const, reviseDraft } as unknown as Backend;
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    backend,
    mealId: 'm1',
    onDraft: vi.fn(),
    onToast: vi.fn(),
    onCreditNotice: vi.fn(),
    ...over,
  };
  const view = render(<ReviseWithAiDialog {...props} />);
  return { ...view, props, reviseDraft };
}

const input = () => screen.getByPlaceholderText(/describe the change/i) as HTMLTextAreaElement;
const apply = () => screen.getByRole('button', { name: 'Update meal' }) as HTMLButtonElement;

describe('Update with AI', () => {
  it('autofocuses the instruction when it opens', async () => {
    setup();
    await waitFor(() => expect(document.activeElement).toBe(input()));
  });

  it('keeps Update meal live and focuses the field when the instruction is too short', () => {
    const { reviseDraft } = setup();
    expect(apply().disabled).toBe(false);

    fireEvent.click(apply());
    expect(reviseDraft).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input());

    fireEvent.change(input(), { target: { value: 'ab' } });
    fireEvent.click(apply());
    expect(reviseDraft).not.toHaveBeenCalled();

    fireEvent.change(input(), { target: { value: ' add a coke ' } });
    fireEvent.click(apply());
    return waitFor(() => expect(reviseDraft).toHaveBeenCalledWith('m1', 'add a coke'));
  });

  it('leaves Enter in the textarea for new lines; the button submits', async () => {
    const { reviseDraft } = setup();
    fireEvent.change(input(), { target: { value: 'the rice was double' } });

    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(reviseDraft).not.toHaveBeenCalled();

    fireEvent.click(apply());
    await waitFor(() => expect(reviseDraft).toHaveBeenCalledWith('m1', 'the rice was double'));
  });

  it('labels the field Change and explains the shape that works', () => {
    setup();
    const field = input();
    expect(screen.getByLabelText('Change')).toBe(field);
    expect(screen.getByText(/for example "add a can of coke"/i)).toBeTruthy();
    expect(screen.getByText(/Review the result before saving/i)).toBeTruthy();
  });

  it('standardises the actions: 48px primary over a 44px text link', () => {
    setup();
    const cancel = screen.getByRole('button', { name: 'Cancel' });

    expect(apply().className).toContain('h-12');
    expect(apply().className).toContain('w-full');
    expect(cancel.className).toContain('min-h-11');
    expect(cancel.className).toContain('w-full');
    expect(cancel.className).toContain('text-primary-text');
    expect(cancel.className).not.toContain('bg-secondary');

    const actions = apply().parentElement as HTMLElement;
    expect(actions.dataset.slot).toBe('dialog-actions');
    expect(actions.className).toContain('flex-col');
    expect(actions.className).toContain('gap-2');
    expect(actions.className).not.toContain('sticky');
    expect(actions.className).not.toMatch(/-m[tbyxl]?-/);
  });

  it('sits above the keyboard with its title and actions inside the sheet', () => {
    // A 336px keyboard leaves 596px of the 932px viewport.
    Object.defineProperty(window, 'innerHeight', { value: 932, configurable: true });
    Object.defineProperty(window, 'visualViewport', {
      value: Object.assign(new EventTarget(), { height: 596, offsetTop: 0 }),
      configurable: true,
    });
    setup();
    const sheet = document.querySelector('[data-slot=dialog-content]') as HTMLElement;
    expect(sheet.className).toContain('max-h-[calc(100svh-var(--keyboard-inset,0px)-2rem)]');
    expect(sheet.className).toContain('bottom-[calc(var(--keyboard-inset,0px)+1rem)]');
    expect(sheet.className).toContain('top-auto');
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('336px');
    expect(screen.getByRole('heading', { name: 'Update with AI' })).toBeTruthy();
    expect(sheet.contains(apply())).toBe(true);
    // Nothing that holds the actions is lifted out of flow over the field.
    for (let el = apply().parentElement; el && el !== sheet; el = el.parentElement) {
      expect(el.className, el.className).not.toMatch(/\b(sticky|absolute|fixed)\b/);
      expect(el.className, el.className).not.toMatch(/(^|\s)-m[tbyxl]?-/);
    }
  });

  it('shows a real pending state while the model runs', async () => {
    let finish!: (meal: MealResult) => void;
    const pending = new Promise<MealResult>((resolve) => {
      finish = resolve;
    });
    const { props } = setup({}, () => pending);

    fireEvent.change(input(), { target: { value: 'add a can of coke' } });
    fireEvent.click(apply());

    const busy = screen.getByRole('button', { name: 'Updating…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(input().disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    finish(DRAFT);
    await waitFor(() => expect(props.onDraft).toHaveBeenCalledWith(DRAFT));
  });

  it('surfaces the server detail, keeps the instruction, and retries from the toast', async () => {
    const quota =
      "Your AI key hit its limit and you're out of credits. Add credits in Settings, or use a working key.";
    const revise = vi
      .fn<() => Promise<MealResult>>()
      .mockRejectedValueOnce(new ApiError(402, quota))
      .mockResolvedValueOnce(DRAFT);
    const { props, reviseDraft } = setup({}, revise);

    fireEvent.change(input(), { target: { value: 'add a can of coke' } });
    fireEvent.click(apply());

    // The toast carries SnapBite's own words and a retry action.
    await waitFor(() =>
      expect(props.onToast).toHaveBeenCalledWith('error', quota, expect.anything()),
    );
    expect(props.onToast).toHaveBeenCalledWith(
      'error',
      quota,
      expect.objectContaining({ label: 'Try again' }),
    );
    // The detail stays on screen and the dialog does not close or clear the text.
    expect(screen.getByRole('alert').textContent).toBe(quota);
    expect(input().value).toBe('add a can of coke');
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);

    const action = (props.onToast as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as {
      onClick: () => void;
    };
    action.onClick();

    await waitFor(() => expect(props.onDraft).toHaveBeenCalledWith(DRAFT));
    expect(reviseDraft).toHaveBeenCalledTimes(2);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});
