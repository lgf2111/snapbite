import type {
  AdvancedReport,
  DailyTargets,
  MealImage,
  MealResult,
  ReportRange,
  UserProfile,
} from '@snapbite/core';

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
  /**
   * List-thumbnail URL, added by the client mapper below. Omitted when the meal
   * has no photo so a manual meal never requests a 404.
   */
  previewUrl?: string;
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

export interface DeviceTokenInfo {
  id: string;
  label: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface CreatedDeviceToken {
  id: string;
  /** The raw `sb_…` secret. Shown once; the server keeps only its hash. */
  token: string;
  label: string;
  createdAt: number;
}

export interface MealDetail {
  id: string;
  loggedAt: number;
  createdAt: number;
  title: string | null;
  notes: string | null;
  confidence: number | null;
  telegramFileId: string | null;
  /** True when a photo can be rendered (stored in R2 or still on Telegram). */
  hasPhoto?: boolean;
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
    fiberG?: number | null;
    nutritionSource: string | null;
  }>;
  total: {
    energyKcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG?: number | null;
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
  /** Push subscription health for the reminders card. */
  push?: PushStatusView | null;
  /** Opt-in adaptive calorie targets (null when never configured). */
  adaptive?: AdaptiveView | null;
  /** The user's most recent weight check-in (kg), or null. */
  latestWeightKg?: number | null;
}

/** Opt-in meal reminder config, as returned/sent by the API. */
export interface ReminderView {
  enabled: boolean;
  times: Record<string, string>;
  tzOffsetMinutes: number;
  /** Epoch ms of the last reminder that gave up without being delivered. */
  lastFailureAt?: number;
}

/** Push subscription health as returned by GET /api/settings. */
export interface PushStatusView {
  /** Live subscriptions (devices) on file. */
  live: number;
  /** ISO time a device last accepted a push, or null. */
  lastOkAt: string | null;
  /** Date to show in "not accepted since": last success, else first subscription. */
  since: string | null;
  /** A reminder exhausted its retries after the last successful push. */
  failing: boolean;
}

/** Opt-in adaptive-targets config, as returned/sent by the API. */
export interface AdaptiveView {
  enabled: boolean;
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
      fiberG?: number | null;
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
      fiberG?: number | null;
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
 * What the client may know about billing. The packs are the server's constants:
 * the client never sends a price or a credit count when buying.
 */
export interface BillingPack {
  id: string;
  label: string;
  credits: number;
  priceCents: number;
  currency: string;
}

export interface BillingSummary {
  signedIn: boolean;
  email: string | null;
  supporter: boolean;
  credits: number;
  source: 'byok' | 'credits' | 'trial' | 'none';
  trialUntil: number | null;
  trialAvailable: boolean;
  overflowEnabled: boolean;
  overflowUsedToday: number;
  overflowCap: number;
  packs: BillingPack[];
}

/** What a person sees when the request failed and the server sent no detail. */
export const LOAD_FAILED_MESSAGE = "Couldn't load that. Tap to retry.";

/**
 * Thin client for the SnapBite Worker API. Attaches the signed Telegram initData
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
    const initData = this.#getInitData();
    if (initData) headers.set(INIT_DATA_HEADER, initData);
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    // Bound every request so the UI can't hang forever if the connection stalls.
    const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res: Response;
    try {
      res = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers,
        // Send/receive the session + anonymous device cookies. Required for a
        // browser (non-Telegram) client; harmless inside the Mini App.
        credentials: 'include',
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted) {
        throw new ApiError(0, 'Request timed out. Please try again.');
      }
      throw new ApiError(0, err instanceof Error ? err.message : 'Network error');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // Keep the numeric status in the log, never on screen. This is also the
      // line that identifies which route failed when Home reports an outage.
      console.error(`[api] ${init.method ?? 'GET'} ${path} failed with HTTP ${res.status}`);
      let detail: string = LOAD_FAILED_MESSAGE;
      try {
        const body = (await res.json()) as { detail?: string; error?: string };
        detail = body.detail ?? body.error ?? detail;
      } catch {
        // non-JSON error body
      }
      // A server may still echo a provider's status text in `detail`; never let
      // "HTTP 503" reach a person.
      if (/\bHTTP\s+\d{3}\b/i.test(detail)) detail = LOAD_FAILED_MESSAGE;
      throw new ApiError(res.status, detail);
    }
    return (await res.json()) as T;
  }

  /* ---------------- auth (optional) ---------------- */

  /** Who this browser is: anonymous, signed in, or a Telegram user. */
  authMe(): Promise<{
    signedIn: boolean;
    via: string | null;
    email: string | null;
    userId: string | null;
  }> {
    return this.#request('/api/auth/me');
  }

  logout(): Promise<{ ok: boolean }> {
    return this.#request('/api/auth/logout', { method: 'POST' });
  }

  /* ---------------- billing (credits + supporter) ---------------- */

  /** Balance, trial state, overflow setting and the server's packs. */
  billingSummary(): Promise<BillingSummary> {
    return this.#request('/api/billing/summary');
  }

  setOverflowEnabled(overflowEnabled: boolean): Promise<{ ok: boolean }> {
    return this.#request('/api/billing/settings', {
      method: 'POST',
      body: JSON.stringify({ overflowEnabled }),
    });
  }

  /** Grants the once-per-identity trial; safe to call again. */
  startTrial(): Promise<{ ok: boolean; granted: boolean; trialUntil: number | null }> {
    return this.#request('/api/billing/trial', { method: 'POST' });
  }

  /** Creates a Stripe Checkout Session for a pack id and returns its URL. */
  checkout(pack: string): Promise<{ url: string; id: string | null }> {
    return this.#request('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ pack }),
    });
  }

  /**
   * Development-only topup through the operator endpoint. The admin token is
   * read from `VITE_ADMIN_TOKEN` at build time and never shipped without it.
   */
  async devTopup(email: string, credits: number): Promise<number> {
    const token = (import.meta.env.VITE_ADMIN_TOKEN ?? '').trim();
    if (!token) {
      throw new ApiError(0, 'Set VITE_ADMIN_TOKEN to use the dev topup.');
    }
    const res = await this.#request<{ ok: boolean; email: string; credits: number }>(
      '/api/admin/topup',
      {
        method: 'POST',
        headers: { 'x-admin-token': token },
        body: JSON.stringify({ email, credits }),
      },
    );
    return res.credits;
  }

  analyze(image: MealImage, hint?: string): Promise<MealResult & { notice?: string }> {
    return this.#request<MealResult & { notice?: string }>('/api/meals/analyze', {
      method: 'POST',
      body: JSON.stringify({ base64: image.base64, mimeType: image.mimeType, hint }),
      timeoutMs: AI_TIMEOUT_MS,
    });
  }

  saveMeal(
    meal: MealResult,
    photo?: { base64: string; mimeType: string },
  ): Promise<{ id: string }> {
    return this.#request<{ id: string }>('/api/meals', {
      method: 'POST',
      body: JSON.stringify(photo ? { meal, photo } : { meal }),
      timeoutMs: photo ? AI_TIMEOUT_MS : undefined,
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

  /**
   * The list-row mapper: the one place a meal summary gains its thumbnail URL.
   * `photoUrl()` stays the single URL builder, so Telegram's initData and the
   * `?w=240` downscale request are never duplicated here.
   */
  #withPreview(meal: MealSummary): MealSummary {
    return meal.hasPhoto ? { ...meal, previewUrl: this.photoUrl(meal.id, { width: 240 }) } : meal;
  }

  /** List meals; optionally scope to one day (YYYY-MM-DD) for a lighter payload. */
  async listMeals(date?: string): Promise<{ meals: MealSummary[]; groups: DayGroup[] }> {
    const params = new URLSearchParams({ tz: String(tzOffsetMinutes()) });
    if (date) params.set('date', date);
    const res = await this.#request<{ meals: MealSummary[]; groups: DayGroup[] }>(
      `/api/meals?${params}`,
    );
    return { ...res, meals: res.meals.map((m) => this.#withPreview(m)) };
  }

  /** Meals within an inclusive local-day-key range (server-side filtered). */
  async mealsInRange(
    startKey: string,
    endKey: string,
  ): Promise<{ meals: MealSummary[]; groups: DayGroup[] }> {
    const params = new URLSearchParams({
      tz: String(tzOffsetMinutes()),
      from: startKey,
      to: endKey,
    });
    const res = await this.#request<{ meals: MealSummary[]; groups: DayGroup[] }>(
      `/api/meals?${params}`,
    );
    return { ...res, meals: res.meals.map((m) => this.#withPreview(m)) };
  }

  /** Distinct logged days for calendar dots, plus the current streak (2+ days). */
  mealDates(): Promise<{ dates: string[]; streak: number | null }> {
    return this.#request<{ dates: string[]; streak: number | null }>(
      `/api/meals/dates?tz=${tzOffsetMinutes()}`,
    );
  }

  /**
   * Advanced reports. The Worker answers 403 unless this account has the
   * supporter tag (bought a pack or is inside the trial); the screen turns that
   * into the locked state.
   */
  analytics(range: ReportRange): Promise<AdvancedReport> {
    const params = new URLSearchParams({ range, tz: String(tzOffsetMinutes()) });
    return this.#request<AdvancedReport>(`/api/analytics?${params}`);
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
  async reviseMeal(id: string, instruction: string): Promise<MealResult & { notice?: string }> {
    const res = await this.#request<{ meal: MealResult; notice?: string }>(
      `/api/meals/${encodeURIComponent(id)}/revise`,
      {
        method: 'POST',
        body: JSON.stringify({ instruction }),
        timeoutMs: AI_TIMEOUT_MS,
      },
    );
    return res.notice ? { ...res.meal, notice: res.notice } : res.meal;
  }

  /**
   * Builds a photo URL for a meal. Inside Telegram the initData rides in the
   * query (an <img> cannot send headers); in a browser the cookies do the work,
   * so no credential ever appears in a URL there. `width` asks the Worker for a
   * thumbnail (`?w=`) whose long edge is at most that many pixels.
   */
  photoUrl(id: string, opts: { width?: number } = {}): string {
    const params = new URLSearchParams();
    const initData = this.#getInitData();
    if (initData) params.set('initData', initData);
    if (opts.width && opts.width > 0) params.set('w', String(Math.round(opts.width)));
    const base = `${this.#baseUrl}/api/meal-photo/${encodeURIComponent(id)}`;
    const query = params.toString();
    return query ? `${base}?${query}` : base;
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
  saveProfile(
    profile: UserProfile,
  ): Promise<{ ok: boolean; profile: UserProfile; targets: DailyTargets }> {
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

  /** Active device tokens (iOS Shortcut). Never includes the raw value. */
  listDeviceTokens(): Promise<{ tokens: DeviceTokenInfo[] }> {
    return this.#request('/api/tokens');
  }

  /** Mints a device token. The raw `token` is returned exactly once. */
  createDeviceToken(label?: string): Promise<CreatedDeviceToken> {
    return this.#request('/api/tokens', {
      method: 'POST',
      body: JSON.stringify(label ? { label } : {}),
    });
  }

  revokeDeviceToken(id: string): Promise<{ ok: boolean }> {
    return this.#request(`/api/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  revokeAllDeviceTokens(): Promise<{ revoked: number }> {
    return this.#request('/api/tokens', { method: 'DELETE' });
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

  /** Opts in/out of adaptive calorie targets. tz is the device offset in minutes. */
  saveAdaptive(enabled: boolean): Promise<{ ok: boolean; adaptive: AdaptiveView }> {
    return this.#request('/api/settings/adaptive', {
      method: 'PUT',
      body: JSON.stringify({ enabled, tzOffsetMinutes: tzOffsetMinutes() }),
    });
  }

  /** Records a bodyweight check-in (canonical kg) for adaptive targets. */
  logWeight(kg: number): Promise<{ ok: boolean; latestWeightKg: number }> {
    return this.#request('/api/settings/weight', {
      method: 'POST',
      body: JSON.stringify({ kg }),
    });
  }
}
