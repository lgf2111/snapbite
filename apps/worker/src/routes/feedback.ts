import { Hono } from 'hono';
import { FEEDBACK_MAX_LEN, storeFeedback } from '../db/feedback.js';
import { type AppBindings, parseAdminId } from '../env.js';
import { TelegramBotClient } from '../telegram/botClient.js';
import type { BotClientFactory } from './webhook.js';

const defaultBotClientFactory: BotClientFactory = (token) => new TelegramBotClient(token);

/**
 * Feedback routes. `POST /api/feedback { message }` (authed) stores a message
 * from the Mini App and best-effort DMs the owner. Length-capped; empty/oversize
 * messages are rejected with 400.
 */
export function feedbackRoutes(botClientFactory: BotClientFactory = defaultBotClientFactory) {
  const app = new Hono<AppBindings>();

  app.post('/', async (c) => {
    let body: { message?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Bad request', detail: 'Invalid JSON' }, 400);
    }

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return c.json({ error: 'Bad request', detail: 'message is required' }, 400);
    }
    if (message.length > FEEDBACK_MAX_LEN) {
      return c.json(
        { error: 'Bad request', detail: `message must be ≤ ${FEEDBACK_MAX_LEN} characters` },
        400,
      );
    }

    const tgUser = c.get('telegramUser');
    const row = await storeFeedback(c.env.DB, {
      telegramUserId: tgUser?.id ?? null,
      source: 'miniapp',
      message,
    });

    // Best-effort DM to the owner — never fail the request on a send error.
    const adminId = parseAdminId(c.env.ADMIN_TELEGRAM_ID);
    if (adminId && c.env.TELEGRAM_BOT_TOKEN) {
      try {
        const bot = botClientFactory(c.env.TELEGRAM_BOT_TOKEN);
        await bot.sendMessage(adminId, {
          text: `📝 New feedback (Mini App) from user ${tgUser?.id ?? '?'}:\n${row.message}`,
        });
      } catch {
        /* ignore */
      }
    }

    return c.json({ ok: true });
  });

  return app;
}
