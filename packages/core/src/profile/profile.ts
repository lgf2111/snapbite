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

/**
 * Five-stage goal scale, most-loss → most-gain. Legacy 3-stage values
 * (`lose`/`gain`) are accepted and mapped forward so existing saved profiles
 * keep working: `lose`→`lose_steady`, `gain`→`gain_lean`, `maintain` unchanged.
 */
export const GOAL_STAGES = [
  'lose_fast',
  'lose_steady',
  'maintain',
  'gain_lean',
  'gain_fast',
] as const;

const LEGACY_GOAL: Record<string, (typeof GOAL_STAGES)[number]> = {
  lose: 'lose_steady',
  gain: 'gain_lean',
};

export const Goal = z.preprocess(
  (v) => (typeof v === 'string' && v in LEGACY_GOAL ? LEGACY_GOAL[v] : v),
  z.enum(GOAL_STAGES),
);
export type Goal = (typeof GOAL_STAGES)[number];

/** Human labels for each goal stage (UI). */
export const GOAL_LABELS: Record<Goal, string> = {
  lose_fast: 'Lose fast',
  lose_steady: 'Lose steady',
  maintain: 'Maintain',
  gain_lean: 'Lean gain',
  gain_fast: 'Gain fast',
};

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

/** Goal → calorie adjustment applied to TDEE (deficit < 1 < surplus). */
export const GOAL_FACTORS: Record<Goal, number> = {
  lose_fast: 0.75,
  lose_steady: 0.88,
  maintain: 1.0,
  gain_lean: 1.1,
  gain_fast: 1.2,
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

/** ISO date-of-birth string `YYYY-MM-DD`, within a sane range. */
export const BirthDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate must be YYYY-MM-DD')
  .refine((s) => {
    const a = ageFromBirthDate(s);
    return a != null && a >= 13 && a <= 100;
  }, 'birthDate must correspond to an age between 13 and 100');

export const UserProfile = z
  .object({
    sex: Sex,
    /**
     * Date of birth (`YYYY-MM-DD`), preferred so age auto-updates over time.
     * Optional for back-compat with older profiles that stored `age` only.
     */
    birthDate: BirthDate.optional(),
    /**
     * Legacy static age. Kept for profiles saved before `birthDate` existed.
     * When both are present, `birthDate` wins (see {@link profileAge}).
     */
    age: z.number().int().min(13).max(100).optional(),
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
  })
  // A profile must carry age somehow: either a birthDate or a legacy age.
  .refine((p) => p.birthDate != null || p.age != null, {
    message: 'Provide birthDate (preferred) or age',
    path: ['birthDate'],
  });
export type UserProfile = z.infer<typeof UserProfile>;

/** Current age in whole years from an ISO `YYYY-MM-DD` birth date, or null. */
export function ageFromBirthDate(birthDate: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let age = now.getFullYear() - y;
  // Not had this year's birthday yet? subtract one.
  const beforeBirthday =
    now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * The age to use in calculations: derived from `birthDate` when present (so it
 * auto-increments), else the legacy stored `age`. Returns 0 if neither is set
 * (shouldn't happen given the schema refinement).
 */
export function profileAge(
  profile: Pick<UserProfile, 'age' | 'birthDate'>,
  now: Date = new Date(),
): number {
  if (profile.birthDate) {
    const a = ageFromBirthDate(profile.birthDate, now);
    if (a != null) return a;
  }
  return profile.age ?? 0;
}

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

/**
 * Basal metabolic rate via Mifflin-St Jeor (kcal/day). Age is derived from
 * `birthDate` when present (auto-updating), else the legacy `age`.
 */
export function computeBmr(
  profile: Pick<UserProfile, 'sex' | 'age' | 'birthDate' | 'heightCm' | 'weightKg'>,
): number {
  const base = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profileAge(profile);
  return base + (profile.sex === 'male' ? 5 : -161);
}

/** Total daily energy expenditure = BMR × activity factor (kcal/day). */
export function computeTdee(
  profile: Pick<UserProfile, 'sex' | 'age' | 'birthDate' | 'heightCm' | 'weightKg' | 'activity'>,
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
