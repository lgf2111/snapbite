import type { MealImage, MealResult } from '@foodlog/core';
import {
  type AnalyticsSummary,
  ApiClient,
  type MealDetail,
  type MealSummary,
  type SettingsView,
  type UserExport,
} from './api.js';
import { readConfig } from './config.js';
import {
  clearMeals,
  deleteSavedMeal,
  loadMeals,
  type SavedMeal,
  updateSavedMeal,
} from './store.js';
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
 * The app's data layer. Logging happens via the Telegram bot; the Mini App
 * reads and edits meals. Worker mode uses the real API (D1); local mode uses
 * localStorage so the app is usable in browser dev.
 */
export interface Backend {
  readonly mode: 'worker' | 'local';
  update(id: string, meal: MealResult): Promise<void>;
  remove(id: string): Promise<void>;
  recent(): Promise<RecentMeal[]>;
  history(): Promise<HistoryDay[]>;
  detail(id: string): Promise<MealDetail>;
  search(query: string): Promise<RecentMeal[]>;
  analytics(days?: number): Promise<AnalyticsSummary>;
  getSettings(): Promise<SettingsView>;
  saveApiKey(apiKey: string, aiProvider?: string, aiModel?: string): Promise<SettingsView>;
  /** Full JSON export of the user's data (never includes the API key). */
  exportData(): Promise<UserExport>;
  /**
   * Public, auth-carrying URL for the export (worker mode only) so Telegram's
   * native downloader can fetch it. `null` in local mode.
   */
  exportUrl(): string | null;
  /** Permanently deletes the user and all their data. */
  deleteAccount(): Promise<void>;
  /** Photo URL for a meal (worker mode with a telegram file); null otherwise. */
  photoUrl(id: string): string | null;
}

export function createBackend(): Backend {
  const config = readConfig();

  if (config.hasBackend) {
    const api = new ApiClient(config.workerUrl, getRawInitData);
    return {
      mode: 'worker',
      async update(id, meal) {
        await api.updateMeal(id, meal);
      },
      async remove(id) {
        await api.deleteMeal(id);
      },
      async recent() {
        const { meals } = await api.listMeals();
        return meals.map((m) => toRecent(m, (id) => api.photoUrl(id)));
      },
      async history() {
        const { meals, groups } = await api.listMeals();
        const byId = new Map(meals.map((m) => [m.id, toRecent(m, (id) => api.photoUrl(id))]));
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
        return meals.map((m) => toRecent(m, (id) => api.photoUrl(id)));
      },
      analytics(days) {
        return api.analytics(days);
      },
      getSettings() {
        return api.getSettings();
      },
      async saveApiKey(apiKey, aiProvider, aiModel) {
        const res = await api.saveApiKey(apiKey, aiProvider, aiModel);
        return {
          aiProvider: res.aiProvider,
          aiModel: res.aiModel,
          connected: res.connected,
          keyLast4: res.keyLast4,
        };
      },
      exportData() {
        return api.exportData();
      },
      exportUrl() {
        return api.exportUrl();
      },
      async deleteAccount() {
        await api.deleteAccount();
      },
      photoUrl(id) {
        return api.photoUrl(id);
      },
    };
  }

  return {
    mode: 'local',
    async update(id, meal) {
      updateSavedMeal(id, meal);
    },
    async remove(id) {
      deleteSavedMeal(id);
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
    async analytics(days = 30) {
      return computeLocalAnalytics(loadMeals(), days);
    },
    // Local (no-backend) mode uses the mock processor, which needs no key.
    async getSettings() {
      return { aiProvider: 'mock', aiModel: null, connected: true, keyLast4: null };
    },
    async saveApiKey() {
      return { aiProvider: 'mock', aiModel: null, connected: true, keyLast4: null };
    },
    async exportData() {
      return localExport(loadMeals());
    },
    exportUrl() {
      return null;
    },
    async deleteAccount() {
      clearMeals();
    },
    photoUrl(id) {
      // Local mode stores a data-URL preview on the saved meal, if any.
      return loadMeals().find((m) => m.id === id)?.previewUrl ?? null;
    },
  };
}

/** Builds a UserExport-shaped payload from locally stored meals. */
function localExport(saved: SavedMeal[]): UserExport {
  return {
    exportedAt: new Date().toISOString(),
    user: { telegramUserId: 0, createdAt: Date.now() },
    settings: { aiProvider: 'mock', aiModel: null },
    meals: saved.map((s) => ({
      id: s.id,
      loggedAt: new Date(s.savedAt).getTime(),
      createdAt: new Date(s.savedAt).getTime(),
      notes: s.meal.notes ?? null,
      confidence: s.meal.confidence,
      telegramFileId: null,
      total: s.meal.total,
      foods: s.meal.foods.map((f) => ({
        name: f.food.name,
        estimatedWeightG: f.food.estimatedWeightG,
        portion: f.food.portion ?? null,
        quantity: f.food.quantity,
        confidence: f.food.confidence,
        energyKcal: f.nutrition.energyKcal,
        proteinG: f.nutrition.proteinG,
        carbsG: f.nutrition.carbsG,
        fatG: f.nutrition.fatG,
        nutritionSource: f.nutrition.source,
      })),
    })),
  };
}

function computeLocalAnalytics(saved: SavedMeal[], days: number): AnalyticsSummary {
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const inWindow = saved.filter((s) => new Date(s.savedAt).getTime() >= sinceMs);

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const totalMeals = inWindow.length;
  const totalKcal = round1(inWindow.reduce((s, m) => s + m.meal.total.energyKcal, 0));

  const dailyMap = new Map<string, { kcal: number; meals: number }>();
  const foodCounts = new Map<string, number>();
  let pSum = 0;
  let cSum = 0;
  let fSum = 0;
  for (const s of inWindow) {
    const date = new Date(s.savedAt).toISOString().slice(0, 10);
    const d = dailyMap.get(date) ?? { kcal: 0, meals: 0 };
    d.kcal += s.meal.total.energyKcal;
    d.meals += 1;
    dailyMap.set(date, d);
    pSum += s.meal.total.proteinG;
    cSum += s.meal.total.carbsG;
    fSum += s.meal.total.fatG;
    for (const f of s.meal.foods) {
      foodCounts.set(f.food.name, (foodCounts.get(f.food.name) ?? 0) + 1);
    }
  }

  return {
    days,
    totalMeals,
    totalKcal,
    avgKcalPerMeal: totalMeals > 0 ? round1(totalKcal / totalMeals) : 0,
    daily: [...dailyMap.entries()]
      .map(([date, v]) => ({ date, kcal: round1(v.kcal), meals: v.meals }))
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
    commonFoods: [...foodCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    macroAverages: {
      proteinG: totalMeals > 0 ? round1(pSum / totalMeals) : 0,
      carbsG: totalMeals > 0 ? round1(cSum / totalMeals) : 0,
      fatG: totalMeals > 0 ? round1(fSum / totalMeals) : 0,
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
      energyKcal: f.nutrition.energyKcal,
      proteinG: f.nutrition.proteinG,
      carbsG: f.nutrition.carbsG,
      fatG: f.nutrition.fatG,
      nutritionSource: f.nutrition.source,
    })),
    total: s.meal.total,
  };
}

function toRecent(m: MealSummary, photoUrl?: (id: string) => string): RecentMeal {
  return {
    id: m.id,
    label: m.foods.join(', ') || 'Meal',
    energyKcal: m.energyKcal,
    when: m.loggedAt,
    ...(m.hasPhoto && photoUrl ? { previewUrl: photoUrl(m.id) } : {}),
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
