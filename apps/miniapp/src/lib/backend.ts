import { computeTargets, type DailyTargets, type MealResult, type UserProfile } from '@foodlog/core';
import {
  ApiClient,
  type MealDetail,
  type MealSummary,
  type SettingsView,
  type UserExport,
} from './api.js';
import { readConfig } from './config.js';
import {
  clearMeals,
  clearProfile,
  deleteSavedMeal,
  loadMeals,
  loadProfile,
  type SavedMeal,
  saveProfileLocal,
  updateSavedMeal,
} from './store.js';
import { getRawInitData } from './telegram.js';

/** A unified recent-meal shape the home screen renders, from either source. */
export interface RecentMeal {
  id: string;
  label: string;
  energyKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  when: number;
  previewUrl?: string;
}

/**
 * The app's data layer. Logging happens via the Telegram bot; the Mini App
 * reads and edits meals. Worker mode uses the real API (D1); local mode uses
 * localStorage so the app is usable in browser dev.
 */
export interface Backend {
  readonly mode: 'worker' | 'local';
  update(id: string, meal: MealResult): Promise<void>;
  /**
   * AI-revise a meal from a plain-language instruction. Returns a DRAFT
   * MealResult (not persisted) for the caller to review and save via update().
   */
  reviseDraft(id: string, instruction: string): Promise<MealResult>;
  remove(id: string): Promise<void>;
  recent(): Promise<RecentMeal[]>;
  /** Meals for one day (YYYY-MM-DD), newest first. */
  mealsByDate(date: string): Promise<RecentMeal[]>;
  /** Distinct days (YYYY-MM-DD) that have meals, for the calendar. */
  mealDates(): Promise<string[]>;
  detail(id: string): Promise<MealDetail>;
  getSettings(): Promise<SettingsView>;
  saveApiKey(apiKey: string, aiProvider?: string, aiModel?: string): Promise<SettingsView>;
  /** Stores the user's profile + goal; returns the computed daily targets. */
  saveProfile(profile: UserProfile): Promise<DailyTargets>;
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
      reviseDraft(id, instruction) {
        return api.reviseMeal(id, instruction);
      },
      async remove(id) {
        await api.deleteMeal(id);
      },
      async recent() {
        const { meals } = await api.listMeals();
        return meals.map((m) => toRecent(m, (id) => api.photoUrl(id)));
      },
      async mealsByDate(date) {
        const { meals } = await api.listMeals(date);
        return meals.map((m) => toRecent(m, (id) => api.photoUrl(id)));
      },
      async mealDates() {
        const { dates } = await api.mealDates();
        return dates;
      },
      detail(id) {
        return api.getMeal(id);
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
      async saveProfile(profile) {
        const res = await api.saveProfile(profile);
        return res.targets;
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
    async reviseDraft(id) {
      // AI edits need the backend (the user's key + model live server-side).
      const saved = loadMeals().find((m) => m.id === id);
      if (!saved) throw new Error('Meal not found');
      throw new Error('AI editing needs the backend (run inside Telegram).');
    },
    async remove(id) {
      deleteSavedMeal(id);
    },
    async recent() {
      return loadMeals().map(fromSaved);
    },
    async mealsByDate(date) {
      return loadMeals()
        .filter((m) => new Date(m.savedAt).toISOString().slice(0, 10) === date)
        .map(fromSaved);
    },
    async mealDates() {
      return [
        ...new Set(loadMeals().map((m) => new Date(m.savedAt).toISOString().slice(0, 10))),
      ].sort((a, b) => (a < b ? 1 : -1));
    },
    async detail(id) {
      const saved = loadMeals().find((m) => m.id === id);
      if (!saved) throw new Error('Meal not found');
      return savedToDetail(saved);
    },
    // Local (no-backend) mode uses the mock processor, which needs no key.
    async getSettings() {
      const profile = loadProfile();
      return {
        aiProvider: 'mock',
        aiModel: null,
        connected: true,
        keyLast4: null,
        profile,
        targets: profile ? computeTargets(profile) : null,
      };
    },
    async saveApiKey() {
      const profile = loadProfile();
      return {
        aiProvider: 'mock',
        aiModel: null,
        connected: true,
        keyLast4: null,
        profile,
        targets: profile ? computeTargets(profile) : null,
      };
    },
    async saveProfile(profile) {
      saveProfileLocal(profile);
      return computeTargets(profile);
    },
    async exportData() {
      return localExport(loadMeals());
    },
    exportUrl() {
      return null;
    },
    async deleteAccount() {
      clearMeals();
      clearProfile();
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
    proteinG: m.proteinG,
    carbsG: m.carbsG,
    fatG: m.fatG,
    when: m.loggedAt,
    ...(m.hasPhoto && photoUrl ? { previewUrl: photoUrl(m.id) } : {}),
  };
}

function fromSaved(m: SavedMeal): RecentMeal {
  return {
    id: m.id,
    label: m.meal.foods.map((f) => f.food.name).join(', ') || 'Meal',
    energyKcal: m.meal.total.energyKcal,
    proteinG: m.meal.total.proteinG,
    carbsG: m.meal.total.carbsG,
    fatG: m.meal.total.fatG,
    when: new Date(m.savedAt).getTime(),
    ...(m.previewUrl ? { previewUrl: m.previewUrl } : {}),
  };
}
