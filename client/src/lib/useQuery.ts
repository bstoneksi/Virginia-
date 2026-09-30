import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

export interface QueryState<T> {
  data: T | undefined;
  error: Error | null;
  /** True while the first load (or a non-silent reload) is in flight. */
  loading: boolean;
  /** Re-run the loader. `silent` (default true) keeps the current data visible while loading. */
  reload: (silent?: boolean) => Promise<void>;
  setData: Dispatch<SetStateAction<T | undefined>>;
}

/**
 * Minimal data-loading hook: runs `loader` when `deps` change, ignores stale results,
 * exposes `reload` and lets callers patch `data` optimistically.
 */
export function useQuery<T>(loader: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]): QueryState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const silentRef = useRef(false);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    if (!silentRef.current) setLoading(true);
    silentRef.current = false;
    loaderRef
      .current(controller.signal)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(async (silent = true) => {
    silentRef.current = silent;
    setVersion((v) => v + 1);
  }, []);

  return { data, error, loading, reload, setData };
}

/** Small helper for one-off async actions with a busy flag. */
export function useBusy(): [boolean, <T>(fn: () => Promise<T>) => Promise<T | undefined>] {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }, []);
  return [busy, run];
}
