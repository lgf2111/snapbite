import { env } from 'cloudflare:test';
import type { BotReply } from '@snapbite/core';
import { describe, expect, it } from 'vitest';
import { createMealsDb, saveMeal } from './db/meals.js';
import {
  createSettingsDb,
  getSettings,
  mergePreferences,
  parsePreferences,
} from './db/settings.js';
import { createDb, upsertUser } from './db/users.js';
import { isLocalSunday, recapUser, runWeeklyRecaps } from './recap.js';

const DAY = 24 * 60 * 60 * 1000;

function meal(kcal: number, proteinG: number) {
  return {
    foods: [
      {
        food: { name: 'food', estimatedWeightG: 100, quantity: 1, confidence: 0.9 },
        nutrition: {
          energyKcal: kcal,
          proteinG,
          carbsG: 40,
          fatG: 10,
          source: 'ai_estimate' as const,
        },
      },
    ],
    total: {
      energyKcal: kcal,
      proteinG,
      carbsG: 40,
      fatG: 10,
      source: 'ai_estimate' as const,
    },
    confidence: 0.9,
    needsConfirmation: false,
  };
}

/** A Sunday at noon UTC. */
const SUNDAY = Date.UTC(2026, 5, 7, 12); // 2026-06-07 is a Sunday

function bot(sent: Array<{ chatId: number; reply: BotReply }>) {
  return {
    async sendMessage(chatId: number, reply: BotReply) {
      sent.push({ chatId, reply });
      return { messageId: 1 };
    },
  };
}

async function seed(tgId: number, enabled: boolean) {
  const user = await upsertUser(createDb(env.DB), { id: tgId });
  await mergePreferences(createSettingsDb(env.DB), user.id, {
    recap: { enabled, tzOffsetMinutes: 0 },
  });
  // Three logged days in the past week.
  const mealsDb = createMealsDb(env.DB);
  for (const d of [1, 2, 3]) {
    await saveMeal(mealsDb, { userId: user.id, meal: meal(2000, 140), loggedAt: SUNDAY - d * DAY });
  }
  return user;
}

describe('isLocalSunday', () => {
  it('detects the local Sunday', () => {
    expect(isLocalSunday(SUNDAY, 0)).toBe(true);
    expect(isLocalSunday(SUNDAY + DAY, 0)).toBe(false); // Monday
  });
});

describe('recapUser', () => {
  it('DMs a week-in-review on the local Sunday and stamps the week', async () => {
    const tgId = 11000;
    const user = await seed(tgId, true);
    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const prefs = JSON.stringify(
      parsePreferences((await getSettings(createSettingsDb(env.DB), user.id))?.preferencesJson),
    );
    const status = await recapUser(
      env,
      bot(sent),
      { userId: user.id, telegramUserId: tgId, preferencesJson: prefs },
      SUNDAY,
    );
    expect(status).toBeTruthy();
    const dm = sent.find((s) => s.chatId === tgId);
    expect(dm?.reply.text).toContain('week in review');
    expect(dm?.reply.text).toContain('Logged 3/7 days');

    // Stamped → a second call the same week is a no-op.
    const prefs2 = JSON.stringify(
      parsePreferences((await getSettings(createSettingsDb(env.DB), user.id))?.preferencesJson),
    );
    const again = await recapUser(
      env,
      bot(sent),
      { userId: user.id, telegramUserId: tgId, preferencesJson: prefs2 },
      SUNDAY,
    );
    expect(again).toBeNull();
  });

  it('does nothing on a non-Sunday', async () => {
    const tgId = 11001;
    const user = await seed(tgId, true);
    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const prefs = JSON.stringify(
      parsePreferences((await getSettings(createSettingsDb(env.DB), user.id))?.preferencesJson),
    );
    const status = await recapUser(
      env,
      bot(sent),
      { userId: user.id, telegramUserId: tgId, preferencesJson: prefs },
      SUNDAY + DAY, // Monday
    );
    expect(status).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('does nothing when recap is disabled', async () => {
    const tgId = 11002;
    const user = await seed(tgId, false);
    const sent: Array<{ chatId: number; reply: BotReply }> = [];
    const prefs = JSON.stringify(
      parsePreferences((await getSettings(createSettingsDb(env.DB), user.id))?.preferencesJson),
    );
    expect(
      await recapUser(
        env,
        bot(sent),
        { userId: user.id, telegramUserId: tgId, preferencesJson: prefs },
        SUNDAY,
      ),
    ).toBeNull();
  });

  it('runWeeklyRecaps returns 0 without a bot token', async () => {
    const n = await runWeeklyRecaps({ ...env, TELEGRAM_BOT_TOKEN: '' } as typeof env, SUNDAY);
    expect(n).toBe(0);
  });
});
