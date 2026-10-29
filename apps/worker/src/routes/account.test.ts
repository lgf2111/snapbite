import { env } from 'cloudflare:test';
import { signInitData } from '@snapbite/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createAccountDb, exportUser } from '../db/account.js';
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
    {
      method: 'PUT',
      headers: h,
      body: JSON.stringify({ apiKey: 'sk-secret-9999', aiProvider: 'gemini' }),
    },
    env,
  );
  await app.request(
    '/api/meals',
    { method: 'POST', headers: h, body: JSON.stringify({ meal }) },
    env,
  );
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

  it("does not touch another user's data", async () => {
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

/**
 * Wraps a D1Database so we can count how many SQL statements drizzle issues.
 * Each `db.select()/insert()/…` compiles to exactly one `.prepare()` call, so
 * counting prepares is the statement count. (We don't use `.batch()` here.)
 */
function countingDb(d1: D1Database): { db: D1Database; count: () => number } {
  let n = 0;
  const db = new Proxy(d1, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        return (query: string) => {
          n += 1;
          return target.prepare(query);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return { db: db as D1Database, count: () => n };
}

let seedTgId = 900000;

/** Seeds `userId` with `n` meals, each with one food item + one nutrition row. */
async function seedMeals(userId: string, n: number): Promise<void> {
  const now = Date.now();
  await env.DB.prepare('INSERT INTO users (id, telegram_user_id, created_at) VALUES (?, ?, ?)')
    .bind(userId, seedTgId++, now)
    .run();
  for (let i = 0; i < n; i++) {
    const mealId = `${userId}-m${i}`;
    await env.DB.prepare(
      'INSERT INTO meals (id, user_id, created_at, logged_at) VALUES (?, ?, ?, ?)',
    )
      .bind(mealId, userId, now, now)
      .run();
    await env.DB.prepare('INSERT INTO food_items (id, meal_id, name, quantity) VALUES (?, ?, ?, 1)')
      .bind(`${mealId}-f`, mealId, `food ${i}`)
      .run();
    await env.DB.prepare(
      'INSERT INTO nutrition (meal_id, energy_kcal, protein_g, carbs_g, fat_g, source) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(mealId, 100, 5, 10, 2, 'table')
      .run();
  }
}

describe('exportUser statement count (kills the N+1)', () => {
  it('uses a constant number of statements for a 100-meal user (≤ 8)', async () => {
    const userId = 'count-100';
    await seedMeals(userId, 100);

    const { db, count } = countingDb(env.DB);
    const data = await exportUser(createAccountDb(db), userId);
    expect(data?.meals).toHaveLength(100);
    // user + settings + meals + saved + 1 chunk of food + 1 chunk of nutrition = 6.
    expect(count()).toBeLessThanOrEqual(8);
  });

  it('does not grow the statement count with the meal count', async () => {
    const small = countingDb(env.DB);
    const smallUser = 'count-5';
    await seedMeals(smallUser, 5);
    await exportUser(createAccountDb(small.db), smallUser);

    const big = countingDb(env.DB);
    const bigUser = 'count-99';
    await seedMeals(bigUser, 99);
    await exportUser(createAccountDb(big.db), bigUser);

    // 5 meals and 99 meals both fit in one id-chunk → identical statement count.
    expect(big.count()).toBe(small.count());
  });
});

describe('GET /api/account/export streams byte-identical JSON', () => {
  it('returns valid JSON that deep-equals the buffered builder output', async () => {
    const tgId = 8101;
    await saveKeyAndMeal(tgId);

    const app = createApp();
    const res = await app.request('/api/account/export', { headers: await headers(tgId) }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(
      /attachment; filename="snapbite-export-\d{4}-\d{2}-\d{2}\.json"/,
    );

    const text = await res.text();
    // Must parse (corrupting the JSON is worse than buffering).
    const streamed = JSON.parse(text) as Record<string, unknown>;

    // Resolve the same user id the route used, then build the buffered version.
    const idRow = await env.DB.prepare('SELECT id FROM users WHERE telegram_user_id = ?')
      .bind(tgId)
      .first<{ id: string }>();
    const buffered = await exportUser(createAccountDb(env.DB), idRow?.id ?? '');
    // `exportedAt` is a wall-clock timestamp; normalize it before comparing.
    const normalized = { ...buffered, exportedAt: 'X' } as Record<string, unknown>;
    expect({ ...streamed, exportedAt: 'X' }).toEqual(normalized);

    // No key material leaked through the stream.
    expect(text).not.toContain('sk-secret-9999');
    expect(text.toLowerCase()).not.toContain('ciphertext');
    expect(text.toLowerCase()).not.toContain('"iv"');
  });
});
