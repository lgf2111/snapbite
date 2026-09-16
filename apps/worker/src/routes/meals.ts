import {
  type AIProvider,
  DeepSeekProvider,
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
  saveMeal,
  searchMeals,
  updateMeal,
} from '../db/meals.js';
import { createSettingsDb, getSettings } from '../db/settings.js';
import { createDb, upsertUser } from '../db/users.js';
import type { AppBindings } from '../env.js';
import { TelegramBotClient } from '../telegram/botClient.js';
import type { BotClientFactory } from './webhook.js';

const defaultBotClientFactory: BotClientFactory = (token) => new TelegramBotClient(token);

/** Injectable provider factory so tests can supply a mock instead of DeepSeek. */
export type ProviderFactory = (apiKey: string) => AIProvider;

const defaultProviderFactory: ProviderFactory = (apiKey) => new DeepSeekProvider({ apiKey });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

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
      const provider = providerFactory(apiKey);
      const analysis = await provider.analyzeMeal(image, hint ? { hint } : {});
      const meal = resolveMeal(analysis);
      return c.json(meal);
    } catch (err) {
      const e = err as { kind?: string; status?: number; message?: string };
      const status = e.kind === 'http' && e.status === 401 ? 400 : 502;
      return c.json(
        { error: 'Analysis failed', detail: e.message ?? 'provider error', kind: e.kind ?? null },
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
  app.get('/', async (c) => {
    const db = createMealsDb(c.env.DB);
    const summaries = await listMeals(db, c.get('userId'));
    return c.json({ meals: summaries, groups: groupByDay(summaries) });
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

  return app;
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

/** Groups meal summaries into day buckets (UTC), newest day first. */
export function groupByDay(summaries: MealSummaryLike[]): DayGroup[] {
  const byDate = new Map<string, DayGroup>();
  for (const m of summaries) {
    const date = new Date(m.loggedAt).toISOString().slice(0, 10);
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

/** Search routes: GET /api/search?q= over the user's food names. */
export function searchRoutes() {
  const app = new Hono<AppBindings>();
  app.get('/', async (c) => {
    const q = c.req.query('q') ?? '';
    const db = createMealsDb(c.env.DB);
    const results = await searchMeals(db, c.get('userId'), q);
    return c.json({ query: q.trim(), meals: results });
  });
  return app;
}
