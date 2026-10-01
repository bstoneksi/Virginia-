import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Item, Status } from "@shared/types";
import { STATUS_COLORS } from "@shared/types";
import { BoardCard } from "./BoardCard";

interface BoardColumnProps {
  status: Status;
  /** Droppable / sortable-context id. Defaults to the status; swimlanes pass `columnId(lane, status)` so every lane's columns stay distinct. */
  id?: string;
  /** Names the lane in the accessible column name when several lanes repeat the same four columns. */
  laneLabel?: string;
  items: Item[];
  /** Total in this status (may exceed items.length when Done is collapsed). */
  total: number;
  onOpen: (item: Item) => void;
  footer?: ReactNode;
  /** Content-sized column with a compact placeholder (inside a swimlane; the page scrolls, not the column). */
  compact?: boolean;
}

export function BoardColumn({ status, id, laneLabel, items, total, onOpen, footer, compact = false }: BoardColumnProps) {
  const containerId = id ?? status;
  const { setNodeRef, isOver } = useDroppable({ id: containerId });
  const color = STATUS_COLORS[status];
  return (
    <section
      className={`flex w-[82vw] max-w-[320px] shrink-0 snap-center flex-col rounded-xl border bg-slate-100/80 md:w-auto md:max-w-none md:min-w-0 md:shrink ${isOver ? "border-brand/40 ring-2 ring-brand/20" : "border-slate-200"}`}
      aria-label={laneLabel ? `${laneLabel} · ${status} column` : `${status} column`}
    >
      <header className="flex items-center justify-between px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: color.fg }}>
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color.fg }} />
          {status}
        </h2>
        <span className="rounded-full bg-white px-2 text-xs font-semibold leading-5 text-slate-600">{total}</span>
      </header>
      <SortableContext id={containerId} items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`flex flex-1 flex-col gap-2 px-2 pb-2 ${compact ? "min-h-[72px]" : "min-h-[120px] md:max-h-[calc(100dvh-16rem)] md:overflow-y-auto md:scrollbar-thin"}`}
        >
          {items.map((item) => (
            <BoardCard key={item.id} item={item} onOpen={onOpen} />
          ))}
          {items.length === 0 && (
            <div className={`flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400 ${compact ? "py-3" : "py-6"}`}>
              {isOver ? "Drop here" : "Nothing here"}
            </div>
          )}
          {footer}
        </div>
      </SortableContext>
    </section>
  );
}
