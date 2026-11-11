import { env } from 'cloudflare:test';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { users } from '../db/schema.js';
import { createDb, upsertUser } from '../db/users.js';
import type { AppBindings } from '../env.js';
import { adminRoutes } from './admin.js';
import type { BotClient } from './webhook.js';

const TOKEN = 'correct-horse-battery-staple';
const withToken = { ...env, ADMIN_TOKEN: TOKEN };

const broadcast = (
  token: string | null,
  body: unknown,
  e: object = withToken,
  app: { request: (...a: never[]) => unknown } = createApp(),
) =>
  (app as ReturnType<typeof createApp>).request(
    '/api/admin/broadcast',
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

async function telegramUserCount(): Promise<number> {
  const rows = await createDb(env.DB)
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(isNotNull(users.telegramUserId));
  return Number(rows[0]?.n ?? 0);
}

/** An app with the admin routes only, no send delay, and a bot we control. */
function appWith(bot: Partial<BotClient>) {
  const app = new Hono<AppBindings>();
  app.route(
    '/api/admin',
    adminRoutes({
      delayMs: 0,
      botClientFactory: () => ({
        getFilePath: async () => null,
        downloadFile: async () => null,
        sendMessage: async () => ({ messageId: 1 }),
        ...bot,
      }),
    }),
  );
  return app;
}

afterEach(() => vi.restoreAllMocks());

describe('POST /api/admin/broadcast: who may call it', () => {
  it('401 without the token', async () => {
    const res = await broadcast(null, { text: 'hi' });
    expect(res.status).toBe(401);
  });

  it('401 with a wrong token, including one that is a prefix or an extension of the right one', async () => {
    for (const wrong of ['nope', '', TOKEN.slice(0, -1), `${TOKEN}x`, TOKEN.toUpperCase()]) {
      const res = await broadcast(wrong, { text: 'hi' });
      expect(res.status, JSON.stringify(wrong)).toBe(401);
    }
  });

  it('503 when ADMIN_TOKEN is unset, and never falls open, whatever header is sent', async () => {
    const unset = { ...env, ADMIN_TOKEN: undefined };
    for (const token of [null, '', 'anything', 'undefined']) {
      const res = await broadcast(token, { text: 'hi' }, unset);
      expect(res.status, String(token)).toBe(503);
    }
    // An empty or blank secret counts as unset.
    expect((await broadcast('', { text: 'hi' }, { ...env, ADMIN_TOKEN: '' })).status).toBe(503);
    expect((await broadcast('  ', { text: 'hi' }, { ...env, ADMIN_TOKEN: '  ' })).status).toBe(503);
  });

  it('is not behind account auth: the token alone is enough (no initData, no cookie)', async () => {
    const res = await broadcast(TOKEN, { text: 'hi', dryRun: true });
    expect(res.status).toBe(200);
  });

  it('sends nothing and touches no Telegram for an unauthorised caller', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await broadcast('wrong', { text: 'hi' });
    await broadcast(null, { text: 'hi' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/broadcast: the body', () => {
  it('400 for missing, empty, non-string or over-long text', async () => {
    for (const text of [undefined, '', 5, null, 'x'.repeat(4001)]) {
      const res = await broadcast(TOKEN, { text });
      expect(res.status, String(text).slice(0, 10)).toBe(400);
    }
    expect((await broadcast(TOKEN, { text: 'x'.repeat(4000), dryRun: true })).status).toBe(200);
    expect((await broadcast(TOKEN, { text: 'x', dryRun: 'yes' })).status).toBe(400);
  });

  it('dryRun counts the Telegram users and calls nothing', async () => {
    await upsertUser(createDb(env.DB), { id: 7001, first_name: 'A' });
    await upsertUser(createDb(env.DB), { id: 7002, first_name: 'B' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await broadcast(TOKEN, { text: 'Migration notice', dryRun: true });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dryRun: true, recipients: await telegramUserCount() });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not count accounts that have no Telegram identity', async () => {
    const before = await telegramUserCount();
    // An email/device account: it has a row but no telegram_user_id.
    await createDb(env.DB).insert(users).values({ id: 'web-only-user', createdAt: Date.now() });
    const res = await broadcast(TOKEN, { text: 'x', dryRun: true });
    expect(((await res.json()) as { recipients: number }).recipients).toBe(before);
    await createDb(env.DB).delete(users).where(eq(users.id, 'web-only-user'));
  });
});

describe('POST /api/admin/broadcast: sending', () => {
  it('sends the text to every Telegram user, as plain text', async () => {
    await upsertUser(createDb(env.DB), { id: 7011, first_name: 'A' });
    const seen: Array<{ chatId: number; text: string; keys: string[] }> = [];
    const app = appWith({
      sendMessage: async (chatId, reply) => {
        seen.push({ chatId, text: reply.text, keys: Object.keys(reply) });
        return { messageId: 1 };
      },
    });
    const text = 'We have moved: https://snapbite.leeguanfeng.com/?a=1&b=_x_';

    const res = await broadcast(TOKEN, { text }, withToken, app);

    const total = await telegramUserCount();
    expect(await res.json()).toEqual({ sent: total, failed: 0, skipped: 0 });
    expect(seen).toHaveLength(total);
    expect(seen.find((s) => s.chatId === 7011)?.text).toBe(text);
    // Nothing but the text: no parse_mode, no markup.
    for (const s of seen) expect(s.keys).toEqual(['text']);
  });

  it('a failed send does not abort the loop', async () => {
    await upsertUser(createDb(env.DB), { id: 7021, first_name: 'Blocked' });
    await upsertUser(createDb(env.DB), { id: 7022, first_name: 'Fine' });
    const attempted: number[] = [];
    const app = appWith({
      sendMessage: async (chatId) => {
        attempted.push(chatId);
        if (chatId === 7021) throw new Error('network down');
        return { messageId: 1 };
      },
    });

    const res = await broadcast(TOKEN, { text: 'hi' }, withToken, app);

    const total = await telegramUserCount();
    const body = (await res.json()) as { sent: number; failed: number; skipped: number };
    expect(res.status).toBe(200);
    expect(body.failed).toBe(1);
    expect(body.sent).toBe(total - 1);
    // Everyone was tried, including those after the failure.
    expect(attempted).toHaveLength(total);
    expect(attempted).toContain(7022);
  });

  it('counts a refusal from Telegram (blocked the bot) as failed, with the real client', async () => {
    await upsertUser(createDb(env.DB), { id: 7031, first_name: 'BlockedTheBot' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const chat = (JSON.parse(String((init as RequestInit).body)) as { chat_id: number }).chat_id;
      return chat === 7031
        ? new Response(JSON.stringify({ ok: false, error_code: 403 }), { status: 403 })
        : new Response(JSON.stringify({ ok: true, result: { message_id: 5 } }), { status: 200 });
    });
    const app = new Hono<AppBindings>();
    app.route('/api/admin', adminRoutes({ delayMs: 0 }));

    const res = await broadcast(TOKEN, { text: 'hi' }, withToken, app);

    const total = await telegramUserCount();
    expect(await res.json()).toEqual({ sent: total - 1, failed: 1, skipped: 0 });
  });

  it('waits between sends (40ms by default) and not after the last one', async () => {
    vi.useFakeTimers();
    try {
      const app = new Hono<AppBindings>();
      const times: number[] = [];
      app.route(
        '/api/admin',
        adminRoutes({
          botClientFactory: () => ({
            getFilePath: async () => null,
            downloadFile: async () => null,
            sendMessage: async () => {
              times.push(Date.now());
              return { messageId: 1 };
            },
          }),
        }),
      );
      const done = broadcast(TOKEN, { text: 'hi' }, withToken, app);
      await vi.advanceTimersByTimeAsync(40 * (await telegramUserCount()) + 100);
      await done;
      for (let i = 1; i < times.length; i++) {
        expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(40);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
