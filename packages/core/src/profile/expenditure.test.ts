import { describe, expect, it } from 'vitest';
import {
  KCAL_PER_KG,
  estimateTdeeKcal,
  recalibrateCalorieTarget,
  weightTrend,
} from './expenditure.js';

const DAY = 24 * 60 * 60 * 1000;

describe('weightTrend', () => {
  it('returns null with fewer than two check-ins', () => {
    expect(weightTrend([])).toBeNull();
    expect(weightTrend([{ ts: 0, kg: 80 }])).toBeNull();
  });

  it('returns null when all check-ins share a timestamp (no span)', () => {
    expect(
      weightTrend([
        { ts: 1000, kg: 80 },
        { ts: 1000, kg: 79 },
      ]),
    ).toBeNull();
  });

  it('tracks a downward trend and reports the span', () => {
    const base = Date.UTC(2026, 0, 1);
    const entries = [
      { ts: base, kg: 80 },
      { ts: base + 7 * DAY, kg: 79.4 },
      { ts: base + 14 * DAY, kg: 78.9 },
    ];
    const t = weightTrend(entries);
    expect(t).not.toBeNull();
    expect(t?.count).toBe(3);
    expect(t?.days).toBe(14);
    expect(t?.startKg).toBe(80);
    // EMA end sits near the latest readings and below the start (losing).
    expect(t?.endKg).toBeLessThan(80);
    expect(t?.deltaKg).toBeLessThan(0);
  });

  it('smooths a single noisy spike rather than chasing it', () => {
    const base = Date.UTC(2026, 0, 1);
    // Steady ~80 with one +2kg water blip near the end.
    const entries = [
      { ts: base, kg: 80 },
      { ts: base + 3 * DAY, kg: 80 },
      { ts: base + 6 * DAY, kg: 82 }, // blip
      { ts: base + 9 * DAY, kg: 80 },
    ];
    const t = weightTrend(entries, 7);
    // The smoothed end should stay close to 80, not jump toward 82.
    expect(t?.endKg).toBeGreaterThan(79);
    expect(t?.endKg).toBeLessThan(81);
  });

  it('ignores non-finite timestamps and non-positive weights', () => {
    const base = Date.UTC(2026, 0, 1);
    const t = weightTrend([
      { ts: base, kg: 80 },
      { ts: Number.NaN, kg: 79 },
      { ts: base + 7 * DAY, kg: 0 },
      { ts: base + 10 * DAY, kg: 79 },
    ]);
    expect(t?.count).toBe(2); // only the two valid points
  });
});

describe('estimateTdeeKcal', () => {
  it('equals intake when weight is stable (maintenance)', () => {
    expect(estimateTdeeKcal({ avgIntakeKcal: 2200, trendDeltaKg: 0, days: 14 })).toBe(2200);
  });

  it('is ABOVE intake when weight dropped (burned more than eaten)', () => {
    // Lost 1 kg over 7 days on 2000 kcal → ~2000 + 7700/7 = ~3100.
    const tdee = estimateTdeeKcal({ avgIntakeKcal: 2000, trendDeltaKg: -1, days: 7 });
    expect(tdee).toBe(2000 + Math.round(KCAL_PER_KG / 7));
    expect(tdee).toBeGreaterThan(2000);
  });

  it('is BELOW intake when weight rose (ate more than burned)', () => {
    const tdee = estimateTdeeKcal({ avgIntakeKcal: 2500, trendDeltaKg: 0.5, days: 7 });
    expect(tdee).toBeLessThan(2500);
  });

  it('returns null on a non-positive window or bad intake', () => {
    expect(estimateTdeeKcal({ avgIntakeKcal: 2000, trendDeltaKg: -1, days: 0 })).toBeNull();
    expect(estimateTdeeKcal({ avgIntakeKcal: 0, trendDeltaKg: -1, days: 7 })).toBeNull();
  });
});

describe('recalibrateCalorieTarget', () => {
  it('moves the target toward measured TDEE × goal factor, damped', () => {
    // Measured TDEE 2600, maintain (×1.0), current 2000 → ideal 2600, gap 600,
    // damping 0.5 → +300, but clamped to +150 → 2150.
    const next = recalibrateCalorieTarget({
      measuredTdee: 2600,
      goal: 'maintain',
      currentTarget: 2000,
    });
    expect(next).toBe(2150);
  });

  it('applies the goal deficit (lose) to the measured maintenance', () => {
    // lose_steady ×0.88 of 2500 = 2200 ideal; current 2200 → no move.
    const next = recalibrateCalorieTarget({
      measuredTdee: 2500,
      goal: 'lose_steady',
      currentTarget: 2200,
    });
    expect(next).toBe(2200);
  });

  it('clamps a large correction to maxStepKcal and rounds to 10', () => {
    const next = recalibrateCalorieTarget({
      measuredTdee: 4000,
      goal: 'maintain',
      currentTarget: 2000,
      maxStepKcal: 150,
      damping: 1,
    });
    expect(next).toBe(2150); // +150 cap, rounded to 10
  });

  it('never drops below the 1200 kcal floor', () => {
    const next = recalibrateCalorieTarget({
      measuredTdee: 1000,
      goal: 'lose_fast',
      currentTarget: 1250,
      maxStepKcal: 1000,
      damping: 1,
    });
    expect(next).toBeGreaterThanOrEqual(1200);
  });
});
