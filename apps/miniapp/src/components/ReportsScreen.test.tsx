import { ApiError, LOAD_FAILED_MESSAGE } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import {
  type AdvancedReport,
  type ReportMeal,
  type ReportRange,
  type ReportTarget,
  buildAdvancedReport,
} from '@snapbite/core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportsScreen } from './ReportsScreen.js';

const TODAY = '2026-11-12';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function meal(
  dayKey: string,
  hour: number,
  energyKcal: number,
  proteinG: number,
  foods: Array<[string, number]> = [],
): ReportMeal {
  return {
    loggedAt: Date.parse(`${dayKey}T00:00:00Z`) + hour * 60 * 60 * 1000,
    dayKey,
    hour,
    energyKcal,
    proteinG,
    foods: foods.map(([name, weightG]) => ({ name, weightG })),
  };
}

function reportFor(range: ReportRange): AdvancedReport {
  const target: ReportTarget = {
    energyKcal: 2000,
    proteinG: 150,
    weightKg: 80,
    goal: 'lose',
  };
  return buildAdvancedReport({
    range,
    todayKey: TODAY,
    meals: [
      meal('2026-11-10', 12, 1900, 150, [['Chicken', 200]]),
      meal('2026-11-12', 12, 500, 30, [['Chicken', 220]]),
      meal('2026-11-12', 19, 700, 40, [['Rice', 250]]),
    ],
    target,
  });
}

function stubBackend(analytics: (range: ReportRange) => Promise<AdvancedReport>): Backend {
  return { mode: 'local', analytics: vi.fn(analytics) } as unknown as Backend;
}

function renderScreen(backend: Backend, onSeeCredits = vi.fn(), onBack = vi.fn()) {
  render(<ReportsScreen backend={backend} onBack={onBack} onSeeCredits={onSeeCredits} />);
  return { onSeeCredits, onBack };
}

describe('ReportsScreen', () => {
  it('turns a 403 into a real locked state that links to credits', async () => {
    const backend = stubBackend(async () => {
      throw new ApiError(403, 'Supporter only');
    });
    const { onSeeCredits } = renderScreen(backend);

    expect(await screen.findByText('Reports are part of the supporter tag')).toBeInTheDocument();
    expect(screen.getByText(/any credit pack once/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Check again after buying a pack' }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /see credits and supporter/i }));
    expect(onSeeCredits).toHaveBeenCalledTimes(1);
  });

  it('shows a retry sentence instead of a status code', async () => {
    const backend = stubBackend(async () => {
      throw new ApiError(503, LOAD_FAILED_MESSAGE);
    });
    renderScreen(backend);

    expect(await screen.findByText(LOAD_FAILED_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/HTTP 503/)).not.toBeInTheDocument();
  });

  it('renders the report card and every section for a ready report', async () => {
    const backend = stubBackend(async (range) => reportFor(range));
    const { onBack } = renderScreen(backend);

    expect(await screen.findByText('Report card · last 7 days')).toBeInTheDocument();
    expect(screen.getByText('Trend')).toBeInTheDocument();
    expect(screen.getByText('Adherence')).toBeInTheDocument();
    expect(screen.getByText('Weekday pattern')).toBeInTheDocument();
    expect(screen.getByText('Time of day')).toBeInTheDocument();
    expect(screen.getByText('Dishes')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Daily calorie trend, 2 logged days' }),
    ).toBeInTheDocument();
    // Chicken appears twice, Rice once: both are listed with their share.
    expect(screen.getByText('Chicken')).toBeInTheDocument();
    expect(screen.getByText('2 meals · 67%')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('switches the range and refetches with the new range', async () => {
    const analytics = vi.fn(async (range: ReportRange) => reportFor(range));
    const backend = { mode: 'local', analytics } as unknown as Backend;
    renderScreen(backend);

    await screen.findByText('Daily kcal · last 90 days');
    await userEvent.click(screen.getByRole('radio', { name: '12 months' }));

    await waitFor(() => expect(analytics).toHaveBeenLastCalledWith('12m'));
    expect(await screen.findByText('Monthly kcal · last 12 months')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Monthly calorie trend/ })).toBeInTheDocument();
  });

  it('answers an empty log honestly', async () => {
    const backend = stubBackend(async (range) =>
      buildAdvancedReport({ range, todayKey: TODAY, meals: [], target: null }),
    );
    renderScreen(backend);

    expect(await screen.findByText('Nothing to report yet')).toBeInTheDocument();
  });
});
