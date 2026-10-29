import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { FoodItemRow, MealRow, NutritionRow, SavedMealRow } from './schema.js';
import {
  foodItems,
  meals,
  nutrition,
  pendingPhotoRetries,
  savedMeals,
  settings,
  users,
} from './schema.js';
import { parsePreferences } from './settings.js';

export function createAccountDb(d1: D1Database) {
  return drizzle(d1, {
    schema: { users, settings, meals, foodItems, nutrition, savedMeals, pendingPhotoRetries },
  });
}

export type AccountDb = ReturnType<typeof createAccountDb>;

/**
 * Above this many meals, /export offers a download link instead of uploading a
 * document to the chat (large files blow past Telegram's inline upload limits
 * and the webhook window). The Mini App's "Download my data" streams the same
 * JSON over HTTP.
 */
export const EXPORT_LINK_THRESHOLD_MEALS = 500;

/** Max ids per `inArray` statement so the SQL stays small (D1 statement size). */
const ID_CHUNK = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface UserExport {
  exportedAt: string;
  user: { telegramUserId: number; createdAt: number };
  settings: { aiProvider: string; aiModel: string | null } | null;
  /** Bodyweight check-ins (canonical kg), oldest→newest. */
  weights: Array<{ ts: number; kg: number }>;
  meals: Array<{
    id: string;
    loggedAt: number;
    createdAt: number;
    notes: string | null;
    confidence: number | null;
    telegramFileId: string | null;
    total: {
      energyKcal: number;
      proteinG: number;
      carbsG: number;
      fatG: number;
      fiberG: number | null;
      source: string;
    } | null;
    foods: Array<{
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
  }>;
  /** Saved-meal templates ("favorites"), with the stored MealResult JSON. */
  savedMeals: Array<{
    id: string;
    label: string;
    energyKcal: number | null;
    createdAt: number;
    meal: unknown;
  }>;
}

/**
 * The raw rows an export is assembled from, loaded in a constant number of
 * queries regardless of meal count: user, settings, meals, saved meals, plus
 * all food items and all nutrition rows for those meals fetched in `inArray`
 * batches (≤100 ids each). Returns null when the user doesn't exist.
 */
async function loadExportData(db: AccountDb, userId: string) {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) return null;

  const [settingsRows, mealRows, savedRows] = await Promise.all([
    db.select().from(settings).where(eq(settings.userId, userId)).limit(1),
    db.select().from(meals).where(eq(meals.userId, userId)),
    db.select().from(savedMeals).where(eq(savedMeals.userId, userId)),
  ]);

  const mealIds = mealRows.map((m) => m.id);
  const foodRows = [];
  const nutritionRows = [];
  for (const ids of chunk(mealIds, ID_CHUNK)) {
    const [foods, nut] = await Promise.all([
      db.select().from(foodItems).where(inArray(foodItems.mealId, ids)),
      db.select().from(nutrition).where(inArray(nutrition.mealId, ids)),
    ]);
    foodRows.push(...foods);
    nutritionRows.push(...nut);
  }

  // Group per meal id for in-memory assembly.
  const foodsByMeal = new Map<string, typeof foodRows>();
  for (const f of foodRows) {
    const list = foodsByMeal.get(f.mealId) ?? [];
    list.push(f);
    foodsByMeal.set(f.mealId, list);
  }
  const nutritionByMeal = new Map<string, (typeof nutritionRows)[number]>();
  for (const n of nutritionRows) nutritionByMeal.set(n.mealId, n);

  const s = settingsRows[0];
  // Weight check-ins live inside preferences_json (never a secret).
  const prefs = parsePreferences(s?.preferencesJson);
  const weights = Array.isArray(prefs.weights) ? (prefs.weights ?? []) : [];

  return { user, settings: s, mealRows, savedRows, foodsByMeal, nutritionByMeal, weights };
}

/** Shapes a single meal row + its grouped foods/nutrition into the export form. */
function assembleMeal(
  meal: MealRow,
  foodsByMeal: Map<string, FoodItemRow[]>,
  nutritionByMeal: Map<string, NutritionRow>,
): UserExport['meals'][number] {
  const n = nutritionByMeal.get(meal.id);
  const foods = foodsByMeal.get(meal.id) ?? [];
  return {
    id: meal.id,
    loggedAt: meal.loggedAt,
    createdAt: meal.createdAt,
    notes: meal.notes,
    confidence: meal.confidence,
    telegramFileId: meal.telegramFileId,
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
    foods: foods.map((f) => ({
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
  };
}

/** Shapes a saved-meal row into the export form (parsing its MealResult JSON). */
function assembleSaved(r: SavedMealRow): UserExport['savedMeals'][number] {
  let meal: unknown = null;
  try {
    meal = JSON.parse(r.mealJson);
  } catch {
    meal = null;
  }
  return { id: r.id, label: r.label, energyKcal: r.energyKcal, createdAt: r.createdAt, meal };
}

/**
 * Builds a full export of a user's data: profile/provider preference, weight
 * check-ins, every meal with its foods + per-food nutrition, and their saved
 * meals. The encrypted API key (and its ciphertext/iv) is deliberately
 * excluded — only the provider/model preference is included. No secrets.
 * Runs a constant number of D1 queries regardless of meal count. Returns null
 * when the user doesn't exist.
 */
export async function exportUser(db: AccountDb, userId: string): Promise<UserExport | null> {
  const loaded = await loadExportData(db, userId);
  if (!loaded) return null;
  const { user, settings: s, mealRows, savedRows, foodsByMeal, nutritionByMeal, weights } = loaded;

  return {
    exportedAt: new Date().toISOString(),
    user: { telegramUserId: user.telegramUserId, createdAt: user.createdAt },
    settings: s ? { aiProvider: s.aiProvider, aiModel: s.aiModel } : null,
    weights,
    meals: mealRows.map((m) => assembleMeal(m, foodsByMeal, nutritionByMeal)),
    savedMeals: savedRows.map(assembleSaved),
  };
}

/**
 * Streams a user's export as JSON into a `ReadableStream`, byte-identical to
 * `JSON.stringify(exportUser(...), null, 2)`. Writes the preamble (user,
 * settings, weights), then each meal incrementally, then saved meals and the
 * closing braces — so the browser downloads immediately and Worker memory stays
 * flat. Returns null when the user doesn't exist.
 */
export async function streamUserExport(
  db: AccountDb,
  userId: string,
): Promise<ReadableStream<Uint8Array> | null> {
  const loaded = await loadExportData(db, userId);
  if (!loaded) return null;
  const { user, settings: s, mealRows, savedRows, foodsByMeal, nutritionByMeal, weights } = loaded;

  const encoder = new TextEncoder();
  // Serialize each top-level value with the same 2-space indent the buffered
  // path uses, then re-indent nested lines by one level so the stitched output
  // matches JSON.stringify(data, null, 2) byte-for-byte.
  const field = (value: unknown): string => JSON.stringify(value, null, 2).replace(/\n/g, '\n  ');

  return new ReadableStream({
    start(controller) {
      const push = (s: string) => controller.enqueue(encoder.encode(s));

      push('{\n');
      push(`  "exportedAt": ${field(new Date().toISOString())},\n`);
      push(
        `  "user": ${field({ telegramUserId: user.telegramUserId, createdAt: user.createdAt })},\n`,
      );
      push(
        `  "settings": ${field(s ? { aiProvider: s.aiProvider, aiModel: s.aiModel } : null)},\n`,
      );
      push(`  "weights": ${field(weights)},\n`);

      // Meals array, one assembled meal at a time.
      push('  "meals": [');
      mealRows.forEach((m, i) => {
        const shaped = assembleMeal(m, foodsByMeal, nutritionByMeal);
        const body = JSON.stringify(shaped, null, 2).replace(/\n/g, '\n    ');
        push(`${i === 0 ? '' : ','}\n    ${body}`);
      });
      push(mealRows.length > 0 ? '\n  ],\n' : '],\n');

      // Saved meals array.
      push('  "savedMeals": [');
      savedRows.forEach((r, i) => {
        const shaped = assembleSaved(r);
        const body = JSON.stringify(shaped, null, 2).replace(/\n/g, '\n    ');
        push(`${i === 0 ? '' : ','}\n    ${body}`);
      });
      push(savedRows.length > 0 ? '\n  ]\n' : ']\n');

      push('}');
      controller.close();
    },
  });
}

/**
 * Whether a user has any data worth exporting (a meal, a saved meal, or a
 * weight check-in). Used so /export can say "nothing to export" instead of
 * sending an essentially empty document.
 */
export function hasExportableData(data: UserExport): boolean {
  return data.meals.length > 0 || data.savedMeals.length > 0 || data.weights.length > 0;
}

/**
 * Permanently deletes a user and everything belonging to them, scoped strictly
 * to the caller's own rows. Ordered child-first so no orphan rows survive even
 * if foreign-key cascades are off: food_items + nutrition (by the user's meal
 * ids) → meals → saved_meals → pending_photo_retries → settings → the user row.
 * The weight check-ins live in settings.preferences_json, so they go with the
 * settings row. Returns false if the user didn't exist.
 */
export async function deleteAccount(db: AccountDb, userId: string): Promise<boolean> {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (userRows.length === 0) return false;

  const mealIdRows = await db.select({ id: meals.id }).from(meals).where(eq(meals.userId, userId));
  const mealIds = mealIdRows.map((r) => r.id);

  if (mealIds.length > 0) {
    await db.delete(foodItems).where(inArray(foodItems.mealId, mealIds));
    await db.delete(nutrition).where(inArray(nutrition.mealId, mealIds));
  }
  await db.delete(meals).where(eq(meals.userId, userId));
  await db.delete(savedMeals).where(eq(savedMeals.userId, userId));
  await db.delete(pendingPhotoRetries).where(eq(pendingPhotoRetries.userId, userId));
  await db.delete(settings).where(eq(settings.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  return true;
}
