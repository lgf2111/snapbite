import { describe, expect, it } from 'vitest';
import {
  computeBmr,
  computeTargets,
  computeTdee,
  feetInchesToCm,
  lbToKg,
  UserProfile,
} from './profile.js';

const base: UserProfile = {
  sex: 'male',
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: 'moderate',
  goal: 'maintain',
  units: 'metric',
  mode: 'simple',
};

describe('Mifflin-St Jeor BMR', () => {
  it('computes male BMR', () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 1780
    expect(computeBmr(base)).toBe(1780);
  });

  it('computes female BMR (−161 constant)', () => {
    // 1780 - 5 (drop male +5) - 161 = 1614
    expect(computeBmr({ ...base, sex: 'female' })).toBe(1614);
  });
});

describe('TDEE', () => {
  it('applies the moderate activity factor', () => {
    expect(computeTdee(base)).toBeCloseTo(1780 * 1.55, 5);
  });
});

describe('computeTargets', () => {
  it('maintain: kcal rounded to 10, macros derived', () => {
    const t = computeTargets(base);
    expect(t.energyKcal).toBe(2760); // 2759 -> 2760
    expect(t.proteinG).toBe(144); // 1.8 * 80
    expect(t.fatG).toBe(77); // 2760*0.25/9 = 76.67
    expect(t.carbsG).toBe(373); // (2760 - 576 - 693)/4
  });

  it('5-stage goal factors apply the right deficit/surplus', () => {
    // TDEE ≈ 2759.
    expect(computeTargets({ ...base, goal: 'lose_fast' }).energyKcal).toBe(2070); // ×0.75 = 2069.25 -> 2070
    expect(computeTargets({ ...base, goal: 'lose_steady' }).energyKcal).toBe(2430); // ×0.88 = 2427.9 -> 2430
    expect(computeTargets({ ...base, goal: 'maintain' }).energyKcal).toBe(2760);
    expect(computeTargets({ ...base, goal: 'gain_lean' }).energyKcal).toBe(3030); // ×1.1 = 3034.9 -> 3030
    expect(computeTargets({ ...base, goal: 'gain_fast' }).energyKcal).toBe(3310); // ×1.2 = 3310.8 -> 3310
  });

  it('maps legacy goal values forward (lose->lose_steady, gain->gain_lean)', () => {
    const legacyLose = UserProfile.parse({ ...base, goal: 'lose' });
    expect(legacyLose.goal).toBe('lose_steady');
    const legacyGain = UserProfile.parse({ ...base, goal: 'gain' });
    expect(legacyGain.goal).toBe('gain_lean');
  });

  it('floors calories at the safe minimum', () => {
    const tiny: UserProfile = {
      ...base,
      sex: 'female',
      age: 90,
      heightCm: 150,
      weightKg: 40,
      activity: 'sedentary',
      goal: 'lose_fast',
    };
    expect(computeTargets(tiny).energyKcal).toBe(1200);
  });

  it('advanced mode honors a calorie override', () => {
    const t = computeTargets({
      ...base,
      mode: 'advanced',
      calorieTargetOverride: 2000,
    });
    expect(t.energyKcal).toBe(2000);
  });

  it('advanced mode honors a full macro override', () => {
    const t = computeTargets({
      ...base,
      mode: 'advanced',
      calorieTargetOverride: 2000,
      macroOverride: { proteinG: 150, carbsG: 200, fatG: 60 },
    });
    expect(t).toEqual({ energyKcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 });
  });

  it('ignores overrides in simple mode', () => {
    const t = computeTargets({
      ...base,
      mode: 'simple',
      calorieTargetOverride: 9999,
    });
    expect(t.energyKcal).toBe(2760);
  });
});

describe('unit conversion', () => {
  it('converts pounds to kilograms', () => {
    expect(lbToKg(176.37)).toBeCloseTo(80, 1);
  });

  it('converts feet+inches to cm', () => {
    expect(feetInchesToCm(5, 11)).toBeCloseTo(180.34, 2);
  });
});

describe('UserProfile schema', () => {
  it('defaults units and mode', () => {
    const parsed = UserProfile.parse({
      sex: 'male',
      age: 30,
      heightCm: 180,
      weightKg: 80,
      activity: 'moderate',
      goal: 'maintain',
    });
    expect(parsed.units).toBe('metric');
    expect(parsed.mode).toBe('simple');
  });

  it('rejects an out-of-range age', () => {
    expect(UserProfile.safeParse({ ...base, age: 5 }).success).toBe(false);
  });
});
