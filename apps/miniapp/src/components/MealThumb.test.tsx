import type { Backend, RecentMeal } from '@/lib/backend';
import { clearCache } from '@/lib/cache';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeScreen } from './HomeScreen.js';
import { MealThumb } from './MealThumb.js';

afterEach(() => {
  cleanup();
  clearCache();
  localStorage.clear();
});

const URL_A = '/api/meal-photo/m1';

describe('MealThumb', () => {
  it('shows the photo, lazily and asynchronously', () => {
    const { container } = render(<MealThumb src={URL_A} />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(URL_A);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(screen.queryByTestId('meal-thumb-placeholder')).toBeNull();
  });

  it('swaps a failed photo for the placeholder: same size, hidden from assistive tech, no img', () => {
    const { container } = render(<MealThumb src={URL_A} />);
    const img = container.querySelector('img') as HTMLImageElement;
    const photoClasses = img.className.split(/\s+/);

    fireEvent.error(img);

    // Nothing the browser can draw a broken-image glyph for.
    expect(container.querySelector('img')).toBeNull();
    const ph = screen.getByTestId('meal-thumb-placeholder');
    expect(ph.getAttribute('aria-hidden')).toBe('true');
    expect(ph.className).toContain('bg-secondary');
    // The slot keeps its size, so the row does not jump.
    for (const c of ['size-16', 'shrink-0', 'rounded-md']) {
      expect(photoClasses).toContain(c);
      expect(ph.className.split(/\s+/)).toContain(c);
    }
  });

  it('does not retry: the failed url stays a placeholder across re-renders', () => {
    const { container, rerender } = render(<MealThumb src={URL_A} />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    rerender(<MealThumb src={URL_A} />);
    rerender(<MealThumb src={URL_A} />);
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

  it('gives a different url its own chance', () => {
    const { container, rerender } = render(<MealThumb src={URL_A} />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    rerender(<MealThumb src="/api/meal-photo/m2" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/meal-photo/m2');
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
    const ph = screen.getByTestId('meal-thumb-placeholder');
    expect(ph.className).toContain('bg-secondary');
    // Same slot, so rows keep one height: the photo, the manual placeholder, and a
    // failed photo's placeholder all share the same size classes.
    const slot = (el: Element) =>
      ['size-16', 'shrink-0', 'rounded-md'].filter((c) => el.classList.contains(c));
    expect(slot(img)).toEqual(['size-16', 'shrink-0', 'rounded-md']);
    expect(slot(ph)).toEqual(['size-16', 'shrink-0', 'rounded-md']);
    fireEvent.error(img);
    expect(screen.getAllByTestId('meal-thumb-placeholder')).toHaveLength(2);
    for (const p of screen.getAllByTestId('meal-thumb-placeholder')) {
      expect(slot(p)).toEqual(['size-16', 'shrink-0', 'rounded-md']);
    }
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
        onSetGoal={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll('img[src^="/api/meal-photo/"]')).toHaveLength(2),
    );

    fireEvent.error(container.querySelector('img[src="/api/meal-photo/bad"]') as HTMLImageElement);

    expect(container.querySelector('img[src="/api/meal-photo/good"]')).not.toBeNull();
    expect(container.querySelector('img[src="/api/meal-photo/bad"]')).toBeNull();
    expect(screen.getAllByTestId('meal-thumb-placeholder')).toHaveLength(1);
    // Both titles are still there: the placeholder replaced the picture, not the row.
    expect(screen.getByText('Meal good')).toBeTruthy();
    expect(screen.getByText('Meal bad')).toBeTruthy();
  });
});
