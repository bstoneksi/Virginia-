/**
 * Shell-level contexts: the page title shown in the top bar and the pending-captures badge count.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { api } from "@/api";

// --- page title -------------------------------------------------------------

interface TitleApi {
  title: string | null;
  setTitle: (title: string | null) => void;
}
const TitleContext = createContext<TitleApi | null>(null);

export function TitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const value = useMemo(() => ({ title, setTitle }), [title]);
  return <TitleContext.Provider value={value}>{children}</TitleContext.Provider>;
}

export function useTitleContext(): TitleApi {
  const ctx = useContext(TitleContext);
  if (!ctx) throw new Error("useTitleContext must be used inside <TitleProvider>");
  return ctx;
}

/** Pages call this to set the top-bar title (and document.title). */
export function usePageTitle(title: string | undefined | null): void {
  const { setTitle } = useTitleContext();
  useEffect(() => {
    setTitle(title ?? null);
    document.title = title ? `${title} · Virginia` : "Virginia";
    return () => setTitle(null);
  }, [title, setTitle]);
}

// --- pending captures badge -------------------------------------------------

interface PendingApi {
  count: number;
  refresh: () => Promise<void>;
}
const PendingContext = createContext<PendingApi | null>(null);

export function PendingCapturesProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const location = useLocation();

  const refresh = useCallback(async () => {
    try {
      const list = await api.captures.list("pending");
      setCount(Array.isArray(list) ? list.length : 0);
    } catch {
      /* badge is best-effort; the API may not be up yet */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, location.pathname]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), 90_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const value = useMemo(() => ({ count, refresh }), [count, refresh]);
  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>;
}

export function usePendingCaptures(): PendingApi {
  const ctx = useContext(PendingContext);
  if (!ctx) throw new Error("usePendingCaptures must be used inside <PendingCapturesProvider>");
  return ctx;
}
