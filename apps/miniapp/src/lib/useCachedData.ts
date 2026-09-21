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
 * Correctness: every fetch is tagged with the key it was started for, and its
 * result is applied ONLY if that's still the current key. This prevents a slow
 * response for a previous key (e.g. yesterday's meals) from overwriting the
 * data after the user has switched keys (to today) — which caused the list to
 * show the wrong day and "jump".
 *
 * `key` may be null to skip fetching (e.g. while inputs aren't ready).
 */
export function useCachedData<T>(
  key: string | null,
  fetcher: () => Promise<T>,
): CachedResult<T> {
  const [data, setData] = useState<T | undefined>(() => (key ? getCached<T>(key) : undefined));
  const [loading, setLoading] = useState<boolean>(() =>
    key ? getCached<T>(key) === undefined : false,
  );
  const [error, setError] = useState<string | null>(null);

  // Latest fetcher (not a dependency, to avoid refetch loops on inline closures).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // The key the hook currently cares about. A resolved fetch is only applied if
  // it still matches this — otherwise it's a stale response for an old key.
  const currentKey = useRef<string | null>(key);
  currentKey.current = key;

  const run = useCallback((k: string) => {
    setError(null);
    revalidate<T>(k, () => fetcherRef.current())
      .then((fresh) => {
        if (currentKey.current !== k) return; // stale response — ignore
        setData(fresh);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (currentKey.current !== k) return; // stale response — ignore
        setLoading(false);
        // Only surface an error when we have nothing cached to show.
        if (getCached<T>(k) === undefined) {
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
    // Snap to THIS key's cached value immediately (never another key's data),
    // so the list always matches the selected day with no cross-day flash.
    const cached = getCached<T>(key);
    setData(cached);
    setLoading(cached === undefined);
    // Skip a redundant refetch when the cache is still fresh.
    if (cached !== undefined && isFresh(key)) {
      setLoading(false);
      return;
    }
    run(key);
  }, [key, run]);

  const refresh = useCallback(() => {
    if (key) run(key);
  }, [key, run]);

  return { data, loading, error, refresh };
}
