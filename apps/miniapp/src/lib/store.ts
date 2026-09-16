import type { MealResult } from '@foodlog/core';

/** A meal saved locally (Task 5 has no backend). */
export interface SavedMeal {
  id: string;
  savedAt: string;
  previewUrl?: string;
  meal: MealResult;
}

const STORAGE_KEY = 'foodlog.meals.v1';

/**
 * Minimal localStorage-backed meal store for the pre-backend Mini App. Swapped
 * for Worker API calls in Task 8; the screens depend only on these functions.
 */
export function loadMeals(): SavedMeal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedMeal[]) : [];
  } catch {
    return [];
  }
}

export function saveMeal(meal: MealResult, previewUrl?: string): SavedMeal {
  const entry: SavedMeal = {
    id: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    ...(previewUrl ? { previewUrl } : {}),
    meal,
  };
  const all = loadMeals();
  all.unshift(entry);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full or unavailable — non-fatal for the demo.
  }
  return entry;
}
