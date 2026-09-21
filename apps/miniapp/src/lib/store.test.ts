// @vitest-environment jsdom
import type { MealResult } from '@snapbite/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadMeals, saveMeal } from './store.js';

const meal: MealResult = {
  foods: [
    {
      food: { name: 'apple', estimatedWeightG: 150, quantity: 1, confidence: 0.9 },
      nutrition: { energyKcal: 78, proteinG: 0.5, carbsG: 21, fatG: 0.3, source: 'table' },
    },
  ],
  total: { energyKcal: 78, proteinG: 0.5, carbsG: 21, fatG: 0.3, source: 'table' },
  confidence: 0.9,
  needsConfirmation: false,
};

describe('meal store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty', () => {
    expect(loadMeals()).toEqual([]);
  });

  it('saves and reloads a meal, newest first', () => {
    const first = saveMeal(meal, 'data:image/jpeg;base64,AAA');
    const second = saveMeal(meal);

    const all = loadMeals();
    expect(all).toHaveLength(2);
    expect(all[0]?.id).toBe(second.id);
    expect(all[1]?.id).toBe(first.id);
    expect(all[1]?.previewUrl).toBe('data:image/jpeg;base64,AAA');
    expect(all[0]?.meal.total.energyKcal).toBe(78);
  });

  it('tolerates corrupt storage', () => {
    localStorage.setItem('foodlog.meals.v1', 'not json');
    expect(loadMeals()).toEqual([]);
  });
});
