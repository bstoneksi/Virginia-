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
import { assignLane, groupItems, laneKeyFor, parseColumnId, reassignment, type GroupMode } from "@shared/boardGroups";
import { api, errorMessage } from "@/api";
import { useBootstrap } from "@/lib/bootstrap";
import { addDays, isoDateInTZ, todayISO } from "@/lib/dates";
import { useItemDrawer } from "@/lib/drawer";
import { itemMatchesFilters, toItemFilters, type BoardFilters } from "@/lib/filters";
import { useItemChanges, type ItemChange } from "@/lib/itemEvents";
import { useToast } from "@/lib/toast";
import { useQuery } from "@/lib/useQuery";
import { EmptyState, ErrorState, LoadingState } from "../States";
import { BoardCardGhost } from "./BoardCard";
import { Swimlane } from "./Swimlane";

/** Full rank order of every status column — the source of truth; swimlanes are a view over it. */
type Columns = Record<Status, Item[]>;

/** Where a card or drop target sits: a lane (`"all"` on the flat board) and a status column. */
interface Location {
  lane: string;
  status: Status;
}

function emptyColumns(): Columns {
  return { Open: [], "In Progress": [], Parked: [], Done: [] };
}

function groupByStatus(items: Item[]): Columns {
  const cols = emptyColumns();
  for (const item of items) cols[item.status].push(item);
  return cols;
}

/** Resolve a dnd-kit id — a column's `columnId(lane, status)` or a card id — to its lane and status. */
function locate(id: UniqueIdentifier, cols: Columns, mode: GroupMode, meInitials: string | null): Location | undefined {
  const column = parseColumnId(id);
  if (column) return column;
  const key = String(id);
  for (const status of STATUSES) {
    const item = cols[status].find((i) => i.id === key);
    if (item) return { lane: laneKeyFor(item, mode, meInitials), status };
  }
  return undefined;
}

function sameLocation(a: Location, b: Location): boolean {
  return a.lane === b.lane && a.status === b.status;
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
  /** Swimlane layout: `none` is the flat four-column board. */
  groupBy?: GroupMode;
}

export function Board({ filters, fixed, groupBy = "none" }: BoardProps) {
  const toast = useToast();
  const { openItem } = useItemDrawer();
  const { allDivisions, allPeople, me } = useBootstrap();
  const itemFilters = useMemo(() => toItemFilters(filters, { includeDone: true, ...fixed }), [filters, fixed]);
  const filterKey = JSON.stringify(itemFilters);
  const query = useQuery((signal) => api.items.list(itemFilters, signal), [filterKey]);
  const mode = groupBy;

  const [columns, setColumns] = useState<Columns>(emptyColumns);
  const columnsRef = useRef<Columns>(columns);
  const snapshotRef = useRef<Columns | null>(null);
  const lastDragEnd = useRef(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Lanes on screen when the drag started — kept visible (even emptied) so nothing shifts under the pointer. */
  const [dragLanes, setDragLanes] = useState<readonly string[] | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);

  const commit = useCallback((next: Columns) => {
    columnsRef.current = next;
    setColumns(next);
  }, []);

  useEffect(() => {
    if (query.data) commit(groupByStatus(query.data));
  }, [query.data, commit]);

  useItemChanges((change) => commit(applyChange(columnsRef.current, change, itemFilters)));

  const meInitials = me?.initials ?? null;
  const lanes = useMemo(
    () =>
      groupItems(
        STATUSES.flatMap((s) => columns[s]),
        mode,
        { divisions: allDivisions, people: allPeople, meInitials, keepEmpty: dragLanes ?? undefined },
      ),
    [columns, mode, allDivisions, allPeople, meInitials, dragLanes],
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    setDragLanes(lanes.map((l) => l.key));
    snapshotRef.current = columnsRef.current;
  };

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const cols = columnsRef.current;
    const from = locate(active.id, cols, mode, meInitials);
    const to = locate(over.id, cols, mode, meInitials);
    if (!from || !to || sameLocation(from, to)) return;
    const moving = cols[from.status].find((i) => i.id === String(active.id));
    if (!moving) return;
    const next: Columns = { ...cols, [from.status]: cols[from.status].filter((i) => i.id !== moving.id) };
    const target = [...next[to.status]];
    const overIndex = target.findIndex((i) => i.id === String(over.id));
    let index: number;
    if (overIndex !== -1) {
      const translated = active.rect.current.translated;
      const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
      index = overIndex + (below ? 1 : 0);
    } else {
      // Dropped on the column itself. All lanes share one rank order per status, so the card goes right
      // after the lane's last card in that column (the bottom of what the user sees), else at the end.
      const last = target.reduce((acc, item, i) => (laneKeyFor(item, mode, meInitials) === to.lane ? i : acc), -1);
      index = last === -1 ? target.length : last + 1;
    }
    // Mirror what the server will do so the optimistic card is not filtered out of Done mid-drag
    // (the 30-day Done window keys on completedAt, falling back to updatedAt). Crossing lanes also
    // reassigns the card (division / personal / owner) so it renders in the lane it was dropped on.
    const completedAt = to.status === "Done" ? (moving.completedAt ?? new Date().toISOString()) : null;
    target.splice(index, 0, { ...assignLane(moving, to.lane, mode, meInitials), status: to.status, completedAt });
    next[to.status] = target;
    commit(next);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveId(null);
    setDragLanes(null);
    lastDragEnd.current = Date.now();
    const before = snapshotRef.current;
    snapshotRef.current = null;
    const cols = columnsRef.current;
    const activeKey = String(active.id);
    // onDragOver already moved the card into the lane/column it hovers; `dest` is where it sits now.
    const dest = locate(activeKey, cols, mode, meInitials);
    if (!dest) return;
    let next = cols;
    if (over) {
      const overAt = locate(over.id, cols, mode, meInitials);
      if (overAt && sameLocation(overAt, dest)) {
        const column = cols[dest.status];
        const oldIndex = column.findIndex((i) => i.id === activeKey);
        const newIndex = column.findIndex((i) => i.id === String(over.id));
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) next = { ...cols, [dest.status]: arrayMove(column, oldIndex, newIndex) };
      }
    }
    const original = before ? STATUSES.flatMap((s) => before[s]).find((i) => i.id === activeKey) : undefined;
    const patch = original ? reassignment(original, dest.lane, mode, meInitials) : null;
    const beforeIds = before ? before[dest.status].map((i) => i.id) : [];
    const afterIds = next[dest.status].map((i) => i.id);
    const orderChanged = beforeIds.length !== afterIds.length || beforeIds.some((id, idx) => id !== afterIds[idx]);
    if (!orderChanged && !patch) {
      if (before) commit(before);
      return;
    }
    commit(next);
    // Reassign first (PATCH), then persist the whole destination column's order (the lane is a view;
    // other lanes' cards keep their relative positions because they are all listed).
    try {
      if (patch) await api.items.update(activeKey, patch);
    } catch (err) {
      if (before) commit(before);
      toast.error(`Couldn't move the card: ${errorMessage(err)}`);
      return;
    }
    try {
      if (orderChanged) await api.items.reorder({ status: dest.status, orderedIds: afterIds });
      await query.reload();
    } catch (err) {
      // The reassignment (if any) is already saved: show the server's truth rather than the snapshot.
      if (patch) void query.reload();
      else if (before) commit(before);
      toast.error(`Couldn't save the new order: ${errorMessage(err)}`);
    }
  };

  const onDragCancel = () => {
    setActiveId(null);
    setDragLanes(null);
    if (snapshotRef.current) commit(snapshotRef.current);
    snapshotRef.current = null;
  };

  const open = (item: Item) => {
    if (Date.now() - lastDragEnd.current < 350) return;
    openItem(item.id);
  };

  const cutoff = addDays(todayISO(), -30);
  // Done older than 30 days is collapsed; the card being dragged always stays rendered, whatever its completion date.
  const hiddenDone = new Set<string>(
    showAllDone ? [] : columns.Done.filter((i) => i.id !== activeId && isoDateInTZ(i.completedAt ?? i.updatedAt) < cutoff).map((i) => i.id),
  );
  const grouped = mode !== "none";
  // Lanes with nothing visible are hidden — except the ones that were on screen when a drag started.
  const shownLanes = grouped ? lanes.filter((l) => dragLanes?.includes(l.key) || l.items.some((i) => !hiddenDone.has(i.id))) : lanes;
  const activeItem = activeId ? STATUSES.flatMap((s) => columns[s]).find((i) => i.id === activeId) : undefined;

  if (query.loading && !query.data) return <LoadingState label="Loading board…" />;
  if (query.error && !query.data) return <ErrorState error={query.error} onRetry={() => void query.reload(false)} />;

  const doneToggle =
    hiddenDone.size > 0 || showAllDone ? (
      <button
        type="button"
        onClick={() => setShowAllDone((v) => !v)}
        className={`min-h-11 rounded-lg text-xs font-medium text-brand ${grouped ? "px-4 hover:bg-slate-100" : "w-full hover:bg-white"}`}
      >
        {showAllDone ? "Show last 30 days only" : `Show all (${hiddenDone.size} older${grouped ? " done" : ""})`}
      </button>
    ) : null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={(e) => void onDragEnd(e)} onDragCancel={onDragCancel}>
      <div className="flex flex-col gap-3">
        {shownLanes.map((lane, index) => (
          <Swimlane
            key={lane.key}
            lane={lane}
            hiddenDone={hiddenDone}
            onOpen={open}
            showHeader={grouped}
            compact={grouped}
            doneFooter={grouped ? undefined : doneToggle}
            className={grouped && index > 0 ? "border-t border-slate-200 pt-3" : ""}
          />
        ))}
        {grouped && shownLanes.length === 0 && (
          <EmptyState compact title="Nothing to show" hint={hiddenDone.size > 0 ? "Only done items older than 30 days match." : "No cards match these filters."} />
        )}
        {grouped && doneToggle && <div className="flex justify-center">{doneToggle}</div>}
      </div>
      <DragOverlay dropAnimation={null}>{activeItem ? <BoardCardGhost item={activeItem} /> : null}</DragOverlay>
    </DndContext>
  );
}
