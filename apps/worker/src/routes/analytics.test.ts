import { env } from 'cloudflare:test';
import type { AdvancedReport, MealResult } from '@snapbite/core';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { grantTrial, markSupporter } from '../billing/accounts.js';
import { createAuthDb, createSession } from '../db/auth.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function cookieOf(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null;
  for (const part of setCookie.split(/,(?=[^;]+=)/)) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.split(';')[0] ?? null;
  }
  return null;
}

/** A verified user with a real session row, without going through sign-in. */
async function verifiedUser(): Promise<{ userId: string; email: string; cookie: string }> {
  const userId = crypto.randomUUID();
  const address = `${crypto.randomUUID()}@example.com`;
  await env.DB.prepare(
    'INSERT INTO users (id, email, email_verified_at, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(userId, address, Date.now(), Date.now())
    .run();
  const raw = await createSession(createAuthDb(env.DB), userId, 'email');
  return { userId, email: address, cookie: `sb_session=${raw}` };
}

async function seedMeal(
  userId: string,
  loggedAt: number,
  energyKcal: number,
  proteinG: number,
  food: string,
  weightG: number,
): Promise<void> {
  const mealId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO meals (id, user_id, created_at, logged_at, title) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(mealId, userId, loggedAt, loggedAt, food)
    .run();
  await env.DB.prepare(
    'INSERT INTO food_items (id, meal_id, name, estimated_weight_g, quantity) VALUES (?, ?, ?, ?, 1)',
  )
    .bind(crypto.randomUUID(), mealId, food, weightG)
    .run();
  await env.DB.prepare(
    'INSERT INTO nutrition (meal_id, energy_kcal, protein_g, carbs_g, fat_g, source) VALUES (?, ?, ?, 0, 0, ?)',
  )
    .bind(mealId, energyKcal, proteinG, 'table')
    .run();
}

async function getReport(
  cookie?: string,
  query = 'range=90d&tz=0',
): Promise<{ status: number; body: AdvancedReport & { detail?: string } }> {
  const res = await createApp().request(
    `/api/analytics?${query}`,
    { headers: cookie ? { cookie } : {} },
    env,
  );
  return { status: res.status, body: (await res.json()) as AdvancedReport & { detail?: string } };
}

async function cacheCount(userId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM analytics_cache WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function sampleMeal(): MealResult {
  return {
    foods: [
      {
        food: { name: 'Apple', estimatedWeightG: 100, quantity: 1, confidence: 0.9 },
        nutrition: { energyKcal: 52, proteinG: 0.3, carbsG: 14, fatG: 0.2, source: 'table' },
      },
    ],
    total: { energyKcal: 52, proteinG: 0.3, carbsG: 14, fatG: 0.2, source: 'table' },
    confidence: 0.9,
    needsConfirmation: false,
  };
}

describe('GET /api/analytics', () => {
  it('refuses an anonymous account', async () => {
    const { status, body } = await getReport();
    expect(status).toBe(403);
    expect(body.detail).toMatch(/supporter tag/i);
  });

  it('refuses a verified account that never bought or trialled', async () => {
    const user = await verifiedUser();
    const { status } = await getReport(user.cookie);
    expect(status).toBe(403);
  });

  it('opens for an active trial and for a purchase', async () => {
    const trial = await verifiedUser();
    await grantTrial(env.DB, trial.email);
    expect((await getReport(trial.cookie)).status).toBe(200);

    const buyer = await verifiedUser();
    await markSupporter(env.DB, buyer.email);
    expect((await getReport(buyer.cookie)).status).toBe(200);
  });

  it('rejects an unknown range', async () => {
    const user = await verifiedUser();
    await markSupporter(env.DB, user.email);
    const { status } = await getReport(user.cookie, 'range=30d&tz=0');
    expect(status).toBe(400);
  });

  it('builds the report from photo-less meals', async () => {
    const user = await verifiedUser();
    await markSupporter(env.DB, user.email);

    const todayStart = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    await seedMeal(user.userId, todayStart + 12 * HOUR, 500, 30, 'Chicken', 200);
    await seedMeal(user.userId, todayStart + 19 * HOUR, 700, 40, 'Rice', 250);
    await seedMeal(user.userId, todayStart - 12 * HOUR, 600, 35, 'Chicken', 220);

    const { status, body } = await getReport(user.cookie);
    expect(status).toBe(200);

    // No photo keys are ever read: all three rows have null photo columns.
    expect(body.totals).toMatchObject({ meals: 3, loggedDays: 2, avgKcalPerLoggedDay: 900 });
    expect(body.series).toHaveLength(90);
    expect(body.series.at(-1)).toMatchObject({
      key: new Date(todayStart).toISOString().slice(0, 10),
      energyKcal: 1200,
      proteinG: 70,
      meals: 2,
    });
    expect(body.timeOfDay).toMatchObject([
      { bucket: 'morning', meals: 0 },
      { bucket: 'afternoon', meals: 2 },
      { bucket: 'evening', meals: 1 },
      { bucket: 'night', meals: 0 },
    ]);
    expect(body.dishes.slice(0, 2)).toEqual([
      { name: 'Chicken', meals: 2, sharePct: 67 },
      { name: 'Rice', meals: 1, sharePct: 33 },
    ]);
    // No profile => no targets, so adherence has no percentage.
    expect(body.card.scorePct).toBeNull();
    expect(body.projection).toBeNull();
  });

  it('serves the second report from the per-day cache', async () => {
    const user = await verifiedUser();
    await markSupporter(env.DB, user.email);

    const todayStart = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    await seedMeal(user.userId, todayStart + 12 * HOUR, 500, 30, 'Chicken', 200);

    const first = await getReport(user.cookie);
    expect(first.status).toBe(200);
    expect(first.body.totals.meals).toBe(1);
    expect(await cacheCount(user.userId)).toBe(1);

    // A recomputation would now see no meals. The cached report must survive.
    await env.DB.prepare('DELETE FROM meals WHERE user_id = ?').bind(user.userId).run();
    const second = await getReport(user.cookie);

    expect(second.status).toBe(200);
    expect(second.body.totals).toEqual(first.body.totals);
    expect(second.body.series).toEqual(first.body.series);
  });

  it('drops the cache when a meal is written', async () => {
    const user = await verifiedUser();
    await markSupporter(env.DB, user.email);

    const todayStart = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    await seedMeal(user.userId, todayStart + 12 * HOUR, 500, 30, 'Chicken', 200);
    await getReport(user.cookie);
    expect(await cacheCount(user.userId)).toBe(1);

    const res = await createApp().request(
      '/api/meals',
      {
        method: 'POST',
        headers: { cookie: user.cookie, 'content-type': 'application/json' },
        body: JSON.stringify(sampleMeal()),
      },
      env,
    );
    expect(res.status).toBe(201);
    expect(await cacheCount(user.userId)).toBe(0);

    const { body } = await getReport(user.cookie);
    expect(body.totals.meals).toBe(2);
  });

  it('wires the saved profile into adherence targets', async () => {
    const user = await verifiedUser();
    await markSupporter(env.DB, user.email);
    const profile = {
      sex: 'male',
      age: 30,
      heightCm: 180,
      weightKg: 80,
      activity: 'moderate',
      goal: 'lose_steady',
      units: 'metric',
      mode: 'simple',
    };
    await env.DB.prepare(
      'INSERT INTO settings (user_id, ai_provider, preferences_json, updated_at) VALUES (?, ?, ?, ?)',
    )
      .bind(user.userId, 'gemini', JSON.stringify({ profile }), Date.now())
      .run();

    const todayStart = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    await seedMeal(user.userId, todayStart + 12 * HOUR, 500, 30, 'Chicken', 200);

    const { body } = await getReport(user.cookie);
    expect(body.card.scorePct).not.toBeNull();
    expect(body.projection).toBeNull(); // only one logged day in the recent window
  });

  it('returns twelve monthly points for 12m', async () => {
    const user = await verifiedUser();
    await markSupporter(env.DB, user.email);

    const { status, body } = await getReport(user.cookie, 'range=12m&tz=0');
    expect(status).toBe(200);
    expect(body.range).toBe('12m');
    expect(body.series).toHaveLength(12);
    expect(body.series.at(-1)?.key).toBe(new Date().toISOString().slice(0, 7));
  });
});
