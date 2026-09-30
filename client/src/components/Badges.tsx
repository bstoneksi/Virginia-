import type { Category, Division, Priority, Status } from "@shared/types";
import { CATEGORY_COLORS, CATEGORY_LABELS, PRIORITY_COLORS, STATUS_COLORS } from "@shared/types";
import { dueLabel, type DueTone } from "@/lib/dates";

export function CategoryBadge({ category, label = false, className = "" }: { category: Category; label?: boolean; className?: string }) {
  const c = CATEGORY_COLORS[category];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 text-[11px] font-bold leading-5 tracking-wide ${className}`}
      style={{ background: c.bg, color: c.fg }}
      title={CATEGORY_LABELS[category]}
    >
      {category}
      {label && <span className="ml-1 font-medium">{CATEGORY_LABELS[category]}</span>}
    </span>
  );
}

export function StatusChip({ status, className = "" }: { status: Status; className?: string }) {
  const c = STATUS_COLORS[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 text-[11px] font-semibold leading-5 ${className}`}
      style={{ background: c.bg, color: c.fg }}
    >
      {status}
    </span>
  );
}

export function DivisionChip({
  division,
  code,
  className = "",
}: {
  division?: Division | undefined;
  code?: string | null;
  className?: string;
}) {
  const shown = division?.code ?? code;
  if (!shown) return null;
  const style = division
    ? { background: division.color, color: division.textColor }
    : { background: "#E2E8F0", color: "#334155" };
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 text-[11px] font-semibold leading-5 ${className}`}
      style={style}
      title={division?.name ?? shown}
    >
      {shown}
    </span>
  );
}

export function PriorityDot({ priority, className = "" }: { priority: Priority; className?: string }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full ${priority === "High" ? "h-3 w-3" : "h-2.5 w-2.5"} ${className}`}
      style={{ background: PRIORITY_COLORS[priority].fg, opacity: priority === "Low" ? 0.7 : 1 }}
      title={`${priority} priority`}
      aria-label={`${priority} priority`}
    />
  );
}

export function PriorityChip({ priority }: { priority: Priority }) {
  const c = PRIORITY_COLORS[priority];
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 text-[11px] font-semibold leading-5" style={{ background: c.bg, color: c.fg }}>
      <PriorityDot priority={priority} className="!h-2 !w-2" />
      {priority}
    </span>
  );
}

const AVATAR_SIZE = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-6 w-6 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
} as const;

export function Avatar({
  initials,
  size = "sm",
  title,
  className = "",
}: {
  initials: string;
  size?: keyof typeof AVATAR_SIZE;
  title?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand/10 font-semibold text-brand ${AVATAR_SIZE[size]} ${className}`}
      title={title ?? initials}
    >
      {initials}
    </span>
  );
}

export function OwnerChip({ initials, name, className = "" }: { initials: string | null; name?: string; className?: string }) {
  if (!initials) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold leading-5 text-slate-700 ${className}`}
      title={name ?? initials}
    >
      {initials}
    </span>
  );
}

const DUE_TONE_CLASS: Record<DueTone, string> = {
  overdue: "text-red-700 font-semibold",
  today: "text-amber-700 font-semibold",
  soon: "text-slate-700",
  normal: "text-slate-500",
};

export function DueChip({ dueDate, status, className = "" }: { dueDate: string | null; status: Status; className?: string }) {
  const label = dueLabel(dueDate);
  if (!label) return null;
  const done = status === "Done";
  const tone = done ? "normal" : label.tone;
  return (
    <span className={`inline-flex shrink-0 items-center text-[11px] leading-5 ${DUE_TONE_CLASS[tone]} ${done ? "line-through" : ""} ${className}`} title={dueDate ?? ""}>
      {label.text}
    </span>
  );
}

export function InferredTag() {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 text-[11px] font-semibold leading-5 text-amber-800" title="No explicit tag — category was inferred">
      inferred
    </span>
  );
}

export function Chip({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full bg-slate-100 px-2 text-[11px] font-medium leading-5 text-slate-600 ${className}`}>{children}</span>;
}
