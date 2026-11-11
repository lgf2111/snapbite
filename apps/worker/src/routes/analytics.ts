import {
  type AdvancedReport,
  type ReportFood,
  type ReportMeal,
  type ReportTarget,
  UserProfile,
  buildAdvancedReport,
  computeTargets,
  reportGoal,
  reportRangeStartKey,
} from '@snapbite/core';
import { Hono } from 'hono';
import {
  createEntitlementMemo,
  getEntitlement,
} from '../billing/accounts.js';
import { createSettingsDb, getSettings, parsePreferences } from '../db/settings.js';
import type { AppBindings } from '../env.js';
import { localDayKey, parseTzOffset } from './meals.js';

const RANGE_90D = '90d';
const RANGE_12M = '12m';

interface AnalyticsRow {
  meal_id: string;
  logged_at: number;
  energy_kcal: number | null;
  protein_g: number | null;
  food_name: string | null;
  weight_g: number | null;
  quantity: number | null;
}

interface MutableMeal {
  loggedAt: number;
  dayKey: string;
  hour: number;
  energyKcal: number;
  proteinG: number;
  foods: ReportFood[];
}

/**
 * Rebuilds one meal per row group. The query LEFT JOINs nutrition and foods, so
 * a manual meal with no food lines still counts: nutrition is optional here too.
 */
function toReportMeals(rows: readonly AnalyticsRow[], tzOffsetMinutes: number): ReportMeal[] {
  const meals = new Map<string, MutableMeal>();

  for (const row of rows) {
    let meal = meals.get(row.meal_id);
    if (!meal) {
      meal = {
        loggedAt: row.logged_at,
        dayKey: localDayKey(row.logged_at, tzOffsetMinutes),
        hour: new Date(row.logged_at - tzOffsetMinutes * 60_000).getUTCHours(),
        energyKcal: row.energy_kcal ?? 0,
        proteinG: row.protein_g ?? 0,
        foods: [],
      };
      meals.set(row.meal_id, meal);
    }
    if (row.food_name) {
      meal.foods.push({
        name: row.food_name,
        weightG: row.weight_g != null ? row.weight_g * (row.quantity ?? 1) : null,
      });
    }
  }

  return [...meals.values()];
}

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
 */
export function analyticsRoutes() {
  const app = new Hono<AppBindings>();

  app.get('/', async (c) => {
    const entitlement = await getEntitlement(
      c.env.DB,
      c.get('userId'),
      createEntitlementMemo(),
    );
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

    const range = c.req.query('range') ?? RANGE_90D;
    if (range !== RANGE_90D && range !== RANGE_12M) {
      return c.json(
        { error: 'Bad request', detail: "range must be '90d' or '12m'" },
        400,
      );
    }

    const tzOffsetMinutes = parseTzOffset(c.req.query('tz'));
    const todayKey = localDayKey(Date.now(), tzOffsetMinutes);
    const rangeStartKey = reportRangeStartKey(range, todayKey);
    const startMs =
      Date.parse(`${rangeStartKey}T00:00:00Z`) + tzOffsetMinutes * 60_000;

    const { results } = await c.env.DB.prepare(
      `SELECT m.id AS meal_id,
              m.logged_at AS logged_at,
              n.energy_kcal AS energy_kcal,
              n.protein_g AS protein_g,
              f.name AS food_name,
              f.estimated_weight_g AS weight_g,
              f.quantity AS quantity
         FROM meals m
         LEFT JOIN nutrition n ON n.meal_id = m.id
         LEFT JOIN food_items f ON f.meal_id = m.id
        WHERE m.user_id = ? AND m.logged_at >= ?
        ORDER BY m.logged_at ASC`,
    )
      .bind(c.get('userId'), startMs)
      .all<AnalyticsRow>();

    const settings = await getSettings(createSettingsDb(c.env.DB), c.get('userId'));
    const report: AdvancedReport = buildAdvancedReport({
      range,
      todayKey,
      meals: toReportMeals(results, tzOffsetMinutes),
      target: targetFor(settings?.preferencesJson),
    });

    return c.json(report);
  });

  return app;
}
