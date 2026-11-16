import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheKey,
  clearCache,
  getCached,
  invalidate,
  mutateCached,
  patchCachedItem,
  removeCachedItem,
  revalidate,
  setCached,
} from './cache';

describe('cache', () => {
  beforeEach(() => {
    clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores and reads a value', () => {
    setCached('k1', { a: 1 });
    expect(getCached<{ a: number }>('k1')).toEqual({ a: 1 });
    expect(getCached('missing')).toBeUndefined();
    // Persisted for this tab (sessionStorage, not localStorage).
    expect(sessionStorage.getItem('snapbite.cache.k1')).toBeTruthy();
    expect(localStorage.getItem('snapbite.cache.k1')).toBeNull();
  });

  it('warms a fresh module from sessionStorage', async () => {
    setCached('persisted', { a: 1 });
    vi.resetModules();
    const fresh = await import('./cache');
    expect(fresh.getCached<{ a: number }>('persisted')).toEqual({ a: 1 });
  });

  it('invalidate removes entries by prefix', () => {
    setCached(cacheKey.mealsByDate('2026-02-01'), [1]);
    setCached(cacheKey.mealsRange('2026-02-01', '2026-02-07'), [2]);
    setCached(cacheKey.favorites(), [3]);

    invalidate(cacheKey.mealsPrefix);

    expect(getCached(cacheKey.mealsByDate('2026-02-01'))).toBeUndefined();
    expect(getCached(cacheKey.mealsRange('2026-02-01', '2026-02-07'))).toBeUndefined();
    // Favorites are a different prefix and survive.
    expect(getCached(cacheKey.favorites())).toEqual([3]);
  });

  it('removeCachedItem drops one id from every cached meal list, leaving the rest', () => {
    const day1 = [{ id: 'a' }, { id: 'b' }];
    const day2 = [{ id: 'b' }, { id: 'c' }];
    const range = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const dates = { dates: ['2026-02-01'], streak: 1 };
    setCached(cacheKey.mealsByDate('2026-02-01'), day1);
    setCached(cacheKey.mealsByDate('2026-02-02'), day2);
    setCached(cacheKey.mealsRange('2026-02-01', '2026-02-07'), range);
    setCached(cacheKey.mealDates(), dates);
    setCached(cacheKey.favorites(), [{ id: 'b' }]);

    removeCachedItem(cacheKey.mealsPrefix, 'b');

    expect(getCached(cacheKey.mealsByDate('2026-02-01'))).toEqual([{ id: 'a' }]);
    expect(getCached(cacheKey.mealsByDate('2026-02-02'))).toEqual([{ id: 'c' }]);
    expect(getCached(cacheKey.mealsRange('2026-02-01', '2026-02-07'))).toEqual([
      { id: 'a' },
      { id: 'c' },
    ]);
    // Non-list meal reads and other prefixes are untouched.
    expect(getCached(cacheKey.mealDates())).toEqual(dates);
    expect(getCached(cacheKey.favorites())).toEqual([{ id: 'b' }]);
  });

  it('patchCachedItem merges an edit into every cached meal list, leaving the rest', () => {
    const day1 = [
      { id: 'a', label: 'Old a' },
      { id: 'b', label: 'B' },
    ];
    const day2 = [
      { id: 'a', label: 'Old a' },
      { id: 'c', label: 'C' },
    ];
    const dates = { dates: ['2026-02-01'], streak: 1 };
    setCached(cacheKey.mealsByDate('2026-02-01'), day1);
    setCached(cacheKey.mealsByDate('2026-02-02'), day2);
    setCached(cacheKey.mealDates(), dates);
    setCached(cacheKey.favorites(), [{ id: 'a', label: 'Favorite a' }]);

    patchCachedItem(cacheKey.mealsPrefix, 'a', { label: 'New a', energyKcal: 600 });

    expect(getCached(cacheKey.mealsByDate('2026-02-01'))).toEqual([
      { id: 'a', label: 'New a', energyKcal: 600 },
      { id: 'b', label: 'B' },
    ]);
    expect(getCached(cacheKey.mealsByDate('2026-02-02'))).toEqual([
      { id: 'a', label: 'New a', energyKcal: 600 },
      { id: 'c', label: 'C' },
    ]);
    // Non-list meal reads and other prefixes are untouched.
    expect(getCached(cacheKey.mealDates())).toEqual(dates);
    expect(getCached(cacheKey.favorites())).toEqual([{ id: 'a', label: 'Favorite a' }]);
  });

  it('revalidate updates the cache and returns the fresh value', async () => {
    setCached('k', { v: 1 });
    const fresh = await revalidate('k', async () => ({ v: 2 }));
    expect(fresh).toEqual({ v: 2 });
    expect(getCached('k')).toEqual({ v: 2 });
  });

  it('revalidate does not rewrite when the value is unchanged', async () => {
    setCached('k', { v: 1 });
    const fetcher = vi.fn(async () => ({ v: 1 }));
    const result = await revalidate('k', fetcher);
    expect(result).toEqual({ v: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getCached('k')).toEqual({ v: 1 });
  });

  it('a mutation outranks a revalidation that was already in flight', async () => {
    setCached('k', { v: 1 });
    let resolve!: (value: { v: number }) => void;
    const pending = revalidate(
      'k',
      () =>
        new Promise<{ v: number }>((done) => {
          resolve = done;
        }),
    );

    mutateCached('k', { v: 2 });
    resolve({ v: 1 });

    await expect(pending).resolves.toEqual({ v: 2 });
    expect(getCached('k')).toEqual({ v: 2 });
  });

  it('lets a revalidation land once the mutation window has passed', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
      let resolve!: (value: { v: number }) => void;
      const pending = revalidate(
        'k',
        () =>
          new Promise<{ v: number }>((done) => {
            resolve = done;
          }),
      );

      mutateCached('k', { v: 2 });
      vi.setSystemTime(Date.now() + 6_000);
      resolve({ v: 1 });

      await expect(pending).resolves.toEqual({ v: 1 });
      expect(getCached('k')).toEqual({ v: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps the cache at 24 entries and evicts the oldest', () => {
    let now = 1;
    vi.spyOn(Date, 'now').mockImplementation(() => now++);
    for (let i = 0; i < 30; i++) setCached(`cap:${i}`, i);

    // The six oldest are gone; the most recent 24 remain.
    expect(getCached('cap:5')).toBeUndefined();
    expect(getCached('cap:6')).toBe(6);
    expect(getCached('cap:29')).toBe(29);
    const persisted = Array.from({ length: sessionStorage.length }, (_, i) =>
      sessionStorage.key(i),
    ).filter((key) => key?.startsWith('snapbite.cache.cap:'));
    expect(persisted).toHaveLength(24);
  });

  it('keeps an oversized entry in memory but does not persist it', () => {
    const big = 'x'.repeat(260_000);
    setCached('big', big);
    expect(getCached('big')).toBe(big);
    expect(sessionStorage.getItem('snapbite.cache.big')).toBeNull();
  });

  it('keys reports by range', () => {
    expect(cacheKey.reports('90d')).toBe('reports:90d');
    expect(cacheKey.reports('12m')).toBe('reports:12m');
  });

  it('clearCache empties everything', () => {
    setCached('a', 1);
    setCached('b', 2);
    clearCache();
    expect(getCached('a')).toBeUndefined();
    expect(getCached('b')).toBeUndefined();
    expect(sessionStorage.getItem('snapbite.cache.a')).toBeNull();
  });
});
