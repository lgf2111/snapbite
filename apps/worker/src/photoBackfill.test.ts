import { env } from 'cloudflare:test';
import { signInitData } from '@snapbite/core';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createMealsDb, getMealDetail } from './db/meals.js';
import { createDb, upsertUser } from './db/users.js';
import type { AppBindings } from './env.js';
import {
  type BackfillBot,
  type BackfillResult,
  MAX_BACKFILL_BATCH,
  backfillTelegramPhotos,
} from './photoBackfill.js';
import { adminRoutes } from './routes/admin.js';
import { photoKey } from './storage/photos.js';
import { photoJpeg, toBase64 } from './test/photos.js';

const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';
const JPEG = photoJpeg(8, 8);

/** A Telegram that serves the same 8×8 JPEG for every file id. */
function servingBot(over: Partial<BackfillBot> = {}): BackfillBot {
  return {
    getFilePath: async (fileId) => `photos/${fileId}.jpg`,
    downloadFile: async () => ({ base64: toBase64(JPEG), mimeType: 'image/jpeg' }),
    ...over,
  };
}

/**
 * A user + a meal row with (or without) a Telegram file id. The logged_at is in
 * the future and strictly increasing, so a row sorts ahead of anything another
 * test left queued: the batch is newest-first and only takes 20.
 */
let seedSeq = 0;
async function seedMeal(opts: {
  id: string;
  tgId: number;
  fileId?: string | null;
  photo?: { key: string; mime: string; bytes: number } | null;
}): Promise<{ userId: string }> {
  const user = await upsertUser(createDb(env.DB), { id: opts.tgId });
  await env.DB.prepare(
    `INSERT INTO meals (id, user_id, telegram_file_id, photo_key, photo_mime, photo_bytes, created_at, logged_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      opts.id,
      user.id,
      opts.fileId ?? null,
      opts.photo?.key ?? null,
      opts.photo?.mime ?? null,
      opts.photo?.bytes ?? null,
      Date.now(),
      Date.now() + 3_600_000 + seedSeq++,
    )
    .run();
  return { userId: user.id };
}

const row = (id: string) =>
  env.DB.prepare(
    'SELECT photo_key AS photoKey, photo_mime AS photoMime, photo_bytes AS photoBytes FROM meals WHERE id = ?',
  )
    .bind(id)
    .first<{ photoKey: string | null; photoMime: string | null; photoBytes: number | null }>();

const initFor = (tgId: number) =>
  signInitData(
    {
      user: JSON.stringify({ id: tgId, first_name: 'Ada' }),
      auth_date: String(Math.floor(Date.now() / 1000)),
    },
    BOT_TOKEN,
  );

describe('backfillTelegramPhotos', () => {
  it('copies a Telegram-held photo into R2 with its real size and mime', async () => {
    await seedMeal({ id: 'bf-copy', tgId: 8101, fileId: 'file-1' });

    const result = await backfillTelegramPhotos(env, { bot: servingBot() });

    const stored = await row('bf-copy');
    expect(stored?.photoKey).toBe(photoKey('bf-copy'));
    expect(stored?.photoMime).toBe('image/jpeg');
    expect(stored?.photoBytes).toBe(JPEG.byteLength);
    const object = await env.PHOTOS.get(photoKey('bf-copy'));
    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toBe('image/jpeg');
    const bytes = object ? new Uint8Array(await object.arrayBuffer()) : new Uint8Array();
    expect(bytes.byteLength).toBe(JPEG.byteLength);
    // Counts agree with each other, and the bucket grew by what was copied.
    expect(result.pending).toBe(result.copied + result.failed + result.remaining);
    expect(result.objects.after).toBe(result.objects.before + result.copied);
  });

  it('leaves a meal with no Telegram file id alone', async () => {
    await seedMeal({ id: 'bf-manual', tgId: 8102, fileId: null });

    await backfillTelegramPhotos(env, { bot: servingBot() });

    expect((await row('bf-manual'))?.photoKey).toBeNull();
    expect(await env.PHOTOS.get(photoKey('bf-manual'))).toBeNull();
  });

  it('skips a meal that already owns its bytes', async () => {
    await seedMeal({
      id: 'bf-owned',
      tgId: 8103,
      fileId: 'file-2',
      photo: { key: 'photos/bf-owned', mime: 'image/jpeg', bytes: 10 },
    });

    await backfillTelegramPhotos(env, { bot: servingBot() });

    // Untouched: the row keeps the key it had, and no second object appears.
    expect((await row('bf-owned'))?.photoKey).toBe('photos/bf-owned');
  });

  it('keeps going when one Telegram file no longer resolves', async () => {
    await seedMeal({ id: 'bf-dead', tgId: 8104, fileId: 'gone' });
    await seedMeal({ id: 'bf-live', tgId: 8105, fileId: 'live' });

    const result = await backfillTelegramPhotos(env, {
      bot: servingBot({
        getFilePath: async (fileId) => (fileId === 'gone' ? null : 'photos/live.jpg'),
      }),
    });

    // The dead file is recorded and left alone; the batch still finishes.
    expect(result.failures).toContainEqual({
      id: 'bf-dead',
      reason: 'Telegram file no longer resolves',
    });
    expect((await row('bf-dead'))?.photoKey).toBeNull();
    expect(await env.PHOTOS.get(photoKey('bf-dead'))).toBeNull();
    expect((await row('bf-live'))?.photoKey).toBe(photoKey('bf-live'));
  });

  it('keeps going when a download fails', async () => {
    await seedMeal({ id: 'bf-throttled', tgId: 8106, fileId: 'slow' });

    const result = await backfillTelegramPhotos(env, {
      bot: servingBot({ downloadFile: async () => null }),
    });

    expect(result.failures).toContainEqual({
      id: 'bf-throttled',
      reason: 'Telegram download failed',
    });
    expect((await row('bf-throttled'))?.photoKey).toBeNull();
  });

  it('makes the meal report a photo, and the photo route serves it from R2', async () => {
    const { userId } = await seedMeal({ id: 'bf-has-photo', tgId: 8107, fileId: 'file-3' });
    await backfillTelegramPhotos(env, { bot: servingBot() });

    const detail = await getMealDetail(createMealsDb(env.DB), 'bf-has-photo', userId);
    // The client mapper emits `previewUrl` on exactly this flag.
    expect(detail?.hasPhoto).toBe(true);
    expect(detail?.photoKey).toBe(photoKey('bf-has-photo'));

    // A bot that throws if called: after the copy the bytes are ours, so the
    // photo route must answer from R2 and never touch Telegram.
    const app = createApp({
      botClientFactory: () => {
        throw new Error('Telegram must not be used for a stored photo');
      },
    });
    const initData = await initFor(8107);
    const res = await app.request(
      `/api/meal-photo/bf-has-photo?initData=${encodeURIComponent(initData)}`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await res.arrayBuffer()).byteLength).toBe(JPEG.byteLength);
  });

  it('bounds one invocation and leaves the rest queued', async () => {
    for (let i = 0; i < 3; i++) {
      await seedMeal({ id: `bf-batch-${i}`, tgId: 8110 + i, fileId: `batch-${i}` });
    }

    const first = await backfillTelegramPhotos(env, { limit: 2, bot: servingBot() });

    expect(first.copied).toBe(2);
    expect(first.remaining).toBe(first.pending - 2);
    const left = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM meals WHERE id LIKE 'bf-batch-%' AND photo_key IS NULL",
    ).first<{ n: number }>();
    expect(left?.n).toBe(1);
  });
});

describe('POST /api/admin/backfill-photos', () => {
  const TOKEN = 'correct-horse-battery-staple';
  const withToken = { ...env, ADMIN_TOKEN: TOKEN };

  /** The admin routes only, with a bot we control. */
  function adminApp(bot: Partial<BackfillBot> = {}) {
    const fake = { ...servingBot(), ...bot };
    const app = new Hono<AppBindings>();
    app.route('/api/admin', adminRoutes({ delayMs: 0, backfillBot: fake }));
    return app;
  }

  const post = (
    token: string | null,
    body: unknown = {},
    app = adminApp(),
    e: object = withToken,
  ) =>
    app.request(
      '/api/admin/backfill-photos',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token === null ? {} : { 'x-admin-token': token }),
        },
        body: JSON.stringify(body),
      },
      e as typeof env,
    );

  it('401s without the admin token', async () => {
    await seedMeal({ id: 'bf-route-noauth', tgId: 8120, fileId: 'nope' });

    expect((await post(null)).status).toBe(401);
    expect((await post('wrong')).status).toBe(401);
    // Nothing was copied on the way to the refusal.
    expect((await row('bf-route-noauth'))?.photoKey).toBeNull();
  });

  it('503s when ADMIN_TOKEN is not configured at all', async () => {
    expect((await post(TOKEN, {}, adminApp(), env)).status).toBe(503);
  });

  it('rejects a batch larger than the cap', async () => {
    expect((await post(TOKEN, { limit: MAX_BACKFILL_BATCH + 1 })).status).toBe(400);
  });

  it('copies one bounded batch and reports what is left', async () => {
    await seedMeal({ id: 'bf-route-a', tgId: 8121, fileId: 'a' });
    await seedMeal({ id: 'bf-route-b', tgId: 8122, fileId: 'b' });

    const res = await post(TOKEN, { limit: 2 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as BackfillResult;
    expect(body.copied).toBe(2);
    expect(body.failures).toEqual([]);
    expect(body.pending).toBe(body.copied + body.failed + body.remaining);
    expect((await row('bf-route-a'))?.photoKey).toBe(photoKey('bf-route-a'));
    expect((await row('bf-route-b'))?.photoKey).toBe(photoKey('bf-route-b'));
  });
});
