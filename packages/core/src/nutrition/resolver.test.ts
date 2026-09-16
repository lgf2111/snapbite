import { describe, expect, it } from 'vitest';
import type { AIFoodAnalysis } from '../schemas/analysis.js';
import type { FoodItem } from '../schemas/food.js';
import { aggregate, resolveFoodNutrition, resolveMeal } from './resolver.js';
import { lookupTable, normalizeName } from './table.js';

function food(overrides: Partial<FoodItem> & { name: string }): FoodItem {
  return {
    estimatedWeightG: 100,
    quantity: 1,
    confidence: 0.9,
    ...overrides,
  };
}

describe('normalizeName', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeName('  White   Rice ')).toBe('white rice');
  });

  it('strips a leading article', () => {
    expect(normalizeName('an Apple')).toBe('apple');
  });
});

describe('lookupTable', () => {
  it('hits an exact normalized name', () => {
    expect(lookupTable('Chicken Breast')?.proteinG).toBe(31);
  });

  it('hits via singular relaxation', () => {
    // "almonds" is a key; "almond" should still resolve via last-word/plural.
    expect(lookupTable('almond')).toBeDefined();
  });

  it('hits via last-word relaxation', () => {
    expect(lookupTable('grilled chicken')?.proteinG).toBe(31);
  });

  it('misses unknown foods', () => {
    expect(lookupTable('dragonfruit tart')).toBeUndefined();
  });
});

describe('resolveFoodNutrition', () => {
  it('scales a table hit by grams (source=table)', () => {
    // white rice 130 kcal/100g at 200g -> 260 kcal
    const result = resolveFoodNutrition(food({ name: 'white rice', estimatedWeightG: 200 }));
    expect(result).toEqual({
      energyKcal: 260,
      proteinG: 5.4,
      carbsG: 56,
      fatG: 0.6,
      source: 'table',
    });
  });

  it('accounts for quantity in scaling', () => {
    // egg 155 kcal/100g, 50g each x 2 = 100g -> 155 kcal
    const result = resolveFoodNutrition(
      food({ name: 'egg', estimatedWeightG: 50, quantity: 2 }),
    );
    expect(result?.energyKcal).toBe(155);
    expect(result?.source).toBe('table');
  });

  it('falls back to the AI estimate on a table miss (source=ai_estimate)', () => {
    const result = resolveFoodNutrition(
      food({
        name: 'mystery stew',
        estimatedWeightG: 150,
        aiNutrition: { energyKcal: 100, proteinG: 5, carbsG: 10, fatG: 3 },
      }),
    );
    expect(result).toEqual({
      energyKcal: 150,
      proteinG: 7.5,
      carbsG: 15,
      fatG: 4.5,
      source: 'ai_estimate',
    });
  });

  it('prefers the table even when an AI estimate is present', () => {
    const result = resolveFoodNutrition(
      food({
        name: 'banana',
        estimatedWeightG: 100,
        aiNutrition: { energyKcal: 999, proteinG: 99, carbsG: 99, fatG: 99 },
      }),
    );
    expect(result?.source).toBe('table');
    expect(result?.energyKcal).toBe(89);
  });

  it('returns undefined when neither table nor AI estimate is available', () => {
    expect(resolveFoodNutrition(food({ name: 'mystery stew' }))).toBeUndefined();
  });
});

describe('aggregate', () => {
  const table = { energyKcal: 100, proteinG: 10, carbsG: 20, fatG: 5, source: 'table' } as const;
  const ai = { energyKcal: 50, proteinG: 5, carbsG: 10, fatG: 2, source: 'ai_estimate' } as const;

  it('sums values and keeps a single source', () => {
    const result = aggregate([table, { ...table }]);
    expect(result.energyKcal).toBe(200);
    expect(result.source).toBe('table');
  });

  it('marks the total mixed when sources differ', () => {
    const result = aggregate([table, ai]);
    expect(result.energyKcal).toBe(150);
    expect(result.source).toBe('mixed');
  });
});

describe('resolveMeal', () => {
  const analysis: AIFoodAnalysis = {
    foods: [
      food({ name: 'white rice', estimatedWeightG: 200 }),
      food({
        name: 'mystery curry',
        estimatedWeightG: 100,
        aiNutrition: { energyKcal: 120, proteinG: 6, carbsG: 8, fatG: 7 },
      }),
    ],
    confidence: 0.7,
    needsConfirmation: true,
    notes: 'sauce uncertain',
  };

  it('resolves each food and produces a mixed total', () => {
    const meal = resolveMeal(analysis);
    expect(meal.foods).toHaveLength(2);
    expect(meal.foods[0]?.nutrition.source).toBe('table');
    expect(meal.foods[1]?.nutrition.source).toBe('ai_estimate');
    // 260 (rice) + 120 (curry) = 380 kcal
    expect(meal.total.energyKcal).toBe(380);
    expect(meal.total.source).toBe('mixed');
    expect(meal.confidence).toBe(0.7);
    expect(meal.needsConfirmation).toBe(true);
    expect(meal.notes).toBe('sauce uncertain');
  });

  it('lists unresolvable foods with zeroed nutrition rather than dropping them', () => {
    const meal = resolveMeal({
      foods: [food({ name: 'totally unknown dish' })],
      confidence: 0.3,
      needsConfirmation: true,
    });
    expect(meal.foods).toHaveLength(1);
    expect(meal.foods[0]?.nutrition.energyKcal).toBe(0);
    expect(meal.notes).toBeUndefined();
  });
});
