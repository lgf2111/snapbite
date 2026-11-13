import {
  type AIFoodAnalysis,
  type MealImage,
  MealResult,
  currentStreak,
  mealLoggedMessage,
  resolveMeal,
  verifyInitData,
} from '@snapbite/core';
import { Hono } from 'hono';
import { cookies, deviceLookupHash, readCookies } from '../auth/cookies.js';
import {
  type ProviderFactory,
  ProviderSetupError,
  QuotaExceeded,
  defaultProviderFactory,
  resolveProviderForUser,
} from '../billing/provider.js';
import { createAuthDb, findDeviceUser, findSessionUser } from '../db/auth.js';
import { describeError, logError } from '../db/errors.js';
import {
  type MealDetail,
  countMealsSince,
  createMealsDb,
  deleteMeal,
  getMealDetail,
  listMeals,
  saveMeal,
  setMealPhoto,
  updateMeal,
} from '../db/meals.js';
import { recordMealSave } from '../db/metrics.js';
import { createSettingsDb, getSettings, parsePreferences } from '../db/settings.js';
import { createDb, upsertUser } from '../db/users.js';
import type { AppBindings } from '../env.js';
import { base64ToBytes, resizeImage, shrinkImage } from '../storage/images.js';
import { photoKey, r2Store } from '../storage/photos.js';
import { TelegramBotClient } from '../telegram/botClient.js';
import type { BotClientFactory } from './webhook.js';

export type { ProviderChoice, ProviderFactory } from '../billing/provider.js';

const defaultBotClientFactory: BotClientFactory = (token) => new TelegramBotClient(token);

export const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** Hard cap on the JSON request body, checked before anything is parsed. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;
/**
 * Client photos must already be compressed (the app targets 1600 px / 400 KB).
 * 2 MB of base64 is ~1.5 MB of bytes: generous for a re-send, small enough that
 * a client cannot hand the Worker an unbounded decode job.
 */
const MAX_PHOTO_BASE64_BYTES = 2 * 1024 * 1024;
/** Largest thumbnail edge `?w=` will produce; the stored original tops out at 1600. */
const MAX_THUMB_EDGE = 1600;

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
 * Rewrites known provider error details into clear, actionable guidance for the
 * Mini App. Currently handles the geographic block (Gemini's "User location is
 * not supported for the API use", HTTP 400 FAILED_PRECONDITION) — recoverable
 * by switching to a provider without that restriction. Any other message is
 * returned unchanged. `detail` is the message + any JSON cause text.
 */
function friendlyProviderDetail(detail: string | undefined, message?: string): string | undefined {
  const raw = `${detail ?? ''} ${message ?? ''}`;
  if (/location is not supported|user location|not available in your/i.test(raw)) {
    return "Your AI provider isn't available in this region (it reported your location isn't supported — common with Google Gemini). Switch to OpenAI or DeepSeek in Settings and try again.";
  }
  // A provider body with a human message ("Invalid API key") is useful; keep it.
  if (detail && !/\bHTTP\s+\d{3}\b/i.test(detail)) return detail;
  // Status-only messages ("gemini returned HTTP 503") are not actionable.
  if (/\bHTTP\s+\d{3}\b/i.test(raw)) {
    return 'The AI provider is busy or unavailable right now. Please try again in a moment.';
  }
  return detail;
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

    // Run the pipeline. `image` (the bytes) is a local const and is discarded
    // when the handler returns — nothing is written to storage.
    const image: MealImage = { base64, mimeType: mimeType as MealImage['mimeType'] };
    try {
      const provider = await resolveProviderForUser(c.env.DB, c.env, c.get('userId'), {
        providerFactory,
      });
      const analysis = await provider.analyzeMeal(image, hint ? { hint } : {});
      const meal = resolveMeal(analysis);
      return c.json(provider.notice ? { ...meal, notice: provider.notice } : meal);
    } catch (err) {
      if (err instanceof QuotaExceeded) {
        return c.json(
          { error: 'Analysis failed', detail: err.userMessage, kind: 'quota' },
          err.status,
        );
      }
      if (err instanceof ProviderSetupError) {
        return c.json({ error: 'Server error', detail: err.userMessage }, err.status);
      }
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
          detail:
            friendlyProviderDetail(providerDetail, e.message) ?? e.message ?? 'provider error',
          kind: e.kind ?? null,
        },
        status,
      );
    }
  });

  // POST /api/meals — persist a (possibly edited) MealResult.
  app.post('/', async (c) => {
    // Content-Length is checked before the body is read; the length of the text
    // is checked again for chunked requests, both before JSON.parse runs.
    const declared = Number.parseInt(c.req.header('content-length') ?? '', 10);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return c.json({ error: 'Payload too large', detail: 'Request body is too large.' }, 413);
    }
    let raw: string;
    try {
      raw = await c.req.text();
    } catch {
      return c.json({ error: 'Bad request', detail: 'Invalid body' }, 400);
    }
    if (raw.length > MAX_BODY_BYTES) {
      return c.json({ error: 'Payload too large', detail: 'Request body is too large.' }, 413);
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ error: 'Bad request', detail: 'Invalid JSON' }, 400);
    }

    const mealField = (body as { meal?: unknown })?.meal ?? body;
    const parsed = MealResult.safeParse(mealField);
    if (!parsed.success) {
      return c.json(
        { error: 'Bad request', detail: 'Invalid meal', issues: parsed.error.issues },
        400,
      );
    }

    const telegramFileId = (body as { telegramFileId?: unknown })?.telegramFileId;
    const photo = (body as { photo?: { base64?: unknown; mimeType?: unknown } })?.photo;
    const photoInput =
      photo &&
      typeof photo.base64 === 'string' &&
      photo.base64.length > 0 &&
      typeof photo.mimeType === 'string' &&
      ALLOWED_MIME.has(photo.mimeType)
        ? { base64: photo.base64, mimeType: photo.mimeType }
        : null;

    if (photoInput && photoInput.base64.length > MAX_PHOTO_BASE64_BYTES) {
      return c.json(
        { error: 'Payload too large', detail: 'Photo is too large. Choose a smaller image.' },
        413,
      );
    }

    // Share the Shortcut path's shrink, and do it before the meal row exists so
    // an oversized or undecodable photo can never leave a half-created meal.
    const shrunk = photoInput ? await shrinkImage(photoInput.base64, photoInput.mimeType) : null;

    const db = createMealsDb(c.env.DB);
    const userId = c.get('userId');
    const isFirstMeal = (await countMealsSince(db, userId, 0)) === 0;
    const id = await saveMeal(db, {
      userId,
      meal: parsed.data,
      ...(typeof telegramFileId === 'string' ? { telegramFileId } : {}),
    });

    // Optional photo captured in the app: store the shrunk bytes so the meal
    // renders an image. Best effort — a storage failure must not lose the meal.
    if (shrunk) {
      const store = r2Store(c.env.PHOTOS);
      if (store) {
        try {
          const key = photoKey(id);
          await store.put(key, base64ToBytes(shrunk.base64), shrunk.mimeType);
          await setMealPhoto(db, id, userId, key, shrunk.mimeType);
        } catch (err) {
          console.error('[meals] photo store failed', err);
        }
      }
    }
    // First-party counters — best-effort, never fails the save (§metrics).
    const tg = c.get('telegramUser');
    if (tg) await recordMealSave(c.env.DB, tg.id, isFirstMeal).catch(() => {});

    // Best-effort "logged" feed message to the user's bot chat. Never blocks or
    // fails the save.
    const tgUser = c.get('telegramUser');
    if (botClientFactory && c.env.TELEGRAM_BOT_TOKEN && tgUser) {
      try {
        const bot = botClientFactory(c.env.TELEGRAM_BOT_TOKEN);
        const foods = parsed.data.foods.map((f) => f.food.name);
        await bot.sendMessage(tgUser.id, {
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
    const from = c.req.query('from');
    const to = c.req.query('to');
    const tz = parseTzOffset(c.req.query('tz'));
    const scoped = Boolean(date || from || to);

    let summaries = await listMeals(db, c.get('userId'), scoped ? 500 : limit);
    if (date) {
      summaries = summaries.filter((m) => localDayKey(m.loggedAt, tz) === date);
    } else if (from || to) {
      // Inclusive [from, to] local-day-key range (either bound optional) — used
      // by the weekly view so the server filters instead of shipping everything.
      summaries = summaries.filter((m) => {
        const key = localDayKey(m.loggedAt, tz);
        return (!from || key >= from) && (!to || key <= to);
      });
    }
    return c.json({ meals: summaries, groups: groupByDay(summaries, tz) });
  });

  // GET /api/meals/dates — distinct days (YYYY-MM-DD) that have meals, so the
  // calendar can dot logged days without fetching every meal, plus the current
  // logging streak for the Home header. `?tz=` is the client's UTC offset in
  // minutes so days align to the user's local time.
  app.get('/dates', async (c) => {
    const userId = c.get('userId');
    const db = createMealsDb(c.env.DB);
    const tz = parseTzOffset(c.req.query('tz'));
    const summaries = await listMeals(db, userId, 500);
    const dates = [...new Set(summaries.map((m) => localDayKey(m.loggedAt, tz)))].sort((a, b) =>
      a < b ? 1 : -1,
    );
    // Revived days count toward the streak, but never appear as logged dates.
    const prefs = parsePreferences(
      (await getSettings(createSettingsDb(c.env.DB), userId))?.preferencesJson,
    );
    const dayKeys = new Set(dates);
    for (const day of Array.isArray(prefs.streakRevival?.revivedDays)
      ? prefs.streakRevival.revivedDays
      : []) {
      dayKeys.add(day);
    }
    const streak = currentStreak(dayKeys, localDayKey(Date.now(), tz));
    return c.json({ dates, streak: streak >= 2 ? streak : null });
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
      return c.json(
        { error: 'Bad request', detail: 'Invalid meal', issues: parsed.error.issues },
        400,
      );
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

    // Bound the provider call so a hung model returns a clean 504 instead of
    // Cloudflare cutting the connection with a 524 (~100s edge limit).
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REVISE_TIMEOUT_MS);
    try {
      const provider = await resolveProviderForUser(c.env.DB, c.env, c.get('userId'), {
        providerFactory,
      });
      const analysis = await provider.reviseMeal(detailToAnalysis(detail), instruction, {
        signal: ac.signal,
      });
      // Draft only: return the revised meal for the client to review + save.
      const meal = resolveMeal(analysis);
      return c.json(provider.notice ? { meal, notice: provider.notice } : { meal });
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
      if (err instanceof QuotaExceeded) {
        return c.json(
          { error: 'Revision failed', detail: err.userMessage, kind: 'quota' },
          err.status,
        );
      }
      if (err instanceof ProviderSetupError) {
        return c.json({ error: 'Server error', detail: err.userMessage }, err.status);
      }
      const e = err as { kind?: string; status?: number; message?: string; cause?: unknown };
      const status = e.kind === 'http' && e.status === 401 ? 400 : 502;
      const providerDetail = extractProviderMessage(e.cause);
      return c.json(
        {
          error: 'Revision failed',
          detail:
            friendlyProviderDetail(providerDetail, e.message) ?? e.message ?? 'provider error',
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
                // Carry fiber back as per-100g when it was stored, so a revise
                // round-trip doesn't silently drop it.
                ...(f.fiberG != null ? { fiberG: per100(f.fiberG) } : {}),
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
 * A strong, quoted ETag for one representation of a photo. R2's `httpEtag` is
 * already a strong validator; the width is appended because `?w=240` and
 * `?w=480` are different representations and must not share a validator.
 */
function photoEtag(base: string, maxEdge: number | null): string {
  const bare = base.replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
  return maxEdge ? `"${bare}-w${maxEdge}"` : `"${bare}"`;
}

/** Fallback validator for bytes with no store metadata (the Telegram proxy). */
function keyEtag(key: string, size: number): string {
  return `${key}:${size}`;
}

/** If-None-Match uses weak comparison: `W/"x"` matches `"x"` (RFC 9110). */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const bare = (value: string) => value.trim().replace(/^W\//, '');
  return header.split(',').some((candidate) => {
    const value = candidate.trim();
    return value === '*' || bare(value) === bare(etag);
  });
}

/**
 * Photo proxy route, mounted separately because <img> tags can't send the
 * initData header — it's passed as a query param and verified inline here. The
 * bot token never reaches the client; the Worker fetches the image and streams
 * it back.
 */
export function mealPhotoRoutes(botClientFactory: BotClientFactory = defaultBotClientFactory) {
  const app = new Hono<AppBindings>();

  // GET /api/meal-photo/:id
  //
  // An <img> cannot send headers, so it is authorised by what the browser attaches
  // on its own: Telegram initData in the query (inside Telegram), or else the
  // session / device cookie (a browser or the installed app). Either way the meal
  // must belong to the account it resolves to; nothing here widens who can read what.
  app.get('/:id', async (c) => {
    let userId: string | null = null;

    const initData = c.req.query('initData') ?? '';
    if (initData && c.env.TELEGRAM_BOT_TOKEN) {
      const verified = await verifyInitData(initData, c.env.TELEGRAM_BOT_TOKEN);
      if (verified.ok) userId = (await upsertUser(createDb(c.env.DB), verified.data.user)).id;
    }

    if (!userId) {
      const jar = readCookies(c.req.header('cookie'));
      const authDb = createAuthDb(c.env.DB);
      const deviceRaw = jar[cookies.device];
      const session = await findSessionUser(authDb, jar[cookies.session] ?? '');
      if (session) userId = session.id;
      else if (deviceRaw) {
        // Look up only: a photo request must never mint an account.
        const device = await findDeviceUser(authDb, await deviceLookupHash(deviceRaw));
        if (device) userId = device.id;
      }
    }
    if (!userId) return c.text('Unauthorized', 401);

    const mealsDb = createMealsDb(c.env.DB);
    const detail = await getMealDetail(mealsDb, c.req.param('id'), userId);
    if (!detail) return c.text('Not found', 404);

    // The PWA renders photos from a different origin than the API (Pages vs
    // workers.dev), so an <img> needs this header to be allowed at all.
    const cors = { 'access-control-allow-origin': '*' } as const;

    // `?w=` asks for a thumbnail: a JPEG with at most `w` px on the long edge.
    // No parameter means the stored original, untouched (the detail screen).
    // The hard ceiling keeps a caller from asking for an upscaled image.
    const requested = Number.parseInt(c.req.query('w') ?? '', 10);
    const maxEdge =
      Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_THUMB_EDGE) : null;

    // A thumbnail is a pure function of the stored bytes + width, so it can be
    // cached for a year without revalidation. The original keeps a day: the
    // detail screen should notice a replaced photo.
    const cacheControl = maxEdge
      ? 'private, max-age=31536000, immutable'
      : 'private, max-age=86400';

    const notModified = (etag: string) =>
      new Response(null, {
        status: 304,
        headers: { etag, 'cache-control': cacheControl, ...cors },
      });

    const respond = (bytes: Uint8Array, mime: string, etag: string) => {
      const resized = maxEdge ? resizeImage(bytes, mime, maxEdge) : null;
      const body = resized?.bytes ?? bytes;
      return new Response(body, {
        headers: {
          'content-type': resized?.mimeType ?? mime,
          // Explicit, so a browser can store the response without waiting for
          // a chunked stream to finish.
          'content-length': String(body.byteLength),
          etag,
          'cache-control': cacheControl,
          ...cors,
        },
      });
    };

    // 1) Bytes we own (Shortcut / PWA uploads). A conditional request only
    // needs `head`: no body download, no Photon resize. An unconditional one
    // goes straight to `get`, so a first view pays for one R2 read, not two.
    const store = r2Store(c.env.PHOTOS);
    if (store && detail.photoKey) {
      const ifNoneMatch = c.req.header('if-none-match');
      if (ifNoneMatch) {
        const meta = await store.head(detail.photoKey);
        if (meta) {
          const etag = photoEtag(meta.etag ?? keyEtag(detail.photoKey, meta.size), maxEdge);
          if (matchesEtag(ifNoneMatch, etag)) return notModified(etag);
        }
      }
      const stored = await store.get(detail.photoKey);
      if (stored) {
        const etag = photoEtag(stored.etag ?? keyEtag(detail.photoKey, stored.size), maxEdge);
        return respond(stored.bytes, stored.mime ?? 'image/jpeg', etag);
      }
    }

    // 2) Legacy fallback: bytes still live on Telegram behind a file_id.
    if (!detail.telegramFileId || !c.env.TELEGRAM_BOT_TOKEN) return c.text('Not found', 404);
    const bot = botClientFactory(c.env.TELEGRAM_BOT_TOKEN);
    const filePath = await bot.getFilePath(detail.telegramFileId);
    if (!filePath) return c.text('Not found', 404);
    const file = await bot.downloadFile(filePath);
    if (!file) return c.text('Not found', 404);

    const bytes = Uint8Array.from(atob(file.base64), (ch) => ch.charCodeAt(0));
    const etag = photoEtag(keyEtag(detail.telegramFileId, bytes.length), maxEdge);
    if (matchesEtag(c.req.header('if-none-match'), etag)) return notModified(etag);
    return respond(bytes, file.mimeType, etag);
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
export function parseTzOffset(raw: string | undefined): number {
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
