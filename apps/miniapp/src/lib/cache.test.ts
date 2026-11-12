import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheKey,
  clearCache,
  getCached,
  invalidate,
  removeCachedItem,
  revalidate,
  setCached,
} from './cache';

describe('cache', () => {
  beforeEach(() => {
    clearCache();
  });

  it('stores and reads a value', () => {
    setCached('k1', { a: 1 });
    expect(getCached<{ a: number }>('k1')).toEqual({ a: 1 });
    expect(getCached('missing')).toBeUndefined();
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

  it('clearCache empties everything', () => {
    setCached('a', 1);
    setCached('b', 2);
    clearCache();
    expect(getCached('a')).toBeUndefined();
    expect(getCached('b')).toBeUndefined();
  });
});
