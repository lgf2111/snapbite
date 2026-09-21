import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheKey, clearCache, getCached, invalidate, revalidate, setCached } from './cache';

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
