import { useCallback, useEffect, useRef, useState } from 'react';
import { getCached, revalidate } from './cache.js';

export interface CachedResult<T> {
  /** The current value: cached immediately, then updated after revalidation. */
  data: T | undefined;
  /** True only when there is nothing at all to show and a fetch is in flight. */
  loading: boolean;
  /** A first-load failure. Background failures behind data stay silent. */
  error: string | null;
  /** HTTP status behind `error`, when the failure carried one (403 → locked). */
  errorStatus: number | null;
  /** True while the shown value is being revalidated or belongs to a prior key. */
  stale: boolean;
  /** Force a background revalidation (e.g. after a mutation). */
  refresh: () => void;
}

interface State<T> {
  /** The key being fetched. */
  key: string | null;
  /** The key the displayed value belongs to (null when there is no value). */
  dataKey: string | null;
  data: T | undefined;
  loading: boolean;
  error: string | null;
  errorStatus: number | null;
  stale: boolean;
}

function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

function initialState<T>(key: string | null): State<T> {
  const cached = key ? getCached<T>(key) : undefined;
  return {
    key,
    dataKey: cached === undefined ? null : key,
    data: cached,
    loading: key !== null && cached === undefined,
    error: null,
    errorStatus: null,
    stale: key !== null,
  };
}

/**
 * Stale-while-revalidate data hook. On mount (and whenever `key` changes) it
 * returns any cached value instantly, then ALWAYS revalidates in the background
 * and updates only if the value changed. A warm cache means no spinner — the app
 * feels instant on back-navigation, reopens and day switches.
 *
 * If the new key has no cached value, the last rendered value stays on screen
 * while the fetch runs, so a date stepper or range toggle never flashes a
 * full-page skeleton. A failure behind data that belongs to the CURRENT key is
 * silent: the screen keeps the last good copy rather than blanking or toasting.
 *
 * Correctness: every fetch is tagged with the key it was started for, and its
 * result is applied ONLY if that's still the current key. This prevents a slow
 * response for a previous key (e.g. yesterday's meals) from overwriting the
 * data after the user has switched keys (to today).
 *
 * `key` may be null to skip fetching (e.g. while inputs aren't ready).
 */
export function useCachedData<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  errorFallback = 'Failed to load',
): CachedResult<T> {
  const [state, setState] = useState<State<T>>(() => initialState<T>(key));

  // Latest fetcher (not a dependency, to avoid refetch loops on inline closures).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // The key the hook currently cares about. A resolved fetch is only applied if
  // it still matches this — otherwise it's a stale response for an old key.
  const currentKey = useRef<string | null>(key);
  currentKey.current = key;

  const run = useCallback(
    (k: string) => {
      setState((prev) => (prev.key === k ? { ...prev, stale: true } : prev));
      revalidate<T>(k, () => fetcherRef.current())
        .then((fresh) => {
          if (currentKey.current !== k) return; // stale response — ignore
          setState({
            key: k,
            dataKey: k,
            data: fresh,
            loading: false,
            error: null,
            errorStatus: null,
            stale: false,
          });
        })
        .catch((e: unknown) => {
          if (currentKey.current !== k) return; // stale response — ignore
          setState((prev) => {
            // A failed refresh behind data for THIS key keeps the cached screen
            // and stays silent. Only a first load (or a key with no data yet)
            // has nothing truthful to show, so only then is there an error.
            if (prev.dataKey === k && prev.data !== undefined) {
              return { ...prev, key: k, loading: false, stale: false };
            }
            return {
              ...prev,
              key: k,
              loading: false,
              error: e instanceof Error && e.message ? e.message : errorFallback,
              errorStatus: statusOf(e),
              stale: false,
            };
          });
        });
    },
    [errorFallback],
  );

  useEffect(() => {
    if (!key) {
      setState({
        key: null,
        dataKey: null,
        data: undefined,
        loading: false,
        error: null,
        errorStatus: null,
        stale: false,
      });
      return;
    }
    const cached = getCached<T>(key);
    setState((prev) => {
      // Snap to THIS key's cached value when it exists; otherwise keep the last
      // rendered value so a stepper/toggle swaps in place instead of flashing.
      const data = cached === undefined ? prev.data : cached;
      return {
        key,
        dataKey: cached === undefined ? prev.dataKey : key,
        data,
        loading: data === undefined,
        error: null,
        errorStatus: null,
        stale: true,
      };
    });
    run(key);
  }, [key, run]);

  const refresh = useCallback(() => {
    if (key) run(key);
  }, [key, run]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    errorStatus: state.errorStatus,
    stale: state.stale,
    refresh,
  };
}
