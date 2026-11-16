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
  /** True while the shown value is being revalidated (or is a kept prior key's). */
  stale: boolean;
  /** Force a background revalidation (e.g. after a mutation). */
  refresh: () => void;
}

export interface UseCachedDataOptions {
  /**
   * Keep the previous key's value on screen while a new key with no cached
   * value loads. Only opt in when the payload is NOT labelled by the key (e.g.
   * a settings blob); never for keyed content such as a day's meals, totals or
   * verdict, where it would show one day's data under another day's header.
   */
  keepPreviousData?: boolean;
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
 * The state to render for `key`. This runs during render as well as from the
 * key-change effect: a new key with no cached value must clear the previous
 * key's data in the SAME commit as the new header, not one effect later.
 * A previous day's meals under today's date is wrong data, not a cosmetic flash.
 */
function stateFor<T>(state: State<T>, key: string | null, keepPreviousData: boolean): State<T> {
  if (state.key === key) return state;
  const next = initialState<T>(key);
  if (key === null || !keepPreviousData || next.data !== undefined || state.data === undefined) {
    return next;
  }
  // Opt-in only: the caller vouches that the key does not label this payload.
  return { ...next, dataKey: state.dataKey, data: state.data, loading: false };
}

/**
 * Stale-while-revalidate data hook. On mount (and whenever `key` changes) it
 * returns any cached value instantly, then ALWAYS revalidates in the background
 * and updates only if the value changed. A warm cache means no spinner — the app
 * feels instant on back-navigation, reopens and day switches.
 *
 * A key change follows three explicit rules:
 * - same key: keep the current value and revalidate in place; no skeleton;
 * - new key with a cached value: show it immediately, then revalidate behind;
 * - new key with NO cached value: clear the previous value in the same commit
 *   as the new key and show the real empty/loading state. The previous key's
 *   data is never rendered under the new key, so a header and its list cannot
 *   disagree — not even for one frame.
 *
 * `keepPreviousData` opts out of the third rule for payloads the key does not
 * label. Home's meals, totals and verdict must never use it.
 *
 * A failure behind data that belongs to the CURRENT key is silent: the screen
 * keeps the last good copy rather than blanking or toasting. A failure with no
 * value for the current key surfaces `error`, so the retry line can never sit
 * above rows that belong to a different key.
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
  { keepPreviousData = false }: UseCachedDataOptions = {},
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
            // Anchor the error to the failed key's own state, never to whatever
            // an earlier key happened to leave behind.
            return {
              ...stateFor(prev, k, keepPreviousData),
              loading: false,
              error: e instanceof Error && e.message ? e.message : errorFallback,
              errorStatus: statusOf(e),
              stale: false,
            };
          });
        });
    },
    [errorFallback, keepPreviousData],
  );

  useEffect(() => {
    // Same key → keep the current value (revalidate in place). New key → snap
    // to ITS cached value, or clear, never the previous key's payload.
    setState((prev) => stateFor(prev, key, keepPreviousData));
    if (key) run(key);
  }, [key, keepPreviousData, run]);

  const refresh = useCallback(() => {
    if (key) run(key);
  }, [key, run]);

  // Derive during render too, so the first commit after a key change already
  // renders this key's value (or its empty state) — never the old key's data.
  const shown = stateFor(state, key, keepPreviousData);

  return {
    data: shown.data,
    loading: shown.loading,
    error: shown.error,
    errorStatus: shown.errorStatus,
    stale: shown.stale,
    refresh,
  };
}
