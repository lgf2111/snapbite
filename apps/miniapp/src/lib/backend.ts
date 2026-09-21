import { computeTargets, type DailyTargets, type MealResult, type UserProfile } from '@snapbite/core';
import {
  ApiClient,
  type CustomProviderInput,
  type Favorite,
  type MealDetail,
  type MealSummary,
  type SettingsView,
  type UserExport,
} from './api.js';
import { cacheKey, clearCache, invalidate, setCached } from './cache.js';
import { readConfig } from './config.js';
import {
  clearMeals,
  clearProfile,
  deleteFavoriteLocal,
  deleteSavedMeal,
  loadFavorites,
  loadMeals,
  loadProfile,
  saveFavoriteLocal,
  saveMeal as saveMealLocal,
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
  aiProvider: string | null;
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
  /** Manually log a meal (no AI/photo). Works without an API key. */
  logManual(meal: MealResult): Promise<void>;
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
  /** Meals within an inclusive local-day range (YYYY-MM-DD), newest first. */
  mealsInRange(startKey: string, endKey: string): Promise<RecentMeal[]>;
  /** Distinct days (YYYY-MM-DD) that have meals, for the calendar. */
  mealDates(): Promise<string[]>;
  detail(id: string): Promise<MealDetail>;
  /** Saved meals ("favorites") the user can re-log with one tap. */
  listFavorites(): Promise<Favorite[]>;
  /** Saves a meal as a favorite; returns its id. */
  addFavorite(meal: MealResult, label?: string): Promise<string>;
  /** Deletes a saved favorite. */
  removeFavorite(id: string): Promise<void>;
  getSettings(): Promise<SettingsView>;
  saveApiKey(
    apiKey: string,
    aiProvider?: string,
    aiModel?: string,
    custom?: CustomProviderInput,
  ): Promise<SettingsView>;
  /** Stores the user's profile + goal; returns the computed daily targets. */
  saveProfile(profile: UserProfile): Promise<DailyTargets>;
  /** Stores/replaces the fallback provider + key (enabled). Returns fresh settings. */
  saveFallback(
    apiKey: string,
    aiProvider?: string,
    aiModel?: string,
    custom?: CustomProviderInput,
  ): Promise<SettingsView>;
  /** Enables/disables the fallback without wiping the stored key. */
  setFallbackEnabled(enabled: boolean): Promise<SettingsView>;
  /** Permanently removes the fallback. */
  removeFallback(): Promise<SettingsView>;
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
  /**
   * Sends user feedback to the maintainer. Worker mode stores + DMs the owner;
   * local mode is a no-op (resolves) so the UI can still show a "thanks" toast.
   */
  sendFeedback(message: string): Promise<void>;
  /** Stores the opt-in meal reminder config; returns fresh settings. */
  saveReminders(enabled: boolean, times: Record<string, string>): Promise<SettingsView>;
}

export function createBackend(): Backend {
  const config = readConfig();

  if (config.hasBackend) {
    const api = new ApiClient(config.workerUrl, getRawInitData);
    return {
      mode: 'worker',
      async logManual(meal) {
        await api.saveMeal(meal);
        invalidate(cacheKey.mealsPrefix);
      },
      async update(id, meal) {
        await api.updateMeal(id, meal);
        invalidate(cacheKey.mealsPrefix);
      },
      reviseDraft(id, instruction) {
        return api.reviseMeal(id, instruction);
      },
      async remove(id) {
        await api.deleteMeal(id);
        invalidate(cacheKey.mealsPrefix);
      },
      async recent() {
        const { meals } = await api.listMeals();
        return meals.map((m) => toRecent(m, (id) => api.photoUrl(id)));
      },
      async mealsByDate(date) {
        const { meals } = await api.listMeals(date);
        return meals.map((m) => toRecent(m, (id) => api.photoUrl(id)));
      },
      async mealsInRange(startKey, endKey) {
        // One call for all meals, filtered client-side by local day key in the
        // inclusive [startKey, endKey] range (lighter than 7 per-day requests).
        const { meals } = await api.listMeals();
        return meals
          .map((m) => toRecent(m, (id) => api.photoUrl(id)))
          .filter((m) => {
            const key = localDayKey(m.when);
            return key >= startKey && key <= endKey;
          });
      },
      async mealDates() {
        const { dates } = await api.mealDates();
        return dates;
      },
      detail(id) {
        return api.getMeal(id);
      },
      async listFavorites() {
        const { favorites } = await api.listFavorites();
        return favorites;
      },
      async addFavorite(meal, label) {
        const { id } = await api.addFavorite(meal, label);
        invalidate(cacheKey.favorites());
        return id;
      },
      async removeFavorite(id) {
        await api.removeFavorite(id);
        invalidate(cacheKey.favorites());
      },
      getSettings() {
        return api.getSettings();
      },
      async saveApiKey(apiKey, aiProvider, aiModel, custom) {
        await api.saveApiKey(apiKey, aiProvider, aiModel, custom);
        // Re-fetch so profile/targets/custom fields all round-trip correctly.
        const s = await api.getSettings();
        setCached(cacheKey.settings(), s);
        return s;
      },
      async saveProfile(profile) {
        const res = await api.saveProfile(profile);
        invalidate(cacheKey.settings());
        return res.targets;
      },
      async saveFallback(apiKey, aiProvider, aiModel, custom) {
        await api.saveFallback(apiKey, aiProvider, aiModel, custom);
        const s = await api.getSettings();
        setCached(cacheKey.settings(), s);
        return s;
      },
      async setFallbackEnabled(enabled) {
        await api.setFallbackEnabled(enabled);
        const s = await api.getSettings();
        setCached(cacheKey.settings(), s);
        return s;
      },
      async removeFallback() {
        await api.removeFallback();
        const s = await api.getSettings();
        setCached(cacheKey.settings(), s);
        return s;
      },
      exportData() {
        return api.exportData();
      },
      exportUrl() {
        return api.exportUrl();
      },
      async deleteAccount() {
        await api.deleteAccount();
        clearCache();
      },
      photoUrl(id) {
        return api.photoUrl(id);
      },
      async saveReminders(enabled, times) {
        await api.saveReminders(enabled, times);
        const s = await api.getSettings();
        setCached(cacheKey.settings(), s);
        return s;
      },
      async sendFeedback(message) {
        await api.sendFeedback(message);
      },
    };
  }

  return {
    mode: 'local',
    async logManual(meal) {
      saveMealLocal(meal);
    },
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
        .filter((m) => localDayKey(new Date(m.savedAt).getTime()) === date)
        .map(fromSaved);
    },
    async mealsInRange(startKey, endKey) {
      return loadMeals()
        .filter((m) => {
          const key = localDayKey(new Date(m.savedAt).getTime());
          return key >= startKey && key <= endKey;
        })
        .map(fromSaved);
    },
    async mealDates() {
      return [
        ...new Set(loadMeals().map((m) => localDayKey(new Date(m.savedAt).getTime()))),
      ].sort((a, b) => (a < b ? 1 : -1));
    },
    async detail(id) {
      const saved = loadMeals().find((m) => m.id === id);
      if (!saved) throw new Error('Meal not found');
      return savedToDetail(saved);
    },
    async listFavorites() {
      return loadFavorites().map((f) => ({
        id: f.id,
        label: f.label,
        energyKcal: f.meal.total.energyKcal,
        createdAt: f.createdAt,
        meal: f.meal,
      }));
    },
    async addFavorite(meal, label) {
      const derived = meal.foods.map((f) => f.food.name).join(', ') || 'Saved meal';
      return saveFavoriteLocal(meal, (label?.trim() || derived).slice(0, 120));
    },
    async removeFavorite(id) {
      deleteFavoriteLocal(id);
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
    // No-op in local/demo mode (the mock analyzer needs no key or fallback).
    async saveFallback() {
      return localMockSettings();
    },
    async setFallbackEnabled() {
      return localMockSettings();
    },
    async removeFallback() {
      return localMockSettings();
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
    // No backend to receive it in local/demo mode — accept + drop so the UI
    // can still show a friendly confirmation.
    async sendFeedback() {
      /* no-op */
    },
    // Reminders need the Worker (cron + Telegram). Reflect the choice back in
    // local mode so the UI stays consistent, but nothing is scheduled.
    async saveReminders(enabled, times) {
      const s = localMockSettings();
      return { ...s, reminders: { enabled, times, tzOffsetMinutes: 0 } };
    },
  };
}

/** YYYY-MM-DD for a timestamp in the device's LOCAL time (matches Home/DateSelector). */
function localDayKey(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The mock SettingsView returned by local/demo mode. */
function localMockSettings(): SettingsView {
  const profile = loadProfile();
  return {
    aiProvider: 'mock',
    aiModel: null,
    connected: true,
    keyLast4: null,
    profile,
    targets: profile ? computeTargets(profile) : null,
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
    title: s.meal.title ?? null,
    notes: s.meal.notes ?? null,
    confidence: s.meal.confidence,
    telegramFileId: null,
    aiProvider: null,
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

/**
 * A short, shareable meal name: prefer the AI's `title`, else the first couple
 * of food names, kept concise. Never returns a long descriptive string.
 */
export function shortMealTitle(title: string | null | undefined, foodNames: string[]): string {
  const t = (title ?? '').trim();
  if (t) return t;
  const names = foodNames.filter(Boolean);
  if (names.length === 0) return 'Meal';
  if (names.length <= 2) return names.join(' & ');
  return `${names[0]} & ${names.length - 1} more`;
}

function toRecent(m: MealSummary, photoUrl?: (id: string) => string): RecentMeal {
  return {
    id: m.id,
    label: shortMealTitle(m.title, m.foods),
    energyKcal: m.energyKcal,
    proteinG: m.proteinG,
    carbsG: m.carbsG,
    fatG: m.fatG,
    aiProvider: m.aiProvider,
    when: m.loggedAt,
    ...(m.hasPhoto && photoUrl ? { previewUrl: photoUrl(m.id) } : {}),
  };
}

function fromSaved(m: SavedMeal): RecentMeal {
  return {
    id: m.id,
    label: shortMealTitle(
      m.meal.title,
      m.meal.foods.map((f) => f.food.name),
    ),
    energyKcal: m.meal.total.energyKcal,
    proteinG: m.meal.total.proteinG,
    carbsG: m.meal.total.carbsG,
    fatG: m.meal.total.fatG,
    aiProvider: null,
    when: new Date(m.savedAt).getTime(),
    ...(m.previewUrl ? { previewUrl: m.previewUrl } : {}),
  };
}
