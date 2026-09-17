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

function meal(name: string, kcal = 100) {
  return {
    foods: [
      {
        food: { name, estimatedWeightG: 100, quantity: 1, confidence: 0.9 },
        nutrition: { energyKcal: kcal, proteinG: 5, carbsG: 10, fatG: 3, source: 'table' },
      },
    ],
    total: { energyKcal: kcal, proteinG: 5, carbsG: 10, fatG: 3, source: 'table' },
    confidence: 0.9,
    needsConfirmation: false,
  };
}

async function save(app: ReturnType<typeof createApp>, tgId: number, name: string): Promise<string> {
  const res = await app.request(
    '/api/meals',
    { method: 'POST', headers: await headers(tgId), body: JSON.stringify({ meal: meal(name) }) },
    env,
  );
  return ((await res.json()) as { id: string }).id;
}

describe('PUT /api/meals/:id', () => {
  it('updates an owned meal', async () => {
    const app = createApp();
    const tgId = 7101;
    const id = await save(app, tgId, 'oatmeal');

    const edited = meal('oatmeal with banana', 250);
    const res = await app.request(
      `/api/meals/${id}`,
      { method: 'PUT', headers: await headers(tgId), body: JSON.stringify({ meal: edited }) },
      env,
    );
    expect(res.status).toBe(200);

    const detail = (await (
      await app.request(`/api/meals/${id}`, { headers: await headers(tgId) }, env)
    ).json()) as { foods: Array<{ name: string }>; total: { energyKcal: number } };
    expect(detail.foods[0]?.name).toBe('oatmeal with banana');
    expect(detail.total.energyKcal).toBe(250);
    expect(detail.foods).toHaveLength(1);
  });

  it('persists per-food nutrition so detail reloads with real values (not zeros)', async () => {
    const app = createApp();
    const tgId = 7150;
    const id = await save(app, tgId, 'chicken curry');

    const detail = (await (
      await app.request(`/api/meals/${id}`, { headers: await headers(tgId) }, env)
    ).json()) as {
      foods: Array<{ energyKcal: number; proteinG: number; nutritionSource: string }>;
    };
    // meal() helper sets per-food nutrition energyKcal=100, protein=5, source=table.
    expect(detail.foods[0]?.energyKcal).toBe(100);
    expect(detail.foods[0]?.proteinG).toBe(5);
    expect(detail.foods[0]?.nutritionSource).toBe('table');
  });

  it('returns 404 when updating another user\'s meal', async () => {
    const app = createApp();
    const id = await save(app, 7102, 'private');
    const res = await app.request(
      `/api/meals/${id}`,
      { method: 'PUT', headers: await headers(7103), body: JSON.stringify({ meal: meal('hacked') }) },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('rejects an invalid meal body with 400', async () => {
    const app = createApp();
    const id = await save(app, 7104, 'valid');
    const res = await app.request(
      `/api/meals/${id}`,
      { method: 'PUT', headers: await headers(7104), body: JSON.stringify({ meal: { foods: [] } }) },
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/meals/:id', () => {
  it('deletes an owned meal and it disappears from the list', async () => {
    const app = createApp();
    const tgId = 7201;
    const id = await save(app, tgId, 'to delete');

    const del = await app.request(
      `/api/meals/${id}`,
      { method: 'DELETE', headers: await headers(tgId) },
      env,
    );
    expect(del.status).toBe(200);

    const detail = await app.request(`/api/meals/${id}`, { headers: await headers(tgId) }, env);
    expect(detail.status).toBe(404);

    const list = (await (
      await app.request('/api/meals', { headers: await headers(tgId) }, env)
    ).json()) as { meals: Array<{ id: string }> };
    expect(list.meals.find((m) => m.id === id)).toBeUndefined();
  });

  it('returns 404 when deleting another user\'s meal', async () => {
    const app = createApp();
    const id = await save(app, 7202, 'safe');
    const res = await app.request(
      `/api/meals/${id}`,
      { method: 'DELETE', headers: await headers(7203) },
      env,
    );
    expect(res.status).toBe(404);
    // Still there for the owner.
    const detail = await app.request(`/api/meals/${id}`, { headers: await headers(7202) }, env);
    expect(detail.status).toBe(200);
  });

  it('cascades: food_items and nutrition rows are removed', async () => {
    const app = createApp();
    const tgId = 7204;
    const id = await save(app, tgId, 'cascade check');
    await app.request(`/api/meals/${id}`, { method: 'DELETE', headers: await headers(tgId) }, env);

    const foods = await env.DB.prepare('SELECT COUNT(*) as n FROM food_items WHERE meal_id = ?')
      .bind(id)
      .first<{ n: number }>();
    const nut = await env.DB.prepare('SELECT COUNT(*) as n FROM nutrition WHERE meal_id = ?')
      .bind(id)
      .first<{ n: number }>();
    expect(foods?.n).toBe(0);
    expect(nut?.n).toBe(0);
  });
});
