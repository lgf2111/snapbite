import type { MealDetail } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import { clearCache } from '@/lib/cache';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MealDetailScreen } from './MealDetailScreen.js';

afterEach(() => {
  cleanup();
  clearCache();
  localStorage.clear();
});

const LOGGED_AT = new Date(2026, 10, 13, 9, 21).getTime();

const DETAIL: MealDetail = {
  id: 'm1',
  loggedAt: LOGGED_AT,
  createdAt: LOGGED_AT,
  title: 'Chicken rice',
  notes: null,
  confidence: 0.9,
  telegramFileId: null,
  hasPhoto: false,
  aiProvider: 'gemini',
  foods: [
    {
      id: 'f1',
      name: 'Chicken rice',
      estimatedWeightG: 300,
      portion: null,
      quantity: 1,
      confidence: 0.9,
      energyKcal: 500,
      proteinG: 30,
      carbsG: 60,
      fatG: 12,
      nutritionSource: 'ai_estimate',
    },
  ],
  total: { energyKcal: 500, proteinG: 30, carbsG: 60, fatG: 12, source: 'ai_estimate' },
};

function stubBackend(over: Partial<Backend> = {}): Backend {
  return {
    mode: 'local' as const,
    detail: vi.fn(async () => DETAIL),
    listFavorites: vi.fn(async () => []),
    photoUrl: () => null,
    update: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    ...over,
  } as unknown as Backend;
}

function props(backend: Backend, over: Record<string, unknown> = {}) {
  return {
    backend,
    mealId: 'm1',
    onBack: vi.fn(),
    onChanged: vi.fn(),
    onToast: vi.fn(),
    ...over,
  };
}

describe('MealDetailScreen', () => {
  it('renders the header, the formatted meta, flat food rows and the totals', async () => {
    render(<MealDetailScreen {...props(stubBackend())} />);

    await screen.findByDisplayValue('Chicken rice');
    expect(screen.getByRole('heading', { level: 1, name: 'Edit meal' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard and close' }).className).toContain(
      'size-11',
    );

    const meta = new Date(LOGGED_AT).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    expect(screen.getByText(`${meta} · analyzed by Gemini`)).toBeTruthy();

    // The foods are in-flow between hairlines, not in a card.
    const name = screen.getByLabelText('Food 1 name');
    expect(name.closest('[data-slot="card"]')).toBeNull();
    const list = name.closest('.divide-y') as HTMLElement;
    expect(list.className).toContain('divide-border');

    // Every macro field has a visible label and the unit inside the field.
    for (const label of ['Calories', 'Protein', 'Carbs', 'Fat']) {
      expect(screen.getByLabelText(`Food 1 ${label.toLowerCase()}`)).toBeTruthy();
    }
    expect(screen.getByLabelText('Food 1 calories').className).toContain('pr-12');
    expect(screen.getByLabelText('Food 1 calories').parentElement?.textContent).toContain('kcal');

    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update with AI' })).toBeTruthy();
    const save = screen.getByRole('button', { name: 'No changes' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Delete meal' }).className).toContain(
      'text-destructive',
    );
  });

  it('shows three skeletons instead of a Loading line on a cold open', async () => {
    let release: (detail: MealDetail) => void = () => {};
    const detail = vi.fn(
      () =>
        new Promise<MealDetail>((resolve) => {
          release = resolve;
        }),
    );
    render(<MealDetailScreen {...props(stubBackend({ detail }))} />);

    expect(screen.queryByText('Loading…')).toBeNull();
    const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons).toHaveLength(3);
    expect(skeletons[0]?.className).toContain('h-40');
    expect(skeletons[1]?.className).toContain('h-20');
    expect(skeletons[2]?.className).toContain('h-20');

    release(DETAIL);
    await screen.findByDisplayValue('Chicken rice');
  });

  it('reports a load failure with the fallback copy and only the close button', async () => {
    render(
      <MealDetailScreen
        {...props(stubBackend({ detail: vi.fn(async () => Promise.reject(new Error(''))) }))}
      />,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("Couldn't load this meal. Close it and open it again.");
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Discard and close' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'No changes' })).toBeNull();
  });

  it('marks a food for removal without deleting it until save', async () => {
    render(<MealDetailScreen {...props(stubBackend())} />);

    await screen.findByDisplayValue('Chicken rice');
    fireEvent.click(screen.getByRole('button', { name: 'Remove food 1' }));

    const name = screen.getByLabelText('Food 1 name') as HTMLInputElement;
    expect(name.disabled).toBe(true);
    expect(name.className).toContain('line-through');
    expect(name.closest('.opacity-50')).toBeTruthy();
    expect(screen.getByText('Will be removed when you save.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep food 1' })).toBeTruthy();
    // Dirty, so the primary offers to save the removal.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('confirms a dirty close and a delete with the spec copy, destructive first', async () => {
    const onBack = vi.fn();
    render(<MealDetailScreen {...props(stubBackend(), { onBack })} />);

    const name = await screen.findByLabelText('Food 1 name');
    fireEvent.change(name, { target: { value: 'Chicken rice bowl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard and close' }));

    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Discard changes?')).toBeTruthy();
    expect(within(dialog).getByText('Your unsaved edits will be lost.')).toBeTruthy();
    const buttons = within(dialog).getAllByRole('button');
    expect(buttons[0]?.textContent).toBe('Discard changes');
    expect(buttons[1]?.textContent).toBe('Keep editing');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete meal' }));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete meal?')).toBeTruthy();
    expect(within(dialog).getByText("This can't be undone.")).toBeTruthy();
    const deleteButtons = within(dialog).getAllByRole('button');
    expect(deleteButtons[0]?.textContent).toBe('Delete meal');
    expect(deleteButtons[1]?.textContent).toBe('Cancel');
    expect(onBack).not.toHaveBeenCalled();
  });

  it('saves an edit and leaves the screen', async () => {
    const backend = stubBackend();
    const onBack = vi.fn();
    const onChanged = vi.fn();
    const onToast = vi.fn();
    render(<MealDetailScreen {...props(backend, { onBack, onChanged, onToast })} />);

    const name = await screen.findByLabelText('Food 1 name');
    fireEvent.change(name, { target: { value: 'Chicken rice bowl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(backend.update).toHaveBeenCalledTimes(1));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onToast).toHaveBeenCalledWith('success', 'Meal updated');
  });
});
