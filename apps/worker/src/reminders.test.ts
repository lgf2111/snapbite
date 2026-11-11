import { env } from 'cloudflare:test';
import { signInitData } from '@snapbite/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { createPushDb, upsertSubscription } from './db/push.js';
import { pushSubscriptions } from './db/schema.js';
import { createDb, upsertUser } from './db/users.js';
import { INIT_DATA_HEADER } from './middleware/auth.js';
import { runReminders } from './reminders.js';
import { browserSubscription, vapidEnv } from './test/pushFixtures.js';

const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';

async function headers(userId: number): Promise<Record<string, string>> {
  const user = JSON.stringify({ id: userId, first_name: 'Ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  return {
    [INIT_DATA_HEADER]: await signInitData({ user, auth_date: authDate }, BOT_TOKEN),
    'content-type': 'application/json',
  };
}

describe('runReminders', () => {
  it('DMs a user whose local time hits an enabled slot, once', async () => {
    const tgId = 6001;
    // Enable reminders with a slot at 08:00, tz offset 0 (so UTC == local).
    await createApp().request(
      '/api/settings/reminders',
      {
        method: 'PUT',
        headers: await headers(tgId),
        body: JSON.stringify({
          enabled: true,
          times: { breakfast: '08:00' },
          tzOffsetMinutes: 0,
        }),
      },
      env,
    );

    // Capture Telegram sendMessage calls by stubbing global fetch.
    const calls: Array<{ chatId: number; text: string }> = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/sendMessage')) {
        const body = JSON.parse(String((init as RequestInit).body)) as {
          chat_id: number;
          text: string;
        };
        calls.push({ chatId: body.chat_id, text: body.text });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
          status: 200,
        });
      }
      return new Response('{}', { status: 200 });
    });

    try {
      // 08:05 UTC on some day — within the 15-min window after 08:00.
      const now = Date.UTC(2026, 5, 1, 8, 5);
      const sent1 = await runReminders(env, now);
      expect(sent1).toBeGreaterThanOrEqual(1);
      const dm = calls.find((c) => c.chatId === tgId);
      expect(dm?.text.toLowerCase()).toContain('breakfast');

      // Running again in the same window must NOT double-send (lastSent guard).
      calls.length = 0;
      const sent2 = await runReminders(env, now);
      expect(calls.find((c) => c.chatId === tgId)).toBeUndefined();
      expect(sent2).toBe(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('does not DM when the slot is outside the window', async () => {
    const tgId = 6002;
    await createApp().request(
      '/api/settings/reminders',
      {
        method: 'PUT',
        headers: await headers(tgId),
        body: JSON.stringify({ enabled: true, times: { dinner: '19:00' }, tzOffsetMinutes: 0 }),
      },
      env,
    );
    const calls: number[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/sendMessage')) {
        const body = JSON.parse(String((init as RequestInit).body)) as { chat_id: number };
        calls.push(body.chat_id);
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    });
    try {
      const now = Date.UTC(2026, 5, 1, 10, 0); // 10:00, nowhere near 19:00
      await runReminders(env, now);
      expect(calls).not.toContain(tgId);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('runReminders: web push first, Telegram as the fallback', () => {
  const SLOT = Date.UTC(2026, 5, 1, 8, 5); // 08:05 UTC, inside the 08:00 slot's window
  const DAY = 24 * 60 * 60 * 1000;

  async function userWithReminder(tgId: number) {
    await createApp().request(
      '/api/settings/reminders',
      {
        method: 'PUT',
        headers: await headers(tgId),
        body: JSON.stringify({ enabled: true, times: { breakfast: '08:00' }, tzOffsetMinutes: 0 }),
      },
      env,
    );
    return (await upsertUser(createDb(env.DB), { id: tgId })).id;
  }

  async function subscribe(userId: string, host = 'web.push.apple.com') {
    const sub = await browserSubscription(host);
    await upsertSubscription(createPushDb(env.DB), {
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    });
    return sub;
  }

  /** Records every outgoing request; answers pushes with `pushStatus`. */
  function network(pushStatus: number | (() => number)) {
    const pushes: string[] = [];
    const dms: Array<{ chatId: number; text: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/sendMessage')) {
        const body = JSON.parse(String((init as RequestInit).body)) as {
          chat_id: number;
          text: string;
        };
        dms.push({ chatId: body.chat_id, text: body.text });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
          status: 200,
        });
      }
      if (url.includes('push.apple.com') || url.includes('googleapis.com')) {
        pushes.push(url);
        return new Response(null, {
          status: typeof pushStatus === 'function' ? pushStatus() : pushStatus,
        });
      }
      return new Response('{}', { status: 200 });
    });
    return { pushes, dms };
  }

  const remaining = (endpoint: string) =>
    createPushDb(env.DB)
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));

  afterEach(() => vi.restoreAllMocks());

  it('a user with a live subscription gets the push and no Telegram message', async () => {
    const vapid = await vapidEnv();
    const userId = await userWithReminder(6101);
    const sub = await subscribe(userId);
    const { pushes, dms } = network(201);

    const sent = await runReminders({ ...env, ...vapid }, SLOT);

    expect(sent).toBeGreaterThanOrEqual(1);
    expect(pushes).toContain(sub.endpoint);
    expect(dms.find((d) => d.chatId === 6101)).toBeUndefined();
    expect((await remaining(sub.endpoint))[0]?.lastOkAt).toBeTruthy();
  });

  it('pushes to every device the user has', async () => {
    const vapid = await vapidEnv();
    const userId = await userWithReminder(6102);
    const phone = await subscribe(userId, 'web.push.apple.com');
    const laptop = await subscribe(userId, 'fcm.googleapis.com');
    const { pushes } = network(201);

    await runReminders({ ...env, ...vapid }, SLOT + DAY);

    expect(pushes).toEqual(expect.arrayContaining([phone.endpoint, laptop.endpoint]));
  });

  it('a 410 deletes the subscription, and the user then falls back to Telegram', async () => {
    const vapid = await vapidEnv();
    const userId = await userWithReminder(6103);
    const sub = await subscribe(userId);
    const { dms } = network(410);

    await runReminders({ ...env, ...vapid }, SLOT + 2 * DAY);

    expect(await remaining(sub.endpoint)).toHaveLength(0);
    expect(dms.find((d) => d.chatId === 6103)?.text.toLowerCase()).toContain('breakfast');
  });

  it('a user with no subscription falls back to Telegram', async () => {
    const vapid = await vapidEnv();
    await userWithReminder(6104);
    const { pushes, dms } = network(201);

    await runReminders({ ...env, ...vapid }, SLOT + 3 * DAY);

    expect(dms.find((d) => d.chatId === 6104)).toBeTruthy();
    expect(pushes.length).toBe(0);
  });

  it('a web-only account (no Telegram identity) with a subscription is reminded by push', async () => {
    const vapid = await vapidEnv();
    // An anonymous browser account: it has settings, but no Telegram id.
    const first = await createApp().request('/api/me', {}, env);
    const cookie = (first.headers.get('set-cookie') ?? '').split(';')[0] as string;
    const { userId } = (await first.json()) as { userId: string };
    await createApp().request(
      '/api/settings/reminders',
      {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true, times: { breakfast: '08:00' }, tzOffsetMinutes: 0 }),
      },
      env,
    );
    const sub = await subscribe(userId);
    const { pushes } = network(201);

    await runReminders({ ...env, ...vapid }, SLOT + 4 * DAY);

    expect(pushes).toContain(sub.endpoint);
    expect((await remaining(sub.endpoint))[0]?.lastOkAt).toBeTruthy();
  });

  it('a web-only account with no subscription is simply skipped, not an error', async () => {
    const vapid = await vapidEnv();
    const first = await createApp().request('/api/me', {}, env);
    const cookie = (first.headers.get('set-cookie') ?? '').split(';')[0] as string;
    await createApp().request(
      '/api/settings/reminders',
      {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true, times: { breakfast: '08:00' }, tzOffsetMinutes: 0 }),
      },
      env,
    );
    network(201);
    await expect(runReminders({ ...env, ...vapid }, SLOT + 5 * DAY)).resolves.toBeTypeOf('number');
  });

  it('counts failures and drops the subscription on the fifth in a row, then falls back', async () => {
    const vapid = await vapidEnv();
    const userId = await userWithReminder(6105);
    const sub = await subscribe(userId);
    const { dms } = network(500);

    for (let day = 0; day < 4; day++) {
      await runReminders({ ...env, ...vapid }, SLOT + (10 + day) * DAY);
      expect((await remaining(sub.endpoint))[0]?.failCount).toBe(day + 1);
    }
    // Still subscribed, so Telegram stayed quiet.
    expect(dms.find((d) => d.chatId === 6105)).toBeUndefined();

    await runReminders({ ...env, ...vapid }, SLOT + 14 * DAY);
    expect(await remaining(sub.endpoint)).toHaveLength(0);
    expect(dms.find((d) => d.chatId === 6105)).toBeTruthy();
  });

  it('a success resets the failure count', async () => {
    const vapid = await vapidEnv();
    const userId = await userWithReminder(6106);
    const sub = await subscribe(userId);
    let status = 500;
    network(() => status);

    await runReminders({ ...env, ...vapid }, SLOT + 20 * DAY);
    await runReminders({ ...env, ...vapid }, SLOT + 21 * DAY);
    expect((await remaining(sub.endpoint))[0]?.failCount).toBe(2);

    status = 201;
    await runReminders({ ...env, ...vapid }, SLOT + 22 * DAY);
    expect((await remaining(sub.endpoint))[0]?.failCount).toBe(0);
  });

  it('with no VAPID keys set, push is off: Telegram reminds and the subscription is untouched', async () => {
    const userId = await userWithReminder(6107);
    const sub = await subscribe(userId);
    const { pushes, dms } = network(201);

    await runReminders(
      { ...env, PUSH_VAPID_PUBLIC_KEY: undefined, PUSH_VAPID_PRIVATE_KEY: undefined },
      SLOT + 30 * DAY,
    );

    expect(pushes).toHaveLength(0);
    expect(dms.find((d) => d.chatId === 6107)).toBeTruthy();
    expect((await remaining(sub.endpoint))[0]?.failCount).toBe(0);
  });

  it('does not send the same reminder twice in one window, on either channel', async () => {
    const vapid = await vapidEnv();
    const userId = await userWithReminder(6108);
    await subscribe(userId);
    const { pushes } = network(201);

    await runReminders({ ...env, ...vapid }, SLOT + 40 * DAY);
    const first = pushes.length;
    await runReminders({ ...env, ...vapid }, SLOT + 40 * DAY);
    expect(pushes.length).toBe(first);
  });
});
