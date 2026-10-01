import { GOAL_FACTORS, type Goal } from './profile.js';

/**
 * Adaptive-targets math — all deterministic (no AI). The idea (MacroFactor-style):
 * a person's *real* maintenance energy (TDEE) can be measured, not just estimated
 * from Mifflin-St Jeor, by comparing how much they ate against how their weight
 * TREND moved over the same window:
 *
 *   measured TDEE ≈ average daily intake − (energy stored/released as weight)
 *
 * Weight is noisy day-to-day (water, food in gut), so we smooth it into a TREND
 * before measuring change. Everything here is pure arithmetic over data the app
 * already has (logged meals = intake) plus a tiny weights series.
 */

/** Energy equivalent of 1 kg of body-mass change (~7700 kcal/kg). */
export const KCAL_PER_KG = 7700;

/** A single weight check-in. `ts` is epoch ms; `kg` is canonical kilograms. */
export interface WeightEntry {
  ts: number;
  kg: number;
}

/** A smoothed weight trend over a series of check-ins. */
export interface WeightTrend {
  /** Exponentially-smoothed weight at the FIRST (oldest) point (kg). */
  startKg: number;
  /** Exponentially-smoothed weight at the LAST (newest) point (kg). */
  endKg: number;
  /** `endKg − startKg` (kg; negative = losing). */
  deltaKg: number;
  /** Days spanned between the first and last check-in. */
  days: number;
  /** Number of check-ins used. */
  count: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Computes a smoothed weight trend from check-ins. Entries are sorted by time;
 * an exponential moving average (time-aware, by `halfLifeDays`) damps daily
 * noise so the start/end reflect the underlying trend rather than a single
 * water-weight blip. Returns null when there are fewer than two check-ins or no
 * time spans between them.
 *
 * The EMA weight for a gap of `dt` days uses alpha = 1 − 0.5^(dt / halfLife),
 * so widely-spaced points move the average more than closely-spaced ones.
 */
export function weightTrend(entries: readonly WeightEntry[], halfLifeDays = 7): WeightTrend | null {
  const pts = [...entries]
    .filter((e) => Number.isFinite(e.ts) && e.kg > 0)
    .sort((a, b) => a.ts - b.ts);
  if (pts.length < 2) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (!first || !last) return null;
  const days = (last.ts - first.ts) / DAY_MS;
  if (days <= 0) return null;

  // Forward EMA for the end-of-window trend weight.
  let ema = first.kg;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    if (!prev || !cur) continue;
    const dtDays = Math.max(0, (cur.ts - prev.ts) / DAY_MS);
    const alpha = 1 - 0.5 ** (dtDays / halfLifeDays);
    ema += alpha * (cur.kg - ema);
  }
  const endKg = round1(ema);

  // The start trend weight is the first smoothed value — with only the first
  // point known there, it's simply the first reading (best available anchor).
  const startKg = round1(first.kg);

  return {
    startKg,
    endKg,
    deltaKg: round1(endKg - startKg),
    days: round1(days),
    count: pts.length,
  };
}

/** Inputs for {@link estimateTdeeKcal}. */
export interface EstimateTdeeInput {
  /** Average daily calories consumed over the window. */
  avgIntakeKcal: number;
  /** Change in TREND weight over the window (kg; negative = lost). */
  trendDeltaKg: number;
  /** Days the window spans. */
  days: number;
}

/**
 * Backs out measured maintenance energy (TDEE, kcal/day) from intake vs. the
 * weight trend: if you ate `avgIntake` and your trend changed by `trendDelta`
 * kg over `days`, the energy balance implies
 *   TDEE = avgIntake − (trendDeltaKg × 7700) / days.
 * (Lost weight → you burned more than you ate → TDEE above intake.)
 * Returns null when the window is non-positive.
 */
export function estimateTdeeKcal(input: EstimateTdeeInput): number | null {
  if (!(input.days > 0)) return null;
  if (!Number.isFinite(input.avgIntakeKcal) || input.avgIntakeKcal <= 0) return null;
  const storedKcalPerDay = (input.trendDeltaKg * KCAL_PER_KG) / input.days;
  return Math.round(input.avgIntakeKcal - storedKcalPerDay);
}

/** Inputs for {@link recalibrateCalorieTarget}. */
export interface RecalibrateInput {
  /** Measured maintenance energy (from {@link estimateTdeeKcal}). */
  measuredTdee: number;
  /** The user's goal (picks the deficit/surplus factor). */
  goal: Goal;
  /** The target currently in use (kcal/day). */
  currentTarget: number;
  /**
   * Max the target may move in one recalibration (kcal). Smoothing against
   * noisy single-window estimates. Default 150.
   */
  maxStepKcal?: number;
  /** Fraction of the gap to close per recalibration (0–1). Default 0.5. */
  damping?: number;
}

/** Never recommend below this many kcal/day (mirrors profile.ts MIN_KCAL). */
const MIN_KCAL = 1200;

/**
 * Nudges the calorie target toward where the MEASURED expenditure says it
 * should be for the user's goal, without over-correcting on one noisy window:
 * the ideal target is `measuredTdee × goalFactor`; we move `damping` of the way
 * there, clamped to ±`maxStepKcal`, floored at a safe minimum, rounded to 10.
 * Returns the new target (kcal/day).
 */
export function recalibrateCalorieTarget(input: RecalibrateInput): number {
  const damping = clamp01(input.damping ?? 0.5);
  const maxStep = Math.max(0, input.maxStepKcal ?? 150);
  const idealTarget = input.measuredTdee * GOAL_FACTORS[input.goal];

  const rawDelta = (idealTarget - input.currentTarget) * damping;
  const step = Math.max(-maxStep, Math.min(maxStep, rawDelta));
  const next = Math.max(MIN_KCAL, input.currentTarget + step);
  return Math.round(next / 10) * 10;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
