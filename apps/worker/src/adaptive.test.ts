import { env } from 'cloudflare:test';
import type { BotReply } from '@snapbite/core';
import { describe, expect, it } from 'vitest';
import { localWeekKey, recalibrateUser, runAdaptiveCheckins } from './adaptive.js';
import { createMealsDb, saveMeal } from './db/meals.js';
import {
  createSettingsDb,
  getSettings,
  mergePreferences,
  parsePreferences,
} from './db/settings.js';
import { createDb, upsertUser } from './db/users.js';

const DAY = 24 * 60 * 60 * 1000;

/** A minimal valid resolved MealResult totalling `kcal`. */
function meal(kcal: number) {
  return {
    foods: [
      {
        food: { name: 'food', estimatedWeightG: 100, quantity: 1, confidence: 0.9 },
        nutrition: {
          energyKcal: kcal,
          proteinG: 20,
          carbsG: 40,
          fatG: 10,
          source: 'ai_estimate' as const,
        },
      },
    ],
    total: { energyKcal: kcal, proteinG: 20, carbsG: 40, fatG: 10, source: 'ai_estimate' as const },
    confidence: 0.9,
    needsConfirmation: false,
  };
}

const PROFILE = {
  sex: 'male' as const,
  birthDate: '1990-03-10',
  heightCm: 178,
  weightKg: 80,
  activity: 'moderate' as const,
  goal: 'lose_steady' as const,
  units: 'metric' as const,
};

async function seedUser(tgId: number, nowMs: number, opts: { enabled: boolean }) {
  const user = await upsertUser(createDb(env.DB), { id: tgId });
  const settingsDb = createSettingsDb(env.DB);
  // Profile + opt-in adaptive + three weigh-ins over 14 days (losing ~1kg).
  await mergePreferences(settingsDb, user.id, {
    profile: PROFILE,
    adaptive: { enabled: opts.enabled, tzOffsetMinutes: 0 },
    weights: [
      { ts: nowMs - 14 * DAY, kg: 80 },
      { ts: nowMs - 7 * DAY, kg: 79.5 },
      { ts: nowMs - 1 * DAY, kg: 79 },
    ],
  });
  // Log meals across the window so average intake is meaningful (~2000/day).
  const mealsDb = createMealsDb(env.DB);
  for (let d = 13; d >= 0; d--) {
    await saveMeal(mealsDb, { userId: user.id, meal: meal(2000), loggedAt: nowMs - d * DAY });
  }
  return user;
}

function mockBot(sent: Array<{ chatId: number; reply: BotReply }>) {
  return {
    async sendMessage(chatId: number, reply: BotReply) {
      sent.push({ chatId, reply });
      return { messageId: 1 };
    },
  };
}

describe('localWeekKey', () => {
  it('produces a YYYY-Www key and is stable within a week', () => {
    const base = Date.UTC(2026, 5, 10, 12); // a Wednesday
    const k = localWeekKey(base, 0);
    expect(k).toMatch(/^\d{4}-W\d{2}$/);
    expect(localWeekKey(base + DAY, 0)).toBe(k); // next day, same ISO week
  });
});

describe('recalibrateUser', () => {
  it('measures TDEE, nudges the target, DMs a check-in, and stamps the week', async () => {
    const now = Date.now();
    const tgId = 10100;
    const user = await seedUser(tgId, now, { enabled: true });

    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const prefsBefore = parsePreferences(
      (await getSettings(createSettingsDb(env.DB), user.id))?.preferencesJson,
    );
    const status = await recalibrateUser(
      env,
      mockBot(sent),
      { userId: user.id, telegramUserId: tgId, preferencesJson: JSON.stringify(prefsBefore) },
      now,
    );
    expect(status).toBeTruthy();

    // DM'd a weekly check-in.
    const dm = sent.find((s) => s.chatId === tgId);
    expect(dm?.reply.text).toContain('Weekly check-in');
    expect(dm?.reply.text.toLowerCase()).toContain('burn');

    // Persisted an advanced calorie override + a week stamp.
    const prefsAfter = parsePreferences(
      (await getSettings(createSettingsDb(env.DB), user.id))?.preferencesJson,
    );
    const profile = prefsAfter.profile as { mode?: string; calorieTargetOverride?: number };
    expect(profile.mode).toBe('advanced');
    expect(typeof profile.calorieTargetOverride).toBe('number');
    expect(prefsAfter.adaptive?.lastCheckinKey).toBe(localWeekKey(now, 0));
  });

  it('is a no-op the second time in the same week (dedup)', async () => {
    const now = Date.now();
    const tgId = 10101;
    const user = await seedUser(tgId, now, { enabled: true });
    const sent: Array<{ chatId: number; reply: BotReply }> = [];

    const prefs0 = JSON.stringify(
      parsePreferences((await getSettings(createSettingsDb(env.DB), user.id))?.preferencesJson),
    );
    await recalibrateUser(
      env,
      mockBot(sent),
      { userId: user.id, telegramUserId: tgId, preferencesJson: prefs0 },
      now,
    );
    const prefs1 = JSON.stringify(
      parsePreferences((await getSettings(createSettingsDb(env.DB), user.id))?.preferencesJson),
    );
    const again = await recalibrateUser(
      env,
      mockBot(sent),
      { userId: user.id, telegramUserId: tgId, preferencesJson: prefs1 },
      now,
    );
    expect(again).toBeNull(); // already stamped this week
  });

  it('does nothing when adaptive is disabled', async () => {
    const now = Date.now();
    const tgId = 10102;
    const user = await seedUser(tgId, now, { enabled: false });
    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const prefs = JSON.stringify(
      parsePreferences((await getSettings(createSettingsDb(env.DB), user.id))?.preferencesJson),
    );
    const status = await recalibrateUser(
      env,
      mockBot(sent),
      { userId: user.id, telegramUserId: tgId, preferencesJson: prefs },
      now,
    );
    expect(status).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('runAdaptiveCheckins returns 0 when no bot token is configured', async () => {
    const n = await runAdaptiveCheckins(
      { ...env, TELEGRAM_BOT_TOKEN: '' } as typeof env,
      Date.now(),
    );
    expect(n).toBe(0);
  });
});
