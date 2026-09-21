import { verifyInitData } from '@snapbite/core';
import type { MiddlewareHandler } from 'hono';
import { createDb, upsertUser } from '../db/users.js';
import type { AppBindings } from '../env.js';

/** Header the Mini App sends its signed initData in. */
export const INIT_DATA_HEADER = 'x-telegram-init-data';

const FAILURE_MESSAGE: Record<string, string> = {
  missing_hash: 'Missing initData hash',
  bad_hash: 'initData signature invalid',
  expired: 'initData expired',
  missing_user: 'initData missing user',
  malformed: 'initData malformed',
};

/**
 * Authenticates a request using Telegram Mini App initData. Verifies the HMAC
 * signature against the bot token, upserts the user, and attaches
 * `telegramUser` + `userId` to the context. Rejects with 401 otherwise.
 */
export function telegramAuth(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const initData =
      c.req.header(INIT_DATA_HEADER) ?? new URL(c.req.url).searchParams.get('initData') ?? '';

    if (!initData) {
      return c.json({ error: 'Unauthorized', detail: 'Missing initData' }, 401);
    }
    if (!c.env.TELEGRAM_BOT_TOKEN) {
      return c.json({ error: 'Server misconfigured', detail: 'No bot token' }, 500);
    }

    const result = await verifyInitData(initData, c.env.TELEGRAM_BOT_TOKEN);
    if (!result.ok) {
      return c.json(
        { error: 'Unauthorized', detail: FAILURE_MESSAGE[result.reason] ?? result.reason },
        401,
      );
    }

    const db = createDb(c.env.DB);
    const user = await upsertUser(db, result.data.user);

    c.set('telegramUser', result.data.user);
    c.set('userId', user.id);
    await next();
  };
}
