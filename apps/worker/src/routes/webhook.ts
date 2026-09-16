import { parseUpdate, replyForCommand, type TelegramUpdate } from '@foodlog/core';
import { Hono } from 'hono';
import type { AppBindings } from '../env.js';
import { TelegramBotClient } from '../telegram/botClient.js';

/** Injectable bot-client factory so tests can supply a mock (no network). */
export type BotClientFactory = (token: string) => Pick<TelegramBotClient, 'sendMessage'>;

const defaultBotClientFactory: BotClientFactory = (token) => new TelegramBotClient(token);

/** Header Telegram sends with the configured secret on each webhook call. */
const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * Telegram webhook. Verifies the shared secret (when configured), parses the
 * update, and replies to commands with a Mini App launch button. Reuses the
 * pure bot logic in `@foodlog/core`.
 *
 * This route is intentionally unauthenticated by initData — it's called by
 * Telegram's servers, guarded by the secret token header instead.
 */
export function webhookRoutes(botClientFactory: BotClientFactory = defaultBotClientFactory) {
  const app = new Hono<AppBindings>();

  app.post('/', async (c) => {
    // Verify the secret token if one is configured.
    const expected = c.env.TELEGRAM_WEBHOOK_SECRET;
    if (expected) {
      const got = c.req.header(SECRET_HEADER);
      if (got !== expected) return c.json({ error: 'Forbidden' }, 403);
    }

    let update: TelegramUpdate;
    try {
      update = await c.req.json();
    } catch {
      return c.json({ ok: true }); // ignore malformed; ack so Telegram stops retrying
    }

    const parsed = parseUpdate(update);
    if (!parsed) return c.json({ ok: true });

    const reply = replyForCommand(parsed, { miniAppUrl: c.env.MINI_APP_URL ?? '' });
    if (reply && c.env.TELEGRAM_BOT_TOKEN) {
      const bot = botClientFactory(c.env.TELEGRAM_BOT_TOKEN);
      await bot.sendMessage(parsed.chatId, reply);
    }

    return c.json({ ok: true });
  });

  return app;
}
