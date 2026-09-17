/**
 * Pure computation for the home "today" summary card. Kept separate from the
 * component so the date-bucketing and totals are unit-testable.
 */
import type { RecentMeal } from './backend.js';

export interface DailySummary {
  /** Number of meals logged today (local time). */
  mealCount: number;
  /** Sum of energy for today's meals; nulls are treated as 0. */
  totalKcal: number;
}

/** Returns YYYY-MM-DD in local time for a timestamp (ms). */
function localDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Computes today's meal count and total kcal from a list of recent meals.
 * `now` is injectable for deterministic tests (defaults to Date.now()).
 */
export function summarizeToday(meals: RecentMeal[], now: number = Date.now()): DailySummary {
  const today = localDateKey(now);
  let mealCount = 0;
  let totalKcal = 0;
  for (const m of meals) {
    if (localDateKey(m.when) === today) {
      mealCount += 1;
      totalKcal += m.energyKcal ?? 0;
    }
  }
  return { mealCount, totalKcal: Math.round(totalKcal * 10) / 10 };
}
