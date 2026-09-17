import {
  type BotReply,
  createProvider,
  decryptSecret,
  parseUpdate,
  photoLoggedReply,
  replyForCommand,
  resolveMeal,
  type TelegramUpdate,
} from '@foodlog/core';
import { type Context, Hono } from 'hono';
import { createMealsDb, saveMeal } from '../db/meals.js';
import { createSettingsDb, getSettings } from '../db/settings.js';
import { createDb, upsertUser } from '../db/users.js';
import type { AppBindings } from '../env.js';
import { TelegramBotClient } from '../telegram/botClient.js';
import type { ProviderFactory } from './meals.js';

/** The bot-client surface the webhook uses (so tests can mock just these). */
export interface BotClient {
  sendMessage(chatId: number, reply: BotReply): Promise<void>;
  getFilePath(fileId: string): Promise<string | null>;
  downloadFile(filePath: string): Promise<{ base64: string; mimeType: string } | null>;
}

/** Injectable bot-client factory so tests can supply a mock (no network). */
export type BotClientFactory = (token: string) => BotClient;

const defaultBotClientFactory: BotClientFactory = (token) => new TelegramBotClient(token);

const defaultProviderFactory: ProviderFactory = ({ apiKey, provider, model }) =>
  createProvider({ providerId: provider, apiKey, ...(model ? { model } : {}) });

/** Header Telegram sends with the configured secret on each webhook call. */
const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

export interface WebhookDeps {
  botClientFactory?: BotClientFactory;
  providerFactory?: ProviderFactory;
}

/**
 * Telegram webhook. Verifies the shared secret, parses the update, and either
 * replies to a command or logs a photo sent straight to the bot chat.
 * Unauthenticated by initData — guarded by the secret token header.
 */
export function webhookRoutes(deps: WebhookDeps = {}) {
  const botClientFactory = deps.botClientFactory ?? defaultBotClientFactory;
  const providerFactory = deps.providerFactory ?? defaultProviderFactory;
  const app = new Hono<AppBindings>();

  app.post('/', async (c) => {
    const expected = c.env.TELEGRAM_WEBHOOK_SECRET;
    if (expected) {
      const got = c.req.header(SECRET_HEADER);
      if (got !== expected) return c.json({ error: 'Forbidden' }, 403);
    }

    let update: TelegramUpdate;
    try {
      update = await c.req.json();
    } catch {
      return c.json({ ok: true });
    }

    const parsed = parseUpdate(update);
    if (!parsed || !c.env.TELEGRAM_BOT_TOKEN) return c.json({ ok: true });

    const bot = botClientFactory(c.env.TELEGRAM_BOT_TOKEN);
    const miniAppUrl = c.env.MINI_APP_URL ?? '';

    // Photo sent to the bot -> analyze and auto-log.
    if (parsed.photoFileId && parsed.fromId != null) {
      try {
        await handlePhoto(c, bot, providerFactory, {
          fileId: parsed.photoFileId,
          fromId: parsed.fromId,
          chatId: parsed.chatId,
          caption: parsed.caption,
        });
      } catch (err) {
        const e = err as { message?: string; kind?: string; status?: number; cause?: unknown };
        // Log rich detail for `wrangler tail`.
        console.error('photo log failed', {
          message: e.message,
          kind: e.kind,
          status: e.status,
          cause: typeof e.cause === 'string' ? e.cause : undefined,
        });
        try {
          await bot.sendMessage(parsed.chatId, { text: friendlyPhotoError(e) });
        } catch {
          /* ignore */
        }
      }
      return c.json({ ok: true });
    }

    // Otherwise treat as a command / text message.
    const reply = replyForCommand(parsed, { miniAppUrl });
    if (reply) {
      try {
        await bot.sendMessage(parsed.chatId, reply);
      } catch (err) {
        console.error('sendMessage failed', err);
      }
    }
    return c.json({ ok: true });
  });

  return app;
}

/** Extract a human message from a provider error body ({error:{message}}). */
function providerMessage(cause: unknown): string | undefined {
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

interface ProviderErrorLike {
  message?: string;
  kind?: string;
  status?: number;
  cause?: unknown;
}

/**
 * Turns a provider error into a short, friendly chat message. The two common
 * cases with the free Gemini tier get tailored guidance:
 * - 429 (quota/rate limit): daily free-tier cap or per-minute rate.
 * - 503 (overloaded): transient demand spike, retry shortly.
 * Everything else falls back to the provider's own message.
 */
function friendlyPhotoError(e: ProviderErrorLike): string {
  const raw = providerMessage(e.cause) ?? e.message ?? '';
  if (e.status === 429 || /quota|rate limit|resource_exhausted/i.test(raw)) {
    return (
      "Sorry — your AI provider's rate limit was hit. On the free tier this is usually a daily " +
      'cap or a short per-minute limit. Wait a bit and send the photo again, or switch model/' +
      'provider in FoodLog → Settings.'
    );
  }
  if (e.status === 503 || /overloaded|high demand|unavailable/i.test(raw)) {
    return 'Sorry — the AI model is busy right now (a temporary demand spike). Please send the photo again in a moment.';
  }
  return `Sorry — couldn't log that photo: ${raw || 'unknown error'}`;
}

interface PhotoJob {
  fileId: string;
  fromId: number;
  chatId: number;
  caption: string;
}

/** Downloads the photo, runs the pipeline with the user's key, saves, and replies. */
async function handlePhoto(
  c: Context<AppBindings>,
  bot: BotClient,
  providerFactory: ProviderFactory,
  job: PhotoJob,
): Promise<void> {
  const { fileId, fromId, chatId, caption } = job;
  const miniAppUrl = c.env.MINI_APP_URL ?? '';

  // Resolve (or create) the app user for this Telegram id.
  const userDb = createDb(c.env.DB);
  const user = await upsertUser(userDb, { id: fromId });

  // Need the user's encrypted key.
  if (!c.env.ENCRYPTION_KEY) {
    await bot.sendMessage(chatId, { text: 'Server not configured for analysis yet.' });
    return;
  }
  const settingsDb = createSettingsDb(c.env.DB);
  const settings = await getSettings(settingsDb, user.id);
  if (!settings?.apiKeyCiphertext || !settings?.apiKeyIv) {
    await bot.sendMessage(chatId, {
      text: 'Add your AI key first: open FoodLog → Settings, then send the photo again.',
      ...(miniAppUrl
        ? {
            replyMarkup: {
              inline_keyboard: [[{ text: '⚙️ Open FoodLog', web_app: { url: miniAppUrl } }]],
            },
          }
        : {}),
    });
    return;
  }

  const apiKey = await decryptSecret(
    { ciphertext: settings.apiKeyCiphertext, iv: settings.apiKeyIv },
    c.env.ENCRYPTION_KEY,
  );

  // Download the image bytes from Telegram, analyze, and discard.
  const filePath = await bot.getFilePath(fileId);
  if (!filePath) {
    await bot.sendMessage(chatId, { text: 'Could not fetch that photo from Telegram.' });
    return;
  }
  const file = await bot.downloadFile(filePath);
  if (!file) {
    await bot.sendMessage(chatId, { text: 'Could not download that photo.' });
    return;
  }

  const provider = providerFactory({
    apiKey,
    provider: settings.aiProvider,
    model: settings.aiModel,
  });
  const image = { base64: file.base64, mimeType: file.mimeType as 'image/jpeg' };
  const opts = caption ? { hint: caption } : {};

  // A 503 (model overloaded) is usually a transient demand spike — retry once
  // after a short backoff before giving up. Quota/other errors are not retried.
  let analysis: Awaited<ReturnType<typeof provider.analyzeMeal>>;
  try {
    analysis = await provider.analyzeMeal(image, opts);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 503) {
      await new Promise((r) => setTimeout(r, 1500));
      analysis = await provider.analyzeMeal(image, opts);
    } else {
      throw err;
    }
  }
  const meal = resolveMeal(analysis);

  // Persist, keeping the Telegram file_id so the photo can be shown later.
  const mealsDb = createMealsDb(c.env.DB);
  await saveMeal(mealsDb, { userId: user.id, meal, telegramFileId: fileId });

  const foods = meal.foods.map((f) => f.food.name);
  await bot.sendMessage(chatId, photoLoggedReply(foods, meal.total.energyKcal, { miniAppUrl }));
}
