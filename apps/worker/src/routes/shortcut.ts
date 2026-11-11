import { type MealImage, decryptSecret, resolveMeal } from '@snapbite/core';
import { type Context, Hono } from 'hono';
import {
  createDeviceTokensDb,
  hashDeviceToken,
  resolveDeviceToken,
  touchDeviceToken,
} from '../db/deviceTokens.js';
import { describeError, logError } from '../db/errors.js';
import { countMealsSince, createMealsDb, saveMeal, setMealPhoto } from '../db/meals.js';
import { recordMealSave } from '../db/metrics.js';
import { createSettingsDb, getSettings } from '../db/settings.js';
import { photoKey, r2Store } from '../storage/photos.js';
import type { AppBindings } from '../env.js';
import {
  ALLOWED_MIME,
  type ProviderFactory,
  defaultProviderFactory,
  primaryProviderChoice,
} from './meals.js';

const BEARER = /^Bearer\s+/i;

function base64FromBytes(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  // Chunked so a large photo doesn't blow the argument limit of fromCharCode.
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Image type from magic bytes — Shortcuts often sends octet-stream. */
function sniffMime(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  const brand = String.fromCharCode(...b.slice(4, 12));
  if (brand.startsWith('ftyp') && /heic|heix|hevc|heif|mif1/.test(brand)) return 'image/heic';
  return null;
}

/**
 * Reads the device token from `Authorization: Bearer …` or `?token=…`.
 * Whitespace is stripped because a token copied out of a chat message often
 * carries a trailing newline, which makes the HTTP header invalid and the
 * request die at the transport layer ("network connection was lost").
 */
function readToken(c: Context<AppBindings>): string {
  const header = (c.req.header('authorization') ?? '').replace(BEARER, '');
  const query = c.req.query('token') ?? '';
  return (header || query).replace(/\s+/g, '');
}

/**
 * Downscale + re-encode a photo before it is stored or analysed.
 *
 * Phones upload 3–6 MB originals. We keep the longest edge at MAX_EDGE px and
 * encode JPEG in QUALITY_STEPS until the result fits MAX_BYTES, so both the AI
 * payload and the R2 object stay small. Uses the Workers-native
 * `createImageBitmap` + `OffscreenCanvas`, so there is no extra dependency.
 * Any failure falls back to the original bytes — storage must never lose a meal.
 */
const MAX_EDGE = 1600;
const MAX_BYTES = 400 * 1024;
const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.5, 0.42];

interface CompressedImage {
  base64: string;
  mimeType: string;
  bytes: number;
}

async function shrinkImage(base64: string, mimeType: string): Promise<CompressedImage> {
  const original: CompressedImage = {
    base64,
    mimeType,
    bytes: Math.floor((base64.length * 3) / 4),
  };
  // Already small, or a format the decode path may not handle in this runtime.
  if (original.bytes <= MAX_BYTES || !/^image\/(jpeg|png|webp)$/.test(mimeType)) return original;
  // The Workers runtime provides both of these, but @cloudflare/workers-types
  // doesn't declare them yet — narrow casts keep tsc honest without `any`.
  const canvasCtor = (globalThis as unknown as {
    OffscreenCanvas?: new (w: number, h: number) => {
      getContext(t: '2d'): { drawImage(img: unknown, x: number, y: number, w: number, h: number): void } | null;
      convertToBlob(o: { type: string; quality?: number }): Promise<Blob>;
    };
  }).OffscreenCanvas;
  const decode = (globalThis as unknown as {
    createImageBitmap?: (src: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
  }).createImageBitmap;
  if (!canvasCtor || !decode) return original;

  try {
    const raw = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    const bitmap = await decode(new Blob([raw], { type: mimeType }));
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new canvasCtor(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    let blob: Blob | null = null;
    for (const quality of QUALITY_STEPS) {
      const attempt: Blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      blob = attempt;
      if (attempt.size <= MAX_BYTES) break;
    }
    if (!blob || blob.size >= original.bytes) return original;

    const out = new Uint8Array(await blob.arrayBuffer());
    return { base64: base64FromBytes(out.buffer as ArrayBuffer), mimeType: 'image/jpeg', bytes: out.length };
  } catch {
    return original;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function oneLine(foods: string[], kcal: number): string {
  const shown = foods.slice(0, 3).join(', ');
  const extra = foods.length > 3 ? ` +${foods.length - 3} more` : '';
  return `Logged ${Math.round(kcal)} kcal — ${shown}${extra}`;
}

/**
 * Capture endpoint for surfaces that cannot send Telegram initData.
 *
 * `POST /api/shortcut/log` with `Authorization: Bearer sb_…` and either
 *   - multipart/form-data with a `photo` file, or
 *   - JSON `{ base64, mimeType, hint? }`
 *
 * Analyses the photo with the user's BYOK key, saves the meal, and answers in
 * plain text so an iOS Shortcut can show the result directly in a notification.
 * Deliberately one call: the Shortcut has no second step to chain.
 */
export function shortcutRoutes(providerFactory: ProviderFactory = defaultProviderFactory) {
  const app = new Hono<AppBindings>();

  // Cheap connectivity probe for a half-built Shortcut: proves the URL, the
  // token and the network path before the photo pipeline is involved.
  app.get('/ping', async (c) => {
    const raw = readToken(c);
    if (!raw) return c.text('Missing device token.', 401);
    const tokensDb = createDeviceTokensDb(c.env.DB);
    const resolved = await resolveDeviceToken(tokensDb, await hashDeviceToken(raw));
    if (!resolved) return c.text('Device token is invalid or revoked.', 401);
    return c.text('pong');
  });

  app.post('/log', async (c) => {
    /* -------- identity -------- */
    const raw = readToken(c);
    if (!raw) {
      return c.text('Missing device token. Create this request from the SnapBite Shortcut.', 401);
    }
    const tokensDb = createDeviceTokensDb(c.env.DB);
    const resolved = await resolveDeviceToken(tokensDb, await hashDeviceToken(raw));
    if (!resolved) {
      return c.text('Device token is invalid or revoked. Send /token to the SnapBite bot for a new one.', 401);
    }
    await touchDeviceToken(tokensDb, resolved.tokenId);

    if (!c.env.ENCRYPTION_KEY) {
      return c.text('Server is missing its encryption key.', 500);
    }

    /* -------- image -------- */
    let base64 = '';
    let mimeType = '';
    let hint: string | undefined;

    const contentType = c.req.header('content-type') ?? '';
    try {
      if (contentType.includes('multipart/form-data')) {
        const form = await c.req.formData();
        const field = form.get('photo') as unknown;
        if (field == null || typeof field === 'string') {
          return c.text('Send the photo as a form field named "photo".', 400);
        }
        const file = field as File;
        mimeType = file.type || 'image/jpeg';
        base64 = base64FromBytes(await file.arrayBuffer());
        const h = form.get('hint');
        if (typeof h === 'string' && h.trim()) hint = h.trim();
      } else if (contentType.startsWith('image/') || contentType.includes('octet-stream')) {
        // Shortcuts' "Request Body: File" sends the bytes directly.
        const bytes = new Uint8Array(await c.req.arrayBuffer());
        mimeType = sniffMime(bytes) ?? contentType.split(';')[0] ?? '';
        base64 = base64FromBytes(bytes.buffer as ArrayBuffer);
      } else if (contentType.includes('application/json') || contentType === '') {
        const body = (await c.req.json()) as { base64?: unknown; mimeType?: unknown; hint?: unknown };
        base64 = typeof body.base64 === 'string' ? body.base64 : '';
        mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
        if (typeof body.hint === 'string' && body.hint.trim()) hint = body.hint.trim();
      } else {
        return c.text(
          `Unsupported Content-Type: ${contentType}. Send the photo as a form field named "photo", or as a raw image body.`,
          415,
        );
      }
    } catch {
      return c.text('Could not read the request body.', 400);
    }

    if (!base64) return c.text('No image in the request.', 400);
    if (!ALLOWED_MIME.has(mimeType)) {
      return c.text(
        mimeType === 'image/heic'
          ? 'iOS sent a HEIC photo. In the Shortcut, add "Convert Image" to JPEG before the request.'
          : `Unsupported image type: ${mimeType || 'unknown'}.`,
        400,
      );
    }

    /* -------- shrink (downscale + re-encode) -------- */
    const shrunk = await shrinkImage(base64, mimeType);
    base64 = shrunk.base64;
    mimeType = shrunk.mimeType;

    /* -------- key -------- */
    const settings = await getSettings(createSettingsDb(c.env.DB), resolved.userId);
    if (!settings?.apiKeyCiphertext || !settings?.apiKeyIv) {
      return c.text('Add your AI key in SnapBite first (Settings → AI provider).', 400);
    }

    let apiKey: string;
    try {
      apiKey = await decryptSecret(
        { ciphertext: settings.apiKeyCiphertext, iv: settings.apiKeyIv },
        c.env.ENCRYPTION_KEY,
      );
    } catch {
      return c.text('Could not decrypt your saved AI key.', 500);
    }

    /* -------- analyse + save -------- */
    const image: MealImage = { base64, mimeType: mimeType as MealImage['mimeType'] };
    try {
      const provider = providerFactory(primaryProviderChoice(settings, apiKey));
      const analysis = await provider.analyzeMeal(image, hint ? { hint } : {});
      const meal = resolveMeal(analysis);

      const db = createMealsDb(c.env.DB);
      const isFirstMeal = (await countMealsSince(db, resolved.userId, 0)) === 0;
      const mealId = await saveMeal(db, {
        userId: resolved.userId,
        meal,
        aiProvider: settings.aiProvider,
      });

      // Store the bytes we were given, so the app can show the photo. Best
      // effort: a storage failure must not lose an otherwise-logged meal.
      const store = r2Store(c.env.PHOTOS);
      if (store) {
        try {
          const key = photoKey(mealId);
          await store.put(key, new Uint8Array(base64ToBytes(base64)), mimeType);
          await setMealPhoto(db, mealId, resolved.userId, key, mimeType);
        } catch (err) {
          console.error('[shortcut] photo store failed', err);
        }
      }
      if (resolved.telegramUserId != null) {
        await recordMealSave(c.env.DB, resolved.telegramUserId, isFirstMeal).catch(() => {});
      }

      const foods = meal.foods.map((f) => f.food.name);
      return c.text(oneLine(foods, meal.total.energyKcal));
    } catch (err) {
      const desc = describeError(err);
      await logError(c.env.DB, {
        telegramUserId: resolved.telegramUserId,
        source: 'shortcut',
        kind: desc.kind ?? 'provider',
        status: 502,
        message: desc.message,
        detail: desc.detail ?? null,
      });
      return c.text(`Analysis failed: ${desc.message}`, 502);
    }
  });

  return app;
}
