import { env } from 'cloudflare:test';
import { type BotReply, signInitData } from '@snapbite/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { INIT_DATA_HEADER } from '../middleware/auth.js';
import { createMealsDb } from './meals.js';
import * as metricsModule from './metrics.js';
import { createMetricsDb, isoWeek, metricDay } from './metrics.js';
import { meals, metrics, userActivity } from './schema.js';
import { createDb, upsertUser } from './users.js';

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';
const SECRET = 'test-webhook-secret';
const ADMIN_ID = 999000; // matches vitest.config.ts ADMIN_TELEGRAM_ID

function post(body: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers[SECRET_HEADER] = secret;
  return { method: 'POST', headers, body: JSON.stringify(body) };
}

/** Reads a single counter's value for today, or 0 when absent. */
async function counterToday(name: 'user_started' | 'first_meal' | 'meal_logged'): Promise<number> {
  const db = createMetricsDb(env.DB);
  const rows = await db.select().from(metrics).where(eq(metrics.name, name));
  return rows.filter((r) => r.day === metricDay()).reduce((acc, r) => acc + r.count, 0);
}

/** Signs initData for a Telegram id so authenticated API calls can be made. */
async function initDataFor(tgId: number): Promise<string> {
  const user = JSON.stringify({ id: tgId, first_name: 'Ada' });
  const authDate = String(Math.floor(Date.now() / 1000));
  return signInitData({ user, auth_date: authDate }, '123456:LOCAL-DEV-BOT-TOKEN');
}

/** A minimal valid MealResult body for the meals API. */
function mealBody(name = 'Egg', kcal = 100) {
  return {
    foods: [
      {
        food: { name, estimatedWeightG: 100, quantity: 1, confidence: 0.9 },
        nutrition: { energyKcal: kcal, proteinG: 5, carbsG: 10, fatG: 3, source: 'manual' },
      },
    ],
    total: { energyKcal: kcal, proteinG: 5, carbsG: 10, fatG: 3, source: 'manual' },
    confidence: 0.9,
    needsConfirmation: false,
  };
}

/** Saves a meal via the authenticated manual-entry endpoint. Returns the response. */
async function saveMealApi(tgId: number) {
  const initData = await initDataFor(tgId);
  return createApp().request(
    '/api/meals',
    {
      method: 'POST',
      headers: { [INIT_DATA_HEADER]: initData, 'content-type': 'application/json' },
      body: JSON.stringify({ meal: mealBody() }),
    },
    env,
  );
}

describe('metrics helpers', () => {
  it('isoWeek formats as YYYY-Www and metricDay as YYYY-MM-DD', () => {
    // 2026-10-29 is a Thursday → ISO week 44 of 2026.
    expect(isoWeek(Date.parse('2026-10-29T12:00:00Z'))).toBe('2026-W44');
    expect(metricDay(Date.parse('2026-10-29T12:00:00Z'))).toBe('2026-10-29');
  });

  it('bumpCounter upserts and increments on conflict', async () => {
    await metricsModule.bumpCounter(env.DB, 'meal_logged', '2020-01-01');
    await metricsModule.bumpCounter(env.DB, 'meal_logged', '2020-01-01');
    const db = createMetricsDb(env.DB);
    const rows = await db.select().from(metrics).where(eq(metrics.day, '2020-01-01'));
    expect(rows[0]?.count).toBe(2);
  });

  it('recordActivity is idempotent for the same user+week (INSERT OR IGNORE)', async () => {
    await metricsModule.recordActivity(env.DB, 55501, '2020-W01');
    await metricsModule.recordActivity(env.DB, 55501, '2020-W01');
    const db = createMetricsDb(env.DB);
    const rows = await db.select().from(userActivity).where(eq(userActivity.userId, 55501));
    expect(rows).toHaveLength(1);
  });

  it('the migration created readable metrics + user_activity tables', async () => {
    // Prove the new migration applied in the Miniflare env by reading both tables.
    const db = createMetricsDb(env.DB);
    await expect(db.select().from(metrics)).resolves.toBeInstanceOf(Array);
    await expect(db.select().from(userActivity)).resolves.toBeInstanceOf(Array);
  });
});

describe('user_started counter via /start', () => {
  it('counts a NEW user once and does NOT recount on a second /start', async () => {
    const tgId = 50001;
    const app = createApp();
    const before = await counterToday('user_started');

    await app.request(
      '/webhook',
      post({ message: { text: '/start', chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    const afterFirst = await counterToday('user_started');
    expect(afterFirst).toBe(before + 1);

    // Same user presses /start again — the row already exists, so no new count.
    await app.request(
      '/webhook',
      post({ message: { text: '/start', chat: { id: tgId }, from: { id: tgId } } }),
      env,
    );
    const afterSecond = await counterToday('user_started');
    expect(afterSecond).toBe(afterFirst);
  });
});

describe('first_meal / meal_logged counters on save', () => {
  it('bumps first_meal only on the first meal, meal_logged on every save', async () => {
    const tgId = 50002;
    const firstBefore = await counterToday('first_meal');
    const loggedBefore = await counterToday('meal_logged');

    const r1 = await saveMealApi(tgId);
    expect(r1.status).toBe(201);
    expect(await counterToday('first_meal')).toBe(firstBefore + 1);
    expect(await counterToday('meal_logged')).toBe(loggedBefore + 1);

    // Second meal for the same user: meal_logged bumps, first_meal does NOT.
    const r2 = await saveMealApi(tgId);
    expect(r2.status).toBe(201);
    expect(await counterToday('first_meal')).toBe(firstBefore + 1);
    expect(await counterToday('meal_logged')).toBe(loggedBefore + 2);

    // The user is marked active for the current ISO week.
    const db = createMetricsDb(env.DB);
    const active = await db.select().from(userActivity).where(eq(userActivity.userId, tgId));
    expect(active.some((a) => a.week === isoWeek())).toBe(true);
  });

  it('a failing metrics write does not prevent the meal from being saved', async () => {
    const tgId = 50003;
    const spy = vi
      .spyOn(metricsModule, 'recordMealSave')
      .mockRejectedValue(new Error('metrics down'));
    try {
      const res = await saveMealApi(tgId);
      // The save itself still succeeds despite the metrics failure.
      expect(res.status).toBe(201);
      const user = await upsertUser(createDb(env.DB), { id: tgId });
      const saved = await createMealsDb(env.DB)
        .select()
        .from(meals)
        .where(eq(meals.userId, user.id));
      expect(saved.length).toBeGreaterThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('/stats command (admin-gated)', () => {
  function sentText(sent: Array<{ chatId: number; reply: BotReply }>): string {
    return sent[sent.length - 1]?.reply.text ?? '';
  }

  it('returns no metrics to a non-admin (generic nudge instead)', async () => {
    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const app = createApp({ botClientFactory: () => fakeBot(sent) });
    await app.request(
      '/webhook',
      post({ message: { text: '/stats', chat: { id: 4402 }, from: { id: 4402 } } }),
      env,
    );
    const text = sentText(sent).toLowerCase();
    expect(text).toContain('open snapbite');
    expect(text).not.toContain('snapbite stats');
  });

  it('returns the recorded counts to the admin', async () => {
    // Seed a meal so there is something to report.
    await saveMealApi(50010);

    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const app = createApp({ botClientFactory: () => fakeBot(sent) });
    await app.request(
      '/webhook',
      post({ message: { text: '/stats', chat: { id: ADMIN_ID }, from: { id: ADMIN_ID } } }),
      env,
    );
    const text = sentText(sent);
    expect(text).toContain('SnapBite stats');
    expect(text).toContain('Meals today:');
    expect(text).toContain('Total meals:');
    // The admin reply reflects real numbers (at least the meal we just logged).
    const m = /Meals today: (\d+)/.exec(text);
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(1);
  });
});

/** A tiny BotClient that just captures sent messages (no network). */
function fakeBot(sent: Array<{ chatId: number; reply: BotReply }>) {
  let nextId = 2000;
  return {
    async sendMessage(chatId: number, reply: BotReply) {
      sent.push({ chatId, reply });
      return { messageId: nextId++ };
    },
    async getFilePath() {
      return null;
    },
    async downloadFile() {
      return null;
    },
    async editMessageText() {
      return true;
    },
    async deleteMessage() {
      return true;
    },
    async answerCallbackQuery() {
      return true;
    },
  };
}
