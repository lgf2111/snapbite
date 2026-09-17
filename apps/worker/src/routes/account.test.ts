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

const meal = {
  foods: [
    {
      food: { name: 'rice', estimatedWeightG: 200, quantity: 1, confidence: 0.9 },
      nutrition: { energyKcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, source: 'table' },
    },
  ],
  total: { energyKcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, source: 'table' },
  confidence: 0.9,
  needsConfirmation: false,
  notes: 'lunch',
};

async function saveKeyAndMeal(tgId: number): Promise<void> {
  const app = createApp();
  const h = await headers(tgId);
  await app.request(
    '/api/settings',
    { method: 'PUT', headers: h, body: JSON.stringify({ apiKey: 'sk-secret-9999', aiProvider: 'gemini' }) },
    env,
  );
  await app.request('/api/meals', { method: 'POST', headers: h, body: JSON.stringify({ meal }) }, env);
}

describe('GET /api/account/export', () => {
  it('exports meals + settings but never the API key', async () => {
    const tgId = 8001;
    await saveKeyAndMeal(tgId);
    const app = createApp();
    const res = await app.request('/api/account/export', { headers: await headers(tgId) }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { telegramUserId: number };
      settings: { aiProvider: string } | null;
      meals: Array<{ notes: string | null; foods: Array<{ name: string; proteinG: number }> }>;
    };
    expect(body.user.telegramUserId).toBe(tgId);
    expect(body.settings?.aiProvider).toBe('gemini');
    expect(body.meals).toHaveLength(1);
    expect(body.meals[0]?.foods[0]?.name).toBe('rice');
    expect(body.meals[0]?.foods[0]?.proteinG).toBe(5.4);
    // The raw payload must contain no key material.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('sk-secret-9999');
    expect(raw.toLowerCase()).not.toContain('ciphertext');
  });
});

describe('DELETE /api/account', () => {
  it('deletes the user and cascades to all their data', async () => {
    const tgId = 8002;
    await saveKeyAndMeal(tgId);

    const app = createApp();
    const del = await app.request(
      '/api/account',
      { method: 'DELETE', headers: await headers(tgId) },
      env,
    );
    expect(del.status).toBe(200);

    // The user's rows should be gone across all tables.
    const idRow = await env.DB.prepare('SELECT id FROM users WHERE telegram_user_id = ?')
      .bind(tgId)
      .first<{ id: string }>();
    expect(idRow).toBeNull();

    // A fresh authed request re-creates a NEW empty user; export shows no meals.
    const exportRes = await app.request(
      '/api/account/export',
      { headers: await headers(tgId) },
      env,
    );
    const body = (await exportRes.json()) as { meals: unknown[] };
    expect(body.meals).toEqual([]);
  });

  it('does not touch another user\'s data', async () => {
    const keep = 8003;
    const drop = 8004;
    await saveKeyAndMeal(keep);
    await saveKeyAndMeal(drop);

    const app = createApp();
    await app.request('/api/account', { method: 'DELETE', headers: await headers(drop) }, env);

    const kept = await app.request('/api/account/export', { headers: await headers(keep) }, env);
    const body = (await kept.json()) as { meals: unknown[] };
    expect(body.meals.length).toBeGreaterThanOrEqual(1);
  });
});
