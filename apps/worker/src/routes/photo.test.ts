import { type BotReply, signInitData } from '@snapbite/core';
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';

const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';

function bot(sent: Array<{ chatId: number; reply: BotReply }>) {
  return {
    async sendMessage(chatId: number, reply: BotReply) {
      sent.push({ chatId, reply });
      return { messageId: 1 };
    },
    async getFilePath() {
      return 'photos/x.jpg';
    },
    async downloadFile() {
      // 1x1 pixel-ish bytes, base64.
      return { base64: 'QUJD', mimeType: 'image/jpeg' };
    },
  };
}

async function initFor(tgId: number): Promise<string> {
  const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  return signInitData({ user, auth_date: authDate }, BOT_TOKEN);
}

async function saveTextMeal(tgId: number): Promise<string> {
  const app = createApp();
  const meal = {
    foods: [
      {
        food: { name: 'rice', estimatedWeightG: 100, quantity: 1, confidence: 0.9 },
        nutrition: { energyKcal: 100, proteinG: 1, carbsG: 1, fatG: 1, source: 'table' },
      },
    ],
    total: { energyKcal: 100, proteinG: 1, carbsG: 1, fatG: 1, source: 'table' },
    confidence: 0.9,
    needsConfirmation: false,
  };
  const res = await app.request(
    '/api/meals',
    {
      method: 'POST',
      headers: { [INIT_DATA_HEADER]: await initFor(tgId), 'content-type': 'application/json' },
      body: JSON.stringify({ meal }),
    },
    env,
  );
  return ((await res.json()) as { id: string }).id;
}

describe('GET /api/meal-photo/:id', () => {
  it('401s without initData', async () => {
    const app = createApp();
    const res = await app.request('/api/meal-photo/anything', {}, env);
    expect(res.status).toBe(401);
  });

  it('404s when the meal has no photo', async () => {
    const tgId = 9001;
    const id = await saveTextMeal(tgId);
    const app = createApp({ botClientFactory: () => bot([]) });
    const res = await app.request(
      `/api/meal-photo/${id}?initData=${encodeURIComponent(await initFor(tgId))}`,
      {},
      env,
    );
    expect(res.status).toBe(404);
  });

  it('serves the image for a photo-backed meal', async () => {
    // Log a photo via the webhook path so the meal gets a telegram_file_id.
    const tgId = 9002;
    // Save a key so the webhook can analyze.
    const keyApp = createApp();
    await keyApp.request(
      '/api/settings',
      {
        method: 'PUT',
        headers: { [INIT_DATA_HEADER]: await initFor(tgId), 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'sk-x' }),
      },
      env,
    );

    const { MockAIProvider } = await import('@snapbite/core');
    const app = createApp({
      botClientFactory: () => bot([]),
      providerFactory: () => new MockAIProvider(),
    });
    await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': 'test-webhook-secret',
        },
        body: JSON.stringify({
          message: { photo: [{ file_id: 'pf1' }], chat: { id: tgId }, from: { id: tgId } },
        }),
      },
      env,
    );

    const list = (await (
      await app.request('/api/meals', { headers: { [INIT_DATA_HEADER]: await initFor(tgId) } }, env)
    ).json()) as { meals: Array<{ id: string; hasPhoto: boolean }> };
    const photoMeal = list.meals.find((m) => m.hasPhoto);
    expect(photoMeal).toBeDefined();

    const res = await app.request(
      `/api/meal-photo/${photoMeal?.id}?initData=${encodeURIComponent(await initFor(tgId))}`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });
});
