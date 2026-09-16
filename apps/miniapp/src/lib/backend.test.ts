// @vitest-environment jsdom
import type { MealResult } from '@foodlog/core';
import { beforeEach, describe, expect, it } from 'vitest';
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
  beforeEach(() => localStorage.clear());

  it('runs in local mode', () => {
    expect(createBackend().mode).toBe('local');
  });

  it('groups saved meals by day for history', async () => {
    saveMeal(meal('rice', 100));
    saveMeal(meal('apple', 50));
    const days = await createBackend().history();
    expect(days.length).toBeGreaterThanOrEqual(1);
    const total = days.reduce((s, d) => s + d.totalKcal, 0);
    expect(total).toBe(150);
  });

  it('searches by food name (case-insensitive substring)', async () => {
    saveMeal(meal('Chicken Rice', 300));
    saveMeal(meal('beef noodles', 400));
    const backend = createBackend();
    const hits = await backend.search('chicken');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.label).toContain('Chicken Rice');
    expect(await backend.search('')).toEqual([]);
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
});
