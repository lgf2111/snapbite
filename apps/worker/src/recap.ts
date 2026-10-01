import {
  type DayTotal,
  UserProfile,
  computeTargets,
  currentStreak,
  summarizeWeek,
} from '@snapbite/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { localWeekKey } from './adaptive.js';
import { logError } from './db/errors.js';
import { createMealsDb, mealRowsSince } from './db/meals.js';
import { settings, users } from './db/schema.js';
import { type Preferences, type RecapConfig, parsePreferences } from './db/settings.js';
import type { Env } from './env.js';
import { localDayKey } from './routes/meals.js';
import { TelegramBotClient } from './telegram/botClient.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A user opted into the weekly recap, joined to their Telegram id. */
interface RecapUser {
  userId: string;
  telegramUserId: number;
  preferencesJson: string | null;
}

/** Whether `nowMs` (in the user's local time) falls on a Sunday. */
export function isLocalSunday(nowMs: number, tzOffsetMinutes: number): boolean {
  return new Date(nowMs - tzOffsetMinutes * 60_000).getUTCDay() === 0;
}

async function loadRecapUsers(db: D1Database): Promise<RecapUser[]> {
  const orm = drizzle(db, { schema: { settings, users } });
  const rows = await orm
    .select({
      userId: users.id,
      telegramUserId: users.telegramUserId,
      preferencesJson: settings.preferencesJson,
    })
    .from(settings)
    .innerJoin(users, eq(settings.userId, users.id));
  const out: RecapUser[] = [];
  for (const r of rows) {
    if (parsePreferences(r.preferencesJson).recap?.enabled) {
      out.push({
        userId: r.userId,
        telegramUserId: r.telegramUserId,
        preferencesJson: r.preferencesJson,
      });
    }
  }
  return out;
}

async function stampRecap(
  db: D1Database,
  userId: string,
  prefs: Preferences,
  recap: RecapConfig,
  weekKey: string,
): Promise<void> {
  const next: Preferences = {
    ...prefs,
    recap: { ...recap, lastRecapKey: weekKey },
    updatedAt: Date.now(),
  };
  const orm = drizzle(db, { schema: { settings, users } });
  await orm
    .update(settings)
    .set({ preferencesJson: JSON.stringify(next), updatedAt: Date.now() })
    .where(eq(settings.userId, userId));
}

/** Formats the recap DM text from a {@link summarizeWeek} result. */
export function recapMessage(
  summary: ReturnType<typeof summarizeWeek>,
  target: { energyKcal: number } | null,
): string {
  if (summary.loggedDays === 0) {
    return [
      '📅 Your week in review',
      '',
      'No meals logged this week — a fresh start is one photo away. Send me a meal to pick your streak back up! 💪',
    ].join('\n');
  }
  const lines = [
    '📅 Your week in review',
    '',
    `• Logged ${summary.loggedDays}/7 days (${summary.totalMeals} meals)`,
    `• Avg ${summary.avgKcal} kcal/day${target ? ` (target ${target.energyKcal})` : ''}`,
    `• Avg ${summary.avgProteinG} g protein/day`,
  ];
  if (summary.proteinHit) {
    lines.push(
      `• Hit your protein goal ${summary.proteinHit.days}/${summary.proteinHit.of} logged days`,
    );
  }
  if (summary.streak >= 2) lines.push(`• 🔥 ${summary.streak}-day streak going`);
  lines.push('', 'Keep it up — everything stays an editable estimate.');
  return lines.join('\n');
}

/**
 * Builds + sends one user's weekly recap, once per local week on their local
 * Sunday. Returns a short status, or null when skipped (not Sunday / already
 * sent this week / disabled). Deterministic; best-effort.
 */
export async function recapUser(
  env: Env,
  bot: Pick<TelegramBotClient, 'sendMessage'>,
  u: RecapUser,
  nowMs: number,
): Promise<string | null> {
  const prefs = parsePreferences(u.preferencesJson);
  const recap = prefs.recap as RecapConfig | undefined;
  if (!recap?.enabled) return null;
  const tz = recap.tzOffsetMinutes ?? 0;
  if (!isLocalSunday(nowMs, tz)) return null;
  const weekKey = localWeekKey(nowMs, tz);
  if (recap.lastRecapKey === weekKey) return null;

  // Bucket the last 7 local days of meals into per-day totals.
  const mealsDb = createMealsDb(env.DB);
  const rows = await mealRowsSince(mealsDb, u.userId, nowMs - 7 * DAY_MS);
  const byDay = new Map<string, DayTotal>();
  for (const r of rows) {
    const key = localDayKey(r.loggedAt, tz);
    const d = byDay.get(key) ?? { dayKey: key, energyKcal: 0, proteinG: 0, meals: 0 };
    d.energyKcal += r.energyKcal;
    d.proteinG += r.proteinG;
    d.meals += 1;
    byDay.set(key, d);
  }
  const days = [...byDay.values()];

  const parsedProfile = prefs.profile ? UserProfile.safeParse(prefs.profile) : undefined;
  const targets = parsedProfile?.success ? computeTargets(parsedProfile.data) : null;
  const streak = currentStreak(new Set(byDay.keys()), localDayKey(nowMs, tz));
  const summary = summarizeWeek({
    days,
    target: targets ? { energyKcal: targets.energyKcal, proteinG: targets.proteinG } : null,
    streak,
  });

  await bot.sendMessage(u.telegramUserId, {
    text: recapMessage(summary, targets ? { energyKcal: targets.energyKcal } : null),
  });
  await stampRecap(env.DB, u.userId, prefs, recap, weekKey);
  return `recap ${u.userId}: ${summary.loggedDays}/7 days`;
}

/**
 * Cron entrypoint for weekly recaps. For each opted-in user whose local time is
 * Sunday and who hasn't had one this week, DMs a "week in review". Best-effort.
 */
export async function runWeeklyRecaps(env: Env, nowMs: number = Date.now()): Promise<number> {
  if (!env.TELEGRAM_BOT_TOKEN) return 0;
  const bot = new TelegramBotClient(env.TELEGRAM_BOT_TOKEN);
  const list = await loadRecapUsers(env.DB);
  let sent = 0;
  for (const u of list) {
    try {
      if (await recapUser(env, bot, u, nowMs)) sent += 1;
    } catch (err) {
      await logError(env.DB, {
        telegramUserId: u.telegramUserId,
        source: 'recap',
        kind: 'cron',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return sent;
}
