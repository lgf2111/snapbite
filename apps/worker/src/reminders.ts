import {
  MAX_REMINDER_ATTEMPTS,
  type ReminderAttempt,
  dueReminderSlots,
  reminderMessage,
} from '@snapbite/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { logError } from './db/errors.js';
import { createPushDb } from './db/push.js';
import { settings, users } from './db/schema.js';
import { type ReminderConfig, parsePreferences } from './db/settings.js';
import type { Env } from './env.js';
import { type PushFailure, pushToUser } from './push/deliver.js';
import { TelegramBotClient } from './telegram/botClient.js';

/**
 * Cron interval width in minutes. The cron trigger runs every 15 min, so a slot
 * is considered "due" if the current local time is within 15 min after it. Keep
 * this in sync with the crons entry in wrangler.toml.
 */
export const REMINDER_WINDOW_MINUTES = 15;

/** A user's reminder config, with the Telegram id we fall back to (if they have one). */
interface UserReminder {
  userId: string;
  telegramUserId: number | null;
  reminders: ReminderConfig;
  preferencesJson: string | null;
}

/** Loads every user with reminders enabled (with their Telegram id, when they have one). */
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
        // Web-only accounts have none; they can still have a push subscription.
        telegramUserId: r.telegramUserId ?? null,
        reminders,
        preferencesJson: r.preferencesJson,
      });
    }
  }
  return out;
}

/** Persists reminder delivery bookkeeping back into preferences_json (merge). */
async function saveReminderState(
  db: D1Database,
  userId: string,
  preferencesJson: string | null,
  state: {
    lastSent: Record<string, string>;
    attempts: Record<string, ReminderAttempt>;
    lastFailureAt?: number;
  },
): Promise<void> {
  const prefs = parsePreferences(preferencesJson);
  const next = {
    ...prefs,
    reminders: {
      ...(prefs.reminders as ReminderConfig),
      lastSent: state.lastSent,
      attempts: state.attempts,
      ...(state.lastFailureAt != null ? { lastFailureAt: state.lastFailureAt } : {}),
    },
    updatedAt: Date.now(),
  };
  const orm = drizzle(db, { schema: { settings, users } });
  await orm
    .update(settings)
    .set({ preferencesJson: JSON.stringify(next), updatedAt: Date.now() })
    .where(eq(settings.userId, userId));
}

const PUSH_BODIES: Record<string, string> = {
  breakfast: 'Log your breakfast before the day gets busy.',
  lunch: 'Log your meal while it is fresh.',
  dinner: 'Snap your dinner and log it in a few seconds.',
};

/**
 * What the lock screen shows. iOS already prints the app name above the title, so
 * the title is the reminder itself and the body is the instruction. Plain, and no
 * instruction to message a bot.
 */
export function pushReminder(label: string): { title: string; body: string } {
  const name = label.trim() || 'Meal';
  return {
    title: name.charAt(0).toUpperCase() + name.slice(1),
    body: PUSH_BODIES[label] ?? 'Log your meal while it is fresh.',
  };
}

/** The Settings "send a test" notification: unmistakably a test. */
export const TEST_PUSH = {
  title: 'Test reminder',
  body: 'Reminders will look like this.',
} as const;

/**
 * Cron entrypoint: finds all users whose local time hits an enabled reminder
 * slot now (and hasn't been sent today) and reminds them.
 *
 * Channel: web push to every device the user subscribed. The Telegram DM is only
 * the fallback, for an account that has a Telegram identity but no live push
 * subscription (none ever, or every one just turned out dead). Best-effort per
 * user: one failure never blocks the rest. Returns the number of reminders sent.
 */
export async function runReminders(env: Env, nowMs: number = Date.now()): Promise<number> {
  const bot = env.TELEGRAM_BOT_TOKEN ? new TelegramBotClient(env.TELEGRAM_BOT_TOKEN) : null;
  // Without VAPID keys every send would "fail" and wear the subscriptions down
  // for a reason that is ours, so push is simply off until they are set.
  const pushConfigured = Boolean(env.PUSH_VAPID_PUBLIC_KEY && env.PUSH_VAPID_PRIVATE_KEY);
  const pushDb = createPushDb(env.DB);
  const enabled = await loadEnabledReminders(env.DB);
  let sent = 0;

  for (const u of enabled) {
    try {
      const due = dueReminderSlots(u.reminders, nowMs, REMINDER_WINDOW_MINUTES);
      if (due.length === 0) continue;

      const lastSent = { ...(u.reminders.lastSent ?? {}) };
      // Compute the user's local date once for the dedup stamp and retry state.
      const localMs = nowMs - u.reminders.tzOffsetMinutes * 60_000;
      const d = new Date(localMs);
      const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      // Keep only today's failures; yesterday's counters reset by date anyway.
      const attempts: Record<string, ReminderAttempt> = {};
      for (const [label, attempt] of Object.entries(u.reminders.attempts ?? {})) {
        if (attempt.date === dateKey) attempts[label] = attempt;
      }
      let lastFailureAt = u.reminders.lastFailureAt;
      let changed = false;

      for (const label of due) {
        const tries = attempts[label]?.tries ?? 0;
        if (tries >= MAX_REMINDER_ATTEMPTS) continue;

        let delivered = false;
        let live = 0;
        let failures: PushFailure[] = [];
        let telegramAttempted = false;
        let failureDetail: string | null = null;

        try {
          if (pushConfigured) {
            const result = await pushToUser(
              pushDb,
              u.userId,
              {
                ...pushReminder(label),
                url: '/',
                tag: `reminder-${label}`,
              },
              env,
            );
            delivered = result.delivered > 0;
            live = result.live;
            failures = result.failures;
          }
          // Telegram only when there is no live subscription to push to.
          if (live === 0 && bot && u.telegramUserId != null) {
            telegramAttempted = true;
            const dm = await bot.sendMessage(u.telegramUserId, {
              text: reminderMessage(label),
            });
            delivered = dm.messageId != null;
          }
        } catch (err) {
          failureDetail = err instanceof Error ? err.message : String(err);
        }

        if (delivered) {
          // Stamp only what was actually delivered: a transient push failure
          // must leave the slot eligible for the next cron tick.
          lastSent[label] = dateKey;
          delete attempts[label];
          sent += 1;
          changed = true;
          continue;
        }

        const nextTries = tries + 1;
        attempts[label] = { date: dateKey, tries: nextTries };
        changed = true;

        if (nextTries >= MAX_REMINDER_ATTEMPTS) {
          // Give up for the day, but leave a trace: status + a short response
          // prefix, and whether a Telegram fallback even existed.
          lastFailureAt = nowMs;
          const pushFailure = failures[0];
          await logError(env.DB, {
            telegramUserId: u.telegramUserId,
            source: 'reminders',
            kind: 'delivery',
            status: pushFailure?.status ?? 0,
            message: `Reminder "${label}" not delivered after ${MAX_REMINDER_ATTEMPTS} attempts`,
            detail: JSON.stringify({
              label,
              date: dateKey,
              attempts: nextTries,
              pushConfigured,
              pushStatus: pushFailure?.status ?? null,
              pushBody: pushFailure?.bodyPrefix ?? null,
              pushFailureCount: failures.length,
              telegramFallback: Boolean(bot && u.telegramUserId != null),
              telegramAttempted,
              error: failureDetail,
            }),
          });
        }
      }
      if (changed) {
        await saveReminderState(env.DB, u.userId, u.preferencesJson, {
          lastSent,
          attempts,
          lastFailureAt,
        });
      }
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
