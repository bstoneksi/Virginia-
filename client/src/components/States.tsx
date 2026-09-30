import type { ReactNode } from "react";
import { errorMessage } from "@/api";
import { Button } from "./Field";
import { Icon } from "./Icon";

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-slate-400 ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Spinner />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="mx-auto my-8 flex max-w-sm flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-center">
      <Icon name="alert" className="h-6 w-6 text-red-600" />
      <p className="text-sm text-red-800">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint, action, compact = false }: { title: string; hint?: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center gap-2 text-center ${compact ? "py-4" : "py-10"}`}>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="max-w-xs text-xs text-slate-500">{hint}</p>}
      {action}
    </div>
  );
}

export function FullScreenMessage({ title, detail, action, spinner = false }: { title: string; detail?: string; action?: ReactNode; spinner?: boolean }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      {spinner && <Spinner className="h-7 w-7" />}
      <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
      {detail && <p className="max-w-sm text-sm text-slate-600">{detail}</p>}
      {action}
    </main>
  );
}

export function SectionHeader({ title, count, right }: { title: string; count?: number; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
        {title}
        {count !== undefined && <span className="rounded-full bg-slate-200 px-1.5 text-[11px] font-semibold leading-5 text-slate-700">{count}</span>}
      </h2>
      {right}
    </div>
  );
}
