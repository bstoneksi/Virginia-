import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Item, Status } from "@shared/types";
import { STATUS_COLORS } from "@shared/types";
import { BoardCard } from "./BoardCard";

interface BoardColumnProps {
  status: Status;
  items: Item[];
  /** Total in this status (may exceed items.length when Done is collapsed). */
  total: number;
  onOpen: (item: Item) => void;
  footer?: ReactNode;
}

export function BoardColumn({ status, items, total, onOpen, footer }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const color = STATUS_COLORS[status];
  return (
    <section
      className={`flex w-[82vw] max-w-[320px] shrink-0 snap-center flex-col rounded-xl border bg-slate-100/80 md:w-auto md:max-w-none md:min-w-0 md:shrink ${isOver ? "border-brand/40 ring-2 ring-brand/20" : "border-slate-200"}`}
      aria-label={`${status} column`}
    >
      <header className="flex items-center justify-between px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: color.fg }}>
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color.fg }} />
          {status}
        </h2>
        <span className="rounded-full bg-white px-2 text-xs font-semibold leading-5 text-slate-600">{total}</span>
      </header>
      <SortableContext id={status} items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-[120px] flex-1 flex-col gap-2 px-2 pb-2 md:max-h-[calc(100dvh-16rem)] md:overflow-y-auto md:scrollbar-thin">
          {items.map((item) => (
            <BoardCard key={item.id} item={item} onOpen={onOpen} />
          ))}
          {items.length === 0 && (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-300 py-6 text-xs text-slate-400">
              {isOver ? "Drop here" : "Nothing here"}
            </div>
          )}
          {footer}
        </div>
      </SortableContext>
    </section>
  );
}
