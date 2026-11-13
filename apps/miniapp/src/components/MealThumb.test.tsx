import type { Backend, RecentMeal } from '@/lib/backend';
import { clearCache } from '@/lib/cache';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeScreen } from './HomeScreen.js';
import { MealThumb, THUMB_RETRY_DELAY_MS } from './MealThumb.js';

afterEach(() => {
  cleanup();
  clearCache();
  localStorage.clear();
  vi.useRealTimers();
});

const URL_A = '/api/meal-photo/m1';

/** The 56 px slot lives on the wrapper now; the placeholder fills it. */
const slotClasses = (el: Element) =>
  ['size-14', 'shrink-0', 'rounded-control'].filter((c) => el.classList.contains(c));

describe('MealThumb', () => {
  it('shows the photo with the placeholder behind it, then drops the placeholder on load', () => {
    const { container } = render(<MealThumb src={URL_A} />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(URL_A);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('fetchpriority')).toBe('low');

    // The placeholder is behind the image, so a slow load never blanks the slot.
    expect(screen.getByTestId('meal-thumb-placeholder')).toBeTruthy();

    fireEvent.load(img);
    expect(screen.queryByTestId('meal-thumb-placeholder')).toBeNull();
    // The same node stays: a load is not a remount.
    expect(container.querySelector('img')).toBe(img);
  });

  it('swaps a failed photo for the placeholder: same slot, hidden from assistive tech, no img', () => {
    const { container } = render(<MealThumb src={URL_A} />);
    const img = container.querySelector('img') as HTMLImageElement;
    const slot = container.querySelector('[data-testid="meal-thumb"]') as HTMLElement;

    fireEvent.error(img);

    // Nothing the browser can draw a broken-image glyph for.
    expect(container.querySelector('img')).toBeNull();
    const ph = screen.getByTestId('meal-thumb-placeholder');
    expect(ph.getAttribute('aria-hidden')).toBe('true');
    expect(ph.className).toContain('bg-secondary');
    expect(ph.className).toContain('absolute');
    expect(ph.className).toContain('inset-0');
    // The wrapper keeps the 56 px slot, so the row does not jump.
    expect(slotClasses(slot)).toEqual(['size-14', 'shrink-0', 'rounded-control']);
  });

  it('retries once after a short delay, then latches the placeholder', () => {
    vi.useFakeTimers();
    const { container } = render(<MealThumb src={URL_A} />);

    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    // While the retry waits, the slot shows the placeholder (no broken glyph).
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('meal-thumb-placeholder')).toBeTruthy();

    act(() => vi.advanceTimersByTime(THUMB_RETRY_DELAY_MS));
    const retry = container.querySelector('img') as HTMLImageElement;
    expect(retry).not.toBeNull();
    // A different URL makes the browser issue a fresh request instead of
    // handing back the failed one from cache.
    expect(retry.getAttribute('src')).toBe(`${URL_A}?retry=1`);
    // The placeholder stays behind the retry until it actually loads.
    expect(screen.getByTestId('meal-thumb-placeholder')).toBeTruthy();
    fireEvent.load(retry);
    expect(screen.queryByTestId('meal-thumb-placeholder')).toBeNull();

    fireEvent.error(retry);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('meal-thumb-placeholder')).toBeTruthy();

    // One retry only: no loop, however long the row stays on screen.
    act(() => vi.advanceTimersByTime(THUMB_RETRY_DELAY_MS * 5));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('meal-thumb-placeholder')).toBeTruthy();
  });

  it('renders the placeholder from the start when there is no photo to ask for', () => {
    for (const src of [undefined, null, '']) {
      const { container, unmount } = render(<MealThumb src={src} />);
      expect(container.querySelector('img')).toBeNull();
      const ph = screen.getByTestId('meal-thumb-placeholder');
      expect(ph.getAttribute('aria-hidden')).toBe('true');
      expect(ph.className).toContain('bg-secondary');
      unmount();
    }
  });

  it('paints the Utensils icon inside the placeholder, not an empty grey block', () => {
    render(<MealThumb src={null} />);
    const icon = screen.getByTestId('meal-thumb-icon');
    const cls = icon.getAttribute('class') ?? '';
    expect(cls).toContain('size-4');
    expect(cls).toContain('text-muted-foreground');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });

  it('gives a different url its own chance', () => {
    const { container, rerender } = render(<MealThumb src={URL_A} />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    rerender(<MealThumb src="/api/meal-photo/m2" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/meal-photo/m2');
  });

  it('keeps the image and the retry attempt when the same src re-renders', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<MealThumb src={URL_A} />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    act(() => vi.advanceTimersByTime(THUMB_RETRY_DELAY_MS));

    const retry = container.querySelector('img') as HTMLImageElement;
    expect(retry.getAttribute('src')).toBe(`${URL_A}?retry=1`);

    rerender(<MealThumb src={URL_A} />);

    // Same element, same attempt: a parent re-render is not a reload.
    expect(container.querySelector('img')).toBe(retry);
    expect(retry.getAttribute('src')).toBe(`${URL_A}?retry=1`);
  });
});

describe('a meal card on Home', () => {
  const meal = (id: string, over: Partial<RecentMeal> = {}): RecentMeal => ({
    id,
    label: `Meal ${id}`,
    energyKcal: 500,
    proteinG: 30,
    carbsG: 60,
    fatG: 12,
    aiProvider: 'gemini',
    when: Date.now(),
    ...over,
  });

  it('a manual meal gets the placeholder, and its slot is the same size as a photo meal', async () => {
    const backend = {
      mode: 'local' as const,
      mealsByDate: vi.fn(async () => [
        meal('photo', { previewUrl: '/api/meal-photo/photo' }),
        meal('manual'),
      ]),
      mealsInRange: vi.fn(async () => []),
      mealDates: vi.fn(async () => ({ dates: [], streak: null })),
      remove: vi.fn(async () => {}),
      photoUrl: () => null,
    } as unknown as Backend;

    const { container } = render(
      <HomeScreen
        backend={backend}
        targets={null}
        date="2026-09-16"
        onDateChange={vi.fn()}
        view="daily"
        onViewChange={vi.fn()}
        refreshSignal={0}
        onOpenMeal={vi.fn()}
        onOpenReports={vi.fn()}
        onSetGoal={vi.fn()}
      />,
    );
    const img = await waitFor(() => {
      const el = container.querySelector('img[src="/api/meal-photo/photo"]');
      expect(el).not.toBeNull();
      return el as HTMLImageElement;
    });

    // Only the meal that has a photo asks for one.
    expect(container.querySelectorAll('img[src^="/api/meal-photo/"]')).toHaveLength(1);
    // Until it loads, both rows show the placeholder: one behind the image,
    // one because the meal has no photo at all.
    expect(screen.getAllByTestId('meal-thumb-placeholder')).toHaveLength(2);

    // Both rows reserve the same 56 px slot, whatever they are showing.
    const slots = container.querySelectorAll('[data-testid="meal-thumb"]');
    expect(slots).toHaveLength(2);
    for (const s of slots) {
      expect(slotClasses(s)).toEqual(['size-14', 'shrink-0', 'rounded-control']);
    }

    // A loaded photo drops its placeholder; the manual meal keeps its own.
    fireEvent.load(img);
    expect(screen.getAllByTestId('meal-thumb-placeholder')).toHaveLength(1);
    // A failed photo gets the placeholder back, in the same slot.
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByTestId('meal-thumb-placeholder')).toHaveLength(2);
    for (const s of slots) {
      expect(slotClasses(s)).toEqual(['size-14', 'shrink-0', 'rounded-control']);
    }
  });

  it('renders the row text before the photo has resolved', async () => {
    const backend = {
      mode: 'local' as const,
      mealsByDate: vi.fn(async () => [meal('slow', { previewUrl: '/api/meal-photo/slow?w=240' })]),
      mealsInRange: vi.fn(async () => []),
      mealDates: vi.fn(async () => ({ dates: [], streak: null })),
      remove: vi.fn(async () => {}),
      photoUrl: () => null,
    } as unknown as Backend;

    const { container } = render(
      <HomeScreen
        backend={backend}
        targets={null}
        date="2026-09-16"
        onDateChange={vi.fn()}
        view="daily"
        onViewChange={vi.fn()}
        refreshSignal={0}
        onOpenMeal={vi.fn()}
        onOpenReports={vi.fn()}
        onSetGoal={vi.fn()}
      />,
    );

    // No `load` event is ever fired in jsdom: the row is fully readable while
    // its photo is still in flight, and the placeholder already reserves the
    // 56 px slot behind it.
    expect(await screen.findByText('Meal slow')).toBeTruthy();
    const img = container.querySelector('img[src^="/api/meal-photo/slow"]') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('fetchpriority')).toBe('low');
    expect(screen.getByTestId('meal-thumb-placeholder')).toBeTruthy();
  });

  it('shows the photo when it loads and the placeholder when it does not', async () => {
    const backend = {
      mode: 'local' as const,
      mealsByDate: vi.fn(async () => [
        meal('good', { previewUrl: '/api/meal-photo/good' }),
        meal('bad', { previewUrl: '/api/meal-photo/bad' }),
      ]),
      mealsInRange: vi.fn(async () => []),
      mealDates: vi.fn(async () => ({ dates: [], streak: null })),
      remove: vi.fn(async () => {}),
      photoUrl: () => null,
    } as unknown as Backend;

    const { container } = render(
      <HomeScreen
        backend={backend}
        targets={null}
        date="2026-09-16"
        onDateChange={vi.fn()}
        view="daily"
        onViewChange={vi.fn()}
        refreshSignal={0}
        onOpenMeal={vi.fn()}
        onOpenReports={vi.fn()}
        onSetGoal={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll('img[src^="/api/meal-photo/"]')).toHaveLength(2),
    );

    fireEvent.load(container.querySelector('img[src="/api/meal-photo/good"]') as HTMLImageElement);
    fireEvent.error(container.querySelector('img[src="/api/meal-photo/bad"]') as HTMLImageElement);

    expect(container.querySelector('img[src="/api/meal-photo/good"]')).not.toBeNull();
    expect(container.querySelector('img[src="/api/meal-photo/bad"]')).toBeNull();
    expect(screen.getAllByTestId('meal-thumb-placeholder')).toHaveLength(1);
    // Both titles are still there: the placeholder replaced the picture, not the row.
    expect(screen.getByText('Meal good')).toBeTruthy();
    expect(screen.getByText('Meal bad')).toBeTruthy();
  });
});
