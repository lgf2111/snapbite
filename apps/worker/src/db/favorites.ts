import { MealResult } from '@snapbite/core';
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { savedMeals } from './schema.js';

export function createFavoritesDb(d1: D1Database) {
  return drizzle(d1, { schema: { savedMeals } });
}

export type FavoritesDb = ReturnType<typeof createFavoritesDb>;

/** A saved-meal template as returned to the client. */
export interface Favorite {
  id: string;
  label: string;
  energyKcal: number | null;
  createdAt: number;
  /** The reusable MealResult (parsed from stored JSON). */
  meal: MealResult;
}

export interface SaveFavoriteInput {
  userId: string;
  label: string;
  meal: MealResult;
}

/** Persists a MealResult as a reusable favorite. Returns the new id. */
export async function saveFavorite(db: FavoritesDb, input: SaveFavoriteInput): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(savedMeals).values({
    id,
    userId: input.userId,
    label: input.label,
    mealJson: JSON.stringify(input.meal),
    energyKcal: input.meal.total.energyKcal,
    createdAt: Date.now(),
  });
  return id;
}

/** Lists a user's favorites, newest first. Skips any rows with unparseable JSON. */
export async function listFavorites(db: FavoritesDb, userId: string): Promise<Favorite[]> {
  const rows = await db
    .select()
    .from(savedMeals)
    .where(eq(savedMeals.userId, userId))
    .orderBy(desc(savedMeals.createdAt));

  const out: Favorite[] = [];
  for (const r of rows) {
    let parsed: MealResult | null = null;
    try {
      const result = MealResult.safeParse(JSON.parse(r.mealJson));
      parsed = result.success ? result.data : null;
    } catch {
      parsed = null;
    }
    if (!parsed) continue;
    out.push({
      id: r.id,
      label: r.label,
      energyKcal: r.energyKcal,
      createdAt: r.createdAt,
      meal: parsed,
    });
  }
  return out;
}

/** Deletes a favorite if it belongs to the user. Returns false when not owned. */
export async function deleteFavorite(
  db: FavoritesDb,
  id: string,
  userId: string,
): Promise<boolean> {
  const owned = await db
    .select({ id: savedMeals.id })
    .from(savedMeals)
    .where(and(eq(savedMeals.id, id), eq(savedMeals.userId, userId)))
    .limit(1);
  if (owned.length === 0) return false;
  await db.delete(savedMeals).where(eq(savedMeals.id, id));
  return true;
}
