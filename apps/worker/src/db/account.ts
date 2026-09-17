import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { foodItems, meals, nutrition, settings, users } from './schema.js';

export function createAccountDb(d1: D1Database) {
  return drizzle(d1, { schema: { users, settings, meals, foodItems, nutrition } });
}

export type AccountDb = ReturnType<typeof createAccountDb>;

export interface UserExport {
  exportedAt: string;
  user: { telegramUserId: number; createdAt: number };
  settings: { aiProvider: string; aiModel: string | null } | null;
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
      nutritionSource: string | null;
    }>;
  }>;
}

/**
 * Builds a full export of a user's data. The encrypted API key is deliberately
 * excluded — only the provider/model preference is included. No secrets.
 */
export async function exportUser(db: AccountDb, userId: string): Promise<UserExport | null> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) return null;

  const [settingsRows, mealRows] = await Promise.all([
    db.select().from(settings).where(eq(settings.userId, userId)).limit(1),
    db.select().from(meals).where(eq(meals.userId, userId)),
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
        nutritionSource: f.nutritionSource,
      })),
    });
  }

  const s = settingsRows[0];
  return {
    exportedAt: new Date().toISOString(),
    user: { telegramUserId: user.telegramUserId, createdAt: user.createdAt },
    settings: s ? { aiProvider: s.aiProvider, aiModel: s.aiModel } : null,
    meals: exportedMeals,
  };
}

/**
 * Permanently deletes a user and everything belonging to them. Deleting the
 * user row cascades (ON DELETE CASCADE) to settings, meals, food_items, and
 * nutrition. Returns false if the user didn't exist.
 */
export async function deleteAccount(db: AccountDb, userId: string): Promise<boolean> {
  const userRows = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (userRows.length === 0) return false;
  await db.delete(users).where(eq(users.id, userId));
  return true;
}
