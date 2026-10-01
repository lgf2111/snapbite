/**
 * Deterministic logging-streak + weekly-recap math (no AI). Everything works on
 * `YYYY-MM-DD` local day-keys supplied by the caller (the Worker computes them
 * in the user's local time), so this module needs no timezone logic itself.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parses a `YYYY-MM-DD` key to a UTC-midnight epoch, or null if malformed. */
function keyToMs(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}

/** `YYYY-MM-DD` for a UTC-midnight epoch. */
function msToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The day-key `n` days before `key` (negative = before). */
export function shiftDayKey(key: string, deltaDays: number): string {
  const ms = keyToMs(key);
  if (ms == null) return key;
  return msToKey(ms + deltaDays * DAY_MS);
}

/**
 * Current logging streak: the number of consecutive days (ending today, or
 * yesterday if nothing is logged today yet) that have at least one logged day.
 *
 * Counting from `todayKey` backwards: if today has a log the streak includes
 * today; otherwise it may still be "alive" from yesterday (so a user mid-day
 * who hasn't logged yet keeps their streak). Returns 0 when neither today nor
 * yesterday is present.
 */
export function currentStreak(loggedDayKeys: Iterable<string>, todayKey: string): number {
  const set = loggedDayKeys instanceof Set ? loggedDayKeys : new Set(loggedDayKeys);
  if (keyToMs(todayKey) == null) return 0;

  // Where does the streak start counting from — today (if logged) or yesterday?
  let cursor: string;
  if (set.has(todayKey)) {
    cursor = todayKey;
  } else {
    const y = shiftDayKey(todayKey, -1);
    if (!set.has(y)) return 0;
    cursor = y;
  }

  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = shiftDayKey(cursor, -1);
  }
  return streak;
}

/** Per-day totals for the recap window (one entry per day that had meals). */
export interface DayTotal {
  dayKey: string;
  energyKcal: number;
  proteinG: number;
  /** Number of meals logged that day. */
  meals: number;
}

/** Inputs for {@link summarizeWeek}. */
export interface WeekSummaryInput {
  /** Per-day totals for the week (only days with meals need appear). */
  days: readonly DayTotal[];
  /** Daily targets, when the user has a profile (null = no targets). */
  target: { energyKcal: number; proteinG: number } | null;
  /** The current logging streak (consecutive days), for the recap line. */
  streak: number;
}

/** A deterministic weekly recap summary. */
export interface WeekSummary {
  /** Days (of the week) that had at least one logged meal. */
  loggedDays: number;
  /** Total meals logged across the week. */
  totalMeals: number;
  /** Average kcal/day over the LOGGED days (0 when none). */
  avgKcal: number;
  /** Average protein (g)/day over the logged days. */
  avgProteinG: number;
  /**
   * Protein hit-rate: logged days that reached ≥90% of the protein target,
   * as a count + the number of logged days. null when there's no target.
   */
  proteinHit: { days: number; of: number } | null;
  /** The logged day closest to the calorie target (or highest-protein when no target). */
  bestDayKey: string | null;
  streak: number;
}

const round = (n: number) => Math.round(n);

/**
 * Builds a deterministic weekly recap from per-day totals + targets. "Best day"
 * is the logged day whose calories are closest to the target (or, with no
 * target, the highest-protein day). Protein hit-rate counts logged days at
 * ≥90% of the protein target. All pure arithmetic.
 */
export function summarizeWeek(input: WeekSummaryInput): WeekSummary {
  const days = input.days.filter((d) => d.meals > 0);
  const loggedDays = days.length;
  const totalMeals = days.reduce((s, d) => s + d.meals, 0);

  if (loggedDays === 0) {
    return {
      loggedDays: 0,
      totalMeals: 0,
      avgKcal: 0,
      avgProteinG: 0,
      proteinHit: input.target ? { days: 0, of: 0 } : null,
      bestDayKey: null,
      streak: input.streak,
    };
  }

  const sumKcal = days.reduce((s, d) => s + d.energyKcal, 0);
  const sumProtein = days.reduce((s, d) => s + d.proteinG, 0);
  const avgKcal = round(sumKcal / loggedDays);
  const avgProteinG = round(sumProtein / loggedDays);

  let proteinHit: WeekSummary['proteinHit'] = null;
  let bestDayKey: string;
  if (input.target && input.target.proteinG > 0) {
    const threshold = input.target.proteinG * 0.9;
    const hit = days.filter((d) => d.proteinG >= threshold).length;
    proteinHit = { days: hit, of: loggedDays };
  }

  if (input.target && input.target.energyKcal > 0) {
    // Closest to the calorie target.
    const targetKcal = input.target.energyKcal;
    bestDayKey = days.reduce((best, d) =>
      Math.abs(d.energyKcal - targetKcal) < Math.abs(best.energyKcal - targetKcal) ? d : best,
    ).dayKey;
  } else {
    // No target → the highest-protein day is the "best".
    bestDayKey = days.reduce((best, d) => (d.proteinG > best.proteinG ? d : best)).dayKey;
  }

  return {
    loggedDays,
    totalMeals,
    avgKcal,
    avgProteinG,
    proteinHit,
    bestDayKey,
    streak: input.streak,
  };
}
