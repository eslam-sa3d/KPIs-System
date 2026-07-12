'use client';

import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api-client';

export interface UseResourceResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-runs the fetch (e.g. after a mutation). Awaitable — resolves once the
   *  new data (or error) has landed in state, so a caller that needs to act
   *  on the fresh result (e.g. select a row it just created) can `await`
   *  it; a caller that doesn't can just fire-and-forget with `void reload()`. */
  reload: () => Promise<void>;
  /** Escape hatch for optimistic local updates after a mutation, so callers
   *  don't need a full reload() round-trip just to reflect a change they
   *  already know the server accepted. */
  setData: Dispatch<SetStateAction<T | null>>;
}

/**
 * Every page in this app used to hand-roll the same
 * `useState(null) + useEffect(() => api(url).then(setX)) + try/catch` shape,
 * each with a slightly different loading/error convention. This is that
 * pattern, written once.
 *
 * Pass `null` for `url` to skip fetching (e.g. while a caller like
 * useSession() is still resolving) — flip it back to a real path once ready
 * and the fetch fires automatically.
 */
export function useResource<T>(url: string | null): UseResourceResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Only the most recently issued request's result is applied — guards
  // against an older, slower request landing after a newer one.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api<T>(url);
      if (id === requestId.current) setData(result);
    } catch (cause) {
      if (id === requestId.current) setError(cause instanceof Error ? cause.message : 'failed to load');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}
