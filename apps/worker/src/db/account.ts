import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
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
 * Builds a full export of a user's data: profile/provider preference, weight
 * check-ins, every meal with its foods + per-food nutrition, and their saved
 * meals. The encrypted API key (and its ciphertext/iv) is deliberately
 * excluded — only the provider/model preference is included. No secrets.
 * Returns null when the user doesn't exist.
 */
export async function exportUser(db: AccountDb, userId: string): Promise<UserExport | null> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) return null;

  const [settingsRows, mealRows, savedRows] = await Promise.all([
    db.select().from(settings).where(eq(settings.userId, userId)).limit(1),
    db.select().from(meals).where(eq(meals.userId, userId)),
    db.select().from(savedMeals).where(eq(savedMeals.userId, userId)),
  ]);

  const exportedMeals: UserExport['meals'] = [];
  for (const meal of mealRows) {
    const [foods, nut] = await Promise.all([
      db.select().from(foodItems).where(eq(foodItems.mealId, meal.id)),
      db.select().from(nutrition).where(eq(nutrition.mealId, meal.id)).limit(1),
    ]);
    const n = nut[0];
    exportedMeals.push({
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
    });
  }

  const s = settingsRows[0];
  // Weight check-ins live inside preferences_json (never a secret).
  const weights = Array.isArray(parsePreferences(s?.preferencesJson).weights)
    ? (parsePreferences(s?.preferencesJson).weights ?? [])
    : [];

  const exportedSaved: UserExport['savedMeals'] = savedRows.map((r) => {
    let meal: unknown = null;
    try {
      meal = JSON.parse(r.mealJson);
    } catch {
      meal = null;
    }
    return {
      id: r.id,
      label: r.label,
      energyKcal: r.energyKcal,
      createdAt: r.createdAt,
      meal,
    };
  });

  return {
    exportedAt: new Date().toISOString(),
    user: { telegramUserId: user.telegramUserId, createdAt: user.createdAt },
    settings: s ? { aiProvider: s.aiProvider, aiModel: s.aiModel } : null,
    weights,
    meals: exportedMeals,
    savedMeals: exportedSaved,
  };
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
