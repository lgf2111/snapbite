import { signInitData } from '@foodlog/core';
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';
import { groupByDay } from './meals.js';

const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';

async function headers(tgId: number): Promise<Record<string, string>> {
  const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  return {
    [INIT_DATA_HEADER]: await signInitData({ user, auth_date: authDate }, BOT_TOKEN),
    'content-type': 'application/json',
  };
}

function meal(name: string) {
  return {
    foods: [
      {
        food: { name, estimatedWeightG: 100, quantity: 1, confidence: 0.9 },
        nutrition: { energyKcal: 100, proteinG: 5, carbsG: 10, fatG: 3, source: 'table' },
      },
    ],
    total: { energyKcal: 100, proteinG: 5, carbsG: 10, fatG: 3, source: 'table' },
    confidence: 0.9,
    needsConfirmation: false,
  };
}

async function save(tgId: number, name: string): Promise<string> {
  const app = createApp();
  const res = await app.request(
    '/api/meals',
    { method: 'POST', headers: await headers(tgId), body: JSON.stringify({ meal: meal(name) }) },
    env,
  );
  return ((await res.json()) as { id: string }).id;
}

describe('groupByDay', () => {
  it('buckets meals by UTC date, newest first, summing kcal', () => {
    const d1 = Date.UTC(2026, 0, 2, 12);
    const d2 = Date.UTC(2026, 0, 1, 12);
    const groups = groupByDay([
      { id: 'a', loggedAt: d1, energyKcal: 100 },
      { id: 'b', loggedAt: d1, energyKcal: 250 },
      { id: 'c', loggedAt: d2, energyKcal: 50 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.date).toBe('2026-01-02');
    expect(groups[0]?.totalKcal).toBe(350);
    expect(groups[0]?.mealIds).toEqual(['a', 'b']);
    expect(groups[1]?.date).toBe('2026-01-01');
  });
});

describe('GET /api/meals/:id', () => {
  it('returns full detail for an owned meal', async () => {
    const tgId = 4001;
    const id = await save(tgId, 'grilled salmon');
    const app = createApp();
    const res = await app.request(`/api/meals/${id}`, { headers: await headers(tgId) }, env);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
      id: string;
      foods: Array<{ name: string }>;
      total: { energyKcal: number };
    };
    expect(detail.id).toBe(id);
    expect(detail.foods[0]?.name).toBe('grilled salmon');
    expect(detail.total.energyKcal).toBe(100);
  });

  it('returns 404 for another user\'s meal', async () => {
    const id = await save(4002, 'private dish');
    const app = createApp();
    const res = await app.request(`/api/meals/${id}`, { headers: await headers(4003) }, env);
    expect(res.status).toBe(404);
  });
});
