import type { MealResult } from '@foodlog/core';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { type FoodItemRow, foodItems, meals, nutrition } from './schema.js';

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

/**
 * Replaces a meal's foods + nutrition + notes with the given MealResult, if the
 * meal belongs to the user. Returns false when the meal isn't owned/found.
 * Atomic via a single D1 batch (delete old children + insert new).
 */
export async function updateMeal(
  db: MealsDb,
  mealId: string,
  userId: string,
  meal: MealResult,
): Promise<boolean> {
  const owned = await mealOwnedBy(db, mealId, userId);
  if (!owned) return false;

  const statements = [
    db
      .update(meals)
      .set({ notes: meal.notes ?? null, confidence: meal.confidence })
      .where(eq(meals.id, mealId)),
    db.delete(foodItems).where(eq(foodItems.mealId, mealId)),
    db.delete(nutrition).where(eq(nutrition.mealId, mealId)),
    ...meal.foods.map((f) =>
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
      energyKcal: meal.total.energyKcal,
      proteinG: meal.total.proteinG,
      carbsG: meal.total.carbsG,
      fatG: meal.total.fatG,
      source: meal.total.source,
    }),
  ];
  await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
  return true;
}

/**
 * Deletes a meal (and its food_items + nutrition via ON DELETE CASCADE), if it
 * belongs to the user. Returns false when not owned/found.
 */
export async function deleteMeal(db: MealsDb, mealId: string, userId: string): Promise<boolean> {
  const owned = await mealOwnedBy(db, mealId, userId);
  if (!owned) return false;
  await db.delete(meals).where(eq(meals.id, mealId));
  return true;
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

export interface MealDetail {
  id: string;
  loggedAt: number;
  createdAt: number;
  notes: string | null;
  confidence: number | null;
  telegramFileId: string | null;
  foods: Array<{
    id: string;
    name: string;
    estimatedWeightG: number | null;
    portion: string | null;
    quantity: number;
    confidence: number | null;
  }>;
  total: {
    energyKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    source: string;
  } | null;
}

/** Fetches full detail for one meal, owner-scoped. Returns undefined if not owned. */
export async function getMealDetail(
  db: MealsDb,
  mealId: string,
  userId: string,
): Promise<MealDetail | undefined> {
  const mealRows = await db
    .select()
    .from(meals)
    .where(and(eq(meals.id, mealId), eq(meals.userId, userId)))
    .limit(1);
  const meal = mealRows[0];
  if (!meal) return undefined;

  const [foods, nut] = await Promise.all([
    db.select().from(foodItems).where(eq(foodItems.mealId, mealId)),
    db.select().from(nutrition).where(eq(nutrition.mealId, mealId)).limit(1),
  ]);

  const n = nut[0];
  return {
    id: meal.id,
    loggedAt: meal.loggedAt,
    createdAt: meal.createdAt,
    notes: meal.notes,
    confidence: meal.confidence,
    telegramFileId: meal.telegramFileId,
    foods: foods.map((f: FoodItemRow) => ({
      id: f.id,
      name: f.name,
      estimatedWeightG: f.estimatedWeightG,
      portion: f.portion,
      quantity: f.quantity,
      confidence: f.confidence,
    })),
    total: n
      ? {
          energyKcal: n.energyKcal,
          proteinG: n.proteinG,
          carbsG: n.carbsG,
          fatG: n.fatG,
          source: n.source,
        }
      : null,
  };
}

/**
 * Searches a user's meals by food name (case-insensitive LIKE). Deterministic
 * SQL — no AI. Returns matching meal summaries newest-first.
 */
export async function searchMeals(
  db: MealsDb,
  userId: string,
  query: string,
  limit = 50,
): Promise<MealSummary[]> {
  const q = query.trim();
  if (!q) return [];

  // Escape LIKE wildcards in user input, then wrap for a contains match.
  const escaped = q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const pattern = `%${escaped}%`;

  // Find the user's food_items whose name matches, scoped to their meals.
  const matches = await db
    .select({ mealId: foodItems.mealId })
    .from(foodItems)
    .innerJoin(meals, eq(foodItems.mealId, meals.id))
    .where(and(eq(meals.userId, userId), like(foodItems.name, pattern)));

  const mealIds = [...new Set(matches.map((m: { mealId: string }) => m.mealId))];
  if (mealIds.length === 0) return [];

  const mealRows = await db
    .select()
    .from(meals)
    .where(and(eq(meals.userId, userId), inArray(meals.id, mealIds)))
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
      foods: foods.map((f: FoodItemRow) => f.name),
    });
  }
  return summaries;
}
