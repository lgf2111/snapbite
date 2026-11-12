import { type MealImage, resolveMeal } from '@snapbite/core';
import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  type ProviderFactory,
  ProviderSetupError,
  QuotaExceeded,
  defaultProviderFactory,
  resolveProviderForUser,
} from '../billing/provider.js';
import {
  createDeviceTokensDb,
  hashDeviceToken,
  resolveDeviceToken,
  touchDeviceToken,
} from '../db/deviceTokens.js';
import { describeError, logError } from '../db/errors.js';
import { countMealsSince, createMealsDb, saveMeal, setMealPhoto } from '../db/meals.js';
import { recordMealSave } from '../db/metrics.js';
import type { AppBindings } from '../env.js';
import { base64FromBytes, base64ToBytes, shrinkImage } from '../storage/images.js';
import { photoKey, r2Store } from '../storage/photos.js';
import { ALLOWED_MIME } from './meals.js';

const BEARER = /^Bearer\s+/i;

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

/*
 * The notification body is two lines, shaped like the in-app confirm card:
 *   17 kcal — Want Want milk candy
 *   P 0 g · C 3 g · F 0 g
 * Line 1 stays under 60 characters (the title is cut, never the kcal) and the whole
 * thing under 120, so iOS does not clip it.
 */
const MAX_LINE_1 = 59;

export interface Logged {
  kcal: number;
  label: string;
  macros: { proteinG: number; carbsG: number; fatG: number };
}

/** The analyser's meal name, else the first foods: never the whole ingredient list. */
function mealLabel(title: string | undefined, foods: string[]): string {
  return (title?.trim() || foods.slice(0, 2).join(', ')).replace(/\s+/g, ' ').trim();
}

export function oneLine({ kcal, label, macros }: Logged): string {
  const lead = `${Math.round(kcal)} kcal — `;
  const room = Math.max(0, MAX_LINE_1 - lead.length);
  const title = label.length > room ? `${label.slice(0, Math.max(0, room - 1)).trimEnd()}…` : label;
  const g = (n: number) => Math.round(n);
  return `${lead}${title}\nP ${g(macros.proteinG)} g · C ${g(macros.carbsG)} g · F ${g(macros.fatG)} g`;
}

type Reply =
  | { ok: true; logged: Logged; mealId: string; notice?: string }
  | { ok: false; message: string };

/**
 * Plain text by default (the Shortcut shows the body in a notification verbatim);
 * `?format=json` answers the same message, same status, as a structured object.
 */
function reply(c: Context<AppBindings>, r: Reply, status: ContentfulStatusCode = 200): Response {
  c.header('Cache-Control', 'no-store');
  if (c.req.query('format') === 'json') {
    return c.json(
      r.ok
        ? {
            ok: true,
            message: r.notice ? `${oneLine(r.logged)}\n${r.notice}` : oneLine(r.logged),
            mealId: r.mealId,
            label: r.logged.label,
            kcal: Math.round(r.logged.kcal),
            macros: {
              proteinG: Math.round(r.logged.macros.proteinG),
              carbsG: Math.round(r.logged.macros.carbsG),
              fatG: Math.round(r.logged.macros.fatG),
            },
            ...(r.notice ? { notice: r.notice } : {}),
          }
        : { ok: false, message: r.message },
      status,
    );
  }
  return c.body(
    r.ok ? `${oneLine(r.logged)}${r.notice ? `\n${r.notice}` : ''}` : r.message,
    status,
    {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  );
}

const fail = (c: Context<AppBindings>, message: string, status: ContentfulStatusCode) =>
  reply(c, { ok: false, message: `SnapBite: ${message}` }, status);

/** What went wrong with the analysis, in a sentence a person can act on. */
function analysisFailure(err: unknown): string {
  const kind = describeError(err).kind;
  if (kind === 'parse') return 'the photo was not readable, try again';
  if (kind === 'empty') return 'no meal detected in that photo';
  return 'the analysis failed, try again in a minute';
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
    if (!raw) return fail(c, 'missing device token', 401);
    const tokensDb = createDeviceTokensDb(c.env.DB);
    const resolved = await resolveDeviceToken(tokensDb, await hashDeviceToken(raw));
    if (!resolved) return fail(c, 'device token is invalid or revoked', 401);
    return c.text('pong');
  });

  app.post('/log', async (c) => {
    /* -------- identity -------- */
    const raw = readToken(c);
    if (!raw) {
      return fail(c, 'missing device token, create this request from the SnapBite Shortcut', 401);
    }
    const tokensDb = createDeviceTokensDb(c.env.DB);
    const resolved = await resolveDeviceToken(tokensDb, await hashDeviceToken(raw));
    if (!resolved) {
      return fail(c, 'device token is invalid or revoked, create a new one in Settings', 401);
    }
    await touchDeviceToken(tokensDb, resolved.tokenId);

    if (!c.env.ENCRYPTION_KEY) {
      return fail(c, 'the server is missing its encryption key', 500);
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
          return fail(c, 'send the photo as a form field named "photo"', 400);
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
        const body = (await c.req.json()) as {
          base64?: unknown;
          mimeType?: unknown;
          hint?: unknown;
        };
        base64 = typeof body.base64 === 'string' ? body.base64 : '';
        mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
        if (typeof body.hint === 'string' && body.hint.trim()) hint = body.hint.trim();
      } else {
        return fail(
          c,
          `unsupported Content-Type ${contentType}, send the photo as a form field named "photo" or a raw image body`,
          415,
        );
      }
    } catch {
      return fail(c, 'the photo was not readable, try again', 400);
    }

    if (!base64) return fail(c, 'the photo was not readable, try again', 400);
    if (!ALLOWED_MIME.has(mimeType)) {
      return fail(
        c,
        mimeType === 'image/heic'
          ? 'iOS sent a HEIC photo, add "Convert Image" to JPEG before the request'
          : `unsupported image type ${mimeType || 'unknown'}`,
        400,
      );
    }

    /* -------- shrink (downscale + re-encode) -------- */
    const shrunk = await shrinkImage(base64, mimeType);
    base64 = shrunk.base64;
    mimeType = shrunk.mimeType;

    /* -------- analyse + save -------- */
    const image: MealImage = { base64, mimeType: mimeType as MealImage['mimeType'] };
    try {
      const provider = await resolveProviderForUser(c.env.DB, c.env, resolved.userId, {
        providerFactory,
      });
      const analysis = await provider.analyzeMeal(image, hint ? { hint } : {});
      const meal = resolveMeal(analysis);

      const db = createMealsDb(c.env.DB);
      const isFirstMeal = (await countMealsSince(db, resolved.userId, 0)) === 0;
      const mealId = await saveMeal(db, {
        userId: resolved.userId,
        meal,
        aiProvider: provider.id,
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

      const { energyKcal, proteinG, carbsG, fatG } = meal.total;
      const label = mealLabel(
        meal.title,
        meal.foods.map((f) => f.food.name),
      );
      return reply(c, {
        ok: true,
        mealId,
        logged: { kcal: energyKcal, label, macros: { proteinG, carbsG, fatG } },
        ...(provider.notice ? { notice: provider.notice } : {}),
      });
    } catch (err) {
      if (err instanceof QuotaExceeded) {
        return fail(
          c,
          err.reason === 'no-access' ? 'add your AI key in Settings first' : err.userMessage,
          err.status,
        );
      }
      if (err instanceof ProviderSetupError) return fail(c, err.userMessage, 500);
      const desc = describeError(err);
      await logError(c.env.DB, {
        telegramUserId: resolved.telegramUserId,
        source: 'shortcut',
        kind: desc.kind ?? 'provider',
        status: 502,
        message: desc.message,
        detail: desc.detail ?? null,
      });
      return fail(c, analysisFailure(err), 502);
    }
  });

  return app;
}
