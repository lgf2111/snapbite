import type { AIFoodAnalysis } from '../schemas/analysis.js';
import type { FoodItem, NutritionPer100g } from '../schemas/food.js';
import type { MealFood, MealResult } from '../schemas/meal.js';
import type { NutritionSource, NutritionValue } from '../schemas/nutrition.js';
import { lookupTable } from './table.js';

/** Rounds to one decimal place to keep resolved values tidy. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Scales a per-100g nutrition record to an absolute value for `grams` total,
 * tagging it with the given source. Grams already account for quantity.
 */
function scale(per100g: NutritionPer100g, grams: number, source: NutritionSource): NutritionValue {
  const factor = grams / 100;
  return {
    energyKcal: round1(per100g.energyKcal * factor),
    proteinG: round1(per100g.proteinG * factor),
    carbsG: round1(per100g.carbsG * factor),
    fatG: round1(per100g.fatG * factor),
    source,
  };
}

/** Total grams for a food = estimated weight × quantity. */
function totalGrams(food: FoodItem): number {
  return food.estimatedWeightG * food.quantity;
}

/**
 * Resolves nutrition for a single food. Prefers a bundled-table match (source
 * `table`); falls back to the AI's rough per-100g estimate (source
 * `ai_estimate`). Returns `undefined` only when neither source is available.
 */
export function resolveFoodNutrition(food: FoodItem): NutritionValue | undefined {
  const grams = totalGrams(food);

  const tableMatch = lookupTable(food.name);
  if (tableMatch) return scale(tableMatch, grams, 'table');

  if (food.aiNutrition) return scale(food.aiNutrition, grams, 'ai_estimate');

  return undefined;
}

/**
 * Aggregates per-food nutrition into a meal total. The total's source is:
 * - `table`       — every contributing food came from the table,
 * - `ai_estimate` — every contributing food came from the AI estimate,
 * - `mixed`       — a combination (or nothing resolved).
 */
export function aggregate(values: readonly NutritionValue[]): NutritionValue {
  const sum = values.reduce(
    (acc, v) => ({
      energyKcal: acc.energyKcal + v.energyKcal,
      proteinG: acc.proteinG + v.proteinG,
      carbsG: acc.carbsG + v.carbsG,
      fatG: acc.fatG + v.fatG,
    }),
    { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );

  const sources = new Set(values.map((v) => v.source));
  let source: NutritionSource;
  if (sources.size === 1) {
    // Exactly one distinct source (or none -> defaults handled below).
    source = (values[0]?.source ?? 'mixed') as NutritionSource;
  } else {
    source = 'mixed';
  }

  return {
    energyKcal: round1(sum.energyKcal),
    proteinG: round1(sum.proteinG),
    carbsG: round1(sum.carbsG),
    fatG: round1(sum.fatG),
    source,
  };
}

/**
 * Turns a validated {@link AIFoodAnalysis} into an editable {@link MealResult}:
 * resolves each food's nutrition, drops foods with no resolvable nutrition from
 * the totals (but keeps them listed with a zeroed ai_estimate so the user can
 * correct them), and aggregates a meal total.
 */
export function resolveMeal(analysis: AIFoodAnalysis): MealResult {
  const foods: MealFood[] = analysis.foods.map((food) => {
    const resolved = resolveFoodNutrition(food);
    const nutrition: NutritionValue = resolved ?? {
      energyKcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      source: 'ai_estimate',
    };
    return { food, nutrition };
  });

  const total = aggregate(foods.map((f) => f.nutrition));

  return {
    foods,
    total,
    confidence: analysis.confidence,
    needsConfirmation: analysis.needsConfirmation,
    ...(analysis.notes !== undefined ? { notes: analysis.notes } : {}),
  };
}
