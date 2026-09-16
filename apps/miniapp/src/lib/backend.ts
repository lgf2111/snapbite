import type { MealImage, MealResult } from '@foodlog/core';
import { ApiClient, type MealSummary } from './api.js';
import { readConfig } from './config.js';
import { LocalMealProcessor, type MealProcessor, WorkerMealProcessor } from './processor.js';
import { loadMeals, type SavedMeal, saveMeal as saveLocal } from './store.js';
import { getRawInitData } from './telegram.js';

/** A unified recent-meal shape the home screen renders, from either source. */
export interface RecentMeal {
  id: string;
  label: string;
  energyKcal: number | null;
  when: number;
  previewUrl?: string;
}

/**
 * The app's data layer. When a Worker backend is configured it uses the real
 * API (server-side DeepSeek + D1); otherwise it falls back to the mock
 * processor + localStorage so the app is fully usable in browser dev.
 */
export interface Backend {
  readonly mode: 'worker' | 'local';
  readonly processor: MealProcessor;
  save(meal: MealResult, previewUrl?: string): Promise<void>;
  recent(): Promise<RecentMeal[]>;
}

export function createBackend(): Backend {
  const config = readConfig();

  if (config.hasBackend) {
    const api = new ApiClient(config.workerUrl, getRawInitData);
    return {
      mode: 'worker',
      processor: new WorkerMealProcessor((image: MealImage, hint?: string) =>
        api.analyze(image, hint),
      ),
      async save(meal) {
        await api.saveMeal(meal);
      },
      async recent() {
        const { meals } = await api.listMeals();
        return meals.map(toRecent);
      },
    };
  }

  return {
    mode: 'local',
    processor: new LocalMealProcessor(),
    async save(meal, previewUrl) {
      saveLocal(meal, previewUrl);
    },
    async recent() {
      return loadMeals().map(fromSaved);
    },
  };
}

function toRecent(m: MealSummary): RecentMeal {
  return {
    id: m.id,
    label: m.foods.join(', ') || 'Meal',
    energyKcal: m.energyKcal,
    when: m.loggedAt,
  };
}

function fromSaved(m: SavedMeal): RecentMeal {
  return {
    id: m.id,
    label: m.meal.foods.map((f) => f.food.name).join(', ') || 'Meal',
    energyKcal: m.meal.total.energyKcal,
    when: new Date(m.savedAt).getTime(),
    ...(m.previewUrl ? { previewUrl: m.previewUrl } : {}),
  };
}
