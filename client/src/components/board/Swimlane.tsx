import type { ReactNode } from "react";
import type { Item, Status } from "@shared/types";
import { STATUSES } from "@shared/types";
import { columnId, type Lane } from "@shared/boardGroups";
import { Avatar } from "../Badges";
import { BoardColumn } from "./BoardColumn";

interface SwimlaneProps {
  lane: Lane;
  /** Done items outside the 30-day window: not rendered, still counted in the Done column header. */
  hiddenDone: ReadonlySet<string>;
  onOpen: (item: Item) => void;
  /** Lane header (chip, label, count). Off for the flat board, which is one anonymous lane. */
  showHeader?: boolean;
  /** Content-sized columns with a compact placeholder: lanes stack vertically and the page scrolls. */
  compact?: boolean;
  /** Rendered at the bottom of the Done column (the flat board's "Show all" toggle). */
  doneFooter?: ReactNode;
  className?: string;
}

/**
 * One swimlane: an optional header plus the same four status columns as the flat board, in the same
 * horizontally scrolling row on a phone (the lane scrolls, never the page) and a four-column grid on
 * desktop. Each column is its own drop target, `columnId(lane.key, status)`.
 */
export function Swimlane({ lane, hiddenDone, onOpen, showHeader = false, compact = false, doneFooter, className = "" }: SwimlaneProps) {
  const byStatus: Record<Status, Item[]> = { Open: [], "In Progress": [], Parked: [], Done: [] };
  const totals: Record<Status, number> = { Open: 0, "In Progress": 0, Parked: 0, Done: 0 };
  for (const item of lane.items) {
    totals[item.status] += 1;
    if (!hiddenDone.has(item.id)) byStatus[item.status].push(item);
  }
  const visible = STATUSES.reduce((n, s) => n + byStatus[s].length, 0);

  return (
    <section aria-label={showHeader ? `${lane.label} lane` : undefined} className={`flex flex-col gap-1.5 ${className}`}>
      {showHeader && (
        <header className="flex min-h-9 items-center gap-2">
          <LaneChip lane={lane} />
          <h2 className="min-w-0 truncate text-sm font-semibold text-slate-800">{lane.label}</h2>
          <span className="rounded-full bg-slate-200 px-2 text-xs font-semibold leading-5 text-slate-700" aria-label={`${visible} cards`}>
            {visible}
          </span>
        </header>
      )}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:snap-none md:overflow-visible md:px-0">
        {STATUSES.map((status) => (
          <BoardColumn
            key={status}
            id={columnId(lane.key, status)}
            status={status}
            laneLabel={showHeader ? lane.label : undefined}
            items={byStatus[status]}
            total={totals[status]}
            onOpen={onOpen}
            compact={compact}
            footer={status === "Done" ? doneFooter : undefined}
          />
        ))}
      </div>
    </section>
  );
}

/** Division code in the division's colour, a person's initials as an avatar; nothing for the catch-all lanes. */
function LaneChip({ lane }: { lane: Lane }) {
  if (!lane.chip) return null;
  if (lane.kind === "person") return <Avatar initials={lane.chip} size="sm" title={lane.label} />;
  const style = lane.color ? { background: lane.color.bg, color: lane.color.fg } : { background: "#E2E8F0", color: "#334155" };
  return (
    <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded px-1.5 text-[11px] font-bold" style={style} aria-hidden="true">
      {lane.chip}
    </span>
  );
}
