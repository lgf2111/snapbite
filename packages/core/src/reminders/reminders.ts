/**
 * Pure helpers for opt-in meal reminders. No I/O — the Worker's cron handler
 * supplies the current time and the send transport.
 */

/** A reminder slot with its label and 24h "HH:MM" local time. */
export interface ReminderSlot {
  label: string;
  time: string;
}

/** Default reminder slots offered in the UI (fixed daily times). */
export const DEFAULT_REMINDER_TIMES: Record<string, string> = {
  breakfast: '08:00',
  lunch: '12:30',
  dinner: '19:00',
};

/** Friendly one-liners per slot, used in the DM. */
export const REMINDER_MESSAGES: Record<string, string> = {
  breakfast: "🍳 Breakfast time — snap a photo of your meal and I'll log it.",
  lunch: '🥗 Lunch check-in — send me a photo to log it.',
  dinner: '🍽️ Dinner time — log your meal by sending a photo.',
};

/** Message for a slot (falls back to a generic nudge for custom labels). */
export function reminderMessage(label: string): string {
  return REMINDER_MESSAGES[label] ?? `⏰ ${label} reminder — send a meal photo to log it.`;
}

/** Parses "HH:MM" into minutes-since-midnight, or null when malformed. */
export function parseHhMm(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * The reminder cron's granularity in minutes. Reminder times are only
 * meaningful on this grid: the cron checks every {@link REMINDER_STEP_MINUTES}
 * minutes, so an off-grid time (e.g. 08:07) would silently fire at the next
 * slot. UIs should restrict/snap picks to this step.
 */
export const REMINDER_STEP_MINUTES = 15;

/** Formats minutes-since-midnight back to a zero-padded "HH:MM". */
function formatHhMm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Snaps an "HH:MM" time to the nearest {@link REMINDER_STEP_MINUTES} slot so the
 * time a user sees matches when the cron will actually fire. Rounds to nearest,
 * clamps the final slot to 23:45 so a round-up near midnight stays same-day, and
 * returns the input unchanged when it isn't a valid time.
 */
export function snapToReminderStep(hhmm: string): string {
  const total = parseHhMm(hhmm);
  if (total == null) return hhmm;
  const snapped = Math.round(total / REMINDER_STEP_MINUTES) * REMINDER_STEP_MINUTES;
  const clamped = Math.min(snapped, 23 * 60 + 45);
  return formatHhMm(clamped);
}

/**
 * The user's LOCAL date + minutes-since-midnight for a UTC instant, given their
 * `Date.getTimezoneOffset()` value (minutes to add to local to reach UTC).
 */
export function localParts(
  nowMs: number,
  tzOffsetMinutes: number,
): { dateKey: string; minutesOfDay: number } {
  // local = UTC - offsetMinutes.
  const localMs = nowMs - tzOffsetMinutes * 60_000;
  const d = new Date(localMs);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return {
    dateKey: `${y}-${mo}-${day}`,
    minutesOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

/** Reminder config shape the due-check needs (mirrors the Worker's ReminderConfig). */
export interface DueCheckConfig {
  enabled: boolean;
  times: Record<string, string>;
  tzOffsetMinutes: number;
  lastSent?: Record<string, string>;
}

/**
 * Given the config, the current UTC time, and how wide the cron tick is, returns
 * the slot labels that are DUE now and haven't been sent yet today (local).
 *
 * A slot is due when the user's current local minute-of-day is within
 * `[slotMinute, slotMinute + windowMinutes)` and `lastSent[label]` isn't today's
 * local date. `windowMinutes` should be >= the cron interval so a slot isn't
 * missed between ticks (e.g. 15 for an every-15-min cron).
 */
export function dueReminderSlots(
  config: DueCheckConfig,
  nowMs: number,
  windowMinutes: number,
): string[] {
  if (!config.enabled) return [];
  const { dateKey, minutesOfDay } = localParts(nowMs, config.tzOffsetMinutes);
  const due: string[] = [];
  for (const [label, hhmm] of Object.entries(config.times ?? {})) {
    const slotMin = parseHhMm(hhmm);
    if (slotMin == null) continue;
    const already = config.lastSent?.[label] === dateKey;
    if (already) continue;
    if (minutesOfDay >= slotMin && minutesOfDay < slotMin + windowMinutes) {
      due.push(label);
    }
  }
  return due;
}
