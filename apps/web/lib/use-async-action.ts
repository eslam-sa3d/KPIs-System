import { useCallback, useState } from 'react';

/** Wraps the "clear error, run a mutation, set error from a thrown Error's
 *  message (or a fallback) on failure" shape repeated across nearly every
 *  admin CRUD page's form handlers. */
export function useAsyncAction() {
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<void>, fallback: string) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
    }
  }, []);

  return { error, setError, run };
}
