import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Item, ItemFilters, Status } from "@shared/types";
import { STATUSES } from "@shared/types";
import { api, errorMessage } from "@/api";
import { addDays, isoDateInTZ, todayISO } from "@/lib/dates";
import { useItemDrawer } from "@/lib/drawer";
import { itemMatchesFilters, toItemFilters, type BoardFilters } from "@/lib/filters";
import { useItemChanges, type ItemChange } from "@/lib/itemEvents";
import { useToast } from "@/lib/toast";
import { useQuery } from "@/lib/useQuery";
import { ErrorState, LoadingState } from "../States";
import { BoardCardGhost } from "./BoardCard";
import { BoardColumn } from "./BoardColumn";

type Columns = Record<Status, Item[]>;

function emptyColumns(): Columns {
  return { Open: [], "In Progress": [], Parked: [], Done: [] };
}

function groupByStatus(items: Item[]): Columns {
  const cols = emptyColumns();
  for (const item of items) cols[item.status].push(item);
  return cols;
}

function findContainer(id: UniqueIdentifier, cols: Columns): Status | undefined {
  const key = String(id);
  if ((STATUSES as readonly string[]).includes(key)) return key as Status;
  return STATUSES.find((s) => cols[s].some((i) => i.id === key));
}

function applyChange(cols: Columns, change: ItemChange, filters: ItemFilters): Columns {
  const next = emptyColumns();
  for (const s of STATUSES) next[s] = cols[s].filter((i) => (change.type === "deleted" ? i.id !== change.id : i.id !== change.item.id));
  if (change.type === "deleted") return next;
  if (!itemMatchesFilters(change.item, filters)) return next;
  const previous = change.type === "updated" ? STATUSES.find((s) => cols[s].some((i) => i.id === change.item.id)) : undefined;
  const column = next[change.item.status];
  if (previous === change.item.status) {
    const index = cols[previous].findIndex((i) => i.id === change.item.id);
    column.splice(Math.min(index, column.length), 0, change.item);
  } else {
    column.unshift(change.item);
  }
  return next;
}

interface BoardProps {
  filters: BoardFilters;
  /** Extra server filters fixed by the page (e.g. a brand's division). */
  fixed?: Partial<ItemFilters>;
}

export function Board({ filters, fixed }: BoardProps) {
  const toast = useToast();
  const { openItem } = useItemDrawer();
  const itemFilters = useMemo(() => toItemFilters(filters, { includeDone: true, ...fixed }), [filters, fixed]);
  const filterKey = JSON.stringify(itemFilters);
  const query = useQuery((signal) => api.items.list(itemFilters, signal), [filterKey]);

  const [columns, setColumns] = useState<Columns>(emptyColumns);
  const columnsRef = useRef<Columns>(columns);
  const snapshotRef = useRef<Columns | null>(null);
  const lastDragEnd = useRef(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);

  const commit = useCallback((next: Columns) => {
    columnsRef.current = next;
    setColumns(next);
  }, []);

  useEffect(() => {
    if (query.data) commit(groupByStatus(query.data));
  }, [query.data, commit]);

  useItemChanges((change) => commit(applyChange(columnsRef.current, change, itemFilters)));

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    snapshotRef.current = columnsRef.current;
  };

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const cols = columnsRef.current;
    const from = findContainer(active.id, cols);
    const to = findContainer(over.id, cols);
    if (!from || !to || from === to) return;
    const moving = cols[from].find((i) => i.id === String(active.id));
    if (!moving) return;
    const toItems = cols[to];
    const overIndex = toItems.findIndex((i) => i.id === String(over.id));
    let newIndex = toItems.length;
    if (overIndex !== -1) {
      const translated = active.rect.current.translated;
      const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
      newIndex = overIndex + (below ? 1 : 0);
    }
    const nextTo = [...toItems];
    // Mirror what the server will do so the optimistic card is not filtered out of Done mid-drag
    // (the 30-day Done window keys on completedAt, falling back to updatedAt).
    const completedAt = to === "Done" ? (moving.completedAt ?? new Date().toISOString()) : null;
    nextTo.splice(newIndex, 0, { ...moving, status: to, completedAt });
    commit({ ...cols, [from]: cols[from].filter((i) => i.id !== moving.id), [to]: nextTo });
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveId(null);
    lastDragEnd.current = Date.now();
    const before = snapshotRef.current;
    snapshotRef.current = null;
    const cols = columnsRef.current;
    const activeKey = String(active.id);
    const from = findContainer(activeKey, cols);
    if (!from) return;
    const to = over ? (findContainer(over.id, cols) ?? from) : from;
    let next = cols;
    if (over && from === to) {
      const oldIndex = cols[to].findIndex((i) => i.id === activeKey);
      const newIndex = cols[to].findIndex((i) => i.id === String(over.id));
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) next = { ...cols, [to]: arrayMove(cols[to], oldIndex, newIndex) };
    }
    const beforeIds = before ? before[to].map((i) => i.id) : [];
    const afterIds = next[to].map((i) => i.id);
    const changed = beforeIds.length !== afterIds.length || beforeIds.some((id, idx) => id !== afterIds[idx]);
    if (!changed) {
      if (before) commit(before);
      return;
    }
    commit(next);
    try {
      await api.items.reorder({ status: to, orderedIds: afterIds });
      await query.reload();
    } catch (err) {
      if (before) commit(before);
      toast.error(`Couldn't save the new order: ${errorMessage(err)}`);
    }
  };

  const onDragCancel = () => {
    setActiveId(null);
    if (snapshotRef.current) commit(snapshotRef.current);
    snapshotRef.current = null;
  };

  const open = (item: Item) => {
    if (Date.now() - lastDragEnd.current < 350) return;
    openItem(item.id);
  };

  const cutoff = addDays(todayISO(), -30);
  const doneAll = columns.Done;
  // The card being dragged always stays rendered, whatever its completion date.
  const doneVisible = showAllDone ? doneAll : doneAll.filter((i) => i.id === activeId || isoDateInTZ(i.completedAt ?? i.updatedAt) >= cutoff);
  const hiddenDone = doneAll.length - doneVisible.length;
  const activeItem = activeId ? STATUSES.flatMap((s) => columns[s]).find((i) => i.id === activeId) : undefined;

  if (query.loading && !query.data) return <LoadingState label="Loading board…" />;
  if (query.error && !query.data) return <ErrorState error={query.error} onRetry={() => void query.reload(false)} />;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={(e) => void onDragEnd(e)} onDragCancel={onDragCancel}>
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:snap-none md:overflow-visible md:px-0">
        {STATUSES.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            items={status === "Done" ? doneVisible : columns[status]}
            total={columns[status].length}
            onOpen={open}
            footer={
              status === "Done" && (hiddenDone > 0 || showAllDone) ? (
                <button type="button" onClick={() => setShowAllDone((v) => !v)} className="min-h-11 w-full rounded-lg text-xs font-medium text-brand hover:bg-white">
                  {showAllDone ? "Show last 30 days only" : `Show all (${hiddenDone} older)`}
                </button>
              ) : undefined
            }
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{activeItem ? <BoardCardGhost item={activeItem} /> : null}</DragOverlay>
    </DndContext>
  );
}
