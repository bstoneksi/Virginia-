/**
 * Virginia — pure "Group by" helpers for the Board's swimlanes (Brand / Person).
 *
 * Shared so the client renders lanes from it and `npm test` (node:test, no React, no DOM) can
 * exercise the grouping. Everything here is deterministic given its inputs.
 *
 * Lane keys are stable strings the client also uses to build drop-target ids (`columnId`):
 *   none   → "all"
 *   brand  → "div:<code>" | "nobrand" | "personal"
 *   person → "person:<initials>" | "unassigned"
 */
import { PERSONAL_DIVISION_CODE, STATUSES, type BadgeColor, type Division, type Item, type Person, type Status } from "./types";

// ---------------------------------------------------------------------------
// Modes and lane keys
// ---------------------------------------------------------------------------

export const GROUP_MODES = ["none", "brand", "person"] as const;
export type GroupMode = (typeof GROUP_MODES)[number];

export function isGroupMode(value: unknown): value is GroupMode {
  return typeof value === "string" && (GROUP_MODES as readonly string[]).includes(value);
}

export const ALL_LANE = "all";
export const NO_BRAND_LANE = "nobrand";
export const PERSONAL_LANE = "personal";
export const UNASSIGNED_LANE = "unassigned";
const DIVISION_PREFIX = "div:";
const PERSON_PREFIX = "person:";

export function divisionLaneKey(code: string): string {
  return `${DIVISION_PREFIX}${code}`;
}

export function personLaneKey(initials: string): string {
  return `${PERSON_PREFIX}${initials}`;
}

/** Seed colour of the Personal (PTD) division, used when no division of kind `personal` exists. */
const PERSONAL_FALLBACK_COLOR: BadgeColor = { bg: "#B08968", fg: "#FFFFFF" };

export type LaneKind = "all" | "division" | "nobrand" | "personal" | "person" | "unassigned";

export interface Lane {
  key: string;
  kind: LaneKind;
  /** Division name, person's full name, "No brand", "Personal", "Brandon Stone (me)", "Unassigned", … */
  label: string;
  /** Short chip text (division code or person initials); absent for the catch-all lanes. */
  chip?: string;
  /** Chip colours (division colour / text colour); absent for people and catch-all lanes. */
  color?: BadgeColor;
  /** Items in input order (the Board passes them in column/rank order). */
  items: Item[];
}

export interface GroupContext {
  /** All divisions (archived included, so items that still reference one get a lane). */
  divisions: readonly Division[];
  /** All people (archived included). */
  people: readonly Person[];
  /** Initials of the `is_me` person, or null when nobody is marked "me". */
  meInitials: string | null;
  /** Lane keys to keep even when they hold no items — the lane a card is being dragged out of. */
  keepEmpty?: readonly string[];
}

type LaneFields = Pick<Item, "divisionCode" | "isPersonal" | "ownerInitials">;

/**
 * The lane `item` belongs to in `mode`. `isPersonal` wins over a division code. A null owner means "me"
 * (SPEC §3: a blank owner on `A:` is Brandon; his agenda lists unowned items too), so with `meInitials`
 * such a card sits in the me lane; without anyone marked me it falls into "Unassigned".
 */
export function laneKeyFor(item: LaneFields, mode: GroupMode, meInitials: string | null = null): string {
  switch (mode) {
    case "none":
      return ALL_LANE;
    case "brand":
      if (item.isPersonal) return PERSONAL_LANE;
      return item.divisionCode === null ? NO_BRAND_LANE : divisionLaneKey(item.divisionCode);
    case "person":
      if (item.ownerInitials !== null) return personLaneKey(item.ownerInitials);
      return meInitials === null ? UNASSIGNED_LANE : personLaneKey(meInitials);
  }
}

// ---------------------------------------------------------------------------
// Moving a card into another lane
// ---------------------------------------------------------------------------

export type LaneAssignment = Partial<LaneFields>;

/** Field values an item must carry to sit in `laneKey` under `mode`; `{}` for the flat board or an unknown key. */
export function laneAssignment(laneKey: string, mode: GroupMode): LaneAssignment {
  if (mode === "brand") {
    if (laneKey === PERSONAL_LANE) return { isPersonal: true, divisionCode: null };
    if (laneKey === NO_BRAND_LANE) return { isPersonal: false, divisionCode: null };
    if (laneKey.startsWith(DIVISION_PREFIX)) return { isPersonal: false, divisionCode: laneKey.slice(DIVISION_PREFIX.length) };
  }
  if (mode === "person") {
    if (laneKey === UNASSIGNED_LANE) return { ownerInitials: null };
    if (laneKey.startsWith(PERSON_PREFIX)) return { ownerInitials: laneKey.slice(PERSON_PREFIX.length) };
  }
  return {};
}

/**
 * `item` with the fields of `laneKey` applied (the optimistic copy while a card is dragged across lanes).
 * A card that already sits in the lane is returned as is — an unowned card moved within the me lane keeps
 * its blank owner rather than picking up the initials.
 */
export function assignLane<T extends LaneFields>(item: T, laneKey: string, mode: GroupMode, meInitials: string | null = null): T {
  if (laneKeyFor(item, mode, meInitials) === laneKey) return item;
  const a = laneAssignment(laneKey, mode);
  return {
    ...item,
    divisionCode: a.divisionCode !== undefined ? a.divisionCode : item.divisionCode,
    isPersonal: a.isPersonal !== undefined ? a.isPersonal : item.isPersonal,
    ownerInitials: a.ownerInitials !== undefined ? a.ownerInitials : item.ownerInitials,
  };
}

/** Only the fields that change when `item` moves into `laneKey` — the PATCH body — or null when it already belongs there. */
export function reassignment(item: LaneFields, laneKey: string, mode: GroupMode, meInitials: string | null = null): LaneAssignment | null {
  if (laneKeyFor(item, mode, meInitials) === laneKey) return null;
  const target = laneAssignment(laneKey, mode);
  const patch: LaneAssignment = {};
  if (target.divisionCode !== undefined && target.divisionCode !== item.divisionCode) patch.divisionCode = target.divisionCode;
  if (target.isPersonal !== undefined && target.isPersonal !== item.isPersonal) patch.isPersonal = target.isPersonal;
  if (target.ownerInitials !== undefined && target.ownerInitials !== item.ownerInitials) patch.ownerInitials = target.ownerInitials;
  return Object.keys(patch).length === 0 ? null : patch;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

function compareDivisions(a: Division, b: Division): number {
  return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code);
}

/** Roster order: by full name, initials as the tie-break. */
function comparePeople(a: Person, b: Person): number {
  return a.fullName.localeCompare(b.fullName) || a.initials.localeCompare(b.initials);
}

/** Initials of the "me" person: the context's, else whoever is flagged `isMe` in the roster. */
export function resolveMe(ctx: Pick<GroupContext, "people" | "meInitials">): string | null {
  return ctx.meInitials ?? ctx.people.find((p) => p.isMe)?.initials ?? null;
}

/**
 * Split `items` into swimlanes for `mode`.
 *
 * - `none`: one lane ("all") holding everything, returned even when empty.
 * - `brand`: one lane per division that has at least one item, in division `sortOrder`; then lanes for
 *   codes no division describes (first-seen order); then "No brand" (no division, not personal) and
 *   "Personal" (`isPersonal`).
 * - `person`: one lane per owner in roster order (full name), the owner's own lane excepted; then unknown
 *   initials (first-seen order); last the owner's lane — "Brandon Stone (me)" — holding the cards owned by
 *   him *and* the unowned ones (a blank owner means Brandon, as on his agenda). Brandon reads this view
 *   for other people's work, so his own lane comes last. With nobody marked me the last lane is
 *   "Unassigned" (`ownerInitials` null).
 *
 * Lanes with no items are omitted unless their key is in `ctx.keepEmpty`. Items keep their input order.
 */
export function groupItems(items: readonly Item[], mode: GroupMode, ctx: GroupContext): Lane[] {
  if (mode === "none") return [{ key: ALL_LANE, kind: "all", label: "All items", items: [...items] }];

  const me = resolveMe(ctx);
  const keep = new Set(ctx.keepEmpty ?? []);
  const byKey = new Map<string, Item[]>();
  for (const item of items) {
    const key = laneKeyFor(item, mode, me);
    const list = byKey.get(key);
    if (list) list.push(item);
    else byKey.set(key, [item]);
  }

  const lanes: Lane[] = [];
  const pushed = new Set<string>();
  const push = (lane: Omit<Lane, "items">): void => {
    pushed.add(lane.key);
    const laneItems = byKey.get(lane.key) ?? [];
    if (laneItems.length > 0 || keep.has(lane.key)) lanes.push({ ...lane, items: laneItems });
  };
  /** Keys with `prefix` that no reference row produced (unknown codes / initials), in first-seen order. */
  const strays = (prefix: string): string[] => [...new Set([...byKey.keys(), ...keep])].filter((k) => k.startsWith(prefix) && !pushed.has(k));

  if (mode === "brand") {
    for (const d of [...ctx.divisions].sort(compareDivisions)) {
      push({ key: divisionLaneKey(d.code), kind: "division", label: d.name, chip: d.code, color: { bg: d.color, fg: d.textColor } });
    }
    for (const key of strays(DIVISION_PREFIX)) {
      const code = key.slice(DIVISION_PREFIX.length);
      push({ key, kind: "division", label: code, chip: code });
    }
    push({ key: NO_BRAND_LANE, kind: "nobrand", label: "No brand" });
    const personal = ctx.divisions.find((d) => d.kind === "personal");
    push({
      key: PERSONAL_LANE,
      kind: "personal",
      label: "Personal",
      chip: personal?.code ?? PERSONAL_DIVISION_CODE,
      color: personal ? { bg: personal.color, fg: personal.textColor } : PERSONAL_FALLBACK_COLOR,
    });
    return lanes;
  }

  const isMe = (p: Person): boolean => p.isMe || p.initials === me;
  for (const p of [...ctx.people].filter((p) => !isMe(p)).sort(comparePeople)) {
    push({ key: personLaneKey(p.initials), kind: "person", label: p.fullName, chip: p.initials });
  }
  // The me lane is pushed last; mark it now so its key is not mistaken for unknown initials.
  if (me !== null) pushed.add(personLaneKey(me));
  for (const key of strays(PERSON_PREFIX)) {
    const initials = key.slice(PERSON_PREFIX.length);
    push({ key, kind: "person", label: initials, chip: initials });
  }
  if (me === null) {
    push({ key: UNASSIGNED_LANE, kind: "unassigned", label: "Unassigned" });
  } else {
    const person = ctx.people.find((p) => p.initials === me);
    push({ key: personLaneKey(me), kind: "person", label: `${person?.fullName ?? me} (me)`, chip: me });
  }
  return lanes;
}

// ---------------------------------------------------------------------------
// Drop-target ids (one droppable per lane × status)
// ---------------------------------------------------------------------------

const COLUMN_SEPARATOR = "::";

/** Droppable / sortable-context id of a lane's status column. */
export function columnId(laneKey: string, status: Status): string {
  return `${laneKey}${COLUMN_SEPARATOR}${status}`;
}

/** Inverse of `columnId`; null for anything else (card ids are UUIDs and never parse). */
export function parseColumnId(id: string | number): { lane: string; status: Status } | null {
  const text = String(id);
  const at = text.lastIndexOf(COLUMN_SEPARATOR);
  if (at === -1) return null;
  const status = text.slice(at + COLUMN_SEPARATOR.length);
  if (!(STATUSES as readonly string[]).includes(status)) return null;
  return { lane: text.slice(0, at), status: status as Status };
}
