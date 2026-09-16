import type { MealResult } from '../schemas/meal.js';
import type { NutritionSource } from '../schemas/nutrition.js';

const SOURCE_LABEL: Record<NutritionSource, string> = {
  table: 'from table',
  ai_estimate: 'AI estimate',
  manual: 'edited',
  mixed: 'mixed',
};

/** Human label for a nutrition source. */
export function sourceLabel(source: NutritionSource): string {
  return SOURCE_LABEL[source];
}

/**
 * Renders a {@link MealResult} as plain multi-line text. Pure and
 * platform-agnostic so both the CLI and any other surface can reuse it.
 * Always frames nutrition as an estimate.
 */
export function formatMealResult(meal: MealResult): string {
  const lines: string[] = [];
  lines.push('Meal (estimated — always correctable)');
  lines.push('='.repeat(40));

  for (const { food, nutrition } of meal.foods) {
    const grams = food.estimatedWeightG * food.quantity;
    const qty = food.quantity > 1 ? ` x${food.quantity}` : '';
    const portion = food.portion ? ` (${food.portion})` : '';
    lines.push(`• ${food.name}${qty}${portion} — ~${grams}g`);
    lines.push(
      `    ${nutrition.energyKcal} kcal | P ${nutrition.proteinG}g  C ${nutrition.carbsG}g  F ${nutrition.fatG}g  [${sourceLabel(nutrition.source)}]`,
    );
  }

  lines.push('-'.repeat(40));
  const t = meal.total;
  lines.push(
    `TOTAL: ${t.energyKcal} kcal | P ${t.proteinG}g  C ${t.carbsG}g  F ${t.fatG}g  [${sourceLabel(t.source)}]`,
  );
  lines.push(`Confidence: ${Math.round(meal.confidence * 100)}%`);
  if (meal.needsConfirmation) lines.push('⚠ Needs confirmation — please review.');
  if (meal.notes) lines.push(`Notes: ${meal.notes}`);

  return lines.join('\n');
}
