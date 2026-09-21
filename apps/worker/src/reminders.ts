import { dueReminderSlots, reminderMessage } from '@snapbite/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { logError } from './db/errors.js';
import { parsePreferences, type ReminderConfig } from './db/settings.js';
import { settings, users } from './db/schema.js';
import type { Env } from './env.js';
import { TelegramBotClient } from './telegram/botClient.js';

/**
 * Cron interval width in minutes. The cron trigger runs every 15 min, so a slot
 * is considered "due" if the current local time is within 15 min after it. Keep
 * this in sync with the crons entry in wrangler.toml.
 */
export const REMINDER_WINDOW_MINUTES = 15;

/** A user's reminder config joined with the Telegram id we DM. */
interface UserReminder {
  userId: string;
  telegramUserId: number;
  reminders: ReminderConfig;
  preferencesJson: string | null;
}

/** Loads every user with reminders enabled, joined to their Telegram id. */
async function loadEnabledReminders(db: D1Database): Promise<UserReminder[]> {
  const orm = drizzle(db, { schema: { settings, users } });
  const rows = await orm
    .select({
      userId: users.id,
      telegramUserId: users.telegramUserId,
      preferencesJson: settings.preferencesJson,
    })
    .from(settings)
    .innerJoin(users, eq(settings.userId, users.id));

  const out: UserReminder[] = [];
  for (const r of rows) {
    const reminders = parsePreferences(r.preferencesJson).reminders;
    if (reminders?.enabled) {
      out.push({
        userId: r.userId,
        telegramUserId: r.telegramUserId,
        reminders,
        preferencesJson: r.preferencesJson,
      });
    }
  }
  return out;
}

/** Persists an updated `lastSent` map back into preferences_json (merge). */
async function markSent(
  db: D1Database,
  userId: string,
  preferencesJson: string | null,
  lastSent: Record<string, string>,
): Promise<void> {
  const prefs = parsePreferences(preferencesJson);
  const next = {
    ...prefs,
    reminders: { ...(prefs.reminders as ReminderConfig), lastSent },
    updatedAt: Date.now(),
  };
  const orm = drizzle(db, { schema: { settings, users } });
  await orm
    .update(settings)
    .set({ preferencesJson: JSON.stringify(next), updatedAt: Date.now() })
    .where(eq(settings.userId, userId));
}

/**
 * Cron entrypoint: finds all users whose local time hits an enabled reminder
 * slot now (and hasn't been sent today) and DMs them. Best-effort per user —
 * one failure never blocks the rest. Returns the number of reminders sent.
 */
export async function runReminders(env: Env, nowMs: number = Date.now()): Promise<number> {
  if (!env.TELEGRAM_BOT_TOKEN) return 0;
  const bot = new TelegramBotClient(env.TELEGRAM_BOT_TOKEN);
  const enabled = await loadEnabledReminders(env.DB);
  let sent = 0;

  for (const u of enabled) {
    try {
      const due = dueReminderSlots(u.reminders, nowMs, REMINDER_WINDOW_MINUTES);
      if (due.length === 0) continue;

      const lastSent = { ...(u.reminders.lastSent ?? {}) };
      // Compute the user's local date once for the dedup stamp.
      const localMs = nowMs - u.reminders.tzOffsetMinutes * 60_000;
      const d = new Date(localMs);
      const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

      for (const label of due) {
        await bot.sendMessage(u.telegramUserId, { text: reminderMessage(label) });
        lastSent[label] = dateKey;
        sent += 1;
      }
      await markSent(env.DB, u.userId, u.preferencesJson, lastSent);
    } catch (err) {
      await logError(env.DB, {
        telegramUserId: u.telegramUserId,
        source: 'reminders',
        kind: 'cron',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return sent;
}
