import type { Backend, RecentMeal } from '@/lib/backend';
import { cacheKey, clearCache, setCached } from '@/lib/cache';
import type { ToastFn } from '@/lib/toast';
import {
  type AdvancedReport,
  type DailyTargets,
  type ReportMeal,
  type ReportRange,
  buildAdvancedReport,
} from '@snapbite/core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeScreen } from './HomeScreen.js';
import { ReportsScreen } from './ReportsScreen.js';
import { Toaster } from './ui/sonner.js';

const DATE = '2026-11-12';
const TARGETS: DailyTargets = { energyKcal: 2000, proteinG: 120, carbsG: 250, fatG: 70 };
const ORIGINAL_WIDTH = window.innerWidth;
const ORIGINAL_HEIGHT = window.innerHeight;

beforeEach(() => {
  // The Mini App's usual iPhone viewport: 430×932.
  Object.defineProperty(window, 'innerWidth', { value: 430, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 932, configurable: true });
  clearCache();
});

afterEach(() => {
  cleanup();
  toast.dismiss();
  clearCache();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Object.defineProperty(window, 'innerWidth', { value: ORIGINAL_WIDTH, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: ORIGINAL_HEIGHT, configurable: true });
});

function meal(over: Partial<RecentMeal> = {}): RecentMeal {
  return {
    id: 'm1',
    label: 'Chicken rice',
    energyKcal: 500,
    proteinG: 30,
    carbsG: 60,
    fatG: 12,
    aiProvider: null,
    when: Date.parse(`${DATE}T12:00:00Z`),
    ...over,
  };
}

function reportMeal(): ReportMeal {
  return {
    loggedAt: Date.parse(`${DATE}T12:00:00Z`),
    dayKey: DATE,
    hour: 12,
    energyKcal: 500,
    proteinG: 30,
    foods: [{ name: 'Chicken', weightG: 200 }],
  };
}

function reportFor(range: ReportRange): AdvancedReport {
  return buildAdvancedReport({
    range,
    todayKey: DATE,
    meals: [reportMeal()],
    target: { energyKcal: 2000, proteinG: 120, weightKg: 70, goal: 'lose' },
  });
}

/** Home ↔ Reports, like App's router, but without the surrounding shell. */
function Harness({ backend, onToast }: { backend: Backend; onToast: ToastFn }) {
  const [screenName, setScreenName] = useState<'home' | 'reports'>('home');
  if (screenName === 'reports') {
    return (
      <ReportsScreen
        backend={backend}
        onBack={() => setScreenName('home')}
        onSeeCredits={() => {}}
      />
    );
  }
  return (
    <HomeScreen
      backend={backend}
      targets={TARGETS}
      date={DATE}
      onDateChange={() => {}}
      view="daily"
      onViewChange={() => {}}
      refreshSignal={0}
      onOpenMeal={() => {}}
      onOpenReports={() => setScreenName('reports')}
      onSetGoal={() => {}}
      onToast={onToast}
    />
  );
}

function backendWith(over: Partial<Backend>): Backend {
  return {
    mode: 'local',
    mealsByDate: async () => [],
    mealsInRange: async () => [],
    mealDates: async () => ({ dates: [DATE], streak: 1 }),
    analytics: async (range: ReportRange) => reportFor(range),
    ...over,
  } as unknown as Backend;
}

describe('cached screens at 430×932', () => {
  it('paints Home from cache on return, with no skeleton, then swaps in place', async () => {
    const updated = meal({ label: 'Chicken rice bowl', energyKcal: 650 });
    let releaseSecond: (meals: RecentMeal[]) => void = () => {};
    const secondCall = new Promise<RecentMeal[]>((resolve) => {
      releaseSecond = resolve;
    });
    let calls = 0;
    const backend = backendWith({
      mealsByDate: vi.fn(() => {
        calls += 1;
        return calls === 1 ? Promise.resolve([meal()]) : secondCall;
      }),
    });
    const onToast = vi.fn();

    render(
      <>
        <Harness backend={backend} onToast={onToast} />
        <Toaster />
      </>,
    );

    // First load fills the cache.
    expect(await screen.findByText('Chicken rice')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    expect(await screen.findByText('Report card · last 7 days')).toBeInTheDocument();

    // The revalidation for the returning Home is still in flight (a mocked
    // slow refresh): the cached day must be there on the first paint.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Chicken rice')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
    const mealsHeading = screen.getByRole('heading', { name: 'Meals' });

    act(() => releaseSecond([updated]));

    await waitFor(() => expect(screen.getByText('Chicken rice bowl')).toBeInTheDocument());
    // The list swapped its rows in place: same section, no skeleton flash.
    expect(screen.getByRole('heading', { name: 'Meals' })).toBe(mealsHeading);
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(onToast).not.toHaveBeenCalled();
  });

  it('keeps the cached day and stays silent when the refresh fails', async () => {
    let calls = 0;
    const backend = backendWith({
      mealsByDate: vi.fn(() => {
        calls += 1;
        return calls === 1
          ? Promise.resolve([meal()])
          : Promise.reject(Object.assign(new Error('offline'), { status: 503 }));
      }),
    });
    const onToast = vi.fn();

    render(
      <>
        <Harness backend={backend} onToast={onToast} />
        <Toaster />
      </>,
    );
    expect(await screen.findByText('Chicken rice')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    expect(await screen.findByText('Report card · last 7 days')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Chicken rice')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('[data-sonner-toast]')).toBeNull();
    expect(onToast).not.toHaveBeenCalled();
  });

  it('shows a cached day immediately while a mocked 2s revalidation runs', async () => {
    vi.useFakeTimers();
    setCached(cacheKey.mealsByDate(DATE), [meal()]);
    const backend = backendWith({
      mealsByDate: vi.fn(
        () =>
          new Promise<RecentMeal[]>((resolve) => {
            setTimeout(() => resolve([meal({ label: 'Chicken rice bowl' })]), 2000);
          }),
      ),
    });
    const onToast = vi.fn();

    render(
      <>
        <Harness backend={backend} onToast={onToast} />
        <Toaster />
      </>,
    );

    // The cached day is on screen before the 2s revalidation resolves.
    expect(screen.getByText('Chicken rice')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText('Chicken rice bowl')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
  });
});
