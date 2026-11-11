import type { Backend, RecentMeal } from '@/lib/backend';
import { clearCache } from '@/lib/cache';
import type { DailyTargets, MealResult } from '@snapbite/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HERO_BASE_REM, ringNumeralSizeRem } from '../lib/ringNumeral.js';
import { HomeScreen } from './HomeScreen.js';
import { Toaster } from './ui/sonner.js';

afterEach(() => {
  // Test files share one process, so RTL's auto-cleanup only covers the first
  // file to import it. Unmount explicitly.
  cleanup();
  toast.dismiss();
  clearCache();
  localStorage.clear();
  vi.restoreAllMocks();
});

function meal(over: Partial<RecentMeal> = {}): RecentMeal {
  return {
    id: 'm1',
    label: 'Chicken rice',
    energyKcal: 500,
    proteinG: 30,
    carbsG: 60,
    fatG: 12,
    aiProvider: 'gemini',
    when: Date.now(),
    ...over,
  };
}

/** A minimal Backend stub — only the read methods HomeScreen calls are wired. */
function stubBackend(over: Partial<Backend> = {}): Backend {
  const base = {
    mode: 'local' as const,
    mealsByDate: vi.fn(async () => [] as RecentMeal[]),
    mealsInRange: vi.fn(async () => [] as RecentMeal[]),
    mealDates: vi.fn(async () => ({ dates: [], streak: null })),
    remove: vi.fn(async () => {}),
    photoUrl: () => null,
    ...over,
  };
  return base as unknown as Backend;
}

const TARGETS: DailyTargets = {
  energyKcal: 2000,
  proteinG: 150,
  carbsG: 200,
  fatG: 60,
};

/** Common no-op props for the controlled/callback surface. */
function props(backend: Backend, over: Record<string, unknown> = {}) {
  return {
    backend,
    targets: null as DailyTargets | null,
    date: '2026-09-16',
    onDateChange: vi.fn(),
    view: 'daily' as const,
    onViewChange: vi.fn(),
    refreshSignal: 0,
    onOpenMeal: vi.fn(),
    onSetGoal: vi.fn(),
    ...over,
  };
}

describe('HomeScreen', () => {
  it("renders the day's meals from the backend", async () => {
    const backend = stubBackend({
      mealsByDate: vi.fn(async () => [meal({ id: 'a', label: 'Chicken rice' })]),
    });
    render(<HomeScreen {...props(backend)} />);

    await waitFor(() => expect(screen.getByText('Chicken rice')).toBeInTheDocument());
    expect(backend.mealsByDate).toHaveBeenCalledWith('2026-09-16');
  });

  it('shows an empty-day state when there are no meals', async () => {
    // With targets, the verdict slot carries the empty state.
    const backend = stubBackend();
    render(<HomeScreen {...props(backend, { targets: TARGETS })} />);

    await waitFor(() => expect(screen.getByText('Nothing logged yet')).toBeInTheDocument());
  });

  it('shows the current logging streak in the header', async () => {
    const backend = stubBackend({
      mealDates: vi.fn(async () => ({ dates: ['2026-09-15'], streak: 5 })),
    });
    render(<HomeScreen {...props(backend)} />);

    const badge = await screen.findByRole('button', { name: '5-day logging streak' });
    expect(within(badge).getByText('🔥')).toBeInTheDocument();
    expect(within(badge).getByText('5')).toBeInTheDocument();
    // The old prose caption is gone: the badge is the only streak surface.
    expect(screen.queryByText(/🔥 5-day streak/)).not.toBeInTheDocument();
  });

  it.each([0, null])('hides the streak badge when the streak is %s', async (value) => {
    const backend = stubBackend({
      mealDates: vi.fn(async () => ({ dates: [], streak: value })),
    });
    render(<HomeScreen {...props(backend)} />);

    await waitFor(() => expect(backend.mealDates).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /logging streak/i })).not.toBeInTheDocument();
  });

  it('explains what counts as a day and how a revive works', async () => {
    const backend = stubBackend({
      mealDates: vi.fn(async () => ({ dates: ['2026-09-15'], streak: 5 })),
    });
    render(<HomeScreen {...props(backend)} />);

    await userEvent.click(await screen.findByRole('button', { name: '5-day logging streak' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Logging streak')).toBeInTheDocument();
    expect(within(dialog).getByText(/at least one meal/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/today or yesterday/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/whole day with no meals/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/revive it, once every 30 days/i)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('gives the badge a 44px quiet pill and leaves the truncation to the wordmark', async () => {
    const backend = stubBackend({
      mealDates: vi.fn(async () => ({ dates: ['2026-09-15'], streak: 5 })),
    });
    render(<HomeScreen {...props(backend)} />);

    const badge = await screen.findByRole('button', { name: '5-day logging streak' });
    for (const cls of [
      'min-h-11',
      'rounded-full',
      'bg-secondary',
      'text-foreground',
      'px-3',
      'shrink-0',
    ]) {
      expect(badge.className).toContain(cls);
    }

    const header = badge.closest('header') as HTMLElement;
    const wordmark = within(header).getByRole('heading', { level: 1 });
    // At 375pt the wordmark is the only thing allowed to truncate.
    expect(wordmark.className).toContain('truncate');
    expect(wordmark.className).toContain('min-w-0');
    expect(screen.getByRole('button', { name: 'Refresh' }).parentElement?.className).toContain(
      'shrink-0',
    );
  });

  it('prompts to set a goal when no targets are configured', async () => {
    const backend = stubBackend();
    render(<HomeScreen {...props(backend)} />);

    expect(screen.getByText('Set a goal to see your rings')).toBeInTheDocument();
    // Let the background meals fetch settle so no state update escapes the test.
    await waitFor(() => expect(screen.getByText(/Nothing logged yet/)).toBeInTheDocument());
    // The goal card carries the one empty message; there is no second paragraph.
    expect(screen.getAllByText(/Nothing logged yet/)).toHaveLength(1);
  });

  it('shows exactly one empty message when targets exist', async () => {
    const backend = stubBackend();
    render(<HomeScreen {...props(backend, { targets: TARGETS })} />);

    await waitFor(() => expect(screen.getByText('Nothing logged yet')).toBeInTheDocument());
    expect(screen.getAllByText(/Nothing logged yet/)).toHaveLength(1);
  });

  it('has no add-by-hand control in the header (manual entry lives in the capture sheet)', async () => {
    const backend = stubBackend();
    render(<HomeScreen {...props(backend, { targets: TARGETS })} />);

    await waitFor(() => expect(screen.getByText('Nothing logged yet')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /add a meal by hand/i })).not.toBeInTheDocument();
  });

  it('draws a macro bar per row, capped at 100%', async () => {
    const backend = stubBackend({
      // protein 75/150 = 50%, carbs 400/200 = capped, fat 0/60 = empty
      mealsByDate: vi.fn(async () => [
        meal({ energyKcal: 800, proteinG: 75, carbsG: 400, fatG: 0 }),
      ]),
    });
    const { container } = render(<HomeScreen {...props(backend, { targets: TARGETS })} />);

    await screen.findByText('Chicken rice');
    const fills = [...container.querySelectorAll('[data-slot="macro-bar"] > div')].map(
      (el) => (el as HTMLElement).style.transform,
    );
    expect(fills).toEqual(['scaleX(0.5)', 'scaleX(1)', 'scaleX(0)']);
  });

  it('shows progress rings instead of the goal prompt when targets are set', async () => {
    const backend = stubBackend();
    render(<HomeScreen {...props(backend, { targets: TARGETS })} />);

    await waitFor(() => expect(screen.getByText('Nothing logged yet')).toBeInTheDocument());
    expect(screen.queryByText('Set a goal to see your rings')).not.toBeInTheDocument();
  });

  it('states a verdict and flags an over-target day', async () => {
    const backend = stubBackend({
      mealsByDate: vi.fn(async () => [meal({ energyKcal: 2400, proteinG: 140 })]),
    });
    render(<HomeScreen {...props(backend, { targets: TARGETS })} />);

    await waitFor(() => expect(screen.getByText('Over by 400')).toBeInTheDocument());
    // The ring's caption says "over" in words, not just in hue.
    expect(screen.getByText('kcal over')).toBeInTheDocument();
    expect(screen.queryByText('kcal left')).not.toBeInTheDocument();
  });

  it('says "left" rather than "over" while under target', async () => {
    const backend = stubBackend({
      mealsByDate: vi.fn(async () => [meal({ energyKcal: 500 })]),
    });
    render(<HomeScreen {...props(backend, { targets: TARGETS })} />);

    await waitFor(() => expect(screen.getByText('kcal left')).toBeInTheDocument());
    expect(screen.queryByText(/over/i)).not.toBeInTheDocument();
  });

  it('mounts the install tip on a phone, but never while setup covers Home', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1',
      configurable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
    localStorage.clear();
    const backend = stubBackend();

    const { rerender } = render(<HomeScreen {...props(backend)} />);
    expect(screen.getByTestId('install-guide')).toBeInTheDocument();

    rerender(<HomeScreen {...props(backend, { hideInstallGuide: true })} />);
    expect(screen.queryByTestId('install-guide')).not.toBeInTheDocument();
    await waitFor(() => expect(backend.mealsByDate).toHaveBeenCalled());
    Reflect.deleteProperty(navigator, 'userAgent');
    Reflect.deleteProperty(navigator, 'maxTouchPoints');
  });

  it('slides the Daily/Weekly highlight rather than swapping it', async () => {
    const backend = stubBackend();
    const { rerender } = render(<HomeScreen {...props(backend)} />);
    const pill = () =>
      document.querySelector<HTMLElement>('[data-slot="toggle-group-indicator"]') as HTMLElement;
    expect(pill().style.transform).toBe('translateX(0%)');

    rerender(<HomeScreen {...props(backend, { view: 'weekly' })} />);
    expect(pill().style.transform).toBe('translateX(100%)');
    await waitFor(() => expect(backend.mealsInRange).toHaveBeenCalled());
  });

  describe('weekly view layout with a real week of data', () => {
    const week = [1, 2, 3, 4, 5, 6, 7].map((i) =>
      meal({ id: `w${i}`, energyKcal: 100, proteinG: 8, carbsG: 12, fatG: 3 }),
    );

    async function weekly() {
      const backend = stubBackend({ mealsInRange: vi.fn(async () => week) });
      render(<HomeScreen {...props(backend, { targets: TARGETS, view: 'weekly' })} />);
      await screen.findByText(/week total/i);
    }

    it('shows a five-digit weekly total grouped and stepped down, not at the Daily size', async () => {
      await weekly();
      const numeral = document.querySelector('[data-slot="ring-numeral"]') as HTMLElement;
      // 7 days x 2000 target - 700 eaten = 13300 left.
      expect(numeral.textContent).toBe('13,300');
      expect(numeral.style.fontSize).toBe(`${ringNumeralSizeRem('13,300')}rem`);
      expect(Number.parseFloat(numeral.style.fontSize)).toBeLessThan(HERO_BASE_REM);
      expect(numeral.className).toContain('tabular');
      // The unit line keeps its own size.
      expect(screen.getByText('kcal left').className).toContain('text-caption');
    });

    it('keeps Daily at the size it always had', async () => {
      const backend = stubBackend({ mealsByDate: vi.fn(async () => [meal({ energyKcal: 140 })]) });
      render(<HomeScreen {...props(backend, { targets: TARGETS })} />);
      await screen.findByText('Chicken rice');
      const numeral = document.querySelector('[data-slot="ring-numeral"]') as HTMLElement;
      expect(numeral.textContent).toBe('1860');
      expect(Number.parseFloat(numeral.style.fontSize)).toBe(HERO_BASE_REM);
    });

    it('puts Total / Daily avg in its own full-width row under the ring and macros', async () => {
      await weekly();
      const toggle = screen.getByRole('radiogroup', { name: 'Weekly total or average' });
      const card = toggle.closest('section') as HTMLElement;
      const ringRow = card
        .querySelector('[data-slot="ring-numeral"]')
        ?.closest('.flex.items-center.gap-4') as HTMLElement;

      // A direct child of the card, after the row that holds the ring and the macros.
      expect(toggle.parentElement).toBe(card);
      expect(ringRow.contains(toggle)).toBe(false);
      expect(ringRow.nextElementSibling).toBe(toggle);
      // Full width and 44px tall; labels at caption size, never truncated.
      expect(toggle.className).toContain('w-full');
      expect(toggle.className).toContain('h-11');
      for (const item of within(toggle).getAllByRole('radio')) {
        expect(item.className).toContain('text-caption');
        expect(item.className).toContain('whitespace-nowrap');
        expect(item.className).not.toMatch(/truncate|overflow-hidden|text-ellipsis/);
      }
      expect(within(toggle).getByText('Daily avg')).toBeTruthy();
      expect(within(toggle).getByText('Total')).toBeTruthy();
    });

    it('is not in the Daily view at all', async () => {
      const backend = stubBackend();
      render(<HomeScreen {...props(backend, { targets: TARGETS })} />);
      await screen.findByText('Nothing logged yet');
      expect(screen.queryByRole('radiogroup', { name: 'Weekly total or average' })).toBeNull();
    });
  });

  it('fires onOpenMeal when a meal row is tapped', async () => {
    const onOpenMeal = vi.fn();
    const backend = stubBackend({
      mealsByDate: vi.fn(async () => [meal({ id: 'x', label: 'Laksa' })]),
    });
    render(<HomeScreen {...props(backend, { onOpenMeal })} />);

    const row = await screen.findByText('Laksa');
    await userEvent.click(row);
    expect(onOpenMeal).toHaveBeenCalledTimes(1);
    expect(onOpenMeal).toHaveBeenCalledWith(expect.objectContaining({ id: 'x', label: 'Laksa' }));
  });

  it('uses the range fetch in weekly view', async () => {
    const backend = stubBackend({
      mealsInRange: vi.fn(async () => [] as RecentMeal[]),
    });
    render(<HomeScreen {...props(backend, { view: 'weekly' })} />);

    await waitFor(() => expect(backend.mealsInRange).toHaveBeenCalled());
    expect(backend.mealsByDate).not.toHaveBeenCalled();
  });

  it('shows the total/daily-average toggle only in weekly view', async () => {
    const backend = stubBackend({ mealsInRange: vi.fn(async () => [meal({ id: 'w1' })]) });
    const { rerender } = render(<HomeScreen {...props(backend, { targets: TARGETS })} />);
    // Daily view: no weekly toggle.
    expect(screen.queryByText('Daily avg')).not.toBeInTheDocument();

    rerender(<HomeScreen {...props(backend, { targets: TARGETS, view: 'weekly' })} />);
    await waitFor(() => expect(screen.getByText('Daily avg')).toBeInTheDocument());
    expect(screen.getByText(/week total/i)).toBeInTheDocument();
  });

  it('switches the weekly label to a daily average when toggled', async () => {
    const backend = stubBackend({ mealsInRange: vi.fn(async () => [meal({ id: 'w1' })]) });
    render(<HomeScreen {...props(backend, { targets: TARGETS, view: 'weekly' })} />);

    const avg = await screen.findByText('Daily avg');
    await userEvent.click(avg);
    expect(screen.getByText(/daily average/i)).toBeInTheDocument();
    // Radix marks the active toggle item with data-state, not aria-pressed.
    expect(avg.closest('[data-state]')).toHaveAttribute('data-state', 'on');
  });

  it('a swipe-delete offers Undo, and Undo restores the row without deleting it', async () => {
    const backend = stubBackend({
      mealsByDate: vi.fn(async () => [meal({ id: 'milk', label: 'Milk candy' })]),
    });
    render(
      <>
        <HomeScreen {...props(backend)} />
        <Toaster />
      </>,
    );
    await screen.findByText('Milk candy');

    const card = screen.getByTestId('swipe-card');
    fireEvent.mouseDown(card, { clientX: 400, clientY: 300 });
    fireEvent.mouseMove(document, { clientX: 300, clientY: 300 });
    fireEvent.mouseUp(document, { clientX: 300, clientY: 300 });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Milk candy')).not.toBeInTheDocument());

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Milk candy')).toBeInTheDocument();
    expect(backend.remove).not.toHaveBeenCalled();
  });

  it('edits a meal with AI inline from Home (no navigation)', async () => {
    const draft: MealResult = {
      foods: [
        {
          food: { name: 'Laksa', estimatedWeightG: 400, quantity: 2, confidence: 0.8 },
          nutrition: { energyKcal: 1000, proteinG: 40, carbsG: 90, fatG: 40, source: 'mixed' },
        },
      ],
      total: { energyKcal: 1000, proteinG: 40, carbsG: 90, fatG: 40, source: 'mixed' },
      confidence: 0.8,
      needsConfirmation: false,
    };
    const reviseDraft = vi.fn(async () => draft);
    const update = vi.fn(async () => {});
    const onOpenMeal = vi.fn();
    const backend = stubBackend({
      mealsByDate: vi.fn(async () => [meal({ id: 'x', label: 'Laksa' })]),
      reviseDraft,
      update,
    });
    render(<HomeScreen {...props(backend, { onOpenMeal })} />);

    // Tap the sparkle button on the row — it should open the AI dialog here,
    // NOT navigate to the edit screen.
    const aiBtn = await screen.findByRole('button', { name: 'Update with AI' });
    await userEvent.click(aiBtn);
    expect(onOpenMeal).not.toHaveBeenCalled();

    // Describe the change and apply.
    const input = await screen.findByPlaceholderText(/describe the change/i);
    await userEvent.type(input, 'the portion was double');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(reviseDraft).toHaveBeenCalledWith('x', 'the portion was double'));
    await waitFor(() => expect(update).toHaveBeenCalledWith('x', draft));
  });
});
