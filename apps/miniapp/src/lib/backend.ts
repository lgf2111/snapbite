import type { MealImage, MealResult } from '@foodlog/core';
import { ApiClient, type MealDetail, type MealSummary } from './api.js';
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

export interface HistoryDay {
  date: string;
  totalKcal: number;
  meals: RecentMeal[];
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
  history(): Promise<HistoryDay[]>;
  detail(id: string): Promise<MealDetail>;
  search(query: string): Promise<RecentMeal[]>;
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
      async history() {
        const { meals, groups } = await api.listMeals();
        const byId = new Map(meals.map((m) => [m.id, toRecent(m)]));
        return groups.map((g) => ({
          date: g.date,
          totalKcal: g.totalKcal,
          meals: g.mealIds.map((id) => byId.get(id)).filter((m): m is RecentMeal => Boolean(m)),
        }));
      },
      detail(id) {
        return api.getMeal(id);
      },
      async search(query) {
        const { meals } = await api.search(query);
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
    async history() {
      return groupSavedByDay(loadMeals());
    },
    async detail(id) {
      const saved = loadMeals().find((m) => m.id === id);
      if (!saved) throw new Error('Meal not found');
      return savedToDetail(saved);
    },
    async search(query) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return loadMeals()
        .filter((m) => m.meal.foods.some((f) => f.food.name.toLowerCase().includes(q)))
        .map(fromSaved);
    },
  };
}

function groupSavedByDay(saved: SavedMeal[]): HistoryDay[] {
  const byDate = new Map<string, HistoryDay>();
  for (const s of saved) {
    const date = new Date(s.savedAt).toISOString().slice(0, 10);
    const day = byDate.get(date) ?? { date, totalKcal: 0, meals: [] };
    day.totalKcal += s.meal.total.energyKcal;
    day.meals.push(fromSaved(s));
    byDate.set(date, day);
  }
  return [...byDate.values()]
    .map((d) => ({ ...d, totalKcal: Math.round(d.totalKcal * 10) / 10 }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

function savedToDetail(s: SavedMeal): MealDetail {
  return {
    id: s.id,
    loggedAt: new Date(s.savedAt).getTime(),
    createdAt: new Date(s.savedAt).getTime(),
    notes: s.meal.notes ?? null,
    confidence: s.meal.confidence,
    telegramFileId: null,
    foods: s.meal.foods.map((f, i) => ({
      id: String(i),
      name: f.food.name,
      estimatedWeightG: f.food.estimatedWeightG,
      portion: f.food.portion ?? null,
      quantity: f.food.quantity,
      confidence: f.food.confidence,
    })),
    total: s.meal.total,
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
