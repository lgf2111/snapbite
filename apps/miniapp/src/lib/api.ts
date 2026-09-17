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

export interface SettingsView {
  aiProvider: string;
  aiModel: string | null;
  connected: boolean;
  keyLast4: string | null;
}

/**
 * Full export of a user's data. Mirrors the Worker's `UserExport`. The
 * encrypted API key is deliberately never included — only provider/model.
 */
export interface UserExport {
  exportedAt: string;
  user: { telegramUserId: number; createdAt: number };
  settings: { aiProvider: string; aiModel: string | null } | null;
  meals: Array<{
    id: string;
    loggedAt: number;
    createdAt: number;
    notes: string | null;
    confidence: number | null;
    telegramFileId: string | null;
    total: {
      energyKcal: number;
      proteinG: number;
      carbsG: number;
      fatG: number;
      source: string;
    } | null;
    foods: Array<{
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
  }>;
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

  /** List meals; optionally scope to one day (YYYY-MM-DD) for a lighter payload. */
  listMeals(date?: string): Promise<{ meals: MealSummary[]; groups: DayGroup[] }> {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return this.#request<{ meals: MealSummary[]; groups: DayGroup[] }>(`/api/meals${qs}`);
  }

  /** Distinct days (YYYY-MM-DD) that have meals — for calendar dots. */
  mealDates(): Promise<{ dates: string[] }> {
    return this.#request<{ dates: string[] }>('/api/meals/dates');
  }

  getMeal(id: string): Promise<MealDetail> {
    return this.#request<MealDetail>(`/api/meals/${encodeURIComponent(id)}`);
  }

  /** AI-revise an owned meal from a plain-language instruction; returns the new detail. */
  reviseMeal(id: string, instruction: string): Promise<MealDetail> {
    return this.#request<MealDetail>(`/api/meals/${encodeURIComponent(id)}/revise`, {
      method: 'POST',
      body: JSON.stringify({ instruction }),
    });
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

  /** Full export of the user's data as JSON (never includes the API key). */
  exportData(): Promise<UserExport> {
    return this.#request<UserExport>('/api/account/export');
  }

  /**
   * Public export URL with initData in the query (for Telegram's native
   * `downloadFile`, which fetches the URL itself and can't send our header).
   */
  exportUrl(): string {
    const initData = encodeURIComponent(this.#getInitData());
    return `${this.#baseUrl}/api/account/export?initData=${initData}`;
  }

  /** Permanently deletes the user and all their data. */
  deleteAccount(): Promise<{ ok: boolean }> {
    return this.#request<{ ok: boolean }>('/api/account', { method: 'DELETE' });
  }
}
