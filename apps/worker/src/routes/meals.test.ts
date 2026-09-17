import { type AIFoodAnalysis, MockAIProvider, signInitData } from '@foodlog/core';
import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';

const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';

// A 1x1-ish base64 payload; the mock provider ignores the bytes anyway.
const IMAGE_BODY = { base64: 'QUJD', mimeType: 'image/jpeg' };

async function headers(tgId: number): Promise<Record<string, string>> {
  const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  return {
    [INIT_DATA_HEADER]: await signInitData({ user, auth_date: authDate }, BOT_TOKEN),
    'content-type': 'application/json',
  };
}

/** App wired with the deterministic mock provider (no network). */
function mockApp(analysis?: AIFoodAnalysis) {
  return createApp({ providerFactory: () => new MockAIProvider(analysis) });
}

/** Saves an API key for the given user so analyze can decrypt one. */
async function saveKey(tgId: number): Promise<void> {
  const app = createApp();
  await app.request(
    '/api/settings',
    { method: 'PUT', headers: await headers(tgId), body: JSON.stringify({ apiKey: 'sk-test-1234' }) },
    env,
  );
}

describe('POST /api/meals/analyze', () => {
  it('returns a resolved MealResult for a valid image (happy path)', async () => {
    const tgId = 2001;
    await saveKey(tgId);
    const app = mockApp();

    const res = await app.request(
      '/api/meals/analyze',
      { method: 'POST', headers: await headers(tgId), body: JSON.stringify(IMAGE_BODY) },
      env,
    );
    expect(res.status).toBe(200);
    const meal = (await res.json()) as { foods: unknown[]; total: { source: string } };
    expect(meal.foods.length).toBeGreaterThan(0);
    // Default mock mixes a table food + an AI-estimate food.
    expect(meal.total.source).toBe('mixed');
  });

  it('returns 400 when the user has no API key', async () => {
    const app = mockApp();
    const res = await app.request(
      '/api/meals/analyze',
      { method: 'POST', headers: await headers(2002), body: JSON.stringify(IMAGE_BODY) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unsupported mimeType', async () => {
    const tgId = 2003;
    await saveKey(tgId);
    const app = mockApp();
    const res = await app.request(
      '/api/meals/analyze',
      {
        method: 'POST',
        headers: await headers(tgId),
        body: JSON.stringify({ base64: 'QUJD', mimeType: 'image/bmp' }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('maps a provider failure to 502', async () => {
    const tgId = 2004;
    await saveKey(tgId);
    const app = createApp({
      providerFactory: () => ({
        id: 'boom',
        analyzeMeal: async () => {
          throw Object.assign(new Error('provider down'), { kind: 'network' });
        },
        reviseMeal: async () => {
          throw Object.assign(new Error('provider down'), { kind: 'network' });
        },
      }),
    });
    const res = await app.request(
      '/api/meals/analyze',
      { method: 'POST', headers: await headers(tgId), body: JSON.stringify(IMAGE_BODY) },
      env,
    );
    expect(res.status).toBe(502);
  });
});

describe('POST /api/meals/:id/revise', () => {
  const rice = {
    foods: [
      {
        food: { name: 'white rice', estimatedWeightG: 200, quantity: 1, confidence: 0.9 },
        nutrition: { energyKcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, source: 'table' },
      },
    ],
    total: { energyKcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, source: 'table' },
    confidence: 0.9,
    needsConfirmation: false,
    notes: 'lunch',
  };

  /** Provider factory whose reviseMeal returns the given analysis. */
  function reviseApp(analysis: AIFoodAnalysis) {
    return createApp({
      providerFactory: () => ({
        id: 'stub',
        analyzeMeal: async () => analysis,
        reviseMeal: async () => analysis,
      }),
    });
  }

  async function saveRice(tgId: number): Promise<string> {
    const app = createApp();
    await saveKey(tgId);
    const res = await app.request(
      '/api/meals',
      { method: 'POST', headers: await headers(tgId), body: JSON.stringify({ meal: rice }) },
      env,
    );
    const { id } = (await res.json()) as { id: string };
    return id;
  }

  it('revises an owned meal and persists the new foods', async () => {
    const tgId = 4001;
    const id = await saveRice(tgId);
    const app = reviseApp({
      foods: [
        { name: 'white rice', estimatedWeightG: 200, quantity: 1, confidence: 0.9 },
        {
          name: 'cola',
          estimatedWeightG: 330,
          quantity: 1,
          confidence: 0.8,
          aiNutrition: { energyKcal: 42, proteinG: 0, carbsG: 10.6, fatG: 0 },
        },
      ],
      confidence: 0.85,
      needsConfirmation: false,
    });

    const res = await app.request(
      `/api/meals/${id}/revise`,
      { method: 'POST', headers: await headers(tgId), body: JSON.stringify({ instruction: 'add a coke' }) },
      env,
    );
    expect(res.status).toBe(200);
    const detail = (await res.json()) as { foods: Array<{ name: string }> };
    expect(detail.foods.map((f) => f.name)).toContain('cola');
    expect(detail.foods).toHaveLength(2);
  });

  it('requires a non-empty instruction', async () => {
    const tgId = 4002;
    const id = await saveRice(tgId);
    const app = reviseApp({ foods: rice.foods.map((f) => f.food) as never, confidence: 0.9, needsConfirmation: false });
    const res = await app.request(
      `/api/meals/${id}/revise`,
      { method: 'POST', headers: await headers(tgId), body: JSON.stringify({ instruction: '  ' }) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for a meal the user does not own', async () => {
    const owner = 4003;
    const id = await saveRice(owner);
    const app = reviseApp({
      foods: [{ name: 'white rice', estimatedWeightG: 200, quantity: 1, confidence: 0.9 }],
      confidence: 0.9,
      needsConfirmation: false,
    });
    const res = await app.request(
      `/api/meals/${id}/revise`,
      { method: 'POST', headers: await headers(4004), body: JSON.stringify({ instruction: 'add a coke' }) },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when the user has no API key', async () => {
    // A user with a meal but no key: save meal directly (save does not need a key).
    const tgId = 4005;
    const app = createApp();
    const save = await app.request(
      '/api/meals',
      { method: 'POST', headers: await headers(tgId), body: JSON.stringify({ meal: rice }) },
      env,
    );
    const { id } = (await save.json()) as { id: string };
    const res = await app.request(
      `/api/meals/${id}/revise`,
      { method: 'POST', headers: await headers(tgId), body: JSON.stringify({ instruction: 'add a coke' }) },
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/meals?date= and /api/meals/dates', () => {
  const meal = {
    foods: [
      {
        food: { name: 'oats', estimatedWeightG: 100, quantity: 1, confidence: 0.9 },
        nutrition: { energyKcal: 380, proteinG: 13, carbsG: 67, fatG: 7, source: 'table' },
      },
    ],
    total: { energyKcal: 380, proteinG: 13, carbsG: 67, fatG: 7, source: 'table' },
    confidence: 0.9,
    needsConfirmation: false,
  };

  it('lists dates that have meals', async () => {
    const tgId = 4101;
    const app = createApp();
    await app.request(
      '/api/meals',
      { method: 'POST', headers: await headers(tgId), body: JSON.stringify({ meal }) },
      env,
    );
    const res = await app.request('/api/meals/dates', { headers: await headers(tgId) }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dates: string[] };
    expect(body.dates.length).toBeGreaterThanOrEqual(1);
    expect(body.dates[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('filters by date (an unrelated day returns nothing)', async () => {
    const tgId = 4102;
    const app = createApp();
    await app.request(
      '/api/meals',
      { method: 'POST', headers: await headers(tgId), body: JSON.stringify({ meal }) },
      env,
    );
    const res = await app.request(
      '/api/meals?date=1999-01-01',
      { headers: await headers(tgId) },
      env,
    );
    const body = (await res.json()) as { meals: unknown[] };
    expect(body.meals).toEqual([]);
  });
});

describe('POST /api/meals + GET /api/meals', () => {
  const savedMeal = {
    foods: [
      {
        food: { name: 'white rice', estimatedWeightG: 200, quantity: 1, confidence: 0.9 },
        nutrition: { energyKcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, source: 'table' },
      },
    ],
    total: { energyKcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, source: 'table' },
    confidence: 0.9,
    needsConfirmation: false,
    notes: 'lunch',
  };

  it('persists a meal and lists it back', async () => {
    const tgId = 3001;
    const app = createApp();

    const save = await app.request(
      '/api/meals',
      { method: 'POST', headers: await headers(tgId), body: JSON.stringify({ meal: savedMeal }) },
      env,
    );
    expect(save.status).toBe(201);
    const { id } = (await save.json()) as { id: string };
    expect(typeof id).toBe('string');

    const list = await app.request('/api/meals', { headers: await headers(tgId) }, env);
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      meals: Array<{ id: string; foods: string[]; energyKcal: number }>;
    };
    const found = body.meals.find((m) => m.id === id);
    expect(found).toBeDefined();
    expect(found?.foods).toContain('white rice');
    expect(found?.energyKcal).toBe(260);
  });

  it('rejects an invalid meal body with 400', async () => {
    const app = createApp();
    const res = await app.request(
      '/api/meals',
      { method: 'POST', headers: await headers(3002), body: JSON.stringify({ meal: { foods: [] } }) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('does not list another user\'s meals', async () => {
    const app = createApp();
    await app.request(
      '/api/meals',
      { method: 'POST', headers: await headers(3003), body: JSON.stringify({ meal: savedMeal }) },
      env,
    );
    const list = await app.request('/api/meals', { headers: await headers(3004) }, env);
    const body = (await list.json()) as { meals: unknown[] };
    expect(body.meals).toEqual([]);
  });

  it('posts a "logged" feed message to the user on save', async () => {
    const sent: Array<{ chatId: number; text: string }> = [];
    const app = createApp({
      botClientFactory: () => ({
        async sendMessage(chatId: number, reply: { text: string }) {
          sent.push({ chatId, text: reply.text });
        },
        async getFilePath() {
          return null;
        },
        async downloadFile() {
          return null;
        },
      }),
    });
    await app.request(
      '/api/meals',
      { method: 'POST', headers: await headers(3005), body: JSON.stringify({ meal: savedMeal }) },
      env,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe(3005);
    expect(sent[0]?.text).toContain('Logged');
    expect(sent[0]?.text).toContain('white rice');
  });
});
