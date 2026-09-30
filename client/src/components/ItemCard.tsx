import type { ReactNode } from "react";
import type { Item } from "@shared/types";
import { CATEGORY_LABELS } from "@shared/types";
import { useBootstrap } from "@/lib/bootstrap";
import { CategoryBadge, DivisionChip, DueChip, OwnerChip, PriorityDot, StatusChip } from "./Badges";

interface ItemCardProps {
  item: Item;
  /** `card` for the board, `row` for dense lists. */
  variant?: "card" | "row";
  onOpen?: (item: Item) => void;
  showStatus?: boolean;
  muted?: boolean;
  trailing?: ReactNode;
  className?: string;
}

export function ItemCard({ item, variant = "row", onOpen, showStatus = false, muted = false, trailing, className = "" }: ItemCardProps) {
  const { division, person } = useBootstrap();
  const div = division(item.divisionCode);
  const owner = person(item.ownerInitials);
  const done = item.status === "Done";
  const dim = muted || done;
  // Accessible name for the clickable card / row (badges and chips alone read as noise).
  const accessibleName = `${CATEGORY_LABELS[item.category]}: ${item.title}`;

  const meta = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-600">
      <OwnerChip initials={item.ownerInitials} name={owner?.fullName} />
      {item.isPersonal ? <DivisionChip code="PTD" division={division("PTD")} /> : <DivisionChip division={div} code={item.divisionCode} />}
      <DueChip dueDate={item.dueDate} status={item.status} />
      {showStatus && <StatusChip status={item.status} />}
      {item.context && <span className="truncate text-[11px] text-slate-400">{item.context}</span>}
    </div>
  );

  if (variant === "card") {
    return (
      <div
        role={onOpen ? "button" : undefined}
        tabIndex={onOpen ? 0 : undefined}
        aria-label={onOpen ? accessibleName : undefined}
        onClick={onOpen ? () => onOpen(item) : undefined}
        onKeyDown={
          onOpen
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(item);
                }
              }
            : undefined
        }
        className={`rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm ${onOpen ? "cursor-pointer hover:border-slate-300 active:bg-slate-50" : ""} ${dim ? "opacity-70" : ""} ${className}`}
      >
        <div className="flex items-start gap-2">
          <CategoryBadge category={item.category} />
          <p className={`min-w-0 flex-1 break-words text-sm font-medium leading-snug text-slate-900 ${done ? "line-through" : ""}`}>{item.title}</p>
          <PriorityDot priority={item.priority} className="mt-1.5" />
        </div>
        <div className="mt-1.5">{meta}</div>
        {trailing}
      </div>
    );
  }

  return (
    <div className={`flex min-h-11 items-stretch gap-1 border-b border-slate-100 last:border-b-0 ${dim ? "opacity-70" : ""} ${className}`}>
      <button
        type="button"
        aria-label={accessibleName}
        onClick={onOpen ? () => onOpen(item) : undefined}
        disabled={!onOpen}
        className="flex min-w-0 flex-1 items-start gap-2 py-2 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <CategoryBadge category={item.category} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className={`break-words text-sm font-medium leading-snug text-slate-900 ${done ? "line-through" : ""}`}>{item.title}</p>
          <div className="mt-0.5">{meta}</div>
        </div>
        <PriorityDot priority={item.priority} className="mt-1.5" />
      </button>
      {trailing && <div className="flex shrink-0 items-center">{trailing}</div>}
    </div>
  );
}

export function ItemList({ items, onOpen, showStatus = false, empty }: { items: Item[]; onOpen: (item: Item) => void; showStatus?: boolean; empty?: ReactNode }) {
  if (items.length === 0) return <>{empty ?? null}</>;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3">
      {items.map((item) => (
        <ItemCard key={item.id} item={item} onOpen={onOpen} showStatus={showStatus} />
      ))}
    </div>
  );
}
