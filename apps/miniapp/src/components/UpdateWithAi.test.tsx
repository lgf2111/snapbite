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

const input = () => screen.getByPlaceholderText(/describe the change/i) as HTMLInputElement;
const apply = () => screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;

describe('Update with AI', () => {
  it('autofocuses the instruction when it opens', async () => {
    setup();
    await waitFor(() => expect(document.activeElement).toBe(input()));
  });

  it('keeps Apply disabled until the instruction is at least three characters', () => {
    setup();
    expect(apply().disabled).toBe(true);

    fireEvent.change(input(), { target: { value: '  ' } });
    expect(apply().disabled).toBe(true);

    fireEvent.change(input(), { target: { value: 'ab' } });
    expect(apply().disabled).toBe(true);

    fireEvent.change(input(), { target: { value: ' add a coke ' } });
    expect(apply().disabled).toBe(false);

    fireEvent.change(input(), { target: { value: '   ' } });
    expect(apply().disabled).toBe(true);
  });

  it('submits from Enter only when the instruction is valid', async () => {
    const { reviseDraft } = setup();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(reviseDraft).not.toHaveBeenCalled();

    fireEvent.change(input(), { target: { value: 'the rice was double' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(reviseDraft).toHaveBeenCalledWith('m1', 'the rice was double'));
  });

  it('shows a one-line hint of the shape that works', () => {
    setup();
    const hint = screen.getByText(/Try "add a can of coke"/i);
    expect(hint.className).toContain('text-caption');
    expect(hint.className).toContain('text-muted-foreground');
    expect(hint.textContent).toContain('the rice was double');
  });

  it('standardises the actions: 48px primary over a 44px text Cancel', () => {
    setup();
    const cancel = screen.getByRole('button', { name: 'Cancel' });

    expect(apply().className).toContain('h-12');
    expect(apply().className).toContain('w-full');
    expect(cancel.className).toContain('h-11');
    expect(cancel.className).toContain('w-full');
    expect(cancel.className).toContain('text-muted-foreground');
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
