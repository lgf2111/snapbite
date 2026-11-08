import { describe, expect, it } from 'vitest';
import {
  type DayTotal,
  currentStreak,
  revivableStreak,
  shiftDayKey,
  summarizeWeek,
} from './stats.js';

describe('shiftDayKey', () => {
  it('shifts across month boundaries', () => {
    expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDayKey('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('currentStreak', () => {
  const today = '2026-06-10';

  it('counts consecutive days ending today', () => {
    const keys = ['2026-06-08', '2026-06-09', '2026-06-10'];
    expect(currentStreak(keys, today)).toBe(3);
  });

  it('stays alive from yesterday when today is not logged yet', () => {
    const keys = ['2026-06-08', '2026-06-09'];
    expect(currentStreak(keys, today)).toBe(2);
  });

  it('is 0 when neither today nor yesterday is logged', () => {
    expect(currentStreak(['2026-06-01', '2026-06-02'], today)).toBe(0);
  });

  it('stops at the first gap', () => {
    const keys = ['2026-06-06', '2026-06-07', '2026-06-09', '2026-06-10'];
    // 10 and 9 are consecutive; 8 is missing → streak 2.
    expect(currentStreak(keys, today)).toBe(2);
  });

  it('handles a single today-only log', () => {
    expect(currentStreak(['2026-06-10'], today)).toBe(1);
  });

  it('accepts a Set and ignores duplicates/order', () => {
    const keys = new Set(['2026-06-10', '2026-06-09', '2026-06-09']);
    expect(currentStreak(keys, today)).toBe(2);
  });
});

describe('revivableStreak', () => {
  const today = '2026-06-10';

  it('bridges a one-day gap and adds both runs plus the missed day', () => {
    // 4,5,6 logged · 7 missing · 8,9,10 logged → current 3 + missed 1 + prior 3.
    const keys = [
      '2026-06-04',
      '2026-06-05',
      '2026-06-06',
      '2026-06-08',
      '2026-06-09',
      '2026-06-10',
    ];
    expect(revivableStreak(keys, today)).toEqual({
      missedDayKey: '2026-06-07',
      currentStreak: 3,
      priorStreak: 3,
      revivedStreak: 7,
    });
  });

  it('works on the first log after the miss (current run of 1)', () => {
    // 6,7,8 logged · 9 missing · 10 logged → current 1 + missed 1 + prior 3.
    const keys = ['2026-06-06', '2026-06-07', '2026-06-08', '2026-06-10'];
    expect(revivableStreak(keys, today)).toEqual({
      missedDayKey: '2026-06-09',
      currentStreak: 1,
      priorStreak: 3,
      revivedStreak: 5,
    });
  });

  it('stays available from yesterday when today is not logged yet', () => {
    // 3,4 logged · 5 missing · 6,7 logged; today (8) not logged but run alive.
    const keys = ['2026-06-03', '2026-06-04', '2026-06-06', '2026-06-07'];
    expect(revivableStreak(keys, '2026-06-08')).toMatchObject({
      missedDayKey: '2026-06-05',
      currentStreak: 2,
      priorStreak: 2,
      revivedStreak: 5,
    });
  });

  it('returns null when the run has no gap', () => {
    expect(revivableStreak(['2026-06-08', '2026-06-09', '2026-06-10'], today)).toBeNull();
  });

  it('returns null when the gap is longer than one day', () => {
    expect(revivableStreak(['2026-06-05', '2026-06-06', '2026-06-10'], today)).toBeNull();
  });

  it('returns null when the prior run is shorter than 2 days', () => {
    expect(revivableStreak(['2026-06-08', '2026-06-10'], today)).toBeNull();
  });

  it('returns null when there is no current run', () => {
    expect(revivableStreak(['2026-06-01', '2026-06-02'], today)).toBeNull();
  });
});

describe('summarizeWeek', () => {
  const days: DayTotal[] = [
    { dayKey: '2026-06-08', energyKcal: 1800, proteinG: 140, meals: 3 },
    { dayKey: '2026-06-09', energyKcal: 2100, proteinG: 95, meals: 2 },
    { dayKey: '2026-06-10', energyKcal: 1950, proteinG: 150, meals: 3 },
  ];
  const target = { energyKcal: 2000, proteinG: 150 };

  it('averages over logged days and counts meals', () => {
    const s = summarizeWeek({ days, target, streak: 3 });
    expect(s.loggedDays).toBe(3);
    expect(s.totalMeals).toBe(8);
    expect(s.avgKcal).toBe(round((1800 + 2100 + 1950) / 3));
    expect(s.avgProteinG).toBe(round((140 + 95 + 150) / 3));
    expect(s.streak).toBe(3);
  });

  it('counts protein hit-rate at >=90% of target', () => {
    const s = summarizeWeek({ days, target, streak: 3 });
    // threshold = 135g: 140 ✓, 95 ✗, 150 ✓ → 2 of 3.
    expect(s.proteinHit).toEqual({ days: 2, of: 3 });
  });

  it('picks the day closest to the calorie target as best', () => {
    const s = summarizeWeek({ days, target, streak: 3 });
    // |1950-2000|=50 is closest.
    expect(s.bestDayKey).toBe('2026-06-10');
  });

  it('falls back to highest-protein best day with no target', () => {
    const s = summarizeWeek({ days, target: null, streak: 0 });
    expect(s.proteinHit).toBeNull();
    expect(s.bestDayKey).toBe('2026-06-10'); // 150g protein
  });

  it('handles an empty week', () => {
    const s = summarizeWeek({ days: [], target, streak: 0 });
    expect(s.loggedDays).toBe(0);
    expect(s.avgKcal).toBe(0);
    expect(s.bestDayKey).toBeNull();
    expect(s.proteinHit).toEqual({ days: 0, of: 0 });
  });
});

const round = (n: number) => Math.round(n);
