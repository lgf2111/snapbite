import {
  type AIProvider,
  DeepSeekProvider,
  decryptSecret,
  type MealImage,
  MealResult,
  resolveMeal,
} from '@foodlog/core';
import { Hono } from 'hono';
import { createMealsDb, listMeals, saveMeal } from '../db/meals.js';
import { createSettingsDb, getSettings } from '../db/settings.js';
import type { AppBindings } from '../env.js';

/** Injectable provider factory so tests can supply a mock instead of DeepSeek. */
export type ProviderFactory = (apiKey: string) => AIProvider;

const defaultProviderFactory: ProviderFactory = (apiKey) => new DeepSeekProvider({ apiKey });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/**
 * Meal routes. `analyze` runs the real AI pipeline using the user's decrypted
 * BYOK key and returns an editable MealResult; the uploaded image bytes are
 * used only for the request and then dropped (never persisted).
 */
export function mealsRoutes(providerFactory: ProviderFactory = defaultProviderFactory) {
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

    return c.json({ id }, 201);
  });

  // GET /api/meals — list the user's meals (newest first).
  app.get('/', async (c) => {
    const db = createMealsDb(c.env.DB);
    const summaries = await listMeals(db, c.get('userId'));
    return c.json({ meals: summaries });
  });

  return app;
}
