import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** `right`: full-height side panel on desktop (drawer). `center`: dialog. Mobile is always a bottom sheet. */
  variant?: "right" | "center";
  wide?: boolean;
}

/** Responsive modal: bottom sheet on phones, side drawer or centered dialog on md+. */
export function Sheet({ open, onClose, title, children, footer, variant = "right", wide = false }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  const wrapper =
    variant === "right"
      ? "items-end justify-center md:items-stretch md:justify-end"
      : "items-end justify-center md:items-center md:justify-center md:p-6";
  const panel =
    variant === "right"
      ? `rounded-t-2xl md:h-full md:max-h-none md:rounded-none ${wide ? "md:w-[640px]" : "md:w-[480px]"}`
      : `rounded-t-2xl md:h-auto md:max-h-[85dvh] md:rounded-2xl ${wide ? "md:w-[720px]" : "md:w-[520px]"}`;

  return createPortal(
    <div className={`no-print fixed inset-0 z-50 flex ${wrapper}`}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" className={`relative flex w-full max-h-[92dvh] flex-col bg-white shadow-2xl ${panel}`}>
        <header className="flex min-h-14 items-center gap-2 border-b border-slate-200 px-4 py-2">
          <div className="min-w-0 flex-1 text-base font-semibold text-slate-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <footer className="border-t border-slate-200 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
