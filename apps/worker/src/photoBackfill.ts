import { countMealsNeedingPhotoBackfill, mealsNeedingPhotoBackfill } from './db/auth.js';
import { logError } from './db/errors.js';
import { canStorePhoto, createMealsDb, setMealPhotoById } from './db/meals.js';
import type { Env } from './env.js';
import { photoKey, r2Store } from './storage/photos.js';
import { TelegramBotClient } from './telegram/botClient.js';

/**
 * Copy Telegram-held meal photos into R2.
 *
 * Meals logged through the bot carry a `telegram_file_id` and no `photo_key`, so
 * their thumbnail is served by proxying the Bot API on every request (and breaks
 * the day that file stops resolving). This moves the bytes we already have into
 * the bucket, which is where every newer upload lives.
 *
 * Bounded and resumable: one batch per invocation, ordered newest first, and a
 * meal leaves the work queue the moment `photo_key` is set. A dead file is
 * recorded and skipped — one deleted Telegram photo must not stop the batch.
 */
export const MAX_BACKFILL_BATCH = 20;

/** The slice of the bot client the backfill needs; tests pass a fake. */
export interface BackfillBot {
  getFilePath(fileId: string): Promise<string | null>;
  downloadFile(filePath: string): Promise<{ base64: string; mimeType: string } | null>;
}

export interface BackfillFailure {
  id: string;
  reason: string;
}

export interface BackfillResult {
  /** Meals that had a Telegram file id and no stored photo when the run started. */
  pending: number;
  copied: number;
  failed: number;
  /** Still queued after this batch: run again until it reaches zero. */
  remaining: number;
  failures: BackfillFailure[];
  /** R2 object count around the batch, so a run can be checked against the bucket. */
  objects: { before: number; after: number };
}

/** Every object in the bucket (paginated). A few hundred here; cheap enough. */
async function countObjects(bucket: R2Bucket): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list(cursor ? { cursor } : {});
    count += page.objects.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return count;
}

/**
 * Runs one batch. Returns counts and the per-meal failures; never throws for a
 * single meal (a deleted file, a throttled download, a full account quota).
 */
export async function backfillTelegramPhotos(
  env: Env,
  opts: { limit?: number; bot?: BackfillBot } = {},
): Promise<BackfillResult> {
  const bucket = env.PHOTOS;
  const store = r2Store(bucket);
  if (!bucket || !store) throw new Error('PHOTOS binding is not configured');

  const limit = Math.min(Math.max(opts.limit ?? MAX_BACKFILL_BATCH, 1), MAX_BACKFILL_BATCH);
  const pending = await countMealsNeedingPhotoBackfill(env.DB);
  const objectsBefore = await countObjects(bucket);
  const rows = pending > 0 ? await mealsNeedingPhotoBackfill(env.DB, limit) : [];

  const failures: BackfillFailure[] = [];
  const fail = async (id: string, reason: string) => {
    failures.push({ id, reason });
    await logError(env.DB, {
      source: 'photo-backfill',
      kind: 'photo',
      message: `${id}: ${reason}`,
    });
  };

  let copied = 0;
  if (rows.length > 0) {
    if (!opts.bot && !env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    const bot = opts.bot ?? new TelegramBotClient(env.TELEGRAM_BOT_TOKEN ?? '');
    const mealsDb = createMealsDb(env.DB);

    for (const row of rows) {
      try {
        const path = await bot.getFilePath(row.telegramFileId);
        if (!path) {
          await fail(row.id, 'Telegram file no longer resolves');
          continue;
        }
        const file = await bot.downloadFile(path);
        if (!file) {
          await fail(row.id, 'Telegram download failed');
          continue;
        }
        const bytes = Uint8Array.from(atob(file.base64), (ch) => ch.charCodeAt(0));
        if (!(await canStorePhoto(mealsDb, row.userId, bytes.byteLength))) {
          await fail(row.id, 'Photo storage quota reached for this account');
          continue;
        }
        const key = photoKey(row.id);
        await store.put(key, bytes, file.mimeType);
        await setMealPhotoById(env.DB, row.id, key, file.mimeType, bytes.byteLength);
        copied += 1;
      } catch (err) {
        await fail(row.id, err instanceof Error ? err.message : String(err));
      }
    }
  }

  return {
    pending,
    copied,
    failed: failures.length,
    remaining: Math.max(pending - copied, 0),
    failures,
    objects: { before: objectsBefore, after: await countObjects(bucket) },
  };
}
