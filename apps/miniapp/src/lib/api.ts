import type { MealImage, MealResult } from '@foodlog/core';

/** Header the Worker expects the signed initData in (matches the Worker). */
const INIT_DATA_HEADER = 'x-telegram-init-data';

export interface MealSummary {
  id: string;
  loggedAt: number;
  notes: string | null;
  confidence: number | null;
  energyKcal: number | null;
  source: string | null;
  foods: string[];
  hasPhoto: boolean;
}

export interface DayGroup {
  date: string;
  totalKcal: number;
  mealIds: string[];
}

export interface MealDetail {
  id: string;
  loggedAt: number;
  createdAt: number;
  notes: string | null;
  confidence: number | null;
  telegramFileId: string | null;
  foods: Array<{
    id: string;
    name: string;
    estimatedWeightG: number | null;
    portion: string | null;
    quantity: number;
    confidence: number | null;
    energyKcal: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    nutritionSource: string | null;
  }>;
  total: {
    energyKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    source: string;
  } | null;
}

export interface AnalyticsSummary {
  days: number;
  totalMeals: number;
  totalKcal: number;
  avgKcalPerMeal: number;
  daily: Array<{ date: string; kcal: number; meals: number }>;
  commonFoods: Array<{ name: string; count: number }>;
  macroAverages: { proteinG: number; carbsG: number; fatG: number };
}

export interface SettingsView {
  aiProvider: string;
  aiModel: string | null;
  connected: boolean;
  keyLast4: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Thin client for the FoodLog Worker API. Attaches the signed Telegram initData
 * on every request so the Worker can authenticate.
 */
export class ApiClient {
  readonly #baseUrl: string;
  readonly #getInitData: () => string;
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, getInitData: () => string, fetchImpl?: typeof fetch) {
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#getInitData = getInitData;
    // Bind to the global so `fetch` keeps its `this` (browsers throw
    // "Can only call Window.fetch on instances of Window" otherwise).
    this.#fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set(INIT_DATA_HEADER, this.#getInitData());
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const res = await this.#fetch(`${this.#baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { detail?: string; error?: string };
        detail = body.detail ?? body.error ?? detail;
      } catch {
        // non-JSON error body
      }
      throw new ApiError(res.status, detail);
    }
    return (await res.json()) as T;
  }

  analyze(image: MealImage, hint?: string): Promise<MealResult> {
    return this.#request<MealResult>('/api/meals/analyze', {
      method: 'POST',
      body: JSON.stringify({ base64: image.base64, mimeType: image.mimeType, hint }),
    });
  }

  saveMeal(meal: MealResult): Promise<{ id: string }> {
    return this.#request<{ id: string }>('/api/meals', {
      method: 'POST',
      body: JSON.stringify({ meal }),
    });
  }

  updateMeal(id: string, meal: MealResult): Promise<{ ok: boolean }> {
    return this.#request<{ ok: boolean }>(`/api/meals/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ meal }),
    });
  }

  deleteMeal(id: string): Promise<{ ok: boolean }> {
    return this.#request<{ ok: boolean }>(`/api/meals/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  listMeals(): Promise<{ meals: MealSummary[]; groups: DayGroup[] }> {
    return this.#request<{ meals: MealSummary[]; groups: DayGroup[] }>('/api/meals');
  }

  getMeal(id: string): Promise<MealDetail> {
    return this.#request<MealDetail>(`/api/meals/${encodeURIComponent(id)}`);
  }

  search(query: string): Promise<{ query: string; meals: MealSummary[] }> {
    return this.#request<{ query: string; meals: MealSummary[] }>(
      `/api/search?q=${encodeURIComponent(query)}`,
    );
  }

  analytics(days = 30): Promise<AnalyticsSummary> {
    return this.#request<AnalyticsSummary>(`/api/analytics?days=${days}`);
  }

  /** Builds a photo URL for a meal (initData in the query — used as an <img> src). */
  photoUrl(id: string): string {
    const initData = encodeURIComponent(this.#getInitData());
    return `${this.#baseUrl}/api/meal-photo/${encodeURIComponent(id)}?initData=${initData}`;
  }

  getSettings(): Promise<SettingsView> {
    return this.#request<SettingsView>('/api/settings');
  }

  saveApiKey(
    apiKey: string,
    aiProvider?: string,
    aiModel?: string,
  ): Promise<SettingsView & { ok: boolean }> {
    return this.#request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ apiKey, aiProvider, aiModel }),
    });
  }
}
