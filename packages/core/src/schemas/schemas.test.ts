import { describe, expect, it } from 'vitest';
import { AIFoodAnalysis } from './analysis.js';
import { FoodItem } from './food.js';
import { MealResult } from './meal.js';
import { NutritionSource, NutritionValue } from './nutrition.js';

const validNutrition = {
  energyKcal: 250,
  proteinG: 10,
  carbsG: 30,
  fatG: 8,
  source: 'table',
} as const;

const validFood = {
  name: 'Grilled chicken breast',
  estimatedWeightG: 150,
  portion: '1 fillet',
  quantity: 1,
  confidence: 0.9,
} as const;

describe('NutritionSource', () => {
  it('accepts the three known sources', () => {
    for (const s of ['table', 'ai_estimate', 'mixed'] as const) {
      expect(NutritionSource.parse(s)).toBe(s);
    }
  });

  it('rejects an unknown source', () => {
    expect(NutritionSource.safeParse('guess').success).toBe(false);
  });
});

describe('NutritionValue', () => {
  it('parses a valid value', () => {
    expect(NutritionValue.parse(validNutrition)).toEqual(validNutrition);
  });

  it('rejects negative macros', () => {
    expect(NutritionValue.safeParse({ ...validNutrition, proteinG: -1 }).success).toBe(false);
  });

  it('rejects a missing source', () => {
    const { source: _drop, ...rest } = validNutrition;
    expect(NutritionValue.safeParse(rest).success).toBe(false);
  });

  it('rejects a non-finite energy value', () => {
    expect(NutritionValue.safeParse({ ...validNutrition, energyKcal: Number.NaN }).success).toBe(
      false,
    );
  });
});

describe('FoodItem', () => {
  it('parses a valid food', () => {
    const parsed = FoodItem.parse(validFood);
    expect(parsed.name).toBe(validFood.name);
    expect(parsed.quantity).toBe(1);
  });

  it('defaults quantity to 1 when omitted', () => {
    const { quantity: _drop, ...rest } = validFood;
    expect(FoodItem.parse(rest).quantity).toBe(1);
  });

  it('allows an omitted portion', () => {
    const { portion: _drop, ...rest } = validFood;
    expect(FoodItem.safeParse(rest).success).toBe(true);
  });

  it('rejects an empty name', () => {
    expect(FoodItem.safeParse({ ...validFood, name: '' }).success).toBe(false);
  });

  it('rejects a zero or negative weight', () => {
    expect(FoodItem.safeParse({ ...validFood, estimatedWeightG: 0 }).success).toBe(false);
    expect(FoodItem.safeParse({ ...validFood, estimatedWeightG: -5 }).success).toBe(false);
  });

  it('rejects a confidence outside [0, 1]', () => {
    expect(FoodItem.safeParse({ ...validFood, confidence: 1.5 }).success).toBe(false);
    expect(FoodItem.safeParse({ ...validFood, confidence: -0.1 }).success).toBe(false);
  });
});

describe('AIFoodAnalysis', () => {
  it('parses a valid analysis', () => {
    const parsed = AIFoodAnalysis.parse({
      foods: [validFood],
      confidence: 0.8,
      needsConfirmation: true,
    });
    expect(parsed.foods).toHaveLength(1);
    expect(parsed.needsConfirmation).toBe(true);
  });

  it('rejects an empty foods array', () => {
    expect(
      AIFoodAnalysis.safeParse({ foods: [], confidence: 0.8, needsConfirmation: false }).success,
    ).toBe(false);
  });

  it('rejects a missing needsConfirmation flag', () => {
    expect(AIFoodAnalysis.safeParse({ foods: [validFood], confidence: 0.8 }).success).toBe(false);
  });
});

describe('MealResult', () => {
  const validMeal = {
    foods: [{ food: validFood, nutrition: validNutrition }],
    total: { ...validNutrition, source: 'mixed' },
    confidence: 0.85,
    needsConfirmation: false,
  };

  it('parses a valid meal result', () => {
    const parsed = MealResult.parse(validMeal);
    expect(parsed.foods).toHaveLength(1);
    expect(parsed.total.source).toBe('mixed');
  });

  it('rejects a meal with no foods', () => {
    expect(MealResult.safeParse({ ...validMeal, foods: [] }).success).toBe(false);
  });

  it('rejects a meal missing its total nutrition', () => {
    const { total: _drop, ...rest } = validMeal;
    expect(MealResult.safeParse(rest).success).toBe(false);
  });
});
