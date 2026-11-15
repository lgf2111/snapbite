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
    expect(result.current.stale).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns a cached value instantly without a loading flash, then always revalidates', async () => {
    setCached('k2', 'cached');
    const fetcher = vi.fn().mockResolvedValue('fresh');

    const { result } = renderHook(() => useCachedData('k2', fetcher));

    // Cached value is shown immediately, no spinner, while the refetch runs.
    expect(result.current.data).toBe('cached');
    expect(result.current.loading).toBe(false);
    expect(result.current.stale).toBe(true);

    await waitFor(() => expect(result.current.data).toBe('fresh'));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.stale).toBe(false);
  });

  it('does not fetch when the key is null', async () => {
    const fetcher = vi.fn().mockResolvedValue('x');
    const { result } = renderHook(() => useCachedData(null, fetcher));

    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(false);
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('surfaces a first-load error and its HTTP status', async () => {
    const failure = Object.assign(new Error('network down'), { status: 503 });
    const fetcher = vi.fn().mockRejectedValue(failure);
    const { result } = renderHook(() => useCachedData('k3', fetcher));

    await waitFor(() => expect(result.current.error).toBe('network down'));
    expect(result.current.errorStatus).toBe(503);
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('keeps cached rows and stays silent when the background refresh fails', async () => {
    setCached('k3b', 'cached');
    const fetcher = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('network down'), { status: 503 }));
    const { result } = renderHook(() => useCachedData('k3b', fetcher));

    await waitFor(() => expect(result.current.stale).toBe(false));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(result.current.errorStatus).toBeNull();
    expect(result.current.data).toBe('cached');
    expect(result.current.loading).toBe(false);
  });

  it('keeps the last rendered value when a new key has no cache, then swaps in place', async () => {
    let resolveNew: (value: string) => void = () => {};
    const newFetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveNew = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      ({ k, f }: { k: string; f: () => Promise<string> }) => useCachedData(k, f),
      { initialProps: { k: 'day:1', f: async () => 'day-1' } },
    );
    await waitFor(() => expect(result.current.data).toBe('day-1'));

    rerender({ k: 'day:2', f: newFetcher });

    // No cache for the new key: yesterday stays on screen, no skeleton state.
    expect(result.current.data).toBe('day-1');
    expect(result.current.loading).toBe(false);
    expect(result.current.stale).toBe(true);

    act(() => resolveNew('day-2'));
    await waitFor(() => expect(result.current.data).toBe('day-2'));
    expect(result.current.stale).toBe(false);
  });

  it("snaps to a new key's cached value immediately", async () => {
    setCached('day:2', 'cached-day-2');
    const newFetcher = vi.fn(() => new Promise<string>(() => {}));

    const { result, rerender } = renderHook(
      ({ k, f }: { k: string; f: () => Promise<string> }) => useCachedData(k, f),
      { initialProps: { k: 'day:1', f: async () => 'day-1' } },
    );
    await waitFor(() => expect(result.current.data).toBe('day-1'));

    rerender({ k: 'day:2', f: newFetcher });

    expect(result.current.data).toBe('cached-day-2');
    expect(result.current.loading).toBe(false);
    expect(result.current.stale).toBe(true);
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
