import type { MealResult } from '@snapbite/core';
import { and, count, desc, eq, gte } from 'drizzle-orm';
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
  /** AI provider that analyzed this meal (e.g. 'gemini'); omit for manual. */
  aiProvider?: string | null;
  /** Chat + message id of the bot confirmation, so it can be edited on revise. */
  telegramChatId?: number | null;
  telegramMessageId?: number | null;
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
      title: m.title ?? null,
      notes: m.notes ?? null,
      confidence: m.confidence,
      aiProvider: input.aiProvider ?? null,
      telegramChatId: input.telegramChatId ?? null,
      telegramMessageId: input.telegramMessageId ?? null,
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
        energyKcal: f.nutrition.energyKcal,
        proteinG: f.nutrition.proteinG,
        carbsG: f.nutrition.carbsG,
        fatG: f.nutrition.fatG,
        fiberG: f.nutrition.fiberG ?? null,
        nutritionSource: f.nutrition.source,
      }),
    ),
    db.insert(nutrition).values({
      mealId,
      energyKcal: m.total.energyKcal,
      proteinG: m.total.proteinG,
      carbsG: m.total.carbsG,
      fatG: m.total.fatG,
      fiberG: m.total.fiberG ?? null,
      source: m.total.source,
    }),
  ];

  // drizzle-d1 batch takes a non-empty tuple; we always have >= 2 statements.
  await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
  return mealId;
}

/** A meal's Telegram confirmation reference, used to edit it in place. */
export interface MealTelegramRef {
  id: string;
  loggedAt: number;
  telegramChatId: number | null;
  telegramMessageId: number | null;
}

/**
 * Recent meals for a user (newest first), limited to a time window and count.
 * Used by the bot's "plain text = revise the last meal" flow to find the target
 * meal and to detect ambiguity (multiple recent meals).
 */
export async function recentMealsForUser(
  db: MealsDb,
  userId: string,
  sinceMs: number,
  limit = 5,
): Promise<MealTelegramRef[]> {
  const rows = await db
    .select({
      id: meals.id,
      loggedAt: meals.loggedAt,
      telegramChatId: meals.telegramChatId,
      telegramMessageId: meals.telegramMessageId,
    })
    .from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.loggedAt, sinceMs)))
    .orderBy(desc(meals.loggedAt))
    .limit(limit);
  return rows;
}

/**
 * Counts a user's meals logged since `sinceMs`. A single indexed COUNT (the
 * `meals_user_logged_idx` on userId+loggedAt covers it), used by the bot's generous
 * per-user photo rate-limit so a flood of photos can't run up D1/Telegram work.
 */
export async function countMealsSince(
  db: MealsDb,
  userId: string,
  sinceMs: number,
): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.loggedAt, sinceMs)));
  return rows[0]?.n ?? 0;
}

/** Macro totals summed across a set of meals. */
export interface MacroTotals {
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/**
 * Sums a user's meal nutrition since `sinceMs` (e.g. local midnight), for the
 * bot's deterministic "today vs. target" nudge. Reads the per-meal `nutrition`
 * rows for meals in the window via a single join — no AI, cheap on the free
 * tier. Returns zeros when there's nothing yet.
 */
export async function sumMealsSince(
  db: MealsDb,
  userId: string,
  sinceMs: number,
): Promise<MacroTotals> {
  const rows = await db
    .select({
      energyKcal: nutrition.energyKcal,
      proteinG: nutrition.proteinG,
      carbsG: nutrition.carbsG,
      fatG: nutrition.fatG,
    })
    .from(nutrition)
    .innerJoin(meals, eq(nutrition.mealId, meals.id))
    .where(and(eq(meals.userId, userId), gte(meals.loggedAt, sinceMs)));

  return rows.reduce<MacroTotals>(
    (acc, r) => ({
      energyKcal: acc.energyKcal + (r.energyKcal ?? 0),
      proteinG: acc.proteinG + (r.proteinG ?? 0),
      carbsG: acc.carbsG + (r.carbsG ?? 0),
      fatG: acc.fatG + (r.fatG ?? 0),
    }),
    { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

/** A meal's timestamp + per-meal totals, for streak/recap bucketing by local day. */
export interface MealRowForStats {
  loggedAt: number;
  energyKcal: number;
  proteinG: number;
}

/**
 * Returns a user's meals since `sinceMs` as `(loggedAt, energyKcal, proteinG)`
 * rows (newest first), for computing the logging streak and the weekly recap by
 * bucketing into the user's local day. One indexed scan + nutrition join.
 */
export async function mealRowsSince(
  db: MealsDb,
  userId: string,
  sinceMs: number,
): Promise<MealRowForStats[]> {
  const rows = await db
    .select({
      loggedAt: meals.loggedAt,
      energyKcal: nutrition.energyKcal,
      proteinG: nutrition.proteinG,
    })
    .from(meals)
    .innerJoin(nutrition, eq(nutrition.mealId, meals.id))
    .where(and(eq(meals.userId, userId), gte(meals.loggedAt, sinceMs)))
    .orderBy(desc(meals.loggedAt));
  return rows.map((r) => ({
    loggedAt: r.loggedAt,
    energyKcal: r.energyKcal ?? 0,
    proteinG: r.proteinG ?? 0,
  }));
}

/** Finds a user's meal by the bot message_id it replied to (for reply-to targeting). */
export async function findMealByMessageId(
  db: MealsDb,
  userId: string,
  messageId: number,
): Promise<MealTelegramRef | undefined> {
  const rows = await db
    .select({
      id: meals.id,
      loggedAt: meals.loggedAt,
      telegramChatId: meals.telegramChatId,
      telegramMessageId: meals.telegramMessageId,
    })
    .from(meals)
    .where(and(eq(meals.userId, userId), eq(meals.telegramMessageId, messageId)))
    .limit(1);
  return rows[0];
}

export interface MealSummary {
  id: string;
  loggedAt: number;
  title: string | null;
  notes: string | null;
  confidence: number | null;
  energyKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  source: string | null;
  aiProvider: string | null;
  foods: string[];
  hasPhoto: boolean;
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
      title: meal.title ?? null,
      notes: meal.notes,
      confidence: meal.confidence,
      energyKcal: nut[0]?.energyKcal ?? null,
      proteinG: nut[0]?.proteinG ?? null,
      carbsG: nut[0]?.carbsG ?? null,
      fatG: nut[0]?.fatG ?? null,
      source: nut[0]?.source ?? null,
      aiProvider: meal.aiProvider ?? null,
      foods: foods.map((f) => f.name),
      hasPhoto: Boolean(meal.telegramFileId),
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
      .set({ title: meal.title ?? null, notes: meal.notes ?? null, confidence: meal.confidence })
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
        energyKcal: f.nutrition.energyKcal,
        proteinG: f.nutrition.proteinG,
        carbsG: f.nutrition.carbsG,
        fatG: f.nutrition.fatG,
        nutritionSource: f.nutrition.source,
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
export async function mealOwnedBy(db: MealsDb, mealId: string, userId: string): Promise<boolean> {
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
  title: string | null;
  notes: string | null;
  confidence: number | null;
  telegramFileId: string | null;
  aiProvider: string | null;
  telegramChatId: number | null;
  telegramMessageId: number | null;
  foods: Array<{
    id: string;
    name: string;
    estimatedWeightG: number | null;
    portion: string | null;
    quantity: number;
    confidence: number | null;
    energyKcal: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    nutritionSource: string | null;
  }>;
  total: {
    energyKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number | null;
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
    title: meal.title ?? null,
    notes: meal.notes,
    confidence: meal.confidence,
    telegramFileId: meal.telegramFileId,
    aiProvider: meal.aiProvider,
    telegramChatId: meal.telegramChatId,
    telegramMessageId: meal.telegramMessageId,
    foods: foods.map((f: FoodItemRow) => ({
      id: f.id,
      name: f.name,
      estimatedWeightG: f.estimatedWeightG,
      portion: f.portion,
      quantity: f.quantity,
      confidence: f.confidence,
      energyKcal: f.energyKcal,
      proteinG: f.proteinG,
      carbsG: f.carbsG,
      fatG: f.fatG,
      fiberG: f.fiberG,
      nutritionSource: f.nutritionSource,
    })),
    total: n
      ? {
          energyKcal: n.energyKcal,
          proteinG: n.proteinG,
          carbsG: n.carbsG,
          fatG: n.fatG,
          fiberG: n.fiberG,
          source: n.source,
        }
      : null,
  };
}
