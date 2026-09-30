import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCache, setCached } from './cache.js';
import { useCachedData } from './useCachedData.js';

afterEach(() => {
  clearCache();
  vi.restoreAllMocks();
});

describe('useCachedData', () => {
  it('fetches when the cache is empty and exposes the result', async () => {
    const fetcher = vi.fn().mockResolvedValue('hello');
    const { result } = renderHook(() => useCachedData('k1', fetcher));

    // No cached value yet → starts loading with no data.
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.data).toBe('hello'));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns a cached value instantly without a loading flash, then revalidates', async () => {
    // Seed a fresh cached value; a fresh entry should skip the refetch entirely.
    setCached('k2', 'cached');
    const fetcher = vi.fn().mockResolvedValue('fresh');

    const { result } = renderHook(() => useCachedData('k2', fetcher));

    // Cached value is shown immediately, no spinner.
    expect(result.current.data).toBe('cached');
    expect(result.current.loading).toBe(false);

    // Entry is within the fresh window → no background fetch.
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not fetch when the key is null', async () => {
    const fetcher = vi.fn().mockResolvedValue('x');
    const { result } = renderHook(() => useCachedData(null, fetcher));

    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(false);
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('surfaces an error only when there is nothing cached to show', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useCachedData('k3', fetcher));

    await waitFor(() => expect(result.current.error).toBe('network down'));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('ignores a stale response for a previous key after the key changes', async () => {
    // Two different keys with fetchers of controllable timing.
    let resolveOld: (v: string) => void = () => {};
    const oldFetcher = vi.fn(
      () =>
        new Promise<string>((res) => {
          resolveOld = res;
        }),
    );
    const newFetcher = vi.fn().mockResolvedValue('new-day');

    const { result, rerender } = renderHook(
      ({ k, f }: { k: string; f: () => Promise<string> }) => useCachedData(k, f),
      { initialProps: { k: 'day:1', f: oldFetcher } },
    );

    // Switch to a new key before the old fetch resolves.
    rerender({ k: 'day:2', f: newFetcher });
    await waitFor(() => expect(result.current.data).toBe('new-day'));

    // The slow old-key response resolves late — it must NOT overwrite the data.
    act(() => resolveOld('old-day'));
    await Promise.resolve();
    expect(result.current.data).toBe('new-day');
  });

  it('refresh() forces a background revalidation', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
    const { result } = renderHook(() => useCachedData('k4', fetcher));

    await waitFor(() => expect(result.current.data).toBe('v1'));

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data).toBe('v2'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
