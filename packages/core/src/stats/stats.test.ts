import { describe, expect, it } from 'vitest';
import { type DayTotal, currentStreak, shiftDayKey, summarizeWeek } from './stats.js';

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
