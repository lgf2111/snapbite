import { signInitData } from '@snapbite/core';
import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { createDb, upsertUser } from './db/users.js';
import { INIT_DATA_HEADER } from './middleware/auth.js';
import { enqueuePhotoRetry, runPhotoRetries } from './photoRetry.js';

const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';

/** Saves an API key for a Telegram user via the authed settings route. */
async function withKey(tgId: number): Promise<string> {
  const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  const initData = await signInitData({ user, auth_date: authDate }, BOT_TOKEN);
  await createApp().request(
    '/api/settings',
    {
      method: 'PUT',
      headers: { [INIT_DATA_HEADER]: initData, 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: 'k', aiProvider: 'gemini' }),
    },
    env,
  );
  const row = await upsertUser(createDb(env.DB), { id: tgId });
  return row.id;
}

/**
 * Stubs global fetch for the Telegram + AI calls runPhotoRetries makes. The AI
 * chat-completions response is controlled by `aiOk`.
 */
function stubFetch(aiOk: boolean) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/getFile')) {
      return new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/x.jpg' } }), {
        status: 200,
      });
    }
    if (url.includes('/file/bot')) {
      return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
    }
    if (url.includes('/editMessageText') || url.includes('/sendMessage')) {
      return new Response(JSON.stringify({ ok: true, result: { message_id: 555 } }), {
        status: 200,
      });
    }
    if (url.includes('/chat/completions')) {
      if (!aiOk) {
        return new Response(
          JSON.stringify({ error: { message: 'The model is overloaded.' } }),
          { status: 503 },
        );
      }
      const content = JSON.stringify({
        foods: [
          {
            name: 'Toast',
            estimatedWeightG: 60,
            quantity: 1,
            confidence: 0.8,
            aiNutrition: { energyKcal: 250, proteinG: 8, carbsG: 45, fatG: 4 },
          },
        ],
        confidence: 0.8,
        needsConfirmation: false,
      });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
}

describe('runPhotoRetries', () => {
  it('re-analyzes a queued photo, logs the meal, and clears the row', async () => {
    const tgId = 9100;
    const userId = await withKey(tgId);
    await enqueuePhotoRetry(env.DB, {
      userId,
      telegramUserId: tgId,
      chatId: tgId,
      statusMessageId: 42,
      fileId: 'file_1',
      caption: '',
    });

    const spy = stubFetch(true);
    try {
      // nowMs far in the future so the (now+3min) row is due.
      const logged = await runPhotoRetries(env, Date.now() + 10 * 60 * 1000);
      expect(logged).toBe(1);
    } finally {
      spy.mockRestore();
    }

    // The meal is now saved for that user.
    const initData = await signInitData(
      { user: JSON.stringify({ id: tgId }), auth_date: String(Math.floor(Date.now() / 1000)) },
      BOT_TOKEN,
    );
    const list = (await (
      await createApp().request('/api/meals', { headers: { [INIT_DATA_HEADER]: initData } }, env)
    ).json()) as { meals: Array<{ foods: string[] }> };
    expect(list.meals.some((m) => m.foods.includes('Toast'))).toBe(true);

    // Running again does nothing (row was cleared).
    const spy2 = stubFetch(true);
    try {
      expect(await runPhotoRetries(env, Date.now() + 20 * 60 * 1000)).toBe(0);
    } finally {
      spy2.mockRestore();
    }
  });

  it('gives up after the attempt cap when the AI stays overloaded', async () => {
    const tgId = 9101;
    const userId = await withKey(tgId);
    await enqueuePhotoRetry(env.DB, {
      userId,
      telegramUserId: tgId,
      chatId: tgId,
      statusMessageId: 43,
      fileId: 'file_2',
      caption: '',
    });

    // Attempt 1: still overloaded → bump (attempts=1), not given up yet.
    let spy = stubFetch(false);
    try {
      expect(await runPhotoRetries(env, Date.now() + 10 * 60 * 1000)).toBe(0);
    } finally {
      spy.mockRestore();
    }
    // Attempt 2: still overloaded → attempts=2 hits cap → row removed.
    spy = stubFetch(false);
    try {
      expect(await runPhotoRetries(env, Date.now() + 40 * 60 * 1000)).toBe(0);
    } finally {
      spy.mockRestore();
    }
    // Third run: nothing left to do.
    spy = stubFetch(false);
    try {
      expect(await runPhotoRetries(env, Date.now() + 90 * 60 * 1000)).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
