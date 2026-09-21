/**
 * User preference for how the Home "Weekly" view defines a week, plus the date
 * math to turn an anchor day into a range. Client-only (affects rendering), so
 * it's kept in localStorage — no backend/schema change.
 *
 * Modes:
 *  - `rolling`  — the last 7 days ending on the anchor (D-6 … D).
 *  - `calendar` — the calendar week containing the anchor, starting on either
 *    Sunday or Monday (`weekStart`).
 */

export type WeekMode = 'rolling' | 'calendar';
export type WeekStart = 'sunday' | 'monday';

export interface WeekPrefs {
  mode: WeekMode;
  /** Only meaningful when mode === 'calendar'. */
  weekStart: WeekStart;
}

export const DEFAULT_WEEK_PREFS: WeekPrefs = { mode: 'rolling', weekStart: 'monday' };

const WEEK_PREFS_KEY = 'snapbite.weekPrefs.v1';

/** Reads the stored week preference, falling back to the default. */
export function loadWeekPrefs(): WeekPrefs {
  try {
    const raw = localStorage.getItem(WEEK_PREFS_KEY);
    if (!raw) return { ...DEFAULT_WEEK_PREFS };
    const parsed = JSON.parse(raw) as Partial<WeekPrefs>;
    return {
      mode: parsed.mode === 'calendar' ? 'calendar' : 'rolling',
      weekStart: parsed.weekStart === 'sunday' ? 'sunday' : 'monday',
    };
  } catch {
    return { ...DEFAULT_WEEK_PREFS };
  }
}

/** Persists the week preference. */
export function saveWeekPrefs(prefs: WeekPrefs): void {
  try {
    localStorage.setItem(WEEK_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable — non-fatal
  }
}

// --- date helpers (all in the device's LOCAL time) --------------------------

/** Local YYYY-MM-DD for a Date. */
function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Parses a YYYY-MM-DD key into a local Date at midnight. */
function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Adds `n` days to a local Date (new Date). */
function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "3 Feb" style short label for a local Date. */
function shortLabel(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export interface WeekRange {
  /** Inclusive local day keys (YYYY-MM-DD). */
  startKey: string;
  endKey: string;
  /** Number of days in the range (rolling = 7; calendar = 7). */
  days: number;
  /** Every day key in the range, oldest → newest. */
  dayKeys: string[];
  /** Human label, e.g. "3–9 Feb" or "Feb 3 – Feb 9". */
  label: string;
}

/**
 * Computes the week range for an anchor day (YYYY-MM-DD) given the preference.
 * All math is in local time so it matches how meals are day-grouped elsewhere.
 */
export function weekRange(anchorKey: string, prefs: WeekPrefs): WeekRange {
  const anchor = parseKey(anchorKey);

  let start: Date;
  if (prefs.mode === 'rolling') {
    // Last 7 days ending on the anchor.
    start = addDays(anchor, -6);
  } else {
    // Calendar week containing the anchor.
    const dow = anchor.getDay(); // 0 = Sun … 6 = Sat
    const startDow = prefs.weekStart === 'sunday' ? 0 : 1;
    // How many days back to reach the week's start day.
    const back = (dow - startDow + 7) % 7;
    start = addDays(anchor, -back);
  }
  const end = addDays(start, 6);

  const dayKeys: string[] = [];
  for (let i = 0; i < 7; i++) dayKeys.push(dayKey(addDays(start, i)));

  return {
    startKey: dayKey(start),
    endKey: dayKey(end),
    days: 7,
    dayKeys,
    label: `${shortLabel(start)} – ${shortLabel(end)}`,
  };
}
