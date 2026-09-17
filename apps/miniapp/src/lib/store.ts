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

function writeAll(all: SavedMeal[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full or unavailable — non-fatal for the demo.
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
  writeAll(all);
  return entry;
}

/** Replaces the meal body of an existing saved entry. Returns true if found. */
export function updateSavedMeal(id: string, meal: MealResult): boolean {
  const all = loadMeals();
  const idx = all.findIndex((m) => m.id === id);
  if (idx < 0) return false;
  const existing = all[idx] as SavedMeal;
  all[idx] = { ...existing, meal };
  writeAll(all);
  return true;
}

/** Removes every saved meal (used by local-mode account deletion). */
export function clearMeals(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — non-fatal.
  }
}

/** Removes a saved meal by id. Returns true if it existed. */
export function deleteSavedMeal(id: string): boolean {
  const all = loadMeals();
  const next = all.filter((m) => m.id !== id);
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
}
