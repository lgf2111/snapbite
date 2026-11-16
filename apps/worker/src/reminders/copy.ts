/**
 * Reminder notification copy: a deterministic rotation through hand-written
 * pools, plus an occasional food word. No AI and no randomness at send time, so
 * the same user, slot and local day always produce the same wording and a retry
 * cannot rewrite the message that may already be on a lock screen.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lunch-specific lines. Keep them short: a food word may follow one. */
export const LUNCH_LINES = [
  "Lunch o'clock. Let the plate do the talking.",
  'Midday check: what is on the plate?',
  'Your lunch deserves a cameo.',
  'One photo, and lunch is logged.',
  'The fork is ready when you are.',
  'Lunch can wait. The log cannot.',
  'Snap the plate before the crumbs win.',
  'A lunch worth remembering? Prove it.',
  'Pause the day. Photograph the plate.',
  'Your plate has a story. Send it.',
  'Lunch: the most photographable meal.',
  'Before the first bite, one quick snap.',
] as const;

/** Dinner-specific lines. */
export const DINNER_LINES = [
  'Dinner is served. The camera is yours.',
  'Evening check: what is on the table?',
  'One photo and dinner is done.',
  'The day ends better with dinner logged.',
  'Table for one, plus a photo.',
  'Snap dinner while it is still warm.',
  'Dinner deserves a closing shot.',
  'Log dinner, then put your feet up.',
  'A plate, a photo, a finished day.',
  'Before the plates clear, snap once.',
  'Dinner: last call for the day.',
  'Your evening meal, one tap away.',
] as const;

/** Used for breakfast and any slot without a pool of its own. */
export const SHARED_LINES = [
  'A photo is the whole log.',
  'Your meal, your plate, one snap.',
  'One picture. Logged. Done.',
  'A quick photo keeps the day on track.',
  'Give the meal its moment.',
  'Snap first, eat second.',
  'Worth eating? Worth logging.',
  'The plate is ready for its close-up.',
  'One photo now, no notes later.',
  'A snack counts too. Snap it.',
  'Capture the plate, skip the homework.',
  'The log is hungry. Feed it a photo.',
] as const;

/**
 * Streak lines, used once the user has a run of 2+ days. `{day}` is replaced
 * with the streak length. Eight lines keep a streak user from seeing a repeat
 * within a week.
 */
export const STREAK_LINES = [
  'Day {day}. One photo keeps it alive.',
  'Day {day}. The run is still warm.',
  'Day {day}. A photo keeps the run going.',
  'Day {day}. Your streak has momentum.',
  'Day {day}. Log it and keep the chain.',
  'Day {day}. The habit is doing its job.',
  'Day {day}. Another day, another plate.',
  'Day {day}. Keep the good run rolling.',
] as const;

/** Real food words with a one-line definition. Never longer than a short line. */
export const FOOD_WORDS = [
  'Frangipane: almond cream, the reason a pastry is worth it.',
  'Mise en place: everything in its place before the cooking.',
  'Sear: a hot pan, a brown crust, a small triumph.',
  'Zest: the part of the citrus that makes you notice.',
  'Emulsion: two liquids agreeing to be one sauce.',
  'Maillard: the browning that makes toast worth toast.',
  'Al dente: firm enough to argue with a fork.',
  'Umami: the savoury depth that keeps you going back.',
  'Dumpling: a filling with a dough coat on.',
  'Fermentation: letting time do the seasoning.',
  "Confection: sugar's most elaborate disguise.",
  'Braise: low heat, long patience, soft dinner.',
  'Sourdough: bread with a personality and a past.',
  'Broth: the long answer to a simple pot.',
] as const;

export interface ReminderCopyInput {
  /** Reminder slot label (`lunch`, `dinner`, or a custom one). */
  slot: string;
  /** The user's local YYYY-MM-DD. */
  dateKey: string;
  /** Stable user id, so two people do not march through the pool in lockstep. */
  userId: string;
  /** Current logging streak, when known. 2+ unlocks the streak pool. */
  streak?: number | undefined;
}

export interface ReminderCopy {
  /** Stable, scannable title: `Lunch` or `Dinner`. */
  title: string;
  /** The line with the character, always <= 120 characters. */
  body: string;
}

/** FNV-1a. Small, stable and identical on every runtime, unlike Math.random(). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Ordinal day for `YYYY-MM-DD`, so consecutive days step the pool by one. */
function dayOf(dateKey: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return 0;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(ms) ? 0 : Math.floor(ms / DAY_MS);
}

const positiveMod = (n: number, m: number) => ((n % m) + m) % m;

function titleFor(slot: string): string {
  const name = slot.trim() || 'Meal';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function poolFor(slot: string, streak: number | undefined): readonly string[] {
  if (streak != null && streak >= 2) {
    return STREAK_LINES.map((line) => line.replace('{day}', String(streak)));
  }
  const key = slot.trim().toLowerCase();
  if (key === 'lunch') return LUNCH_LINES;
  if (key === 'dinner') return DINNER_LINES;
  return SHARED_LINES;
}

/**
 * The day number steps the pool by exactly one, while a hash of slot + user
 * picks where that user starts. Hashing the date itself would jump around the
 * pool and could repeat two days running, which is the stall this avoids.
 */
function lineIndex(input: ReminderCopyInput, size: number): number {
  const slot = input.slot.trim().toLowerCase();
  const start = hash(`${slot}\u0000${input.userId}`);
  return positiveMod(start + dayOf(input.dateKey), size);
}

/**
 * Roughly one day in three gets a dictionary entry. The bucket comes from the
 * same date + slot + user hash as the rotation, so it is stable for a retry and
 * the word days do not line up with the same few base lines. The word itself is
 * picked from the same hash value.
 */
function foodWordFor(input: ReminderCopyInput): string | null {
  const slot = input.slot.trim().toLowerCase();
  const h = hash(`${input.dateKey}\u0000${slot}\u0000${input.userId}`);
  if (h % 3 !== 0) return null;
  return FOOD_WORDS[h % FOOD_WORDS.length] ?? null;
}

/**
 * Picks the notification for one reminder. Same inputs always give the same
 * string. Consecutive days move to the next line, so a run of days never
 * repeats while the pool lasts.
 */
export function pickReminderCopy(input: ReminderCopyInput): ReminderCopy {
  const pool = poolFor(input.slot, input.streak);
  const line = pool[lineIndex(input, pool.length)] ?? pool[0] ?? '';
  const word = foodWordFor(input);
  return {
    title: titleFor(input.slot),
    body: word ? `${line} ${word}` : line,
  };
}
