import {
  type DailyTargets,
  UserProfile,
  computeTargets,
  estimateTdeeKcal,
  recalibrateCalorieTarget,
  weightTrend,
} from '@snapbite/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { logError } from './db/errors.js';
import { createMealsDb, sumMealsSince } from './db/meals.js';
import { settings, users } from './db/schema.js';
import {
  type AdaptiveConfig,
  type Preferences,
  type WeightEntry,
  parsePreferences,
} from './db/settings.js';
import type { Env } from './env.js';
import { TelegramBotClient } from './telegram/botClient.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Window the recalibration measures over. */
const WINDOW_DAYS = 14;
/** Minimum weigh-ins and span required before we trust an estimate. */
const MIN_WEIGHINS = 3;
const MIN_SPAN_DAYS = 7;
/** Minimum meal-days of logging in the window (so avg intake is meaningful). */
const MIN_INTAKE_KCAL_PER_DAY = 800;

/** A user opted into adaptive targets, joined to their Telegram id. */
interface AdaptiveUser {
  userId: string;
  telegramUserId: number;
  preferencesJson: string | null;
}

/** Local ISO-week key (YYYY-Www) for the dedup stamp, in the user's local time. */
export function localWeekKey(nowMs: number, tzOffsetMinutes: number): string {
  const local = new Date(nowMs - tzOffsetMinutes * 60_000);
  // ISO week number.
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / DAY_MS -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Loads every user who has opted into adaptive targets. */
async function loadAdaptiveUsers(db: D1Database): Promise<AdaptiveUser[]> {
  const orm = drizzle(db, { schema: { settings, users } });
  const rows = await orm
    .select({
      userId: users.id,
      telegramUserId: users.telegramUserId,
      preferencesJson: settings.preferencesJson,
    })
    .from(settings)
    .innerJoin(users, eq(settings.userId, users.id));

  const out: AdaptiveUser[] = [];
  for (const r of rows) {
    if (parsePreferences(r.preferencesJson).adaptive?.enabled) {
      out.push({
        userId: r.userId,
        telegramUserId: r.telegramUserId,
        preferencesJson: r.preferencesJson,
      });
    }
  }
  return out;
}

/** Persists an updated preferences object (merge of profile + adaptive stamp). */
async function savePrefs(db: D1Database, userId: string, next: Preferences): Promise<void> {
  const orm = drizzle(db, { schema: { settings, users } });
  await orm
    .update(settings)
    .set({
      preferencesJson: JSON.stringify({ ...next, updatedAt: Date.now() }),
      updatedAt: Date.now(),
    })
    .where(eq(settings.userId, userId));
}

/**
 * The weekly recalibration for one user. Returns a short status for logging.
 * Deterministic: measures real TDEE from logged intake vs the smoothed weight
 * trend over the window, nudges the calorie target toward it for the user's
 * goal, writes it back as an advanced override, and DMs a one-line check-in.
 * No-ops (returns null) when there isn't enough data or it already ran this week.
 */
export async function recalibrateUser(
  env: Env,
  bot: Pick<TelegramBotClient, 'sendMessage'>,
  u: AdaptiveUser,
  nowMs: number,
): Promise<string | null> {
  const prefs = parsePreferences(u.preferencesJson);
  const adaptive = prefs.adaptive as AdaptiveConfig | undefined;
  if (!adaptive?.enabled) return null;

  const tz = adaptive.tzOffsetMinutes ?? 0;
  const weekKey = localWeekKey(nowMs, tz);
  if (adaptive.lastCheckinKey === weekKey) return null; // already done this week

  const parsedProfile = prefs.profile ? UserProfile.safeParse(prefs.profile) : undefined;
  if (!parsedProfile?.success) return null;
  const profile = parsedProfile.data;

  const weights: WeightEntry[] = Array.isArray(prefs.weights) ? prefs.weights : [];
  const sinceMs = nowMs - WINDOW_DAYS * DAY_MS;
  const windowWeights = weights.filter((w) => w.ts >= sinceMs);
  const trend = weightTrend(windowWeights);
  if (!trend || trend.count < MIN_WEIGHINS || trend.days < MIN_SPAN_DAYS) return null;

  // Average daily intake over the SAME span as the trend.
  const mealsDb = createMealsDb(env.DB);
  const intakeSinceMs = nowMs - trend.days * DAY_MS;
  const totals = await sumMealsSince(mealsDb, u.userId, intakeSinceMs);
  const avgIntakeKcal = totals.energyKcal / trend.days;
  if (!(avgIntakeKcal >= MIN_INTAKE_KCAL_PER_DAY)) return null;

  const measuredTdee = estimateTdeeKcal({
    avgIntakeKcal,
    trendDeltaKg: trend.deltaKg,
    days: trend.days,
  });
  if (measuredTdee == null) return null;

  const currentTarget: DailyTargets = computeTargets(profile);
  const newKcal = recalibrateCalorieTarget({
    measuredTdee,
    goal: profile.goal,
    currentTarget: currentTarget.energyKcal,
  });

  // Persist as an advanced calorie override + stamp the week so we run once/wk.
  const nextProfile = {
    ...profile,
    mode: 'advanced' as const,
    calorieTargetOverride: newKcal,
  };
  const next: Preferences = {
    ...prefs,
    profile: nextProfile,
    adaptive: { ...adaptive, lastCheckinKey: weekKey },
  };
  await savePrefs(env.DB, u.userId, next);

  const delta = newKcal - currentTarget.energyKcal;
  const move =
    delta === 0
      ? 'kept your target'
      : `${delta > 0 ? 'nudged your target up' : 'nudged your target down'} to ${newKcal} kcal`;
  const text = [
    '📅 Weekly check-in',
    `Your real daily burn looks like ~${measuredTdee} kcal (from your logging + weight trend).`,
    `I ${move}. It's an estimate — tweak it anytime in SnapBite → Settings.`,
  ].join('\n');
  await bot.sendMessage(u.telegramUserId, { text });

  return `recalibrated ${u.userId}: tdee=${measuredTdee} target=${newKcal}`;
}

/**
 * Cron entrypoint for adaptive targets. For each opted-in user with enough
 * data, recalibrates their calorie target once per local week and DMs a
 * check-in. Best-effort per user — one failure never blocks the rest.
 */
export async function runAdaptiveCheckins(env: Env, nowMs: number = Date.now()): Promise<number> {
  if (!env.TELEGRAM_BOT_TOKEN) return 0;
  const bot = new TelegramBotClient(env.TELEGRAM_BOT_TOKEN);
  const usersList = await loadAdaptiveUsers(env.DB);
  let recalibrated = 0;
  for (const u of usersList) {
    try {
      const status = await recalibrateUser(env, bot, u, nowMs);
      if (status) recalibrated += 1;
    } catch (err) {
      await logError(env.DB, {
        telegramUserId: u.telegramUserId,
        source: 'adaptive',
        kind: 'cron',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return recalibrated;
}
