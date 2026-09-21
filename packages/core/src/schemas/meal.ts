import { z } from 'zod';
import { Confidence, FoodItem } from './food.js';
import { NutritionValue } from './nutrition.js';

/**
 * A food paired with its resolved nutrition — one entry in a MealResult.
 */
export const MealFood = z.object({
  food: FoodItem,
  nutrition: NutritionValue,
});
export type MealFood = z.infer<typeof MealFood>;

/**
 * The editable, user-facing draft produced after AI analysis + nutrition
 * resolution. This is what the confirm screen renders and what gets persisted
 * once the user accepts it. All nutrition is an estimate and is correctable.
 */
export const MealResult = z.object({
  foods: z.array(MealFood).min(1),
  total: NutritionValue,
  confidence: Confidence,
  needsConfirmation: z.boolean(),
  /** Short, shareable meal name (2–4 words), e.g. "Chicken rice". */
  title: z.string().optional(),
  notes: z.string().optional(),
});
export type MealResult = z.infer<typeof MealResult>;

/** A single manually-entered food: a name plus absolute macros for the item. */
export interface ManualFoodInput {
  name: string;
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/**
 * Builds a persistable {@link MealResult} from manually-entered foods (no AI,
 * no photo). Each food's macros are taken verbatim and tagged `manual`; the
 * meal total is their sum (tagged `manual` for one food, `mixed` for several).
 * Weight defaults to 100g since macros are entered as absolute values.
 */
export function buildManualMeal(foods: ManualFoodInput[], notes?: string): MealResult {
  const clean = foods
    .map((f) => ({
      name: f.name.trim(),
      energyKcal: Math.max(0, f.energyKcal || 0),
      proteinG: Math.max(0, f.proteinG || 0),
      carbsG: Math.max(0, f.carbsG || 0),
      fatG: Math.max(0, f.fatG || 0),
    }))
    .filter((f) => f.name.length > 0);
  if (clean.length === 0) {
    throw new Error('Add at least one food with a name');
  }

  const mealFoods: MealFood[] = clean.map((f) => ({
    food: {
      name: f.name,
      estimatedWeightG: 100,
      quantity: 1,
      confidence: 1,
    },
    nutrition: {
      energyKcal: f.energyKcal,
      proteinG: f.proteinG,
      carbsG: f.carbsG,
      fatG: f.fatG,
      source: 'manual',
    },
  }));

  const sum = clean.reduce(
    (acc, f) => ({
      energyKcal: acc.energyKcal + f.energyKcal,
      proteinG: acc.proteinG + f.proteinG,
      carbsG: acc.carbsG + f.carbsG,
      fatG: acc.fatG + f.fatG,
    }),
    { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );

  // The entered food name(s) make a fine short title for a manual meal.
  const title =
    clean.length === 1 ? clean[0]!.name : `${clean[0]!.name} & ${clean.length - 1} more`;

  return {
    foods: mealFoods,
    total: { ...sum, source: clean.length > 1 ? 'mixed' : 'manual' },
    confidence: 1,
    needsConfirmation: false,
    title,
    ...(notes && notes.trim() ? { notes: notes.trim() } : {}),
  };
}
