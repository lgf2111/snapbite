import { type BotReply, createProvider, decryptSecret, photoLoggedReply, resolveMeal } from '@foodlog/core';
import { and, asc, eq, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { logError } from './db/errors.js';
import { createMealsDb, saveMeal } from './db/meals.js';
import { pendingPhotoRetries, type PendingPhotoRetryRow } from './db/schema.js';
import { createSettingsDb, getSettings } from './db/settings.js';
import type { Env } from './env.js';
import { primaryProviderChoice } from './routes/meals.js';
import { TelegramBotClient } from './telegram/botClient.js';

/** First delayed retry ~3 min after the failure; subsequent ~15 min later. */
const FIRST_DELAY_MS = 3 * 60 * 1000;
const NEXT_DELAY_MS = 15 * 60 * 1000;
/** Give up after this many cron attempts (§17: up to 2). */
const MAX_ATTEMPTS = 2;

function db(d1: D1Database) {
  return drizzle(d1, { schema: { pendingPhotoRetries } });
}

/** Enqueue a photo whose analysis hit a sustained overload, for a later retry. */
export async function enqueuePhotoRetry(
  d1: D1Database,
  input: {
    userId: string;
    telegramUserId: number;
    chatId: number;
    statusMessageId: number | null;
    fileId: string;
    caption: string;
  },
): Promise<void> {
  const now = Date.now();
  await db(d1)
    .insert(pendingPhotoRetries)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      statusMessageId: input.statusMessageId ?? null,
      fileId: input.fileId,
      caption: input.caption || null,
      attempts: 0,
      createdAt: now,
      nextAt: now + FIRST_DELAY_MS,
    });
}

/** How many pending retries are due now (used to skip work when idle). */
async function dueRetries(d1: D1Database, nowMs: number): Promise<PendingPhotoRetryRow[]> {
  return db(d1)
    .select()
    .from(pendingPhotoRetries)
    .where(lte(pendingPhotoRetries.nextAt, nowMs))
    .orderBy(asc(pendingPhotoRetries.nextAt))
    .limit(10);
}

async function deleteRetry(d1: D1Database, id: string): Promise<void> {
  await db(d1).delete(pendingPhotoRetries).where(eq(pendingPhotoRetries.id, id));
}

async function bumpRetry(d1: D1Database, id: string, attempts: number, nextAt: number): Promise<void> {
  await db(d1)
    .update(pendingPhotoRetries)
    .set({ attempts, nextAt })
    .where(and(eq(pendingPhotoRetries.id, id)));
}

/**
 * Cron entrypoint: re-analyzes photos that hit a transient overload earlier.
 * On success it saves the meal and edits the "busy" status message into the
 * result; on failure it backs off, and after {@link MAX_ATTEMPTS} it gives up
 * and edits the message into a final "couldn't log" note. Best-effort per row.
 */
export async function runPhotoRetries(env: Env, nowMs: number = Date.now()): Promise<number> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.ENCRYPTION_KEY) return 0;
  const rows = await dueRetries(env.DB, nowMs);
  if (rows.length === 0) return 0;

  const bot = new TelegramBotClient(env.TELEGRAM_BOT_TOKEN);
  const encryptionKey = env.ENCRYPTION_KEY;
  const miniAppUrl = env.MINI_APP_URL ?? '';
  let logged = 0;

  for (const row of rows) {
    try {
      const settingsDb = createSettingsDb(env.DB);
      const settings = await getSettings(settingsDb, row.userId);
      if (!settings?.apiKeyCiphertext || !settings?.apiKeyIv) {
        // No key anymore — nothing we can do; drop it quietly.
        await deleteRetry(env.DB, row.id);
        continue;
      }
      const apiKey = await decryptSecret(
        { ciphertext: settings.apiKeyCiphertext, iv: settings.apiKeyIv },
        encryptionKey,
      );

      const filePath = await bot.getFilePath(row.fileId);
      const file = filePath ? await bot.downloadFile(filePath) : null;
      if (!file) {
        // Photo no longer fetchable — give up on this one.
        await finishGiveUp(env, bot, row);
        continue;
      }

      const choice = primaryProviderChoice(settings, apiKey);
      const provider = createProvider({
        providerId: choice.provider,
        apiKey: choice.apiKey,
        ...(choice.model ? { model: choice.model } : {}),
        ...(choice.baseUrl ? { baseUrl: choice.baseUrl } : {}),
        ...(choice.supportsDetail != null ? { supportsDetail: choice.supportsDetail } : {}),
      });
      const image = { base64: file.base64, mimeType: file.mimeType as 'image/jpeg' };
      const analysis = await provider.analyzeMeal(image, row.caption ? { hint: row.caption } : {});
      const meal = resolveMeal(analysis);

      const reply = photoLoggedReply(
        meal.foods.map((f) => f.food.name),
        {
          energyKcal: meal.total.energyKcal,
          proteinG: meal.total.proteinG,
          carbsG: meal.total.carbsG,
          fatG: meal.total.fatG,
        },
        { miniAppUrl },
      );
      const confirmId = await editOrSend(bot, row.chatId, row.statusMessageId, reply);

      const mealsDb = createMealsDb(env.DB);
      await saveMeal(mealsDb, {
        userId: row.userId,
        meal,
        telegramFileId: row.fileId,
        aiProvider: settings.aiProvider,
        telegramChatId: row.chatId,
        telegramMessageId: confirmId,
      });
      await deleteRetry(env.DB, row.id);
      logged += 1;
    } catch (err) {
      // Still failing — back off, and give up past the cap.
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await finishGiveUp(env, bot, row);
      } else {
        await bumpRetry(env.DB, row.id, attempts, nowMs + NEXT_DELAY_MS);
      }
      await logError(env.DB, {
        telegramUserId: row.telegramUserId,
        source: 'photo-retry',
        kind: 'overload',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return logged;
}

/** Edits the status message into a final "couldn't log" note and drops the row. */
async function finishGiveUp(
  env: Env,
  bot: TelegramBotClient,
  row: PendingPhotoRetryRow,
): Promise<void> {
  await editOrSend(bot, row.chatId, row.statusMessageId, {
    text: "Sorry — the AI stayed busy and I couldn't log that photo. Please send it again, or set a fallback provider in SnapBite → Settings so this doesn't happen.",
  });
  await deleteRetry(env.DB, row.id);
}

/** Edit the message in place when we have an id; else send fresh. Returns the id. */
async function editOrSend(
  bot: TelegramBotClient,
  chatId: number,
  messageId: number | null,
  reply: BotReply,
): Promise<number | null> {
  if (messageId != null) {
    const ok = await bot.editMessageText(chatId, messageId, reply);
    if (ok) return messageId;
  }
  const sent = await bot.sendMessage(chatId, reply);
  return sent.messageId;
}
