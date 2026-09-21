import { signInitData } from '@snapbite/core';
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

function meal(name: string, kcal = 120) {
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

describe('/api/favorites', () => {
  it('requires auth', async () => {
    const res = await createApp().request('/api/favorites', {}, env);
    expect(res.status).toBe(401);
  });

  it('saves, lists, and deletes a favorite', async () => {
    const app = createApp();
    const tgId = 9500;

    // Save with an explicit label.
    const save = await app.request(
      '/api/favorites',
      {
        method: 'POST',
        headers: await headers(tgId),
        body: JSON.stringify({ meal: meal('Chicken rice', 540), label: 'My chicken rice' }),
      },
      env,
    );
    expect(save.status).toBe(201);
    const { id } = (await save.json()) as { id: string; label: string };
    expect(id).toBeTruthy();

    // List returns it with the meal + kcal.
    const list = (await (
      await app.request('/api/favorites', { headers: await headers(tgId) }, env)
    ).json()) as { favorites: Array<{ id: string; label: string; energyKcal: number; meal: { total: { energyKcal: number } } }> };
    expect(list.favorites).toHaveLength(1);
    expect(list.favorites[0]?.label).toBe('My chicken rice');
    expect(list.favorites[0]?.energyKcal).toBe(540);
    expect(list.favorites[0]?.meal.total.energyKcal).toBe(540);

    // Delete it.
    const del = await app.request(
      `/api/favorites/${id}`,
      { method: 'DELETE', headers: await headers(tgId) },
      env,
    );
    expect(del.status).toBe(200);
    const after = (await (
      await app.request('/api/favorites', { headers: await headers(tgId) }, env)
    ).json()) as { favorites: unknown[] };
    expect(after.favorites).toHaveLength(0);
  });

  it('derives a label from the foods when none is given', async () => {
    const app = createApp();
    const tgId = 9501;
    await app.request(
      '/api/favorites',
      { method: 'POST', headers: await headers(tgId), body: JSON.stringify({ meal: meal('Oatmeal') }) },
      env,
    );
    const list = (await (
      await app.request('/api/favorites', { headers: await headers(tgId) }, env)
    ).json()) as { favorites: Array<{ label: string }> };
    expect(list.favorites[0]?.label).toBe('Oatmeal');
  });

  it('is owner-scoped: one user cannot see or delete another user favorite', async () => {
    const app = createApp();
    const owner = 9502;
    const other = 9503;
    const save = await app.request(
      '/api/favorites',
      { method: 'POST', headers: await headers(owner), body: JSON.stringify({ meal: meal('Secret') }) },
      env,
    );
    const { id } = (await save.json()) as { id: string };

    // Other user sees none.
    const otherList = (await (
      await app.request('/api/favorites', { headers: await headers(other) }, env)
    ).json()) as { favorites: unknown[] };
    expect(otherList.favorites).toHaveLength(0);

    // Other user can't delete it.
    const del = await app.request(
      `/api/favorites/${id}`,
      { method: 'DELETE', headers: await headers(other) },
      env,
    );
    expect(del.status).toBe(404);
  });

  it('rejects an invalid meal', async () => {
    const app = createApp();
    const res = await app.request(
      '/api/favorites',
      { method: 'POST', headers: await headers(9504), body: JSON.stringify({ meal: { nope: true } }) },
      env,
    );
    expect(res.status).toBe(400);
  });
});
