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

function setup(over: Record<string, unknown> = {}) {
  const reviseDraft = vi.fn(async () => DRAFT);
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
});
