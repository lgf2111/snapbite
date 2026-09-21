import type { DailyTargets, MealImage, MealResult, UserProfile } from '@snapbite/core';

/** Header the Worker expects the signed initData in (matches the Worker). */
const INIT_DATA_HEADER = 'x-telegram-init-data';

/**
 * The device's current UTC offset in minutes (as `Date.getTimezoneOffset()`:
 * positive when behind UTC). Sent to the Worker so meals group by the user's
 * local calendar day rather than UTC.
 */
function tzOffsetMinutes(): number {
  return new Date().getTimezoneOffset();
}

/** Default per-request timeout (ms). */
const DEFAULT_TIMEOUT_MS = 20_000;
/** AI calls (analyze/revise) run a model server-side; give them more headroom. */
const AI_TIMEOUT_MS = 60_000;

export interface MealSummary {
  id: string;
  loggedAt: number;
  title: string | null;
  notes: string | null;
  confidence: number | null;
  energyKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  source: string | null;
  aiProvider: string | null;
  foods: string[];
  hasPhoto: boolean;
}

export interface DayGroup {
  date: string;
  totalKcal: number;
  mealIds: string[];
}

/** A saved-meal template ("favorite") the user can re-log with one tap. */
export interface Favorite {
  id: string;
  label: string;
  energyKcal: number | null;
  createdAt: number;
  meal: MealResult;
}

export interface MealDetail {
  id: string;
  loggedAt: number;
  createdAt: number;
  title: string | null;
  notes: string | null;
  confidence: number | null;
  telegramFileId: string | null;
  aiProvider: string | null;
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
  profile?: UserProfile | null;
  targets?: DailyTargets | null;
  /** Custom primary provider (when aiProvider === 'custom'). */
  customBaseUrl?: string | null;
  customSupportsDetail?: boolean;
  fallbackConnected?: boolean;
  fallbackEnabled?: boolean;
  fallbackProvider?: string | null;
  fallbackModel?: string | null;
  fallbackKeyLast4?: string | null;
  fallbackBaseUrl?: string | null;
  fallbackSupportsDetail?: boolean;
  /** Opt-in meal reminders (null when never configured). */
  reminders?: ReminderView | null;
}

/** Opt-in meal reminder config, as returned/sent by the API. */
export interface ReminderView {
  enabled: boolean;
  times: Record<string, string>;
  tzOffsetMinutes: number;
}

/** Extra fields for configuring a custom OpenAI-compatible provider. */
export interface CustomProviderInput {
  baseUrl?: string;
  supportsDetail?: boolean;
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

  async #request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set(INIT_DATA_HEADER, this.#getInitData());
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    // Bound every request so the UI can't hang forever if the connection stalls.
    const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res: Response;
    try {
      res = await this.#fetch(`${this.#baseUrl}${path}`, { ...init, headers, signal: ac.signal });
    } catch (err) {
      if (ac.signal.aborted) {
        throw new ApiError(0, 'Request timed out. Please try again.');
      }
      throw new ApiError(0, err instanceof Error ? err.message : 'Network error');
    } finally {
      clearTimeout(timer);
    }

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
      timeoutMs: AI_TIMEOUT_MS,
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
    const params = new URLSearchParams({ tz: String(tzOffsetMinutes()) });
    if (date) params.set('date', date);
    return this.#request<{ meals: MealSummary[]; groups: DayGroup[] }>(`/api/meals?${params}`);
  }

  /** Distinct days (YYYY-MM-DD) that have meals — for calendar dots. */
  mealDates(): Promise<{ dates: string[] }> {
    return this.#request<{ dates: string[] }>(`/api/meals/dates?tz=${tzOffsetMinutes()}`);
  }

  getMeal(id: string): Promise<MealDetail> {
    return this.#request<MealDetail>(`/api/meals/${encodeURIComponent(id)}`);
  }

  /** Lists the user's saved meals (favorites), newest first. */
  listFavorites(): Promise<{ favorites: Favorite[] }> {
    return this.#request<{ favorites: Favorite[] }>('/api/favorites');
  }

  /** Saves a meal as a reusable favorite. */
  addFavorite(meal: MealResult, label?: string): Promise<{ id: string; label: string }> {
    return this.#request<{ id: string; label: string }>('/api/favorites', {
      method: 'POST',
      body: JSON.stringify({ meal, ...(label ? { label } : {}) }),
    });
  }

  /** Deletes a saved favorite. */
  removeFavorite(id: string): Promise<{ ok: boolean }> {
    return this.#request<{ ok: boolean }>(`/api/favorites/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  /**
   * AI-revise an owned meal from a plain-language instruction. Returns a DRAFT
   * MealResult (not persisted) for the client to review and save via update().
   */
  async reviseMeal(id: string, instruction: string): Promise<MealResult> {
    const res = await this.#request<{ meal: MealResult }>(
      `/api/meals/${encodeURIComponent(id)}/revise`,
      {
        method: 'POST',
        body: JSON.stringify({ instruction }),
        timeoutMs: AI_TIMEOUT_MS,
      },
    );
    return res.meal;
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
    custom?: CustomProviderInput,
  ): Promise<SettingsView & { ok: boolean }> {
    return this.#request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ apiKey, aiProvider, aiModel, ...custom }),
    });
  }

  /** Stores the user's profile + goal; returns the computed targets. */
  saveProfile(profile: UserProfile): Promise<{ ok: boolean; profile: UserProfile; targets: DailyTargets }> {
    return this.#request('/api/settings/profile', {
      method: 'PUT',
      body: JSON.stringify({ profile }),
    });
  }

  /** Stores/replaces the fallback provider + key (enabled). */
  saveFallback(
    apiKey: string,
    aiProvider?: string,
    aiModel?: string,
    custom?: CustomProviderInput,
  ): Promise<{ ok: boolean; fallbackConnected: boolean; fallbackKeyLast4?: string }> {
    return this.#request('/api/settings/fallback', {
      method: 'PUT',
      body: JSON.stringify({ apiKey, aiProvider, aiModel, ...custom }),
    });
  }

  /** Enables/disables the fallback without touching the stored key. */
  setFallbackEnabled(enabled: boolean): Promise<{ ok: boolean; fallbackEnabled: boolean }> {
    return this.#request('/api/settings/fallback', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  }

  /** Permanently removes the fallback provider + key. */
  removeFallback(): Promise<{ ok: boolean; fallbackConnected: boolean }> {
    return this.#request('/api/settings/fallback', {
      method: 'PUT',
      body: JSON.stringify({ remove: true }),
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

  /** Sends user feedback to the maintainer (stored + DM'd). */
  sendFeedback(message: string): Promise<{ ok: boolean }> {
    return this.#request<{ ok: boolean }>('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  /** Stores the opt-in meal reminder config. tz is the device offset in minutes. */
  saveReminders(
    enabled: boolean,
    times: Record<string, string>,
  ): Promise<{ ok: boolean; reminders: ReminderView }> {
    return this.#request('/api/settings/reminders', {
      method: 'PUT',
      body: JSON.stringify({ enabled, times, tzOffsetMinutes: tzOffsetMinutes() }),
    });
  }
}
