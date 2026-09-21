/**
 * A tiny stale-while-revalidate cache for the Mini App's read data.
 *
 * Goal: the app should feel instant. Reads render immediately from a cached
 * copy (in memory, warmed from localStorage on load), while a background fetch
 * revalidates and only notifies subscribers when the data actually changed.
 * Mutations invalidate the relevant keys so the next read refetches.
 *
 * This is deliberately dependency-free and small (no react-query etc.), in
 * keeping with the project's lightweight principle.
 */

type Json = unknown;

/** Cache-key builders + prefixes, so reads and invalidation stay in sync. */
export const cacheKey = {
  /** All meal-derived reads (day view, range/week, dates). One prefix to bust. */
  mealsPrefix: 'meals:',
  mealsByDate: (date: string) => `meals:day:${date}`,
  mealsRange: (start: string, end: string) => `meals:range:${start}:${end}`,
  mealDates: () => 'meals:dates',
  favorites: () => 'favorites',
  settings: () => 'settings',
} as const;

interface Entry {
  value: Json;
  /** When this entry was last written (ms). */
  at: number;
}

const MEM = new Map<string, Entry>();
const STORE_PREFIX = 'snapbite.cache.';
/** Entries older than this are still shown, but always revalidated. */
const FRESH_MS = 60_000;

function storageKey(key: string): string {
  return `${STORE_PREFIX}${key}`;
}

/** Reads an entry from memory, falling back to localStorage (and warming memory). */
function read(key: string): Entry | undefined {
  const mem = MEM.get(key);
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Entry;
    if (parsed && typeof parsed === 'object' && 'value' in parsed) {
      MEM.set(key, parsed);
      return parsed;
    }
  } catch {
    // ignore corrupt/unavailable storage
  }
  return undefined;
}

function write(key: string, value: Json): Entry {
  const entry: Entry = { value, at: Date.now() };
  MEM.set(key, entry);
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    // storage full/unavailable — memory cache still works for this session
  }
  return entry;
}

/** Returns the cached value for a key, or undefined when absent. */
export function getCached<T>(key: string): T | undefined {
  return read(key)?.value as T | undefined;
}

/** Whether a cached value exists and is still within the fresh window. */
export function isFresh(key: string): boolean {
  const e = read(key);
  return e != null && Date.now() - e.at < FRESH_MS;
}

/** Writes a value to the cache (used after mutations to seed a known result). */
export function setCached<T>(key: string, value: T): void {
  write(key, value);
}

/** Removes cached entries whose key starts with the given prefix. */
export function invalidate(prefix: string): void {
  for (const k of [...MEM.keys()]) {
    if (k.startsWith(prefix)) MEM.delete(k);
  }
  try {
    const full = storageKey(prefix);
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(full)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

/** Clears the entire client cache (e.g. on account deletion). */
export function clearCache(): void {
  MEM.clear();
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORE_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

/**
 * Runs `fetcher`, and updates the cache only if the result differs from what's
 * stored (shallow JSON compare). Returns the fresh value. Used by the SWR hook
 * and can be called directly to revalidate after a mutation elsewhere.
 */
export async function revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const next = await fetcher();
  const prev = read(key)?.value;
  if (JSON.stringify(prev) !== JSON.stringify(next)) {
    write(key, next);
  }
  return next;
}
