import { z } from 'zod';

/**
 * A confidence score in [0, 1]. Used both per-food and for the overall analysis.
 */
export const Confidence = z.number().min(0).max(1);
export type Confidence = z.infer<typeof Confidence>;

const nonNegative = z.number().finite().nonnegative();

/**
 * Per-100g macro/energy figures. Used both for the bundled local table and for
 * the AI's optional rough estimate, so the resolver can scale either the same
 * way (by grams / 100).
 */
export const NutritionPer100g = z.object({
  energyKcal: nonNegative,
  proteinG: nonNegative,
  carbsG: nonNegative,
  fatG: nonNegative,
});
export type NutritionPer100g = z.infer<typeof NutritionPer100g>;

/**
 * A single food the AI identified in a photo, before nutrition is resolved.
 * Portion is a free-text human description ("1 bowl", "2 slices"); the numeric
 * `estimatedWeightG` is what the nutrition resolver actually scales by.
 *
 * `aiNutrition` is the AI's optional rough per-100g estimate. The resolver
 * prefers a local table match and falls back to this when present.
 */
export const FoodItem = z.object({
  name: z.string().min(1),
  estimatedWeightG: z.number().finite().positive(),
  portion: z.string().min(1).optional(),
  quantity: z.number().finite().positive().default(1),
  confidence: Confidence,
  aiNutrition: NutritionPer100g.optional(),
});
export type FoodItem = z.infer<typeof FoodItem>;
