import { signInitData } from '@foodlog/core';
import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { INIT_DATA_HEADER } from './middleware/auth.js';
import { runReminders } from './reminders.js';

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
