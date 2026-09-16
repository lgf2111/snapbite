import { z } from 'zod';

/**
 * Where a nutrition value came from. Every value is source-labeled and shown as
 * an estimate:
 * - `table`       — resolved from the bundled local per-100g table.
 * - `ai_estimate` — the AI's rough estimate (no table match).
 * - `mixed`       — an aggregate combining table-backed and AI-estimated foods.
 */
export const NutritionSource = z.enum(['table', 'ai_estimate', 'mixed']);
export type NutritionSource = z.infer<typeof NutritionSource>;

const nonNegative = z.number().finite().nonnegative();

/**
 * A resolved set of macro/energy values for a food item or an aggregated meal.
 * Always presented to the user as an estimate.
 */
export const NutritionValue = z.object({
  energyKcal: nonNegative,
  proteinG: nonNegative,
  carbsG: nonNegative,
  fatG: nonNegative,
  source: NutritionSource,
});
export type NutritionValue = z.infer<typeof NutritionValue>;
