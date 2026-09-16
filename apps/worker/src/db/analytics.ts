import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { foodItems, meals, nutrition } from './schema.js';

export function createAnalyticsDb(d1: D1Database) {
  return drizzle(d1, { schema: { meals, foodItems, nutrition } });
}

export type AnalyticsDb = ReturnType<typeof createAnalyticsDb>;

export interface DailyPoint {
  /** YYYY-MM-DD (UTC). */
  date: string;
  kcal: number;
  meals: number;
}

export interface CommonFood {
  name: string;
  count: number;
}

export interface MacroAverages {
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface AnalyticsSummary {
  totalMeals: number;
  totalKcal: number;
  avgKcalPerMeal: number;
  daily: DailyPoint[];
  commonFoods: CommonFood[];
  macroAverages: MacroAverages;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Computes analytics for a user over the last `days` days using aggregate SQL —
 * no AI calls. All queries are owner-scoped.
 */
export async function getAnalytics(
  db: AnalyticsDb,
  userId: string,
  days = 30,
): Promise<AnalyticsSummary> {
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

  // Totals + averages across the window (join meals -> nutrition).
  const totalsRows = await db
    .select({
      totalMeals: sql<number>`count(${meals.id})`,
      totalKcal: sql<number>`coalesce(sum(${nutrition.energyKcal}), 0)`,
      avgProtein: sql<number>`coalesce(avg(${nutrition.proteinG}), 0)`,
      avgCarbs: sql<number>`coalesce(avg(${nutrition.carbsG}), 0)`,
      avgFat: sql<number>`coalesce(avg(${nutrition.fatG}), 0)`,
    })
    .from(meals)
    .leftJoin(nutrition, eq(nutrition.mealId, meals.id))
    .where(and(eq(meals.userId, userId), gte(meals.loggedAt, sinceMs)));

  const totals = totalsRows[0] ?? {
    totalMeals: 0,
    totalKcal: 0,
    avgProtein: 0,
    avgCarbs: 0,
    avgFat: 0,
  };

  // Daily buckets. SQLite: loggedAt is ms epoch; convert to a UTC date string.
  const dateExpr = sql<string>`strftime('%Y-%m-%d', ${meals.loggedAt} / 1000, 'unixepoch')`;
  const dailyRows = await db
    .select({
      date: dateExpr,
      kcal: sql<number>`coalesce(sum(${nutrition.energyKcal}), 0)`,
      meals: sql<number>`count(${meals.id})`,
    })
    .from(meals)
    .leftJoin(nutrition, eq(nutrition.mealId, meals.id))
    .where(and(eq(meals.userId, userId), gte(meals.loggedAt, sinceMs)))
    .groupBy(dateExpr)
    .orderBy(desc(dateExpr));

  // Most common foods (by name), owner-scoped.
  const commonRows = await db
    .select({
      name: foodItems.name,
      count: sql<number>`count(${foodItems.id})`,
    })
    .from(foodItems)
    .innerJoin(meals, eq(foodItems.mealId, meals.id))
    .where(and(eq(meals.userId, userId), gte(meals.loggedAt, sinceMs)))
    .groupBy(foodItems.name)
    .orderBy(desc(sql`count(${foodItems.id})`))
    .limit(10);

  const totalMeals = Number(totals.totalMeals) || 0;
  const totalKcal = round1(Number(totals.totalKcal) || 0);

  return {
    totalMeals,
    totalKcal,
    avgKcalPerMeal: totalMeals > 0 ? round1(totalKcal / totalMeals) : 0,
    daily: dailyRows.map((r: { date: string; kcal: number; meals: number }) => ({
      date: r.date,
      kcal: round1(Number(r.kcal) || 0),
      meals: Number(r.meals) || 0,
    })),
    commonFoods: commonRows.map((r: { name: string; count: number }) => ({
      name: r.name,
      count: Number(r.count) || 0,
    })),
    macroAverages: {
      proteinG: round1(Number(totals.avgProtein) || 0),
      carbsG: round1(Number(totals.avgCarbs) || 0),
      fatG: round1(Number(totals.avgFat) || 0),
    },
  };
}
