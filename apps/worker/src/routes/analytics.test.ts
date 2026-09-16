import { signInitData } from '@foodlog/core';
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';

const BOT_TOKEN = '123456:LOCAL-DEV-BOT-TOKEN';

async function headers(tgId: number): Promise<Record<string, string>> {
  const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  return {
    [INIT_DATA_HEADER]: await signInitData({ user, auth_date: authDate }, BOT_TOKEN),
    'content-type': 'application/json',
  };
}

function meal(name: string, kcal: number, protein: number) {
  return {
    foods: [
      {
        food: { name, estimatedWeightG: 100, quantity: 1, confidence: 0.9 },
        nutrition: { energyKcal: kcal, proteinG: protein, carbsG: 10, fatG: 5, source: 'table' },
      },
    ],
    total: { energyKcal: kcal, proteinG: protein, carbsG: 10, fatG: 5, source: 'table' },
    confidence: 0.9,
    needsConfirmation: false,
  };
}

async function save(tgId: number, m: ReturnType<typeof meal>): Promise<void> {
  const app = createApp();
  await app.request(
    '/api/meals',
    { method: 'POST', headers: await headers(tgId), body: JSON.stringify({ meal: m }) },
    env,
  );
}

interface Analytics {
  totalMeals: number;
  totalKcal: number;
  avgKcalPerMeal: number;
  daily: Array<{ date: string; kcal: number; meals: number }>;
  commonFoods: Array<{ name: string; count: number }>;
  macroAverages: { proteinG: number; carbsG: number; fatG: number };
}

describe('GET /api/analytics', () => {
  it('returns zeros for a user with no meals', async () => {
    const app = createApp();
    const res = await app.request('/api/analytics', { headers: await headers(6001) }, env);
    expect(res.status).toBe(200);
    const a = (await res.json()) as Analytics;
    expect(a.totalMeals).toBe(0);
    expect(a.totalKcal).toBe(0);
    expect(a.avgKcalPerMeal).toBe(0);
    expect(a.commonFoods).toEqual([]);
  });

  it('aggregates totals, averages, and common foods', async () => {
    const tgId = 6002;
    await save(tgId, meal('rice', 200, 4));
    await save(tgId, meal('rice', 100, 2));
    await save(tgId, meal('chicken', 300, 30));
    const app = createApp();

    const res = await app.request('/api/analytics', { headers: await headers(tgId) }, env);
    const a = (await res.json()) as Analytics;

    expect(a.totalMeals).toBe(3);
    expect(a.totalKcal).toBe(600);
    expect(a.avgKcalPerMeal).toBe(200);
    // rice appears twice -> most common first.
    expect(a.commonFoods[0]?.name).toBe('rice');
    expect(a.commonFoods[0]?.count).toBe(2);
    // avg protein = (4+2+30)/3 = 12.
    expect(a.macroAverages.proteinG).toBe(12);
    // one day bucket (all saved just now).
    expect(a.daily.length).toBeGreaterThanOrEqual(1);
  });

  it('does not mix in another user\'s data', async () => {
    await save(6003, meal('secret-food', 999, 50));
    const app = createApp();
    const res = await app.request('/api/analytics', { headers: await headers(6004) }, env);
    const a = (await res.json()) as Analytics;
    expect(a.totalMeals).toBe(0);
  });
});
