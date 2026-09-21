import { useCallback, useEffect, useRef, useState } from 'react';
import { getCached, isFresh, revalidate } from './cache.js';

export interface CachedResult<T> {
  /** The current value: cached immediately, then updated after revalidation. */
  data: T | undefined;
  /** True only when there's no cached value yet AND a fetch is in flight. */
  loading: boolean;
  error: string | null;
  /** Force a background revalidation (e.g. after a mutation). */
  refresh: () => void;
}

/**
 * Stale-while-revalidate data hook. On mount (and whenever `key` changes) it
 * returns any cached value instantly, then revalidates in the background and
 * updates only if the value changed. A warm cache means no spinner — the app
 * feels instant on back-navigation and reopens.
 *
 * `key` may be null to skip fetching (e.g. while inputs aren't ready).
 */
export function useCachedData<T>(
  key: string | null,
  fetcher: () => Promise<T>,
): CachedResult<T> {
  const [data, setData] = useState<T | undefined>(() =>
    key ? getCached<T>(key) : undefined,
  );
  const [loading, setLoading] = useState<boolean>(() => (key ? getCached<T>(key) === undefined : false));
  const [error, setError] = useState<string | null>(null);

  // Keep the latest fetcher without making it a dependency (avoids refetch loops
  // when callers pass inline closures).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Track the last value we've shown so a background refresh (e.g. after a
  // mutation invalidates the cache) can keep showing it instead of flashing a
  // skeleton.
  const lastShown = useRef<T | undefined>(data);
  lastShown.current = data;

  const run = useCallback((k: string, keepStale: boolean) => {
    const cached = getCached<T>(k);
    // On a background refresh (same key, e.g. after a mutation) keep showing the
    // current data so there's no skeleton flash. On a cold load for a new key,
    // only fall back to cache (never to another key's stale data).
    const shown = cached ?? (keepStale ? lastShown.current : undefined);
    setData(shown);
    setLoading(shown === undefined);
    setError(null);
    revalidate<T>(k, () => fetcherRef.current())
      .then((fresh) => {
        setData(fresh);
        setLoading(false);
      })
      .catch((e: unknown) => {
        // Keep showing what we had on a failed revalidation; only surface an
        // error when we had nothing to show.
        setLoading(false);
        if (shown === undefined) {
          setError(e instanceof Error ? e.message : 'Failed to load');
        }
      });
  }, []);

  useEffect(() => {
    if (!key) {
      setData(undefined);
      setLoading(false);
      return;
    }
    // Show cache immediately; revalidate unless very fresh (avoids redundant
    // refetch when navigating quickly).
    const cached = getCached<T>(key);
    setData(cached);
    if (cached !== undefined && isFresh(key)) {
      setLoading(false);
      return;
    }
    run(key, false);
  }, [key, run]);

  const refresh = useCallback(() => {
    if (key) run(key, true);
  }, [key, run]);

  return { data, loading, error, refresh };
}
