import { type BotReply, signInitData } from '@foodlog/core';
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { recentFeedback } from '../db/feedback.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';

const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';

async function authHeaders(userId: number): Promise<Record<string, string>> {
  const user = JSON.stringify({ id: userId, first_name: 'Ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  return {
    [INIT_DATA_HEADER]: await signInitData({ user, auth_date: authDate }, BOT_TOKEN),
    'content-type': 'application/json',
  };
}

/** Bot mock that records DMs so we can assert the owner was alerted. */
function captureBot(sent: Array<{ chatId: number; reply: BotReply }>) {
  return {
    botClientFactory: () => ({
      async sendMessage(chatId: number, reply: BotReply) {
        sent.push({ chatId, reply });
        return { messageId: 1 };
      },
      async getFilePath() {
        return null;
      },
      async downloadFile() {
        return null;
      },
    }),
  };
}

describe('POST /api/feedback', () => {
  it('stores a message and DMs the owner', async () => {
    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const app = createApp(captureBot(sent));
    const res = await app.request(
      '/api/feedback',
      { method: 'POST', headers: await authHeaders(7001), body: JSON.stringify({ message: 'love it, add streaks' }) },
      env,
    );
    expect(res.status).toBe(200);

    const rows = await recentFeedback(env.DB, 20);
    const found = rows.find((r) => r.telegramUserId === 7001 && r.message === 'love it, add streaks');
    expect(found).toBeTruthy();
    expect(found?.source).toBe('miniapp');

    // Owner (ADMIN_TELEGRAM_ID = 999000 in test env) got a DM.
    const dm = sent.find((s) => s.chatId === 999000);
    expect(dm?.reply.text).toContain('love it, add streaks');
  });

  it('rejects an empty message with 400', async () => {
    const app = createApp();
    const res = await app.request(
      '/api/feedback',
      { method: 'POST', headers: await authHeaders(7002), body: JSON.stringify({ message: '   ' }) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects an over-long message with 400', async () => {
    const app = createApp();
    const res = await app.request(
      '/api/feedback',
      {
        method: 'POST',
        headers: await authHeaders(7003),
        body: JSON.stringify({ message: 'x'.repeat(2001) }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('requires auth', async () => {
    const app = createApp();
    const res = await app.request(
      '/api/feedback',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'hi' }) },
      env,
    );
    expect(res.status).toBe(401);
  });
});
