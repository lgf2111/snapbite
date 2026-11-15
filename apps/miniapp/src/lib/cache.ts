/**
 * A tiny stale-while-revalidate cache for the Mini App's read data.
 *
 * Goal: the app should feel instant. Reads render immediately from a cached
 * copy (in memory, warmed from sessionStorage on load), while a background fetch
 * revalidates and only notifies subscribers when the data actually changed.
 * Mutations patch or invalidate the relevant keys so the next read is current.
 *
 * Storage is sessionStorage, not localStorage: the payload is a screen's last
 * look for this tab, not a durable offline database. Closing the tab drops it.
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
  reports: (range: string) => `reports:${range}`,
  settings: () => 'settings',
} as const;

interface Entry {
  value: Json;
  /** When this entry was last written (ms). */
  at: number;
}

const MEM = new Map<string, Entry>();
const STORE_PREFIX = 'snapbite.cache.';
/**
 * Payloads are small, but a date stepper can mint a key per day. Keep the most
 * recent screens and evict the oldest; this is a screen cache, not an archive.
 */
const MAX_ENTRIES = 24;
/** A single entry larger than this is kept in memory but not persisted. */
const MAX_ENTRY_CHARS = 256_000;

function storageKey(key: string): string {
  return `${STORE_PREFIX}${key}`;
}

/** Every key currently held in memory or sessionStorage (without the prefix). */
function allKeys(): Set<string> {
  const keys = new Set(MEM.keys());
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const full = sessionStorage.key(i);
      if (full?.startsWith(STORE_PREFIX)) keys.add(full.slice(STORE_PREFIX.length));
    }
  } catch {
    // storage unavailable — memory is the whole cache
  }
  return keys;
}

/** Drops the oldest entries so one more key fits under the cap. */
function evictOldest(keep: string): void {
  const keys = [...allKeys()].filter((key) => key !== keep);
  if (keys.length < MAX_ENTRIES) return;
  const oldest = keys.map((key) => ({ key, at: read(key)?.at ?? 0 })).sort((a, b) => a.at - b.at);
  for (const { key } of oldest.slice(0, keys.length - MAX_ENTRIES + 1)) {
    MEM.delete(key);
    try {
      sessionStorage.removeItem(storageKey(key));
    } catch {
      // ignore
    }
  }
}

/** Reads an entry from memory, falling back to sessionStorage (warming memory). */
function read(key: string): Entry | undefined {
  const mem = MEM.get(key);
  if (mem) return mem;
  try {
    const raw = sessionStorage.getItem(storageKey(key));
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
    const serialized = JSON.stringify(entry);
    if (serialized.length <= MAX_ENTRY_CHARS) {
      evictOldest(key);
      sessionStorage.setItem(storageKey(key), serialized);
    } else {
      // Too large to persist: never leave an older copy behind to be read.
      sessionStorage.removeItem(storageKey(key));
    }
  } catch {
    // storage full/unavailable — memory cache still works for this session
  }
  return entry;
}

/** Returns the cached value for a key, or undefined when absent. */
export function getCached<T>(key: string): T | undefined {
  return read(key)?.value as T | undefined;
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
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(full)) toRemove.push(k);
    }
    for (const k of toRemove) sessionStorage.removeItem(k);
  } catch {
    // ignore
  }
}

/**
 * Drops one item by id from every cached list under `prefix` (e.g. a deleted
 * meal from the day and range lists) without discarding the other cached
 * reads. A remount then renders the list already short, with no skeleton.
 */
export function removeCachedItem(prefix: string, id: string): void {
  const keys = new Set<string>();
  for (const k of MEM.keys()) {
    if (k.startsWith(prefix)) keys.add(k);
  }
  try {
    const full = storageKey(prefix);
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(full)) keys.add(k.slice(STORE_PREFIX.length));
    }
  } catch {
    // storage unavailable — memory cache still works
  }
  for (const key of keys) {
    const entry = read(key);
    if (!entry || !Array.isArray(entry.value)) continue;
    const value = entry.value as Array<{ id?: unknown }>;
    const next = value.filter((item) => item?.id !== id);
    if (next.length !== value.length) write(key, next);
  }
}

/**
 * Merges `patch` into the item with `id` in every cached list under `prefix`.
 * Used after an edit so a back-navigation renders the new label/macros instead
 * of the pre-edit copy (and without dropping the list into a skeleton).
 */
export function patchCachedItem(prefix: string, id: string, patch: Record<string, unknown>): void {
  const keys = new Set<string>();
  for (const k of MEM.keys()) {
    if (k.startsWith(prefix)) keys.add(k);
  }
  try {
    const full = storageKey(prefix);
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(full)) keys.add(k.slice(STORE_PREFIX.length));
    }
  } catch {
    // storage unavailable — memory cache still works
  }
  for (const key of keys) {
    const entry = read(key);
    if (!entry || !Array.isArray(entry.value)) continue;
    let changed = false;
    const value = entry.value as Array<Record<string, unknown>>;
    const next = value.map((item) => {
      if (item?.id !== id) return item;
      changed = true;
      return { ...item, ...patch };
    });
    if (changed) write(key, next);
  }
}

/** Clears the entire client cache (e.g. on account deletion). */
export function clearCache(): void {
  MEM.clear();
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(STORE_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) sessionStorage.removeItem(k);
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
