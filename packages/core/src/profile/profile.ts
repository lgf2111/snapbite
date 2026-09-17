import { z } from 'zod';

/**
 * User profile + goal used to compute daily calorie/macro targets.
 *
 * Canonical body metrics are always stored metric (kg/cm) regardless of the
 * `units` display preference — the math only ever works in metric. Targets are
 * derived deterministically (Mifflin-St Jeor BMR × activity, adjusted by goal),
 * and are estimates the user can override in advanced mode.
 */

export const Sex = z.enum(['male', 'female']);
export type Sex = z.infer<typeof Sex>;

export const ActivityLevel = z.enum([
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
]);
export type ActivityLevel = z.infer<typeof ActivityLevel>;

export const Goal = z.enum(['lose', 'maintain', 'gain']);
export type Goal = z.infer<typeof Goal>;

export const Units = z.enum(['metric', 'imperial']);
export type Units = z.infer<typeof Units>;

export const ProfileMode = z.enum(['simple', 'advanced']);
export type ProfileMode = z.infer<typeof ProfileMode>;

/** Standard TDEE activity multipliers. */
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** Goal → calorie adjustment applied to TDEE. */
export const GOAL_FACTORS: Record<Goal, number> = {
  lose: 0.8,
  maintain: 1.0,
  gain: 1.1,
};

/** Grams of protein per kg of bodyweight (mid of the common 1.6–2.2 range). */
const PROTEIN_G_PER_KG = 1.8;
/** Share of calories from fat. */
const FAT_CALORIE_SHARE = 0.25;
/** Never target below this many kcal/day. */
const MIN_KCAL = 1200;

const optionalMacroOverride = z
  .object({
    proteinG: z.number().finite().nonnegative(),
    carbsG: z.number().finite().nonnegative(),
    fatG: z.number().finite().nonnegative(),
  })
  .optional();

export const UserProfile = z.object({
  sex: Sex,
  age: z.number().int().min(13).max(100),
  /** Canonical height in centimeters. */
  heightCm: z.number().finite().positive(),
  /** Canonical weight in kilograms. */
  weightKg: z.number().finite().positive(),
  activity: ActivityLevel,
  goal: Goal,
  /** Display unit preference (math is always metric). */
  units: Units.default('metric'),
  /** simple = presets only; advanced = manual overrides available. */
  mode: ProfileMode.default('simple'),
  /** Advanced: override the computed calorie target. */
  calorieTargetOverride: z.number().finite().positive().optional(),
  /** Advanced: override the computed macro grams. */
  macroOverride: optionalMacroOverride,
});
export type UserProfile = z.infer<typeof UserProfile>;

/** Computed (or overridden) daily targets. */
export interface DailyTargets {
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

const round = (n: number) => Math.round(n);
const roundTo10 = (n: number) => Math.round(n / 10) * 10;

// --- unit conversion helpers (display <-> canonical) -----------------------

export const LB_PER_KG = 2.2046226218;
export const CM_PER_INCH = 2.54;

export const kgToLb = (kg: number): number => kg * LB_PER_KG;
export const lbToKg = (lb: number): number => lb / LB_PER_KG;
export const cmToInches = (cm: number): number => cm / CM_PER_INCH;
export const inchesToCm = (inches: number): number => inches * CM_PER_INCH;

/** Splits total inches into feet + inches (for imperial height display). */
export function inchesToFeetInches(totalInches: number): { feet: number; inches: number } {
  const feet = Math.floor(totalInches / 12);
  return { feet, inches: Math.round(totalInches - feet * 12) };
}

export const feetInchesToCm = (feet: number, inches: number): number =>
  inchesToCm(feet * 12 + inches);

// --- the math --------------------------------------------------------------

/** Basal metabolic rate via Mifflin-St Jeor (kcal/day). */
export function computeBmr(profile: Pick<UserProfile, 'sex' | 'age' | 'heightCm' | 'weightKg'>): number {
  const base = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age;
  return base + (profile.sex === 'male' ? 5 : -161);
}

/** Total daily energy expenditure = BMR × activity factor (kcal/day). */
export function computeTdee(
  profile: Pick<UserProfile, 'sex' | 'age' | 'heightCm' | 'weightKg' | 'activity'>,
): number {
  return computeBmr(profile) * ACTIVITY_FACTORS[profile.activity];
}

/**
 * Computes daily calorie + macro targets from the profile and goal. In advanced
 * mode, an explicit `calorieTargetOverride` / `macroOverride` wins over the
 * computed values. Calories are floored at a safe minimum.
 */
export function computeTargets(profile: UserProfile): DailyTargets {
  const advanced = profile.mode === 'advanced';

  // Calories: override (advanced) or TDEE × goal factor, floored + rounded.
  const computedKcal = computeTdee(profile) * GOAL_FACTORS[profile.goal];
  const energyKcal = roundTo10(
    Math.max(
      MIN_KCAL,
      advanced && profile.calorieTargetOverride ? profile.calorieTargetOverride : computedKcal,
    ),
  );

  // Macros: full override (advanced) or derived from calories + bodyweight.
  if (advanced && profile.macroOverride) {
    return {
      energyKcal,
      proteinG: round(profile.macroOverride.proteinG),
      carbsG: round(profile.macroOverride.carbsG),
      fatG: round(profile.macroOverride.fatG),
    };
  }

  const proteinG = round(PROTEIN_G_PER_KG * profile.weightKg);
  const fatG = round((energyKcal * FAT_CALORIE_SHARE) / 9);
  const remainingKcal = energyKcal - proteinG * 4 - fatG * 9;
  const carbsG = Math.max(0, round(remainingKcal / 4));

  return { energyKcal, proteinG, carbsG, fatG };
}
