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
  notes: z.string().optional(),
});
export type MealResult = z.infer<typeof MealResult>;
