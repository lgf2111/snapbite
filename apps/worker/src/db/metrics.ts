import { and, eq, gte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { metrics, userActivity } from './schema.js';

export function createMetricsDb(d1: D1Database) {
  return drizzle(d1, { schema: { metrics, userActivity } });
}

export type MetricsDb = ReturnType<typeof createMetricsDb>;

/** A metric event name. Kept as a union so callers can't typo a counter. */
export type MetricName = 'user_started' | 'first_meal' | 'meal_logged';

/** The UTC 'YYYY-MM-DD' day a metric is bucketed under. */
export function metricDay(ms: number = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The ISO-8601 week string ('YYYY-Www') for a timestamp, UTC. ISO weeks start
 * on Monday and week 1 is the week containing the first Thursday of the year.
 */
export function isoWeek(ms: number = Date.now()): string {
  // Shift to the Thursday of the current week (ISO weeks are keyed by it), then
  // read the year off that Thursday and count weeks from year-start.
  const d = new Date(ms);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // move to Thursday
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * Bumps a day's counter for `name` by one via an UPSERT
 * (`INSERT … ON CONFLICT(day,name) DO UPDATE SET count = count + 1`).
 * Best-effort: never throws into the caller — a metrics failure must not fail
 * the user's action. One statement, so it adds no meaningful latency.
 */
export async function bumpCounter(
  d1: D1Database,
  name: MetricName,
  day: string = metricDay(),
): Promise<void> {
  try {
    const db = createMetricsDb(d1);
    await db
      .insert(metrics)
      .values({ day, name, count: 1 })
      .onConflictDoUpdate({
        target: [metrics.day, metrics.name],
        set: { count: sql`${metrics.count} + 1` },
      });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[metrics] bumpCounter failed', name, err);
  }
}

/**
 * Records that a Telegram user was active in the current ISO week, idempotently
 * (INSERT OR IGNORE, so a repeat in the same week is a no-op). Best-effort.
 */
export async function recordActivity(
  d1: D1Database,
  telegramUserId: number,
  week: string = isoWeek(),
): Promise<void> {
  try {
    const db = createMetricsDb(d1);
    await db.insert(userActivity).values({ userId: telegramUserId, week }).onConflictDoNothing();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[metrics] recordActivity failed', err);
  }
}

/**
 * Records the counters for a meal save: always `meal_logged`, plus `first_meal`
 * when this is the user's first meal, and marks the user active for the ISO
 * week. All best-effort (each helper swallows its own errors) so a metrics
 * failure never blocks the save.
 */
export async function recordMealSave(
  d1: D1Database,
  telegramUserId: number,
  isFirstMeal: boolean,
): Promise<void> {
  const day = metricDay();
  await bumpCounter(d1, 'meal_logged', day);
  if (isFirstMeal) await bumpCounter(d1, 'first_meal', day);
  await recordActivity(d1, telegramUserId);
}

/** The aggregated numbers behind the admin `/stats` command. */
export interface StatsSummary {
  newUsersToday: number;
  newUsers7d: number;
  mealsToday: number;
  meals7d: number;
  activeThisWeek: number;
  totalUsers: number;
  totalMeals: number;
}

/** Sums a metric's count over the last `days` days (inclusive of today). */
async function sumSince(db: MetricsDb, name: MetricName, days: number): Promise<number> {
  const since = metricDay(Date.now() - (days - 1) * 86_400_000);
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${metrics.count}), 0)` })
    .from(metrics)
    .where(and(eq(metrics.name, name), gte(metrics.day, since)));
  return rows[0]?.total ?? 0;
}

/**
 * Reads the admin `/stats` numbers from the metrics + user_activity tables.
 * `totalUsers` and `totalMeals` are the all-time sums of `user_started` and
 * `meal_logged`. Best-effort: returns zeros if a read fails.
 */
export async function readStats(d1: D1Database): Promise<StatsSummary> {
  const db = createMetricsDb(d1);
  const today = metricDay();
  const countFor = async (name: MetricName, day: string): Promise<number> => {
    const rows = await db
      .select({ c: metrics.count })
      .from(metrics)
      .where(and(eq(metrics.name, name), eq(metrics.day, day)))
      .limit(1);
    return rows[0]?.c ?? 0;
  };

  try {
    const [newUsersToday, newUsers7d, mealsToday, meals7d, activeRows, totalUsers, totalMeals] =
      await Promise.all([
        countFor('user_started', today),
        sumSince(db, 'user_started', 7),
        countFor('meal_logged', today),
        sumSince(db, 'meal_logged', 7),
        db
          .select({ n: sql<number>`count(*)` })
          .from(userActivity)
          .where(eq(userActivity.week, isoWeek())),
        sumSince(db, 'user_started', 36_500),
        sumSince(db, 'meal_logged', 36_500),
      ]);
    return {
      newUsersToday,
      newUsers7d,
      mealsToday,
      meals7d,
      activeThisWeek: activeRows[0]?.n ?? 0,
      totalUsers,
      totalMeals,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[metrics] readStats failed', err);
    return {
      newUsersToday: 0,
      newUsers7d: 0,
      mealsToday: 0,
      meals7d: 0,
      activeThisWeek: 0,
      totalUsers: 0,
      totalMeals: 0,
    };
  }
}
