import {
  type AdvancedReport,
  type ReportDayAggregate,
  type ReportDishAggregate,
  type ReportHourAggregate,
  type ReportPortionAggregate,
  type ReportTarget,
  UserProfile,
  buildAdvancedReportFromAggregates,
  computeTargets,
  reportGoal,
  reportRangeStartKey,
} from '@snapbite/core';
import { Hono } from 'hono';
import { createEntitlementMemo, getEntitlement } from '../billing/accounts.js';
import {
  createAnalyticsCacheDb,
  readAnalyticsCache,
  writeAnalyticsCache,
} from '../db/analyticsCache.js';
import { describeError, logError } from '../db/errors.js';
import { createSettingsDb, getSettings, parsePreferences } from '../db/settings.js';
import type { AppBindings } from '../env.js';
import { localDayKey, parseTzOffset } from './meals.js';

const RANGE_90D = '90d';
const RANGE_12M = '12m';
const UNAVAILABLE = "Couldn't load that — tap to retry.";

interface DayRow {
  day_key: string;
  energy_kcal: number;
  protein_g: number;
  meals: number;
}

interface HourRow {
  hour: number;
  meals: number;
  energy_kcal: number;
}

interface DishRow {
  name: string;
  meals: number;
}

interface PortionRow {
  name: string;
  first_weight_g: number | null;
  last_weight_g: number | null;
  observations: number;
}

/**
 * Daily totals in the user's local calendar. `logged_at` is epoch ms, so the
 * offset is applied before SQLite reads the date fields. Nutrition is a LEFT
 * join because a manual meal without resolved macros still counts as a meal.
 */
const DAYS_SQL = `SELECT date((m.logged_at / 1000) - ? * 60, 'unixepoch') AS day_key,
                         COALESCE(SUM(n.energy_kcal), 0) AS energy_kcal,
                         COALESCE(SUM(n.protein_g), 0) AS protein_g,
                         COUNT(*) AS meals
                    FROM meals m
                    LEFT JOIN nutrition n ON n.meal_id = m.id
                   WHERE m.user_id = ? AND m.logged_at >= ? AND m.logged_at < ?
                   GROUP BY day_key
                   ORDER BY day_key ASC`;

/** The same local-hour buckets the report draws, counted in SQL. */
const HOURS_SQL = `SELECT CAST(strftime('%H', (m.logged_at / 1000) - ? * 60, 'unixepoch') AS INTEGER) AS hour,
                          COUNT(*) AS meals,
                          COALESCE(SUM(n.energy_kcal), 0) AS energy_kcal
                     FROM meals m
                     LEFT JOIN nutrition n ON n.meal_id = m.id
                    WHERE m.user_id = ? AND m.logged_at >= ? AND m.logged_at < ?
                    GROUP BY hour`;

/** Top dishes, counted once per meal even when a dish spans two lines. */
const DISHES_SQL = `SELECT MIN(TRIM(f.name)) AS name,
                           COUNT(DISTINCT f.meal_id) AS meals
                      FROM food_items f
                      JOIN meals m ON m.id = f.meal_id
                     WHERE m.user_id = ? AND m.logged_at >= ? AND m.logged_at < ?
                       AND TRIM(f.name) <> ''
                     GROUP BY LOWER(TRIM(f.name))
                     ORDER BY meals DESC, name ASC
                     LIMIT 8`;

/**
 * First/last portion per dish, with the observation count. Window functions
 * keep this to one statement instead of shipping every food row to the Worker.
 */
const PORTIONS_SQL = `WITH observations AS (
                        SELECT LOWER(TRIM(f.name)) AS key,
                               TRIM(f.name) AS name,
                               m.logged_at AS logged_at,
                               f.estimated_weight_g * COALESCE(f.quantity, 1) AS weight_g
                          FROM food_items f
                          JOIN meals m ON m.id = f.meal_id
                         WHERE m.user_id = ? AND m.logged_at >= ? AND m.logged_at < ?
                           AND TRIM(f.name) <> ''
                           AND f.estimated_weight_g IS NOT NULL
                           AND f.estimated_weight_g > 0
                      ),
                      ranked AS (
                        SELECT key, name, weight_g,
                               ROW_NUMBER() OVER (PARTITION BY key ORDER BY logged_at ASC) AS first_rn,
                               ROW_NUMBER() OVER (PARTITION BY key ORDER BY logged_at DESC) AS last_rn,
                               COUNT(*) OVER (PARTITION BY key) AS observations
                          FROM observations
                      )
                      SELECT MAX(CASE WHEN first_rn = 1 THEN name END) AS name,
                             MAX(CASE WHEN first_rn = 1 THEN weight_g END) AS first_weight_g,
                             MAX(CASE WHEN last_rn = 1 THEN weight_g END) AS last_weight_g,
                             MAX(observations) AS observations
                        FROM ranked
                       GROUP BY key
                      HAVING MAX(observations) >= 3`;

/** Resolves the user's targets + body context, or null without a profile. */
function targetFor(preferencesJson: string | null | undefined): ReportTarget | null {
  const profile = UserProfile.safeParse(parsePreferences(preferencesJson).profile);
  if (!profile.success) return null;
  const targets = computeTargets(profile.data);
  return {
    energyKcal: targets.energyKcal,
    proteinG: targets.proteinG,
    weightKg: profile.data.weightKg,
    goal: reportGoal(profile.data.goal),
  };
}

/**
 * Advanced analytics. Reads only the user's own meals, never a photo, so a
 * manual-only account gets the same report. The supporter tag is the gate:
 * buying any pack or an active trial unlocks every range permanently.
 *
 * The report is assembled from SQL aggregates and cached for the user's local
 * day, so reopening Reports does not re-read the meal log. Any meal write clears
 * the cache for that user (see `db/meals.ts`).
 */
export function analyticsRoutes() {
  const app = new Hono<AppBindings>();

  app.get('/', async (c) => {
    const userId = c.get('userId');
    const requestedRange = c.req.query('range') ?? RANGE_90D;
    const tzOffsetMinutes = parseTzOffset(c.req.query('tz'));

    try {
      const entitlement = await getEntitlement(c.env.DB, userId, createEntitlementMemo());
      if (!entitlement.supporter) {
        return c.json(
          {
            error: 'Supporter only',
            detail:
              'Advanced analytics are part of the supporter tag. Any credit pack unlocks them permanently, and the trial includes them.',
          },
          403,
        );
      }

      if (requestedRange !== RANGE_90D && requestedRange !== RANGE_12M) {
        return c.json({ error: 'Bad request', detail: "range must be '90d' or '12m'" }, 400);
      }
      const range = requestedRange;

      const todayKey = localDayKey(Date.now(), tzOffsetMinutes);
      const rangeStartKey = reportRangeStartKey(range, todayKey);
      const startMs = Date.parse(`${rangeStartKey}T00:00:00Z`) + tzOffsetMinutes * 60_000;
      const dayStartMs = Date.parse(`${todayKey}T00:00:00Z`) + tzOffsetMinutes * 60_000;
      // Tomorrow's local midnight: the report never counts a meal dated ahead.
      const endMs = dayStartMs + 24 * 60 * 60 * 1000;

      const cacheDb = createAnalyticsCacheDb(c.env.DB);
      const cached = await readAnalyticsCache(cacheDb, userId, range, dayStartMs);
      if (cached) return c.body(cached, 200, { 'content-type': 'application/json' });

      const results = await c.env.DB.batch([
        c.env.DB.prepare(DAYS_SQL).bind(tzOffsetMinutes, userId, startMs, endMs),
        c.env.DB.prepare(HOURS_SQL).bind(tzOffsetMinutes, userId, startMs, endMs),
        c.env.DB.prepare(DISHES_SQL).bind(userId, startMs, endMs),
        c.env.DB.prepare(PORTIONS_SQL).bind(userId, startMs, endMs),
      ]);

      const dayRows = (results[0]?.results ?? []) as unknown as DayRow[];
      const hourRows = (results[1]?.results ?? []) as unknown as HourRow[];
      const dishRows = (results[2]?.results ?? []) as unknown as DishRow[];
      const portionRows = (results[3]?.results ?? []) as unknown as PortionRow[];

      const settings = await getSettings(createSettingsDb(c.env.DB), userId);
      const report: AdvancedReport = buildAdvancedReportFromAggregates({
        range,
        todayKey,
        days: dayRows.map(
          (row): ReportDayAggregate => ({
            dayKey: row.day_key,
            energyKcal: row.energy_kcal,
            proteinG: row.protein_g,
            meals: row.meals,
          }),
        ),
        hours: hourRows.map(
          (row): ReportHourAggregate => ({
            hour: row.hour,
            meals: row.meals,
            energyKcal: row.energy_kcal,
          }),
        ),
        dishes: dishRows.map((row): ReportDishAggregate => ({ name: row.name, meals: row.meals })),
        portions: portionRows.flatMap((row): ReportPortionAggregate[] =>
          row.first_weight_g == null || row.last_weight_g == null
            ? []
            : [
                {
                  name: row.name,
                  firstWeightG: row.first_weight_g,
                  lastWeightG: row.last_weight_g,
                  observations: row.observations,
                },
              ],
        ),
        target: targetFor(settings?.preferencesJson),
      });

      const payloadJson = JSON.stringify(report);
      await writeAnalyticsCache(cacheDb, userId, range, payloadJson);
      return c.json(report);
    } catch (err) {
      // Persist the failure with the account + range so a bare status on screen
      // is never the only trace. The client gets a sentence, never the status.
      const described = describeError(err);
      await logError(c.env.DB, {
        telegramUserId: c.get('telegramUser')?.id ?? null,
        source: 'analytics',
        kind: described.kind ?? 'analytics',
        status: described.status ?? 500,
        message: described.message,
        detail: JSON.stringify({ userId, range: requestedRange, tzOffsetMinutes }),
      });
      return c.json({ error: 'Report unavailable', detail: UNAVAILABLE }, 500);
    }
  });

  return app;
}
