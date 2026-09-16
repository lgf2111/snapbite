import type { MealResult } from '@foodlog/core';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { foodItems, meals, nutrition } from './schema.js';

export function createMealsDb(d1: D1Database) {
  return drizzle(d1, { schema: { meals, foodItems, nutrition } });
}

export type MealsDb = ReturnType<typeof createMealsDb>;

export interface SaveMealInput {
  userId: string;
  meal: MealResult;
  telegramFileId?: string;
  loggedAt?: number;
}

/**
 * Persists a MealResult as meal + food_items + nutrition rows in a single D1
 * batch (atomic). Returns the new meal id.
 */
export async function saveMeal(db: MealsDb, input: SaveMealInput): Promise<string> {
  const mealId = crypto.randomUUID();
  const now = Date.now();
  const loggedAt = input.loggedAt ?? now;
  const m = input.meal;

  const statements = [
    db.insert(meals).values({
      id: mealId,
      userId: input.userId,
      telegramFileId: input.telegramFileId ?? null,
      notes: m.notes ?? null,
      confidence: m.confidence,
      createdAt: now,
      loggedAt,
    }),
    ...m.foods.map((f) =>
      db.insert(foodItems).values({
        id: crypto.randomUUID(),
        mealId,
        name: f.food.name,
        estimatedWeightG: f.food.estimatedWeightG,
        portion: f.food.portion ?? null,
        quantity: f.food.quantity,
        confidence: f.food.confidence,
      }),
    ),
    db.insert(nutrition).values({
      mealId,
      energyKcal: m.total.energyKcal,
      proteinG: m.total.proteinG,
      carbsG: m.total.carbsG,
      fatG: m.total.fatG,
      source: m.total.source,
    }),
  ];

  // drizzle-d1 batch takes a non-empty tuple; we always have >= 2 statements.
  await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
  return mealId;
}

export interface MealSummary {
  id: string;
  loggedAt: number;
  notes: string | null;
  confidence: number | null;
  energyKcal: number | null;
  source: string | null;
  foods: string[];
}

/** Lists a user's meals (newest first) with a food-name summary and totals. */
export async function listMeals(db: MealsDb, userId: string, limit = 50): Promise<MealSummary[]> {
  const mealRows = await db
    .select()
    .from(meals)
    .where(eq(meals.userId, userId))
    .orderBy(desc(meals.loggedAt))
    .limit(limit);

  const summaries: MealSummary[] = [];
  for (const meal of mealRows) {
    const [foods, nut] = await Promise.all([
      db.select().from(foodItems).where(eq(foodItems.mealId, meal.id)),
      db.select().from(nutrition).where(eq(nutrition.mealId, meal.id)).limit(1),
    ]);
    summaries.push({
      id: meal.id,
      loggedAt: meal.loggedAt,
      notes: meal.notes,
      confidence: meal.confidence,
      energyKcal: nut[0]?.energyKcal ?? null,
      source: nut[0]?.source ?? null,
      foods: foods.map((f) => f.name),
    });
  }
  return summaries;
}

/** Verifies a meal belongs to the user (for detail/delete in later tasks). */
export async function mealOwnedBy(
  db: MealsDb,
  mealId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: meals.id })
    .from(meals)
    .where(and(eq(meals.id, mealId), eq(meals.userId, userId)))
    .limit(1);
  return rows.length > 0;
}
