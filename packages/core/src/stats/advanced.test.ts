import { describe, expect, it } from 'vitest';
import {
  type ReportMeal,
  type ReportTarget,
  buildAdvancedReport,
  reportGoal,
  reportRangeStartKey,
} from './advanced.js';

const TODAY = '2026-11-12';

function meal(
  dayKey: string,
  hour: number,
  energyKcal: number,
  proteinG: number,
  foods: Array<[string, number | null]> = [],
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

function target(over: Partial<ReportTarget> = {}): ReportTarget {
  return { energyKcal: 2000, proteinG: 150, weightKg: 80, goal: 'maintain', ...over };
}

describe('reportRangeStartKey', () => {
  it('starts 90d at the first of the 90 days including today', () => {
    expect(reportRangeStartKey('90d', TODAY)).toBe('2026-08-15');
  });

  it('starts 12m at the first day of the month 11 months back', () => {
    expect(reportRangeStartKey('12m', TODAY)).toBe('2025-12-01');
    expect(reportRangeStartKey('12m', '2026-01-15')).toBe('2025-02-01');
  });
});

describe('reportGoal', () => {
  it('maps every profile stage to a direction', () => {
    expect(reportGoal('lose_fast')).toBe('lose');
    expect(reportGoal('lose_steady')).toBe('lose');
    expect(reportGoal('maintain')).toBe('maintain');
    expect(reportGoal('gain_lean')).toBe('gain');
    expect(reportGoal('gain_fast')).toBe('gain');
    expect(reportGoal(null)).toBe('maintain');
    expect(reportGoal('unknown')).toBe('maintain');
  });
});

describe('trend series and totals', () => {
  const meals = [
    meal('2026-11-11', 13, 600, 35, [['Chicken', 220]]),
    meal('2026-11-12', 12, 500, 30, [['Chicken', 200]]),
    meal('2026-11-12', 19, 700, 40, [['Rice', 250]]),
  ];

  it('builds one point per day for 90d, including empty days', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals,
      target: target(),
    });

    expect(report.series).toHaveLength(90);
    expect(report.series[0]?.key).toBe('2026-08-15');
    expect(report.series.at(-1)).toMatchObject({
      key: '2026-11-12',
      energyKcal: 1200,
      proteinG: 70,
      meals: 2,
    });
    expect(report.totals).toEqual({
      meals: 3,
      loggedDays: 2,
      avgKcalPerLoggedDay: 900,
      avgProteinPerLoggedDay: 53,
      avgMealsPerLoggedDay: 1.5,
    });
  });

  it('builds 12 monthly points for 12m', () => {
    const report = buildAdvancedReport({
      range: '12m',
      todayKey: TODAY,
      meals,
      target: target(),
    });

    expect(report.series).toHaveLength(12);
    expect(report.series[0]?.key).toBe('2025-12');
    expect(report.series.at(-1)).toMatchObject({
      key: '2026-11',
      energyKcal: 1800,
      proteinG: 105,
      meals: 3,
    });
  });

  it('averages weekday intake over logged days, not meals', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals,
      target: target(),
    });

    // 2026-11-12 is a Thursday (4); 2026-11-11 is a Wednesday (3).
    expect(report.weekdays[4]).toMatchObject({ label: 'Thu', loggedDays: 1, meals: 2, avgKcal: 1200 });
    expect(report.weekdays[3]).toMatchObject({ label: 'Wed', loggedDays: 1, meals: 1, avgKcal: 600 });
  });

  it('distribution by time of day and dish frequency', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals,
      target: target(),
    });

    expect(report.timeOfDay.map((b) => [b.bucket, b.meals, b.sharePct])).toEqual([
      ['morning', 0, 0],
      ['afternoon', 2, 67],
      ['evening', 1, 33],
      ['night', 0, 0],
    ]);
    expect(report.dishes).toEqual([
      { name: 'Chicken', meals: 2, sharePct: 67 },
      { name: 'Rice', meals: 1, sharePct: 33 },
    ]);
    expect(report.portionDrift).toEqual([]);
  });

  it('counts a dish once per meal, even when it appears on two lines', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals: [meal('2026-11-12', 12, 500, 30, [['Rice', 100], ['rice', 50]])],
      target: null,
    });
    expect(report.dishes).toEqual([{ name: 'Rice', meals: 1, sharePct: 100 }]);
  });
});

describe('weekly adherence and the report card', () => {
  const meals = [
    meal('2026-11-09', 12, 2000, 150),
    meal('2026-11-10', 12, 2500, 100),
    meal('2026-11-12', 12, 1900, 130),
  ];

  it('scores the current week against days elapsed, counting unlogged days as misses', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals,
      target: target(),
    });

    const week = report.weeks.at(-1);
    expect(week).toMatchObject({
      weekStartKey: '2026-11-09',
      daysInWindow: 4,
      loggedDays: 3,
      proteinHitDays: 1,
      kcalHitDays: 2,
      scorePct: 25,
    });
    expect(week?.avgKcal).toBe(2133);
  });

  it('builds the trailing seven-day card', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals,
      target: target(),
    });

    expect(report.card).toEqual({
      windowStartKey: '2026-11-06',
      daysInWindow: 7,
      daysLogged: 3,
      daysOnTarget: 1,
      scorePct: 14,
      avgKcal: 2133,
      avgProteinG: 127,
    });
  });

  it('has no percentage without targets, but still counts the days', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals,
      target: null,
    });

    expect(report.weeks.every((week) => week.scorePct === null)).toBe(true);
    expect(report.card.scorePct).toBeNull();
    expect(report.card.daysLogged).toBe(3);
  });
});

describe('portion drift', () => {
  it('compares the first and last observed weight for recurring dishes', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals: [
        meal('2026-09-01', 12, 500, 30, [['Chicken breast', 200], ['Rice', 100]]),
        meal('2026-10-01', 12, 550, 33, [['chicken breast', 220], ['Rice', 100]]),
        meal('2026-11-01', 12, 600, 36, [['Chicken breast', 250], ['Rice', 100]]),
      ],
      target: null,
    });

    expect(report.portionDrift).toEqual([
      {
        name: 'Chicken breast',
        firstWeightG: 200,
        lastWeightG: 250,
        deltaG: 50,
        deltaPct: 25,
        observations: 3,
      },
    ]);
  });

  it('ignores dishes with fewer than three weighed observations or a small change', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals: [
        meal('2026-10-01', 12, 500, 30, [['Chicken', 200], ['Rice', 100]]),
        meal('2026-11-01', 12, 550, 33, [['Chicken', 260], ['Rice', 103]]),
      ],
      target: null,
    });
    expect(report.portionDrift).toEqual([]);
  });
});

describe('projection', () => {
  const sevenDays = Array.from({ length: 7 }, (_, i) =>
    meal(`2026-11-${String(6 + i).padStart(2, '0')}`, 12, 2000, 100),
  );

  it('projects the 5% milestone at the current deficit', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals: sevenDays,
      target: target({ energyKcal: 2700, weightKg: 80, goal: 'lose' }),
    });

    expect(report.projection).toMatchObject({
      goal: 'lose',
      loggedDays: 7,
      avgKcal: 2000,
      deltaKcalPerDay: -700,
      kgPerWeek: -0.6,
      onPace: true,
      milestoneWeightKg: 76,
      projectedDateKey: '2026-12-26',
    });
  });

  it('is honest when the rate goes the wrong way', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals: sevenDays,
      target: target({ energyKcal: 1700, goal: 'lose' }),
    });

    expect(report.projection).toMatchObject({
      deltaKcalPerDay: 300,
      onPace: false,
      milestoneWeightKg: 76,
      projectedDateKey: null,
    });
  });

  it('maintains without inventing a milestone', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals: sevenDays,
      target: target({ energyKcal: 2000, goal: 'maintain' }),
    });

    expect(report.projection).toMatchObject({
      deltaKcalPerDay: 0,
      onPace: true,
      milestoneWeightKg: null,
      projectedDateKey: null,
    });
  });

  it('needs at least three logged days in the recent window', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals: sevenDays.slice(0, 2),
      target: target(),
    });
    expect(report.projection).toBeNull();
  });
});

describe('empty and boundary cases', () => {
  it('returns a valid empty report', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals: [],
      target: target(),
    });

    expect(report.series).toHaveLength(90);
    expect(report.series.every((point) => point.meals === 0)).toBe(true);
    expect(report.totals).toEqual({
      meals: 0,
      loggedDays: 0,
      avgKcalPerLoggedDay: 0,
      avgProteinPerLoggedDay: 0,
      avgMealsPerLoggedDay: 0,
    });
    expect(report.card).toMatchObject({ daysLogged: 0, daysOnTarget: 0, scorePct: 0 });
    expect(report.projection).toBeNull();
    expect(report.weeks.at(-1)?.weekStartKey).toBe('2026-11-09');
  });

  it('puts each hour in exactly one time bucket', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals: [5, 10, 11, 16, 17, 21, 22, 4].map((hour) =>
        meal('2026-11-12', hour, 100, 5),
      ),
      target: null,
    });

    expect(report.timeOfDay.map((b) => [b.bucket, b.meals, b.sharePct])).toEqual([
      ['morning', 2, 25],
      ['afternoon', 2, 25],
      ['evening', 2, 25],
      ['night', 2, 25],
    ]);
  });

  it('ignores meals outside the selected range', () => {
    const report = buildAdvancedReport({
      range: '90d',
      todayKey: TODAY,
      meals: [meal('2026-08-14', 12, 999, 99), meal('2026-11-12', 12, 500, 30)],
      target: null,
    });

    expect(report.totals.meals).toBe(1);
  });
});
