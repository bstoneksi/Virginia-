import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const KIND_CLASS: Record<ToastKind, string> = {
  success: "bg-emerald-700 text-white",
  error: "bg-red-700 text-white",
  info: "bg-slate-800 text-white",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-2), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3500);
    },
    [dismiss],
  );

  const value = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show(m, "success"),
      error: (m) => show(m, "error"),
      info: (m) => show(m, "info"),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 &&
        createPortal(
          <div
            className="no-print pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-4"
            style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
            aria-live="polite"
          >
            {toasts.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => dismiss(t.id)}
                className={`pointer-events-auto max-w-sm rounded-lg px-4 py-2.5 text-sm shadow-lg ${KIND_CLASS[t.kind]}`}
              >
                {t.message}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
