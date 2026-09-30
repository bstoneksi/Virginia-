/**
 * Virginia — pure agenda / Today helpers shared by the server (routes, MCP) and the client.
 *
 * Everything here is deterministic given its inputs: no database, no clock (the only default that
 * touches `Date` is the optional `generatedAt` argument of `todayBuckets`). See docs/SPEC.md §4 and §8.
 */
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  isActiveStatus,
  type Agenda,
  type AgendaGroup,
  type Item,
  type Priority,
  type TodayView,
} from "./types";

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

const PRIORITY_RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };

/** High before Medium before Low. */
export function comparePriority(a: Priority, b: Priority): number {
  return PRIORITY_RANK[a] - PRIORITY_RANK[b];
}

/** Earlier due date first; items without a due date last. */
export function compareDueDate(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/** Board rank, then creation time, then id — a total order so sorts are stable across platforms. */
function compareStable(a: Item, b: Item): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Agenda order: priority High>Medium>Low, then due date ascending (nulls last), then rank ascending. */
export function compareAgendaItems(a: Item, b: Item): number {
  return comparePriority(a.priority, b.priority) || compareDueDate(a.dueDate, b.dueDate) || compareStable(a, b);
}

/** Date-driven order: due date ascending (nulls last), then priority, then rank. */
export function compareByDueDate(a: Item, b: Item): number {
  return compareDueDate(a.dueDate, b.dueDate) || comparePriority(a.priority, b.priority) || compareStable(a, b);
}

/** Most recently completed first. */
function compareDone(a: Item, b: Item): number {
  const ca = a.completedAt ?? a.updatedAt;
  const cb = b.completedAt ?? b.updatedAt;
  if (ca !== cb) return ca > cb ? -1 : 1;
  return compareStable(a, b);
}

// ---------------------------------------------------------------------------
// Agenda grouping
// ---------------------------------------------------------------------------

export interface GroupOptions {
  /** Include Done items in each group's `done` list. Default false. */
  includeDone?: boolean;
}

/**
 * Group items by category in `CATEGORY_ORDER`. Within a group: Open + In Progress in `active`
 * (sorted by `compareAgendaItems`), Parked in `parked`, and — only when requested — Done in `done`.
 * Groups with nothing to show are omitted.
 */
export function groupForAgenda(items: readonly Item[], options: GroupOptions = {}): AgendaGroup[] {
  const includeDone = options.includeDone ?? false;
  const groups: AgendaGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const active: Item[] = [];
    const parked: Item[] = [];
    const done: Item[] = [];
    for (const item of items) {
      if (item.category !== category) continue;
      if (isActiveStatus(item.status)) active.push(item);
      else if (item.status === "Parked") parked.push(item);
      else if (item.status === "Done" && includeDone) done.push(item);
    }
    if (active.length === 0 && parked.length === 0 && done.length === 0) continue;
    active.sort(compareAgendaItems);
    parked.sort(compareAgendaItems);
    done.sort(compareDone);
    groups.push({ category, active, parked, done });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

/** The parts of an Agenda the renderer needs (so it can be called before `markdown` exists). */
export type AgendaLike = Pick<Agenda, "subject" | "groups" | "generatedAt">;

/** YYYY-MM-DD in America/Detroit for an ISO timestamp; falls back to the first 10 characters. */
export function formatDateDetroit(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Detroit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** `[priority] title — owner initials, due YYYY-MM-DD` (owner / due omitted when absent). */
export function itemToBullet(item: Item): string {
  const tail: string[] = [];
  if (item.ownerInitials) tail.push(item.ownerInitials);
  if (item.dueDate) tail.push(`due ${item.dueDate}`);
  const suffix = tail.length > 0 ? ` — ${tail.join(", ")}` : "";
  return `[${item.priority}] ${item.title.trim()}${suffix}`;
}

function pushItemLines(lines: string[], item: Item, indent: string): void {
  lines.push(`${indent}- ${itemToBullet(item)}`);
  const note = item.note.trim();
  if (note.length === 0) return;
  for (const raw of note.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length > 0) lines.push(`${indent}  ${line}`);
  }
}

/**
 * Ready-to-paste Markdown: heading with the subject label and date, one `##` section per category
 * (CATEGORY_LABELS), one bullet per active item with its note indented beneath, parked items in a
 * `Parked:` sub-list and (when present) done items in a `Done:` sub-list. No trailing whitespace.
 */
export function agendaToMarkdown(agenda: AgendaLike): string {
  const lines: string[] = [`# Agenda — ${agenda.subject.label} (${formatDateDetroit(agenda.generatedAt)})`];
  if (agenda.groups.length === 0) {
    lines.push("", "_No open items._");
  }
  for (const group of agenda.groups) {
    lines.push("", `## ${CATEGORY_LABELS[group.category]}`);
    for (const item of group.active) pushItemLines(lines, item, "");
    if (group.parked.length > 0) {
      lines.push("- Parked:");
      for (const item of group.parked) pushItemLines(lines, item, "  ");
    }
    if (group.done.length > 0) {
      lines.push("- Done:");
      for (const item of group.done) pushItemLines(lines, item, "  ");
    }
  }
  return lines.map((l) => l.replace(/\s+$/u, "")).join("\n");
}

// ---------------------------------------------------------------------------
// Today buckets
// ---------------------------------------------------------------------------

/** "Due soon" covers today plus the following days, this many days in total. */
export const DUE_SOON_DAYS = 7;

/** Add `days` to a YYYY-MM-DD string (calendar arithmetic in UTC, no timezone drift). */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days);
  return new Date(t).toISOString().slice(0, 10);
}

export type TodayBuckets = Omit<TodayView, "pendingCaptures">;

/**
 * Compute the Today view buckets. Each item lands in at most one bucket, evaluated in this order:
 *  1. overdue      — due before `todayISO` and not Done
 *  2. dueSoon      — due within `DUE_SOON_DAYS` days counting today, not Done
 *  3. highPriority — High priority and Open/In Progress
 *  4. unowned      — Open/In Progress with no owner, no division and not personal (needs triage)
 * Buckets 1–3 only include "my" items: owned by `meInitials` or unowned (`ownerInitials === null`,
 * which by convention means Brandon). When `meInitials` is null no owner filter is applied.
 */
export function todayBuckets(
  items: readonly Item[],
  todayISO: string,
  meInitials: string | null,
  generatedAt: string = new Date().toISOString(),
): TodayBuckets {
  const horizon = addDaysISO(todayISO, DUE_SOON_DAYS - 1);
  const isMine = (item: Item): boolean =>
    meInitials === null || item.ownerInitials === null || item.ownerInitials === meInitials;
  const taken = new Set<string>();
  const bucket = (predicate: (item: Item) => boolean, compare: (a: Item, b: Item) => number): Item[] => {
    const picked = items.filter((item) => !taken.has(item.id) && predicate(item)).sort(compare);
    for (const item of picked) taken.add(item.id);
    return picked;
  };

  const overdue = bucket(
    (i) => i.status !== "Done" && i.dueDate !== null && i.dueDate < todayISO && isMine(i),
    compareByDueDate,
  );
  const dueSoon = bucket(
    (i) => i.status !== "Done" && i.dueDate !== null && i.dueDate >= todayISO && i.dueDate <= horizon && isMine(i),
    compareByDueDate,
  );
  const highPriority = bucket((i) => i.priority === "High" && isActiveStatus(i.status) && isMine(i), compareAgendaItems);
  const unowned = bucket(
    (i) => isActiveStatus(i.status) && i.ownerInitials === null && i.divisionCode === null && !i.isPersonal,
    compareAgendaItems,
  );

  return { overdue, dueSoon, highPriority, unowned, generatedAt };
}
