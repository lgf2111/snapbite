import { Hono } from 'hono';
import { createDb, listBroadcastTargets } from '../db/users.js';
import type { AppBindings } from '../env.js';
import { TelegramBotClient } from '../telegram/botClient.js';
import type { BotClientFactory } from './webhook.js';

const MAX_TEXT = 4000;
/** Pause between sends, to stay well under Telegram's ~30 messages/second limit. */
const SEND_GAP_MS = 40;

/**
 * Constant-time string comparison. Both sides are hashed first, so the compared
 * values are always 32 bytes and neither the content nor the length of the real
 * token can be read from how long a wrong guess takes.
 */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] as number) ^ (y[i] as number);
  return diff === 0;
}

/**
 * One-shot operator tools. Mounted OUTSIDE account auth (it is not an account
 * request) and guarded by `x-admin-token` against `env.ADMIN_TOKEN`: a wrong or
 * missing token is a 401, and an unset `ADMIN_TOKEN` is a 503, so the endpoint
 * can never be open by accident.
 *
 *   POST /api/admin/broadcast  { text, dryRun? }  ->  { sent, failed, skipped }
 *
 * Plain text, no parse_mode (a URL is not mangled). Nothing is stored and nobody
 * is de-duplicated: running it twice messages everyone twice.
 */
export function adminRoutes(opts: { botClientFactory?: BotClientFactory; delayMs?: number } = {}) {
  const app = new Hono<AppBindings>();
  const delayMs = opts.delayMs ?? SEND_GAP_MS;
  const makeBot: BotClientFactory = opts.botClientFactory ?? ((t) => new TelegramBotClient(t));

  app.post('/broadcast', async (c) => {
    const expected = c.env.ADMIN_TOKEN?.trim();
    if (!expected) {
      return c.json({ error: 'Not configured', detail: 'ADMIN_TOKEN is not set' }, 503);
    }
    if (!(await safeEqual(c.req.header('x-admin-token') ?? '', expected))) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = (await c.req.json().catch(() => null)) as {
      text?: unknown;
      dryRun?: unknown;
    } | null;
    const text = body?.text;
    if (typeof text !== 'string' || text.length < 1 || text.length > MAX_TEXT) {
      return c.json(
        { error: 'Bad request', detail: `text must be a string of 1 to ${MAX_TEXT} characters` },
        400,
      );
    }
    if (body?.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
      return c.json({ error: 'Bad request', detail: 'dryRun must be a boolean' }, 400);
    }

    // Everyone with a Telegram identity; accounts without one cannot be messaged.
    const targets = await listBroadcastTargets(createDb(c.env.DB));
    if (body?.dryRun === true) {
      return c.json({ dryRun: true, recipients: targets.length });
    }
    if (!c.env.TELEGRAM_BOT_TOKEN) {
      return c.json({ error: 'Not configured', detail: 'TELEGRAM_BOT_TOKEN is not set' }, 503);
    }

    const bot = makeBot(c.env.TELEGRAM_BOT_TOKEN);
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (let i = 0; i < targets.length; i++) {
      const chatId = (targets[i] as { telegramUserId: number }).telegramUserId;
      // A private chat's id is the user's own positive id; anything else cannot be DMed.
      if (!Number.isSafeInteger(chatId) || chatId <= 0) {
        skipped += 1;
        continue;
      }
      try {
        const res = await bot.sendMessage(chatId, { text });
        // The client reports a refusal (blocked the bot, deleted chat) as no message id.
        if (res.messageId == null) failed += 1;
        else sent += 1;
      } catch {
        failed += 1;
      }
      if (delayMs > 0 && i < targets.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return c.json({ sent, failed, skipped });
  });

  return app;
}
