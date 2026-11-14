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
import { beginErrorLog, describeError, finishErrorLog, logError } from '../db/errors.js';
import {
  canStorePhoto,
  countMealsSince,
  createMealsDb,
  saveMeal,
  setMealPhoto,
} from '../db/meals.js';
import { recordMealSave } from '../db/metrics.js';
import { consumeTokenRequest } from '../db/tokenUsage.js';
import type { AppBindings } from '../env.js';
import { base64Bytes, base64FromBytes, base64ToBytes } from '../storage/images.js';
import { photoKey, r2Store } from '../storage/photos.js';
import { ALLOWED_MIME } from './meals.js';

const BEARER = /^Bearer\s+/i;

/**
 * The Shortcut resizes before sending, so a photo larger than this is a
 * misconfigured shortcut, not something to decode. Rejecting it before the
 * body is parsed keeps a 1102 from costing anything.
 */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Multipart boundaries and field headers ride along with the photo. */
const MULTIPART_SLACK_BYTES = 64 * 1024;
/** Base64 inflates bytes by 4/3; leave room for the JSON envelope and a hint. */
const MAX_JSON_BODY_BYTES = 4 * 1024 * 1024;
const TOO_BIG = 'that photo is too big — set Resize Image to 1024 in the shortcut';

/** Thrown by {@link readAtMost} as soon as a body crosses its hard limit. */
class BodyTooLargeError extends Error {}

/**
 * Reads a request body with a byte counter, stopping the moment it crosses
 * `limit`. `Content-Length` is only an early hint: a chunked upload has none and
 * a malicious client can lie. The reader is cancelled on the offending chunk so
 * the rest of the body is never pulled into the Worker.
 */
async function readAtMost(req: Request, limit: number): Promise<Uint8Array> {
  const declared = Number.parseInt(req.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > limit) throw new BodyTooLargeError();
  if (!req.body) return new Uint8Array();

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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

const tooBig = (c: Context<AppBindings>) => fail(c, TOO_BIG, 413);

/**
 * The per-request budget breakdown stored in `error_logs.detail`. Timings are
 * `Date.now()` deltas: `performance.now()` is quantized to 10 ms in workerd.
 * `ms_shrink` stays in the shape (always 0) so old and new rows compare.
 */
function stageTimings(
  bytesIn: number,
  msBase64: number,
  msAi: number,
  msTotal: number,
): Record<string, number> {
  return {
    bytes_in: bytesIn,
    ms_shrink: 0,
    ms_ai: msAi,
    ms_total: msTotal,
    ms_base64: msBase64,
  };
}

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
    const startedAt = Date.now();
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
    // Per-token, not per-IP: carrier NAT makes an IP limit useless on mobile,
    // and the token already identifies the caller. 30/hour is generous for a
    // person logging meals and tight for a script.
    if (!(await consumeTokenRequest(c.env.DB, resolved.tokenId))) {
      return fail(c, 'too many requests, try again later', 429);
    }
    await touchDeviceToken(tokensDb, resolved.tokenId);

    if (!c.env.ENCRYPTION_KEY) {
      return fail(c, 'the server is missing its encryption key', 500);
    }

    /* -------- image -------- */
    let base64 = '';
    let mimeType = '';
    let hint: string | undefined;
    /** The bytes as received, when they came as a file/body, so storage skips a re-decode. */
    let photoBytes: Uint8Array | null = null;
    let msBase64 = 0;

    const contentType = c.req.header('content-type') ?? '';
    try {
      if (contentType.includes('multipart/form-data')) {
        const bytes = await readAtMost(c.req.raw, MAX_UPLOAD_BYTES + MULTIPART_SLACK_BYTES);
        const form = await new Response(bytes, {
          headers: { 'content-type': contentType },
        }).formData();
        const field = form.get('photo') as unknown;
        if (field == null || typeof field === 'string') {
          return fail(c, 'send the photo as a form field named "photo"', 400);
        }
        const file = field as File;
        if (file.size > MAX_UPLOAD_BYTES) return tooBig(c);
        mimeType = file.type || 'image/jpeg';
        photoBytes = new Uint8Array(await file.arrayBuffer());
        const b64Start = Date.now();
        base64 = base64FromBytes(photoBytes);
        msBase64 = Date.now() - b64Start;
        const h = form.get('hint');
        if (typeof h === 'string' && h.trim()) hint = h.trim();
      } else if (contentType.startsWith('image/') || contentType.includes('octet-stream')) {
        // Shortcuts' "Request Body: File" sends the bytes directly.
        const bytes = await readAtMost(c.req.raw, MAX_UPLOAD_BYTES);
        photoBytes = bytes;
        mimeType = sniffMime(bytes) ?? contentType.split(';')[0] ?? '';
        const b64Start = Date.now();
        base64 = base64FromBytes(bytes);
        msBase64 = Date.now() - b64Start;
      } else if (contentType.includes('application/json') || contentType === '') {
        const bytes = await readAtMost(c.req.raw, MAX_JSON_BODY_BYTES);
        const body = JSON.parse(new TextDecoder().decode(bytes)) as {
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
    } catch (err) {
      if (err instanceof BodyTooLargeError) return tooBig(c);
      return fail(c, 'the photo was not readable, try again', 400);
    }

    if (!base64) return fail(c, 'the photo was not readable, try again', 400);
    const bytesIn = base64Bytes(base64);
    if (bytesIn > MAX_UPLOAD_BYTES) return tooBig(c);
    if (!ALLOWED_MIME.has(mimeType)) {
      return fail(
        c,
        mimeType === 'image/heic'
          ? 'iOS sent a HEIC photo, add "Convert Image" to JPEG before the request'
          : `unsupported image type ${mimeType || 'unknown'}`,
        400,
      );
    }

    /* -------- analyse + save -------- */
    const image: MealImage = { base64, mimeType: mimeType as MealImage['mimeType'] };
    let logId: string | null = null;
    let aiStart: number | null = null;
    try {
      const provider = await resolveProviderForUser(c.env.DB, c.env, resolved.userId, {
        providerFactory,
      });
      logId = await beginErrorLog(c.env.DB, {
        telegramUserId: resolved.telegramUserId,
        source: 'shortcut',
        kind: 'ai_started',
        message: 'analysis started',
        detail: JSON.stringify({ bytes_in: bytesIn, mime: mimeType }),
      });
      aiStart = Date.now();
      const analysis = await provider.analyzeMeal(image, hint ? { hint } : {});
      const msAi = Date.now() - aiStart;

      // Persist that the AI stage returned, so a kill during the save below is
      // distinguishable from one during the call.
      if (logId) {
        await finishErrorLog(c.env.DB, logId, {
          kind: 'ai_done',
          status: 200,
          message: 'analysis finished',
          detail: JSON.stringify(stageTimings(bytesIn, msBase64, msAi, Date.now() - startedAt)),
        });
      }

      const meal = resolveMeal(analysis);

      const db = createMealsDb(c.env.DB);
      const isFirstMeal = (await countMealsSince(db, resolved.userId, 0)) === 0;
      const mealId = await saveMeal(db, {
        userId: resolved.userId,
        meal,
        aiProvider: provider.id,
      });

      // Store the bytes we were given, so the app can show the photo. Best
      // effort: a storage failure must not lose an otherwise-logged meal, and
      // a user past the R2 quota still gets the meal (just no stored photo).
      const store = r2Store(c.env.PHOTOS);
      if (store) {
        try {
          const bytes = photoBytes ?? base64ToBytes(base64);
          if (await canStorePhoto(db, resolved.userId, bytes.byteLength)) {
            const key = photoKey(mealId);
            await store.put(key, bytes, mimeType);
            await setMealPhoto(db, mealId, resolved.userId, key, mimeType, bytes.byteLength);
          }
        } catch (err) {
          console.error('[shortcut] photo store failed', err);
        }
      }
      if (resolved.telegramUserId != null) {
        await recordMealSave(c.env.DB, resolved.telegramUserId, isFirstMeal).catch(() => {});
      }

      if (logId) {
        await finishErrorLog(c.env.DB, logId, {
          kind: 'completed',
          status: 200,
          message: 'meal saved',
          detail: JSON.stringify(stageTimings(bytesIn, msBase64, msAi, Date.now() - startedAt)),
        });
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
      const msAi = aiStart == null ? 0 : Date.now() - aiStart;
      const total = Date.now() - startedAt;
      const desc = describeError(err);
      const detail = JSON.stringify({
        ...stageTimings(bytesIn, msBase64, msAi, total),
        error: desc.detail,
      });

      if (err instanceof QuotaExceeded) {
        if (logId) {
          await finishErrorLog(c.env.DB, logId, {
            kind: 'quota',
            status: err.status,
            message: err.userMessage,
            detail,
          });
        }
        return fail(
          c,
          err.reason === 'no-access' ? 'add your AI key in Settings first' : err.userMessage,
          err.status,
        );
      }
      if (err instanceof ProviderSetupError) {
        if (logId) {
          await finishErrorLog(c.env.DB, logId, {
            kind: 'setup',
            status: 500,
            message: err.userMessage,
            detail,
          });
        }
        return fail(c, err.userMessage, 500);
      }
      if (logId) {
        await finishErrorLog(c.env.DB, logId, {
          kind: desc.kind ?? 'provider',
          status: 502,
          message: desc.message,
          detail,
        });
      } else {
        // The start row could not be written; keep the old single-shot log so
        // the failure is not lost entirely.
        await logError(c.env.DB, {
          telegramUserId: resolved.telegramUserId,
          source: 'shortcut',
          kind: desc.kind ?? 'provider',
          status: 502,
          message: desc.message,
          detail: desc.detail ?? null,
        });
      }
      return fail(c, analysisFailure(err), 502);
    }
  });

  return app;
}
