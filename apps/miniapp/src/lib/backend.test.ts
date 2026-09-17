// @vitest-environment jsdom
import type { MealResult } from '@foodlog/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackend } from './backend.js';
import { saveMeal } from './store.js';

function meal(name: string, kcal: number): MealResult {
  return {
    foods: [
      {
        food: { name, estimatedWeightG: 100, quantity: 1, confidence: 0.9 },
        nutrition: { energyKcal: kcal, proteinG: 1, carbsG: 1, fatG: 1, source: 'table' },
      },
    ],
    total: { energyKcal: kcal, proteinG: 1, carbsG: 1, fatG: 1, source: 'table' },
    confidence: 0.9,
    needsConfirmation: false,
  };
}

describe('local backend (no VITE_WORKER_URL)', () => {
  beforeEach(() => {
    localStorage.clear();
    // Force local mode regardless of any ambient VITE_WORKER_URL in the shell.
    vi.stubEnv('VITE_WORKER_URL', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('runs in local mode', () => {
    expect(createBackend().mode).toBe('local');
  });

  it('lists meals for a given day and reports logged dates', async () => {
    saveMeal(meal('rice', 100));
    saveMeal(meal('apple', 50));
    const backend = createBackend();
    const today = new Date().toISOString().slice(0, 10);
    const dates = await backend.mealDates();
    expect(dates).toContain(today);
    const meals = await backend.mealsByDate(today);
    expect(meals).toHaveLength(2);
    expect(await backend.mealsByDate('1999-01-01')).toEqual([]);
  });

  it('returns detail for a saved meal', async () => {
    const backend = createBackend();
    saveMeal(meal('tofu', 76));
    const recent = await backend.recent();
    const id = recent[0]?.id as string;
    const detail = await backend.detail(id);
    expect(detail.foods[0]?.name).toBe('tofu');
    expect(detail.total?.energyKcal).toBe(76);
  });

  it('returns per-food macros for every food on detail (multi-food)', async () => {
    const backend = createBackend();
    const multi: MealResult = {
      foods: [
        {
          food: { name: 'rice', estimatedWeightG: 200, quantity: 1, confidence: 0.9 },
          nutrition: { energyKcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, source: 'table' },
        },
        {
          food: { name: 'mystery stew', estimatedWeightG: 300, quantity: 1, confidence: 0.7 },
          nutrition: { energyKcal: 330, proteinG: 22, carbsG: 12, fatG: 20, source: 'ai_estimate' },
        },
      ],
      total: { energyKcal: 590, proteinG: 27.4, carbsG: 68, fatG: 20.6, source: 'mixed' },
      confidence: 0.8,
      needsConfirmation: false,
    };
    saveMeal(multi);
    const id = (await backend.recent())[0]?.id as string;
    const detail = await backend.detail(id);
    // Both foods must carry their own P/C/F, including the non-table one.
    expect(detail.foods[0]?.proteinG).toBe(5.4);
    expect(detail.foods[1]?.proteinG).toBe(22);
    expect(detail.foods[1]?.carbsG).toBe(12);
    expect(detail.foods[1]?.fatG).toBe(20);
  });

  it('updates a saved meal in local mode', async () => {
    const backend = createBackend();
    saveMeal(meal('rice', 100));
    const id = (await backend.recent())[0]?.id as string;
    await backend.update(id, meal('fried rice', 300));
    const detail = await backend.detail(id);
    expect(detail.foods[0]?.name).toBe('fried rice');
    expect(detail.total?.energyKcal).toBe(300);
  });

  it('deletes a saved meal in local mode', async () => {
    const backend = createBackend();
    saveMeal(meal('to-remove', 50));
    const id = (await backend.recent())[0]?.id as string;
    await backend.remove(id);
    expect(await backend.recent()).toEqual([]);
  });

  it('reports mock settings in local mode (no key needed)', async () => {
    const backend = createBackend();
    const s = await backend.getSettings();
    expect(s.aiProvider).toBe('mock');
    expect(s.connected).toBe(true);
    const saved = await backend.saveApiKey('anything');
    expect(saved.connected).toBe(true);
  });
});
