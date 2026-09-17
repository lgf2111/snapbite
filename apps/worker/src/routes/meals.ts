import {
  type AIFoodAnalysis,
  type AIProvider,
  createProvider,
  decryptSecret,
  type MealImage,
  mealLoggedMessage,
  MealResult,
  resolveMeal,
  verifyInitData,
} from '@foodlog/core';
import { Hono } from 'hono';
import {
  createMealsDb,
  deleteMeal,
  getMealDetail,
  listMeals,
  type MealDetail,
  saveMeal,
  updateMeal,
} from '../db/meals.js';
import { describeError, logError } from '../db/errors.js';
import { createSettingsDb, getSettings, parsePreferences } from '../db/settings.js';
import type { SettingsRow } from '../db/schema.js';
import { createDb, upsertUser } from '../db/users.js';
import type { AppBindings } from '../env.js';
import { TelegramBotClient } from '../telegram/botClient.js';
import type { BotClientFactory } from './webhook.js';

const defaultBotClientFactory: BotClientFactory = (token) => new TelegramBotClient(token);

/** How the chosen provider is described to the factory. */
export interface ProviderChoice {
  apiKey: string;
  provider: string;
  model: string | null;
  /** Custom OpenAI-compatible base URL (when `provider` is `custom`). */
  baseUrl?: string | null;
  /** Whether the custom endpoint honors `image_url.detail`. */
  supportsDetail?: boolean;
}

/** Injectable provider factory so tests can supply a mock. */
export type ProviderFactory = (choice: ProviderChoice) => AIProvider;

const defaultProviderFactory: ProviderFactory = ({
  apiKey,
  provider,
  model,
  baseUrl,
  supportsDetail,
}) =>
  createProvider({
    providerId: provider,
    apiKey,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(supportsDetail != null ? { supportsDetail } : {}),
  });

/**
 * Builds the primary {@link ProviderChoice} from a settings row + decrypted key,
 * pulling the custom base URL / detail flag out of preferences_json when the
 * user's provider is `custom`.
 */
export function primaryProviderChoice(row: SettingsRow, apiKey: string): ProviderChoice {
  const choice: ProviderChoice = { apiKey, provider: row.aiProvider, model: row.aiModel };
  if (row.aiProvider === 'custom') {
    const custom = parsePreferences(row.preferencesJson).customProvider;
    if (custom?.baseUrl) {
      choice.baseUrl = custom.baseUrl;
      choice.supportsDetail = custom.supportsDetail ?? false;
    }
  }
  return choice;
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/**
 * Best-effort extraction of a human message from a provider's error body. Both
 * OpenAI and Gemini return `{ error: { message } }` (Gemini sometimes wraps it
 * in an array). Returns undefined if nothing useful is found.
 */
function extractProviderMessage(cause: unknown): string | undefined {
  if (typeof cause !== 'string' || !cause.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(cause);
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    const msg = (obj as { error?: { message?: unknown } })?.error?.message;
    return typeof msg === 'string' ? msg : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Meal routes. `analyze` runs the real AI pipeline using the user's decrypted
 * BYOK key and returns an editable MealResult; the uploaded image bytes are
 * used only for the request and then dropped (never persisted).
 */
export function mealsRoutes(
  providerFactory: ProviderFactory = defaultProviderFactory,
  botClientFactory?: BotClientFactory,
) {
  const app = new Hono<AppBindings>();

  // POST /api/meals/analyze — { base64, mimeType, hint? } -> MealResult
  app.post('/analyze', async (c) => {
    if (!c.env.ENCRYPTION_KEY) {
      return c.json({ error: 'Server misconfigured', detail: 'No encryption key' }, 500);
    }

    let body: { base64?: unknown; mimeType?: unknown; hint?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Bad request', detail: 'Invalid JSON' }, 400);
    }

    const base64 = typeof body.base64 === 'string' ? body.base64 : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
    const hint = typeof body.hint === 'string' ? body.hint : undefined;

    if (!base64) return c.json({ error: 'Bad request', detail: 'base64 image required' }, 400);
    if (!ALLOWED_MIME.has(mimeType)) {
      return c.json({ error: 'Bad request', detail: 'unsupported mimeType' }, 400);
    }

    // Load and decrypt the user's API key.
    const settingsDb = createSettingsDb(c.env.DB);
    const row = await getSettings(settingsDb, c.get('userId'));
    if (!row?.apiKeyCiphertext || !row?.apiKeyIv) {
      return c.json({ error: 'No API key', detail: 'Add your AI key in settings first' }, 400);
    }

    let apiKey: string;
    try {
      apiKey = await decryptSecret(
        { ciphertext: row.apiKeyCiphertext, iv: row.apiKeyIv },
        c.env.ENCRYPTION_KEY,
      );
    } catch {
      return c.json({ error: 'Server error', detail: 'Could not decrypt key' }, 500);
    }

    // Run the pipeline. `image` (the bytes) is a local const and is discarded
    // when the handler returns — nothing is written to storage.
    const image: MealImage = { base64, mimeType: mimeType as MealImage['mimeType'] };
    try {
      const provider = providerFactory(primaryProviderChoice(row, apiKey));
      const analysis = await provider.analyzeMeal(image, hint ? { hint } : {});
      const meal = resolveMeal(analysis);
      return c.json(meal);
    } catch (err) {
      const e = err as { kind?: string; status?: number; message?: string; cause?: unknown };
      const status = e.kind === 'http' && e.status === 401 ? 400 : 502;
      // Surface the provider's own message (e.g. a retired-model hint) when present.
      const providerDetail = extractProviderMessage(e.cause);
      // Persist server-side analysis failures for the owner to review via /errors.
      // (No admin DM here — API 4xx/5xx aren't user-facing chat errors; §14 decision.)
      const desc = describeError(err);
      await logError(c.env.DB, {
        telegramUserId: c.get('telegramUser')?.id ?? null,
        source: 'analyze',
        kind: desc.kind ?? 'provider',
        status,
        message: desc.message,
        detail: providerDetail ?? desc.detail ?? null,
      });
      return c.json(
        {
          error: 'Analysis failed',
          detail: providerDetail ?? e.message ?? 'provider error',
          kind: e.kind ?? null,
        },
        status,
      );
    }
  });

  // POST /api/meals — persist a (possibly edited) MealResult.
  app.post('/', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Bad request', detail: 'Invalid JSON' }, 400);
    }

    const mealField = (body as { meal?: unknown })?.meal ?? body;
    const parsed = MealResult.safeParse(mealField);
    if (!parsed.success) {
      return c.json({ error: 'Bad request', detail: 'Invalid meal', issues: parsed.error.issues }, 400);
    }

    const telegramFileId = (body as { telegramFileId?: unknown })?.telegramFileId;
    const db = createMealsDb(c.env.DB);
    const id = await saveMeal(db, {
      userId: c.get('userId'),
      meal: parsed.data,
      ...(typeof telegramFileId === 'string' ? { telegramFileId } : {}),
    });

    // Best-effort "logged" feed message to the user's bot chat. Never blocks or
    // fails the save.
    if (botClientFactory && c.env.TELEGRAM_BOT_TOKEN) {
      try {
        const bot = botClientFactory(c.env.TELEGRAM_BOT_TOKEN);
        const foods = parsed.data.foods.map((f) => f.food.name);
        await bot.sendMessage(c.get('telegramUser').id, {
          text: mealLoggedMessage(foods, parsed.data.total.energyKcal),
        });
      } catch {
        // ignore feed failures
      }
    }

    return c.json({ id }, 201);
  });

  // GET /api/meals — list the user's meals (newest first), grouped by day.
  // Optional query: ?limit=N (default 50) and ?date=YYYY-MM-DD to fetch just
  // one day (used by the Home day view for a lighter payload).
  app.get('/', async (c) => {
    const db = createMealsDb(c.env.DB);
    const limitParam = Number.parseInt(c.req.query('limit') ?? '', 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;
    const date = c.req.query('date');
    const tz = parseTzOffset(c.req.query('tz'));

    let summaries = await listMeals(db, c.get('userId'), date ? 500 : limit);
    if (date) {
      summaries = summaries.filter((m) => localDayKey(m.loggedAt, tz) === date);
    }
    return c.json({ meals: summaries, groups: groupByDay(summaries, tz) });
  });

  // GET /api/meals/dates — distinct days (YYYY-MM-DD) that have meals, so the
  // calendar can dot logged days without fetching every meal. `?tz=` is the
  // client's UTC offset in minutes so days align to the user's local time.
  app.get('/dates', async (c) => {
    const db = createMealsDb(c.env.DB);
    const tz = parseTzOffset(c.req.query('tz'));
    const summaries = await listMeals(db, c.get('userId'), 500);
    const dates = [...new Set(summaries.map((m) => localDayKey(m.loggedAt, tz)))].sort((a, b) =>
      a < b ? 1 : -1,
    );
    return c.json({ dates });
  });

  // GET /api/meals/:id — full detail for one owned meal.
  app.get('/:id', async (c) => {
    const db = createMealsDb(c.env.DB);
    const detail = await getMealDetail(db, c.req.param('id'), c.get('userId'));
    if (!detail) return c.json({ error: 'Not found' }, 404);
    return c.json(detail);
  });

  // PUT /api/meals/:id — update an owned meal with an edited MealResult.
  app.put('/:id', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Bad request', detail: 'Invalid JSON' }, 400);
    }
    const mealField = (body as { meal?: unknown })?.meal ?? body;
    const parsed = MealResult.safeParse(mealField);
    if (!parsed.success) {
      return c.json({ error: 'Bad request', detail: 'Invalid meal', issues: parsed.error.issues }, 400);
    }

    const db = createMealsDb(c.env.DB);
    const ok = await updateMeal(db, c.req.param('id'), c.get('userId'), parsed.data);
    if (!ok) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  });

  // DELETE /api/meals/:id — delete an owned meal (cascades to foods+nutrition).
  app.delete('/:id', async (c) => {
    const db = createMealsDb(c.env.DB);
    const ok = await deleteMeal(db, c.req.param('id'), c.get('userId'));
    if (!ok) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  });

  // POST /api/meals/:id/revise — { instruction } -> AI-revised meal (DRAFT).
  // Sends the current meal + the plain-language instruction to the provider
  // (no image), re-resolves nutrition, and RETURNS the revised MealResult
  // WITHOUT persisting. The client reviews it and saves via PUT /api/meals/:id.
  app.post('/:id/revise', async (c) => {
    if (!c.env.ENCRYPTION_KEY) {
      return c.json({ error: 'Server misconfigured', detail: 'No encryption key' }, 500);
    }

    let body: { instruction?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Bad request', detail: 'Invalid JSON' }, 400);
    }
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    if (!instruction) {
      return c.json({ error: 'Bad request', detail: 'instruction required' }, 400);
    }
    if (instruction.length > 500) {
      return c.json({ error: 'Bad request', detail: 'instruction too long (max 500 chars)' }, 400);
    }

    const mealsDb = createMealsDb(c.env.DB);
    const id = c.req.param('id');
    const detail = await getMealDetail(mealsDb, id, c.get('userId'));
    if (!detail) return c.json({ error: 'Not found' }, 404);

    // Load + decrypt the user's key.
    const settingsDb = createSettingsDb(c.env.DB);
    const row = await getSettings(settingsDb, c.get('userId'));
    if (!row?.apiKeyCiphertext || !row?.apiKeyIv) {
      return c.json({ error: 'No API key', detail: 'Add your AI key in settings first' }, 400);
    }
    let apiKey: string;
    try {
      apiKey = await decryptSecret(
        { ciphertext: row.apiKeyCiphertext, iv: row.apiKeyIv },
        c.env.ENCRYPTION_KEY,
      );
    } catch {
      return c.json({ error: 'Server error', detail: 'Could not decrypt key' }, 500);
    }

    // Bound the provider call so a hung model returns a clean 504 instead of
    // Cloudflare cutting the connection with a 524 (~100s edge limit).
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REVISE_TIMEOUT_MS);
    try {
      const provider = providerFactory(primaryProviderChoice(row, apiKey));
      const analysis = await provider.reviseMeal(detailToAnalysis(detail), instruction, {
        signal: ac.signal,
      });
      // Draft only: return the revised meal for the client to review + save.
      const meal = resolveMeal(analysis);
      return c.json({ meal });
    } catch (err) {
      if (ac.signal.aborted) {
        return c.json(
          {
            error: 'Revision timed out',
            detail: 'The AI took too long to respond. Please try again.',
            kind: 'timeout',
          },
          504,
        );
      }
      const e = err as { kind?: string; status?: number; message?: string; cause?: unknown };
      const status = e.kind === 'http' && e.status === 401 ? 400 : 502;
      const providerDetail = extractProviderMessage(e.cause);
      return c.json(
        {
          error: 'Revision failed',
          detail: providerDetail ?? e.message ?? 'provider error',
          kind: e.kind ?? null,
        },
        status,
      );
    } finally {
      clearTimeout(timer);
    }
  });

  return app;
}

/** Max time to wait on the AI revise call before returning a 504 (well under
 * Cloudflare's ~100s edge timeout so the client gets a real error). */
const REVISE_TIMEOUT_MS = 45_000;

/**
 * Reconstructs an {@link AIFoodAnalysis} from a stored meal so it can be sent
 * to `reviseMeal`. Stored food macros are ABSOLUTE (already scaled by weight ×
 * quantity), so we convert them back to the per-100g `aiNutrition` the model
 * expects. Foods with no stored nutrition are sent without `aiNutrition`.
 */
export function detailToAnalysis(detail: MealDetail): AIFoodAnalysis {
  return {
    foods: detail.foods.map((f) => {
      const weight = f.estimatedWeightG ?? 1;
      const quantity = f.quantity > 0 ? f.quantity : 1;
      const grams = weight * quantity;
      const per100 = (v: number | null): number =>
        grams > 0 && v != null ? Math.round(((v * 100) / grams) * 10) / 10 : 0;
      const hasNutrition = f.energyKcal != null;
      return {
        name: f.name,
        estimatedWeightG: weight > 0 ? weight : 1,
        ...(f.portion ? { portion: f.portion } : {}),
        quantity,
        confidence: f.confidence ?? 0.5,
        ...(hasNutrition
          ? {
              aiNutrition: {
                energyKcal: per100(f.energyKcal),
                proteinG: per100(f.proteinG),
                carbsG: per100(f.carbsG),
                fatG: per100(f.fatG),
              },
            }
          : {}),
      };
    }),
    confidence: detail.confidence ?? 0.5,
    needsConfirmation: false,
    ...(detail.notes ? { notes: detail.notes } : {}),
  };
}

/**
 * Photo proxy route, mounted separately because <img> tags can't send the
 * initData header — it's passed as a query param and verified inline here. The
 * bot token never reaches the client; the Worker fetches the image and streams
 * it back.
 */
export function mealPhotoRoutes(botClientFactory: BotClientFactory = defaultBotClientFactory) {
  const app = new Hono<AppBindings>();

  // GET /api/meal-photo/:id?initData=...
  app.get('/:id', async (c) => {
    const initData = c.req.query('initData') ?? '';
    if (!initData || !c.env.TELEGRAM_BOT_TOKEN) return c.text('Unauthorized', 401);
    const verified = await verifyInitData(initData, c.env.TELEGRAM_BOT_TOKEN);
    if (!verified.ok) return c.text('Unauthorized', 401);

    const db = createDb(c.env.DB);
    const user = await upsertUser(db, verified.data.user);
    const mealsDb = createMealsDb(c.env.DB);
    const detail = await getMealDetail(mealsDb, c.req.param('id'), user.id);
    if (!detail?.telegramFileId) return c.text('Not found', 404);

    const bot = botClientFactory(c.env.TELEGRAM_BOT_TOKEN);
    const filePath = await bot.getFilePath(detail.telegramFileId);
    if (!filePath) return c.text('Not found', 404);
    const file = await bot.downloadFile(filePath);
    if (!file) return c.text('Not found', 404);

    const bytes = Uint8Array.from(atob(file.base64), (ch) => ch.charCodeAt(0));
    return new Response(bytes, {
      headers: {
        'content-type': file.mimeType,
        'cache-control': 'private, max-age=86400',
      },
    });
  });

  return app;
}

/** A day bucket for the grouped history view. */
export interface DayGroup {
  /** ISO date (YYYY-MM-DD, UTC) for the bucket. */
  date: string;
  totalKcal: number;
  mealIds: string[];
}

/**
 * Parses the client's UTC offset (minutes, as from `Date.getTimezoneOffset()`:
 * positive when the zone is behind UTC). Clamped to ±16h; 0 (UTC) on anything
 * invalid or absent — back-compat for older clients that don't send it.
 */
function parseTzOffset(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-960, Math.min(960, n));
}

/**
 * The YYYY-MM-DD calendar day for a timestamp in the user's local time.
 * `tzOffsetMinutes` follows `Date.getTimezoneOffset()` (UTC = local + offset),
 * so local wall-clock = UTC − offset; shifting the epoch by that lets us read
 * local date fields off the UTC accessors.
 */
export function localDayKey(ms: number, tzOffsetMinutes = 0): string {
  return new Date(ms - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Groups meal summaries into day buckets in the user's local time, newest first. */
export function groupByDay(summaries: MealSummaryLike[], tzOffsetMinutes = 0): DayGroup[] {
  const byDate = new Map<string, DayGroup>();
  for (const m of summaries) {
    const date = localDayKey(m.loggedAt, tzOffsetMinutes);
    const group = byDate.get(date) ?? { date, totalKcal: 0, mealIds: [] };
    group.totalKcal += m.energyKcal ?? 0;
    group.mealIds.push(m.id);
    byDate.set(date, group);
  }
  return [...byDate.values()]
    .map((g) => ({ ...g, totalKcal: Math.round(g.totalKcal * 10) / 10 }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

interface MealSummaryLike {
  id: string;
  loggedAt: number;
  energyKcal: number | null;
}
