import { describe, expect, it } from 'vitest';
import type { RecentMeal } from './backend.js';
import { summarizeToday } from './summary.js';

function meal(id: string, when: number, kcal: number | null): RecentMeal {
  return { id, label: id, energyKcal: kcal, when };
}

describe('summarizeToday', () => {
  const now = new Date('2024-05-10T12:00:00').getTime();
  const earlierToday = new Date('2024-05-10T08:30:00').getTime();
  const yesterday = new Date('2024-05-09T23:00:00').getTime();

  it('counts only meals logged today (local time) and sums kcal', () => {
    const summary = summarizeToday(
      [
        meal('a', earlierToday, 300),
        meal('b', now, 450),
        meal('c', yesterday, 999),
      ],
      now,
    );
    expect(summary.mealCount).toBe(2);
    expect(summary.totalKcal).toBe(750);
  });

  it('treats null energy as zero', () => {
    const summary = summarizeToday([meal('a', now, null), meal('b', now, 200)], now);
    expect(summary.mealCount).toBe(2);
    expect(summary.totalKcal).toBe(200);
  });

  it('returns zeros when nothing is from today', () => {
    const summary = summarizeToday([meal('a', yesterday, 500)], now);
    expect(summary).toEqual({ mealCount: 0, totalKcal: 0 });
  });
});
