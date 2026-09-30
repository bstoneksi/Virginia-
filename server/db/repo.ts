/**
 * server/db/repo.ts — every SQL statement in Virginia lives here (docs/SPEC.md §2/§3).
 *
 * Typed functions that return the camelCase shapes from shared/types.ts. Rows are mapped from
 * snake_case, booleans from 0/1, JSON columns parsed. Only positional `?` parameters are used and
 * every multi-statement write runs inside BEGIN/COMMIT with ROLLBACK on error.
 *
 * Usage: `const repo = createRepo(db)`; errors are `HttpError` subclasses (422 ValidationError,
 * 404 NotFoundError, 409 ConflictError) that the route layer renders as `{ error, details? }`.
 */
import { randomUUID } from "node:crypto";
import type { StatementSync } from "node:sqlite";
import type { Db } from "./index";
import { nowISO } from "./index";
import {
  BRIEF_KINDS,
  CAPTURE_KINDS,
  CAPTURE_STATUSES,
  CATEGORIES,
  DIVISION_KINDS,
  INITIATIVE_STATUSES,
  PRIORITIES,
  STATUSES,
  emptyDraft,
} from "../../shared/types";
import type {
  Brief,
  BriefKind,
  Capture,
  CaptureFileMeta,
  CaptureKind,
  CaptureStatus,
  CaptureSummary,
  Category,
  Division,
  DivisionKind,
  Initiative,
  InitiativeStatus,
  Item,
  ItemDraft,
  ItemEvent,
  ItemEventType,
  ItemFilters,
  Person,
  Priority,
  Proposal,
  ProposalState,
  SearchResult,
  Status,
} from "../../shared/types";
import type { ProposalDraft } from "../contracts";
import { ConflictError, HttpError, NotFoundError, ValidationError } from "../lib/errors";

export { ConflictError, HttpError, NotFoundError, ValidationError };

// ---------------------------------------------------------------------------
// Public input / output shapes that are not part of shared/types.ts
// ---------------------------------------------------------------------------

/** `GET /api/items/:id` payload. */
export interface ItemDetail extends Item {
  events: ItemEvent[];
  capture?: CaptureSummary;
}

/** ItemDraft plus an optional explicit initiative id (takes precedence over initiativeName). */
export type ItemCreateInput = ItemDraft & { initiativeId?: number | null };

/** `PATCH /api/items/:id` body. Absent keys keep their value; `null` clears a nullable field. */
export type ItemPatch = Partial<ItemDraft> & { status?: Status; rank?: number; initiativeId?: number | null };

export interface CreateItemOptions {
  sourceCaptureId?: string | null;
}

export interface RepoItemFilters extends ItemFilters {
  /** With `ownerInitials`: also return items whose owner is null (Brandon's own by convention). */
  includeUnowned?: boolean;
}

export interface DivisionInput {
  code: string;
  name: string;
  kind?: DivisionKind;
  parentCode?: string | null;
  color?: string;
  textColor?: string;
  sortOrder?: number;
}
export type DivisionPatch = Partial<Omit<Division, "code">>;

export interface PersonInput {
  initials: string;
  fullName: string;
  divisionCode?: string | null;
  email?: string | null;
  role?: string | null;
  isMe?: boolean;
}
export type PersonPatch = Partial<Omit<Person, "id">>;

export interface InitiativeInput {
  name: string;
  status?: InitiativeStatus;
}
export type InitiativePatch = Partial<Pick<Initiative, "name" | "status">>;

export interface CaptureInput {
  kind: CaptureKind;
  title?: string | null;
  rawText?: string | null;
  context?: string | null;
  defaultDivisionCode?: string | null;
  notes?: string[];
  error?: string | null;
}
export interface CapturePatch {
  kind?: CaptureKind;
  title?: string | null;
  status?: CaptureStatus;
  error?: string | null;
  notes?: string[];
  reviewedAt?: string | null;
}
export interface CaptureFileInput {
  filename: string;
  mime: string;
  bytes: Uint8Array;
  /** Defaults to bytes.byteLength. */
  size?: number;
}
export interface CaptureFileWithBytes extends CaptureFileMeta {
  bytes: Uint8Array;
}

export interface BriefInput {
  kind: BriefKind;
  title: string;
  bodyMd: string;
}

export interface Session {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Row coercion helpers (node:sqlite returns number | bigint | string | null | Uint8Array)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return String(v);
}
function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v : String(v);
}
function asNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") return Number(v);
  return 0;
}
function asNumberOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : asNumber(v);
}
function asBool(v: unknown): boolean {
  return asNumber(v) !== 0;
}
function asJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
function asBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return new Uint8Array(0);
}
function isIn<T extends string>(values: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (values as readonly string[]).includes(v);
}
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
function cleanNullable(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDateISO(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
function normalizeDate(v: unknown, field = "dueDate"): string | null {
  const s = cleanNullable(v);
  if (s === null) return null;
  if (!isValidDateISO(s)) throw new ValidationError(`${field} must be a valid YYYY-MM-DD date`);
  return s;
}
function definedOnly<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

/** Drafts stored as JSON may pre-date fields; always hand back a complete ItemDraft. */
export function normalizeStoredDraft(raw: unknown): ItemDraft {
  const base = emptyDraft();
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Partial<Record<keyof ItemDraft, unknown>>;
  return {
    category: isIn(CATEGORIES, r.category) ? r.category : base.category,
    title: typeof r.title === "string" ? r.title : base.title,
    note: typeof r.note === "string" ? r.note : base.note,
    divisionCode: cleanNullable(r.divisionCode),
    ownerInitials: cleanNullable(r.ownerInitials),
    initiativeName: cleanNullable(r.initiativeName),
    priority: isIn(PRIORITIES, r.priority) ? r.priority : base.priority,
    status: isIn(STATUSES, r.status) ? r.status : base.status,
    dueDate: typeof r.dueDate === "string" && isValidDateISO(r.dueDate) ? r.dueDate : null,
    isPersonal: Boolean(r.isPersonal),
    context: cleanNullable(r.context),
  };
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

const DIVISION_COLS = "code, name, kind, parent_code, color, text_color, sort_order, archived";
const PERSON_COLS = "id, initials, full_name, division_code, email, role, is_me, archived";
const INITIATIVE_COLS = "id, name, status, created_at";
const ITEM_COLS =
  "id, category, title, note, division_code, owner_initials, initiative_id, priority, status, due_date, rank, is_personal, context, source_capture_id, created_at, updated_at, completed_at";
const EVENT_COLS = "id, item_id, type, data, created_at";
const PROPOSAL_COLS = "id, capture_id, state, item_id, draft, confidence, inferred, source_excerpt, warnings, sort_order";
const FILE_META_COLS = "id, capture_id, filename, mime, size";
const BRIEF_COLS = "id, kind, title, body_md, created_at";
const ITEM_ORDER = "CASE status WHEN 'Open' THEN 0 WHEN 'In Progress' THEN 1 WHEN 'Parked' THEN 2 ELSE 3 END, rank ASC, created_at DESC";
const CAPTURE_SELECT = `SELECT c.id, c.kind, c.title, c.raw_text, c.context, c.default_division_code, c.status, c.error, c.notes,
    c.created_at, c.reviewed_at,
    (SELECT COUNT(*) FROM proposals p WHERE p.capture_id = c.id) AS proposal_count,
    (SELECT COUNT(*) FROM proposals p WHERE p.capture_id = c.id AND p.state = 'proposed') AS proposed_count,
    (SELECT COUNT(*) FROM capture_files f WHERE f.capture_id = c.id) AS file_count
  FROM captures c`;

function rowToDivision(r: Row): Division {
  return {
    code: asString(r.code),
    name: asString(r.name),
    kind: asString(r.kind) as DivisionKind,
    parentCode: asStringOrNull(r.parent_code),
    color: asString(r.color),
    textColor: asString(r.text_color),
    sortOrder: asNumber(r.sort_order),
    archived: asBool(r.archived),
  };
}
function rowToPerson(r: Row): Person {
  return {
    id: asNumber(r.id),
    initials: asString(r.initials),
    fullName: asString(r.full_name),
    divisionCode: asStringOrNull(r.division_code),
    email: asStringOrNull(r.email),
    role: asStringOrNull(r.role),
    isMe: asBool(r.is_me),
    archived: asBool(r.archived),
  };
}
function rowToInitiative(r: Row): Initiative {
  return {
    id: asNumber(r.id),
    name: asString(r.name),
    status: asString(r.status) as InitiativeStatus,
    createdAt: asString(r.created_at),
  };
}
function rowToItem(r: Row): Item {
  return {
    id: asString(r.id),
    category: asString(r.category) as Category,
    title: asString(r.title),
    note: asString(r.note),
    divisionCode: asStringOrNull(r.division_code),
    ownerInitials: asStringOrNull(r.owner_initials),
    initiativeId: asNumberOrNull(r.initiative_id),
    priority: asString(r.priority) as Priority,
    status: asString(r.status) as Status,
    dueDate: asStringOrNull(r.due_date),
    rank: asNumber(r.rank),
    isPersonal: asBool(r.is_personal),
    context: asStringOrNull(r.context),
    sourceCaptureId: asStringOrNull(r.source_capture_id),
    createdAt: asString(r.created_at),
    updatedAt: asString(r.updated_at),
    completedAt: asStringOrNull(r.completed_at),
  };
}
function rowToEvent(r: Row): ItemEvent {
  return {
    id: asNumber(r.id),
    itemId: asString(r.item_id),
    type: asString(r.type) as ItemEventType,
    data: asJson<Record<string, unknown>>(r.data, {}),
    createdAt: asString(r.created_at),
  };
}
function rowToCaptureSummary(r: Row): CaptureSummary {
  return {
    id: asString(r.id),
    kind: asString(r.kind) as CaptureKind,
    title: asStringOrNull(r.title),
    context: asStringOrNull(r.context),
    defaultDivisionCode: asStringOrNull(r.default_division_code),
    status: asString(r.status) as CaptureStatus,
    error: asStringOrNull(r.error),
    createdAt: asString(r.created_at),
    reviewedAt: asStringOrNull(r.reviewed_at),
    proposalCount: asNumber(r.proposal_count),
    proposedCount: asNumber(r.proposed_count),
    fileCount: asNumber(r.file_count),
  };
}
function rowToFileMeta(r: Row): CaptureFileMeta {
  return {
    id: asString(r.id),
    captureId: asString(r.capture_id),
    filename: asString(r.filename),
    mime: asString(r.mime),
    size: asNumber(r.size),
  };
}
function rowToProposal(r: Row): Proposal {
  return {
    id: asString(r.id),
    captureId: asString(r.capture_id),
    state: asString(r.state) as ProposalState,
    itemId: asStringOrNull(r.item_id),
    draft: normalizeStoredDraft(asJson<unknown>(r.draft, {})),
    confidence: asNumber(r.confidence),
    inferred: asBool(r.inferred),
    sourceExcerpt: asStringOrNull(r.source_excerpt),
    warnings: asJson<string[]>(r.warnings, []),
    sortOrder: asNumber(r.sort_order),
  };
}
function rowToBrief(r: Row): Brief {
  return {
    id: asString(r.id),
    kind: asString(r.kind) as BriefKind,
    title: asString(r.title),
    bodyMd: asString(r.body_md),
    createdAt: asString(r.created_at),
  };
}

interface NormalizedDraft {
  category: Category;
  title: string;
  note: string;
  divisionCode: string | null;
  ownerInitials: string | null;
  initiativeId: number | null;
  priority: Priority;
  status: Status;
  dueDate: string | null;
  isPersonal: boolean;
  context: string | null;
}

// ---------------------------------------------------------------------------
// Repo
// ---------------------------------------------------------------------------

export class Repo {
  private readonly statements = new Map<string, StatementSync>();

  constructor(readonly db: Db) {}

  private stmt(sql: string): StatementSync {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  /** Run `fn` inside BEGIN/COMMIT (ROLLBACK on throw). Nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T {
    if (this.db.isTransaction) return fn();
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* the transaction may already be gone */
      }
      throw err;
    }
  }

  // ----- divisions ---------------------------------------------------------

  listDivisions(options: { includeArchived?: boolean } = {}): Division[] {
    const sql = options.includeArchived
      ? `SELECT ${DIVISION_COLS} FROM divisions ORDER BY sort_order, code`
      : `SELECT ${DIVISION_COLS} FROM divisions WHERE archived = 0 ORDER BY sort_order, code`;
    return this.stmt(sql).all().map(rowToDivision);
  }

  getDivision(code: string): Division | null {
    const row = this.stmt(`SELECT ${DIVISION_COLS} FROM divisions WHERE code = ? COLLATE NOCASE`).get(code);
    return row ? rowToDivision(row) : null;
  }

  requireDivision(code: string): Division {
    const d = this.getDivision(code);
    if (!d) throw new NotFoundError(`Unknown division: ${code}`);
    return d;
  }

  createDivision(input: DivisionInput): Division {
    return this.transaction(() => {
      const code = String(input.code ?? "").trim();
      if (code.length === 0 || code.length > 16) throw new ValidationError("Division code must be 1–16 characters");
      if (/\s|\//.test(code)) throw new ValidationError("Division code cannot contain spaces or slashes");
      const name = String(input.name ?? "").trim();
      if (name.length === 0 || name.length > 120) throw new ValidationError("Division name must be 1–120 characters");
      const kind = input.kind ?? "brand";
      if (!isIn(DIVISION_KINDS, kind)) throw new ValidationError(`Invalid division kind: ${String(kind)}`);
      if (this.getDivision(code)) throw new ConflictError(`Division code already exists: ${code}`);
      const parentCode = input.parentCode ? this.requireDivision(input.parentCode).code : null;
      const color = cleanNullable(input.color) ?? "#3A3A3A";
      const textColor = cleanNullable(input.textColor) ?? "#FFFFFF";
      let sortOrder = input.sortOrder;
      if (sortOrder === undefined || !Number.isFinite(sortOrder)) {
        const max = this.stmt("SELECT COALESCE(MAX(sort_order), 0) AS m FROM divisions").get();
        sortOrder = asNumber(max?.m) + 10;
      }
      this.stmt(
        `INSERT INTO divisions (${DIVISION_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      ).run(code, name, kind, parentCode, color, textColor, sortOrder);
      return this.requireDivision(code);
    });
  }

  updateDivision(code: string, patch: DivisionPatch): Division {
    return this.transaction(() => {
      const cur = this.requireDivision(code);
      const name = patch.name !== undefined ? String(patch.name).trim() : cur.name;
      if (name.length === 0 || name.length > 120) throw new ValidationError("Division name must be 1–120 characters");
      const kind = patch.kind ?? cur.kind;
      if (!isIn(DIVISION_KINDS, kind)) throw new ValidationError(`Invalid division kind: ${String(kind)}`);
      let parentCode = cur.parentCode;
      if (patch.parentCode !== undefined) {
        parentCode = patch.parentCode ? this.requireDivision(patch.parentCode).code : null;
        if (parentCode === cur.code) throw new ValidationError("A division cannot be its own parent");
      }
      const color = patch.color !== undefined ? cleanNullable(patch.color) ?? cur.color : cur.color;
      const textColor = patch.textColor !== undefined ? cleanNullable(patch.textColor) ?? cur.textColor : cur.textColor;
      const sortOrder = patch.sortOrder !== undefined && Number.isFinite(patch.sortOrder) ? patch.sortOrder : cur.sortOrder;
      const archived = patch.archived !== undefined ? Boolean(patch.archived) : cur.archived;
      this.stmt(
        "UPDATE divisions SET name = ?, kind = ?, parent_code = ?, color = ?, text_color = ?, sort_order = ?, archived = ? WHERE code = ?",
      ).run(name, kind, parentCode, color, textColor, sortOrder, archived ? 1 : 0, cur.code);
      return this.requireDivision(cur.code);
    });
  }

  /** Canonical division code (case-insensitive lookup) or 422 when unknown. */
  private resolveDivision(code: unknown): string | null {
    const c = cleanNullable(code);
    if (c === null) return null;
    const d = this.getDivision(c);
    if (!d) throw new ValidationError(`Unknown division code: ${c}`);
    return d.code;
  }

  // ----- people ------------------------------------------------------------

  listPeople(options: { includeArchived?: boolean } = {}): Person[] {
    const sql = options.includeArchived
      ? `SELECT ${PERSON_COLS} FROM people ORDER BY is_me DESC, archived ASC, full_name ASC`
      : `SELECT ${PERSON_COLS} FROM people WHERE archived = 0 ORDER BY is_me DESC, full_name ASC`;
    return this.stmt(sql).all().map(rowToPerson);
  }

  getPerson(id: number): Person | null {
    const row = this.stmt(`SELECT ${PERSON_COLS} FROM people WHERE id = ?`).get(id);
    return row ? rowToPerson(row) : null;
  }

  requirePerson(id: number): Person {
    const p = this.getPerson(id);
    if (!p) throw new NotFoundError(`Unknown person: ${id}`);
    return p;
  }

  getPersonByInitials(initials: string): Person | null {
    const row = this.stmt(`SELECT ${PERSON_COLS} FROM people WHERE initials = ? COLLATE NOCASE`).get(initials.trim());
    return row ? rowToPerson(row) : null;
  }

  getMe(): Person | null {
    const row = this.stmt(`SELECT ${PERSON_COLS} FROM people WHERE is_me = 1 ORDER BY archived ASC, id ASC LIMIT 1`).get();
    return row ? rowToPerson(row) : null;
  }

  private normalizeInitials(v: unknown): string {
    const s = String(v ?? "").trim().toUpperCase();
    if (s.length === 0 || s.length > 8 || /\s/.test(s)) throw new ValidationError("Initials must be 1–8 characters without spaces");
    return s;
  }

  createPerson(input: PersonInput): Person {
    return this.transaction(() => {
      const initials = this.normalizeInitials(input.initials);
      const fullName = String(input.fullName ?? "").trim();
      if (fullName.length === 0 || fullName.length > 120) throw new ValidationError("Full name must be 1–120 characters");
      if (this.getPersonByInitials(initials)) throw new ConflictError(`Initials already in use: ${initials}`);
      const divisionCode = this.resolveDivision(input.divisionCode ?? null);
      const isMe = Boolean(input.isMe);
      if (isMe) this.stmt("UPDATE people SET is_me = 0").run();
      const result = this.stmt(
        "INSERT INTO people (initials, full_name, division_code, email, role, is_me, archived) VALUES (?, ?, ?, ?, ?, ?, 0)",
      ).run(initials, fullName, divisionCode, cleanNullable(input.email), cleanNullable(input.role), isMe ? 1 : 0);
      return this.requirePerson(Number(result.lastInsertRowid));
    });
  }

  updatePerson(id: number, patch: PersonPatch): Person {
    return this.transaction(() => {
      const cur = this.requirePerson(id);
      const initials = patch.initials !== undefined ? this.normalizeInitials(patch.initials) : cur.initials;
      if (initials !== cur.initials) {
        const clash = this.getPersonByInitials(initials);
        if (clash && clash.id !== cur.id) throw new ConflictError(`Initials already in use: ${initials}`);
      }
      const fullName = patch.fullName !== undefined ? String(patch.fullName).trim() : cur.fullName;
      if (fullName.length === 0 || fullName.length > 120) throw new ValidationError("Full name must be 1–120 characters");
      const divisionCode = patch.divisionCode !== undefined ? this.resolveDivision(patch.divisionCode) : cur.divisionCode;
      const email = patch.email !== undefined ? cleanNullable(patch.email) : cur.email;
      const role = patch.role !== undefined ? cleanNullable(patch.role) : cur.role;
      const isMe = patch.isMe !== undefined ? Boolean(patch.isMe) : cur.isMe;
      const archived = patch.archived !== undefined ? Boolean(patch.archived) : cur.archived;
      if (isMe && !cur.isMe) this.stmt("UPDATE people SET is_me = 0").run();
      if (initials !== cur.initials) {
        // items.owner_initials references people.initials without ON UPDATE CASCADE:
        // defer the FK check to COMMIT and rewrite both sides.
        this.db.exec("PRAGMA defer_foreign_keys = ON");
        this.stmt("UPDATE items SET owner_initials = ? WHERE owner_initials = ?").run(initials, cur.initials);
      }
      this.stmt(
        "UPDATE people SET initials = ?, full_name = ?, division_code = ?, email = ?, role = ?, is_me = ?, archived = ? WHERE id = ?",
      ).run(initials, fullName, divisionCode, email, role, isMe ? 1 : 0, archived ? 1 : 0, id);
      return this.requirePerson(id);
    });
  }

  /** Canonical initials (case-insensitive lookup) or 422 when unknown. */
  private resolveOwner(initials: unknown): string | null {
    const s = cleanNullable(initials);
    if (s === null) return null;
    const p = this.getPersonByInitials(s);
    if (!p) throw new ValidationError(`Unknown owner initials: ${s}`);
    return p.initials;
  }

  // ----- initiatives -------------------------------------------------------

  listInitiatives(): Initiative[] {
    return this.stmt(`SELECT ${INITIATIVE_COLS} FROM initiatives ORDER BY name COLLATE NOCASE`).all().map(rowToInitiative);
  }

  getInitiative(id: number): Initiative | null {
    const row = this.stmt(`SELECT ${INITIATIVE_COLS} FROM initiatives WHERE id = ?`).get(id);
    return row ? rowToInitiative(row) : null;
  }

  requireInitiative(id: number): Initiative {
    const i = this.getInitiative(id);
    if (!i) throw new NotFoundError(`Unknown initiative: ${id}`);
    return i;
  }

  getInitiativeByName(name: string): Initiative | null {
    const row = this.stmt(`SELECT ${INITIATIVE_COLS} FROM initiatives WHERE name = ? COLLATE NOCASE`).get(name.trim());
    return row ? rowToInitiative(row) : null;
  }

  createInitiative(input: InitiativeInput): Initiative {
    return this.transaction(() => {
      const name = String(input.name ?? "").trim();
      if (name.length === 0 || name.length > 120) throw new ValidationError("Initiative name must be 1–120 characters");
      const status = input.status ?? "Active";
      if (!isIn(INITIATIVE_STATUSES, status)) throw new ValidationError(`Invalid initiative status: ${String(status)}`);
      if (this.getInitiativeByName(name)) throw new ConflictError(`Initiative already exists: ${name}`);
      const result = this.stmt("INSERT INTO initiatives (name, status, created_at) VALUES (?, ?, ?)").run(name, status, nowISO());
      return this.requireInitiative(Number(result.lastInsertRowid));
    });
  }

  updateInitiative(id: number, patch: InitiativePatch): Initiative {
    return this.transaction(() => {
      const cur = this.requireInitiative(id);
      const name = patch.name !== undefined ? String(patch.name).trim() : cur.name;
      if (name.length === 0 || name.length > 120) throw new ValidationError("Initiative name must be 1–120 characters");
      const clash = this.getInitiativeByName(name);
      if (clash && clash.id !== id) throw new ConflictError(`Initiative already exists: ${name}`);
      const status = patch.status ?? cur.status;
      if (!isIn(INITIATIVE_STATUSES, status)) throw new ValidationError(`Invalid initiative status: ${String(status)}`);
      this.stmt("UPDATE initiatives SET name = ?, status = ? WHERE id = ?").run(name, status, id);
      return this.requireInitiative(id);
    });
  }

  /** Find by name (case-insensitive) or create an Active initiative. */
  ensureInitiative(name: string): Initiative {
    const existing = this.getInitiativeByName(name);
    return existing ?? this.createInitiative({ name });
  }

  // ----- items -------------------------------------------------------------

  listItems(filters: RepoItemFilters = {}): Item[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filters.status && filters.status.length > 0) {
      for (const s of filters.status) if (!isIn(STATUSES, s)) throw new ValidationError(`Invalid status: ${String(s)}`);
      where.push(`status IN (${filters.status.map(() => "?").join(", ")})`);
      params.push(...filters.status);
    } else if (!filters.includeDone) {
      where.push("status != 'Done'");
    }
    if (filters.category && filters.category.length > 0) {
      for (const c of filters.category) if (!isIn(CATEGORIES, c)) throw new ValidationError(`Invalid category: ${String(c)}`);
      where.push(`category IN (${filters.category.map(() => "?").join(", ")})`);
      params.push(...filters.category);
    }
    if (filters.divisionCode !== undefined && filters.divisionCode !== "") {
      where.push("division_code = ? COLLATE NOCASE");
      params.push(filters.divisionCode);
    }
    if (filters.ownerInitials !== undefined && filters.ownerInitials !== "") {
      if (filters.includeUnowned) {
        where.push("(owner_initials = ? COLLATE NOCASE OR owner_initials IS NULL)");
      } else {
        where.push("owner_initials = ? COLLATE NOCASE");
      }
      params.push(filters.ownerInitials);
    }
    if (filters.personal !== undefined) {
      where.push("is_personal = ?");
      params.push(filters.personal ? 1 : 0);
    }
    if (filters.initiativeId !== undefined && Number.isFinite(filters.initiativeId)) {
      where.push("initiative_id = ?");
      params.push(filters.initiativeId);
    }
    if (filters.q !== undefined && filters.q.trim().length > 0) {
      const like = `%${escapeLike(filters.q.trim())}%`;
      where.push("(title LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\' OR context LIKE ? ESCAPE '\\')");
      params.push(like, like, like);
    }
    const sql = `SELECT ${ITEM_COLS} FROM items${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${ITEM_ORDER}`;
    return this.stmt(sql).all(...params).map(rowToItem);
  }

  getItem(id: string): Item | null {
    const row = this.stmt(`SELECT ${ITEM_COLS} FROM items WHERE id = ?`).get(id);
    return row ? rowToItem(row) : null;
  }

  requireItem(id: string): Item {
    const item = this.getItem(id);
    if (!item) throw new NotFoundError(`Unknown item: ${id}`);
    return item;
  }

  getItemDetail(id: string): ItemDetail | null {
    const item = this.getItem(id);
    if (!item) return null;
    const events = this.listEvents(id);
    const capture = item.sourceCaptureId ? this.getCaptureSummary(item.sourceCaptureId) : null;
    return capture ? { ...item, events, capture } : { ...item, events };
  }

  /** New items go to the top of their column: (min rank in that status) - 1, or 0 when empty. */
  private nextTopRank(status: Status): number {
    const row = this.stmt("SELECT COALESCE(MIN(rank), 1) - 1 AS r FROM items WHERE status = ?").get(status);
    return asNumber(row?.r);
  }

  private normalizeDraft(input: ItemCreateInput): NormalizedDraft {
    const category = input.category;
    if (!isIn(CATEGORIES, category)) throw new ValidationError(`Invalid category: ${String(category)}`);
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (title.length === 0) throw new ValidationError("Title is required");
    if (title.length > 140) throw new ValidationError("Title must be 140 characters or fewer");
    const note = typeof input.note === "string" ? input.note : "";
    const priority = input.priority ?? "Medium";
    if (!isIn(PRIORITIES, priority)) throw new ValidationError(`Invalid priority: ${String(priority)}`);
    const status = input.status ?? "Open";
    if (!isIn(STATUSES, status)) throw new ValidationError(`Invalid status: ${String(status)}`);
    const dueDate = normalizeDate(input.dueDate);
    const ownerInitials = this.resolveOwner(input.ownerInitials);
    const divisionCode = this.resolveDivision(input.divisionCode);
    const isPersonal = Boolean(input.isPersonal);
    const context = cleanNullable(input.context);
    let initiativeId: number | null = null;
    if (input.initiativeId !== undefined && input.initiativeId !== null) {
      if (!Number.isInteger(input.initiativeId) || !this.getInitiative(input.initiativeId)) {
        throw new ValidationError(`Unknown initiative: ${String(input.initiativeId)}`);
      }
      initiativeId = input.initiativeId;
    } else if (cleanNullable(input.initiativeName) !== null) {
      initiativeId = this.ensureInitiative(String(input.initiativeName)).id;
    }
    if (category === "NB" && ownerInitials === null && divisionCode === null) {
      throw new ValidationError("NB needs a target");
    }
    return { category, title, note, divisionCode, ownerInitials, initiativeId, priority, status, dueDate, isPersonal, context };
  }

  private addEvent(itemId: string, type: ItemEventType, data: Record<string, unknown>, at: string): ItemEvent {
    const result = this.stmt("INSERT INTO item_events (item_id, type, data, created_at) VALUES (?, ?, ?, ?)").run(
      itemId,
      type,
      JSON.stringify(data),
      at,
    );
    const row = this.stmt(`SELECT ${EVENT_COLS} FROM item_events WHERE id = ?`).get(Number(result.lastInsertRowid));
    if (!row) throw new Error("item_events insert did not return a row");
    return rowToEvent(row);
  }

  createItem(draft: ItemCreateInput, options: CreateItemOptions = {}): Item {
    return this.transaction(() => {
      const d = this.normalizeDraft(draft);
      const sourceCaptureId = options.sourceCaptureId ?? null;
      if (sourceCaptureId !== null && !this.captureExists(sourceCaptureId)) {
        throw new NotFoundError(`Unknown capture: ${sourceCaptureId}`);
      }
      const id = randomUUID();
      const now = nowISO();
      const rank = this.nextTopRank(d.status);
      const completedAt = d.status === "Done" ? now : null;
      this.stmt(`INSERT INTO items (${ITEM_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        d.category,
        d.title,
        d.note,
        d.divisionCode,
        d.ownerInitials,
        d.initiativeId,
        d.priority,
        d.status,
        d.dueDate,
        rank,
        d.isPersonal ? 1 : 0,
        d.context,
        sourceCaptureId,
        now,
        now,
        completedAt,
      );
      this.addEvent(id, "created", sourceCaptureId ? { sourceCaptureId } : {}, now);
      return this.requireItem(id);
    });
  }

  updateItem(id: string, patch: ItemPatch): Item {
    return this.transaction(() => {
      const cur = this.requireItem(id);
      if (patch.rank !== undefined && (typeof patch.rank !== "number" || !Number.isFinite(patch.rank))) {
        throw new ValidationError("rank must be a finite number");
      }
      let initiativeId: number | null = cur.initiativeId;
      if (patch.initiativeId !== undefined) {
        initiativeId = patch.initiativeId;
      } else if (patch.initiativeName !== undefined) {
        const name = cleanNullable(patch.initiativeName);
        initiativeId = name === null ? null : this.ensureInitiative(name).id;
      }
      const merged: ItemCreateInput = {
        category: patch.category ?? cur.category,
        title: patch.title ?? cur.title,
        note: patch.note ?? cur.note,
        divisionCode: patch.divisionCode !== undefined ? patch.divisionCode : cur.divisionCode,
        ownerInitials: patch.ownerInitials !== undefined ? patch.ownerInitials : cur.ownerInitials,
        initiativeName: null,
        initiativeId,
        priority: patch.priority ?? cur.priority,
        status: patch.status ?? cur.status,
        dueDate: patch.dueDate !== undefined ? patch.dueDate : cur.dueDate,
        isPersonal: patch.isPersonal ?? cur.isPersonal,
        context: patch.context !== undefined ? patch.context : cur.context,
      };
      const d = this.normalizeDraft(merged);

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const track = (key: string, from: unknown, to: unknown): void => {
        if (from !== to) changes[key] = { from, to };
      };
      track("category", cur.category, d.category);
      track("title", cur.title, d.title);
      track("note", cur.note, d.note);
      track("divisionCode", cur.divisionCode, d.divisionCode);
      track("ownerInitials", cur.ownerInitials, d.ownerInitials);
      track("initiativeId", cur.initiativeId, d.initiativeId);
      track("priority", cur.priority, d.priority);
      track("dueDate", cur.dueDate, d.dueDate);
      track("isPersonal", cur.isPersonal, d.isPersonal);
      track("context", cur.context, d.context);
      const statusChanged = d.status !== cur.status;
      const rankChanged = patch.rank !== undefined && patch.rank !== cur.rank;
      if (Object.keys(changes).length === 0 && !statusChanged && !rankChanged) return cur;

      const now = nowISO();
      const rank = patch.rank !== undefined ? patch.rank : statusChanged ? this.nextTopRank(d.status) : cur.rank;
      const completedAt = statusChanged ? (d.status === "Done" ? now : null) : cur.completedAt;
      this.stmt(
        `UPDATE items SET category = ?, title = ?, note = ?, division_code = ?, owner_initials = ?, initiative_id = ?, priority = ?,
           status = ?, due_date = ?, rank = ?, is_personal = ?, context = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
      ).run(
        d.category,
        d.title,
        d.note,
        d.divisionCode,
        d.ownerInitials,
        d.initiativeId,
        d.priority,
        d.status,
        d.dueDate,
        rank,
        d.isPersonal ? 1 : 0,
        d.context,
        now,
        completedAt,
        id,
      );
      if (statusChanged) this.addEvent(id, "status", { from: cur.status, to: d.status }, now);
      if (Object.keys(changes).length > 0) this.addEvent(id, "edit", { changes }, now);
      return this.requireItem(id);
    });
  }

  /** Hard delete (the UI confirms first). Events cascade; proposals keep their draft but lose the link. */
  deleteItem(id: string): void {
    this.transaction(() => {
      this.requireItem(id);
      this.stmt("UPDATE proposals SET item_id = NULL WHERE item_id = ?").run(id);
      this.stmt("DELETE FROM item_events WHERE item_id = ?").run(id);
      this.stmt("DELETE FROM items WHERE id = ?").run(id);
    });
  }

  /**
   * Persist a column's order (top to bottom) in one transaction. `orderedIds` is the final order of the
   * items the client could see — the whole column or a filtered subset — so the listed ids are spliced
   * into the column's current order: items in `status` that were not listed keep their relative
   * positions, listed items already in the column take the slots those items occupied (in the new
   * order), and items arriving from another column are placed next to their listed neighbours (top of
   * the column when there is none). The whole column is then renumbered 0..n-1; arriving items get a
   * status event and completed_at maintenance. Rank moves alone are not journaled.
   */
  reorderItems(status: Status, orderedIds: string[]): void {
    if (!isIn(STATUSES, status)) throw new ValidationError(`Invalid status: ${String(status)}`);
    if (new Set(orderedIds).size !== orderedIds.length) throw new ValidationError("orderedIds contains duplicates");
    this.transaction(() => {
      const now = nowISO();
      const listed = new Map(orderedIds.map((id) => [id, this.requireItem(id)] as const));
      const column = this.listItems({ status: [status] });
      const inColumn = new Map(column.map((item) => [item.id, item] as const));
      const merged: string[] = column.map((item) => item.id);

      // 1. Listed items already in the column take the listed slots, in the new order.
      const slots = merged.flatMap((id, index) => (listed.has(id) ? [index] : []));
      const staying = orderedIds.filter((id) => inColumn.has(id));
      slots.forEach((slot, k) => {
        const id = staying[k];
        if (id !== undefined) merged[slot] = id;
      });

      // 2. Items arriving from another column go next to their listed neighbours (in listed order, so
      //    several arrivals keep their relative order); with no neighbour at all they go on top.
      const placed = new Set(merged);
      orderedIds.forEach((id, position) => {
        if (inColumn.has(id)) return;
        const after = orderedIds.slice(position + 1).find((other) => placed.has(other));
        const before = after === undefined ? orderedIds.slice(0, position).reverse().find((other) => placed.has(other)) : undefined;
        if (after !== undefined) merged.splice(merged.indexOf(after), 0, id);
        else if (before !== undefined) merged.splice(merged.indexOf(before) + 1, 0, id);
        else merged.unshift(id);
        placed.add(id);
      });

      // 3. Renumber the whole column.
      merged.forEach((id, index) => {
        const cur = listed.get(id) ?? inColumn.get(id);
        if (!cur) return;
        if (cur.status === status) {
          if (cur.rank !== index) this.stmt("UPDATE items SET rank = ? WHERE id = ?").run(index, id);
          return;
        }
        const completedAt = status === "Done" ? now : null;
        this.stmt("UPDATE items SET rank = ?, status = ?, completed_at = ?, updated_at = ? WHERE id = ?").run(
          index,
          status,
          completedAt,
          now,
          id,
        );
        this.addEvent(id, "status", { from: cur.status, to: status }, now);
      });
    });
  }

  addComment(id: string, text: string): ItemEvent {
    return this.transaction(() => {
      this.requireItem(id);
      const body = String(text ?? "").trim();
      if (body.length === 0) throw new ValidationError("Comment text is required");
      if (body.length > 4000) throw new ValidationError("Comment must be 4000 characters or fewer");
      const now = nowISO();
      this.stmt("UPDATE items SET updated_at = ? WHERE id = ?").run(now, id);
      return this.addEvent(id, "comment", { text: body }, now);
    });
  }

  listEvents(itemId: string): ItemEvent[] {
    return this.stmt(`SELECT ${EVENT_COLS} FROM item_events WHERE item_id = ? ORDER BY created_at ASC, id ASC`)
      .all(itemId)
      .map(rowToEvent);
  }

  // ----- captures ----------------------------------------------------------

  private captureExists(id: string): boolean {
    return this.stmt("SELECT 1 AS one FROM captures WHERE id = ?").get(id) !== undefined;
  }

  createCapture(input: CaptureInput): Capture {
    return this.transaction(() => {
      if (!isIn(CAPTURE_KINDS, input.kind)) throw new ValidationError(`Invalid capture kind: ${String(input.kind)}`);
      const defaultDivisionCode = this.resolveDivision(input.defaultDivisionCode ?? null);
      const id = randomUUID();
      const now = nowISO();
      this.stmt(
        `INSERT INTO captures (id, kind, title, raw_text, context, default_division_code, status, error, notes, created_at, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL)`,
      ).run(
        id,
        input.kind,
        cleanNullable(input.title),
        typeof input.rawText === "string" && input.rawText.length > 0 ? input.rawText : null,
        cleanNullable(input.context),
        defaultDivisionCode,
        cleanNullable(input.error),
        JSON.stringify(input.notes ?? []),
        now,
      );
      return this.requireCapture(id);
    });
  }

  addCaptureFile(captureId: string, file: CaptureFileInput): CaptureFileMeta {
    return this.transaction(() => {
      if (!this.captureExists(captureId)) throw new NotFoundError(`Unknown capture: ${captureId}`);
      const filename = String(file.filename ?? "").trim() || "file";
      const mime = String(file.mime ?? "").trim().toLowerCase() || "application/octet-stream";
      const id = randomUUID();
      const size = file.size ?? file.bytes.byteLength;
      this.stmt("INSERT INTO capture_files (id, capture_id, filename, mime, size, bytes) VALUES (?, ?, ?, ?, ?, ?)").run(
        id,
        captureId,
        filename,
        mime,
        size,
        file.bytes,
      );
      return { id, captureId, filename, mime, size };
    });
  }

  listCaptureFiles(captureId: string): CaptureFileMeta[] {
    return this.stmt(`SELECT ${FILE_META_COLS} FROM capture_files WHERE capture_id = ? ORDER BY rowid`).all(captureId).map(rowToFileMeta);
  }

  listCaptureFilesWithBytes(captureId: string): CaptureFileWithBytes[] {
    return this.stmt(`SELECT ${FILE_META_COLS}, bytes FROM capture_files WHERE capture_id = ? ORDER BY rowid`)
      .all(captureId)
      .map((r) => ({ ...rowToFileMeta(r), bytes: asBytes(r.bytes) }));
  }

  getCaptureFile(captureId: string, fileId: string): CaptureFileWithBytes | null {
    const row = this.stmt(`SELECT ${FILE_META_COLS}, bytes FROM capture_files WHERE capture_id = ? AND id = ?`).get(captureId, fileId);
    return row ? { ...rowToFileMeta(row), bytes: asBytes(row.bytes) } : null;
  }

  listCaptures(status?: CaptureStatus): CaptureSummary[] {
    if (status !== undefined) {
      if (!isIn(CAPTURE_STATUSES, status)) throw new ValidationError(`Invalid capture status: ${String(status)}`);
      return this.stmt(`${CAPTURE_SELECT} WHERE c.status = ? ORDER BY c.created_at DESC`).all(status).map(rowToCaptureSummary);
    }
    return this.stmt(`${CAPTURE_SELECT} ORDER BY c.created_at DESC`).all().map(rowToCaptureSummary);
  }

  getCaptureSummary(id: string): CaptureSummary | null {
    const row = this.stmt(`${CAPTURE_SELECT} WHERE c.id = ?`).get(id);
    return row ? rowToCaptureSummary(row) : null;
  }

  getCapture(id: string): Capture | null {
    const row = this.stmt(`${CAPTURE_SELECT} WHERE c.id = ?`).get(id);
    if (!row) return null;
    return {
      ...rowToCaptureSummary(row),
      rawText: asStringOrNull(row.raw_text),
      files: this.listCaptureFiles(id),
      proposals: this.listProposals(id),
      notes: asJson<string[]>(row.notes, []),
    };
  }

  requireCapture(id: string): Capture {
    const c = this.getCapture(id);
    if (!c) throw new NotFoundError(`Unknown capture: ${id}`);
    return c;
  }

  updateCapture(id: string, patch: CapturePatch): Capture {
    return this.transaction(() => {
      if (!this.captureExists(id)) throw new NotFoundError(`Unknown capture: ${id}`);
      const sets: string[] = [];
      const params: (string | number | null)[] = [];
      if (patch.kind !== undefined) {
        if (!isIn(CAPTURE_KINDS, patch.kind)) throw new ValidationError(`Invalid capture kind: ${String(patch.kind)}`);
        sets.push("kind = ?");
        params.push(patch.kind);
      }
      if (patch.title !== undefined) {
        sets.push("title = ?");
        params.push(cleanNullable(patch.title));
      }
      if (patch.status !== undefined) {
        if (!isIn(CAPTURE_STATUSES, patch.status)) throw new ValidationError(`Invalid capture status: ${String(patch.status)}`);
        sets.push("status = ?");
        params.push(patch.status);
      }
      if (patch.error !== undefined) {
        sets.push("error = ?");
        params.push(cleanNullable(patch.error));
      }
      if (patch.notes !== undefined) {
        sets.push("notes = ?");
        params.push(JSON.stringify(patch.notes));
      }
      if (patch.reviewedAt !== undefined) {
        sets.push("reviewed_at = ?");
        params.push(patch.reviewedAt);
      }
      if (sets.length > 0) {
        params.push(id);
        this.stmt(`UPDATE captures SET ${sets.join(", ")} WHERE id = ?`).run(...params);
      }
      return this.requireCapture(id);
    });
  }

  discardCapture(id: string): void {
    this.transaction(() => {
      if (!this.captureExists(id)) throw new NotFoundError(`Unknown capture: ${id}`);
      this.stmt("UPDATE captures SET status = 'discarded', reviewed_at = ? WHERE id = ?").run(nowISO(), id);
    });
  }

  countPendingCaptures(): number {
    const row = this.stmt("SELECT COUNT(*) AS n FROM captures WHERE status = 'pending'").get();
    return asNumber(row?.n);
  }

  /**
   * A pending capture with no proposed proposals left is marked reviewed (no-op for any other state).
   * Called after accept / reject and after (re-)extraction, so a capture never waits in the inbox with
   * nothing to review. 404 for unknown ids.
   */
  settleCaptureStatus(captureId: string): void {
    const row = this.stmt(
      "SELECT status, (SELECT COUNT(*) FROM proposals p WHERE p.capture_id = c.id AND p.state = 'proposed') AS proposed FROM captures c WHERE c.id = ?",
    ).get(captureId);
    if (!row) throw new NotFoundError(`Unknown capture: ${captureId}`);
    if (asString(row.status) === "pending" && asNumber(row.proposed) === 0) {
      this.stmt("UPDATE captures SET status = 'reviewed', reviewed_at = ? WHERE id = ?").run(nowISO(), captureId);
    }
  }

  /** The capture's status, or 404. */
  private requireCaptureStatus(captureId: string): CaptureStatus {
    const row = this.stmt("SELECT status FROM captures WHERE id = ?").get(captureId);
    if (!row) throw new NotFoundError(`Unknown capture: ${captureId}`);
    return asString(row.status) as CaptureStatus;
  }

  /** 409 when the capture was discarded: its proposals can no longer be edited, accepted or rejected. */
  private requireReviewableCapture(captureId: string): void {
    if (this.requireCaptureStatus(captureId) === "discarded") throw new ConflictError("Capture was discarded");
  }

  // ----- proposals ---------------------------------------------------------

  listProposals(captureId: string): Proposal[] {
    return this.stmt(`SELECT ${PROPOSAL_COLS} FROM proposals WHERE capture_id = ? ORDER BY sort_order ASC, rowid ASC`)
      .all(captureId)
      .map(rowToProposal);
  }

  getProposal(captureId: string, proposalId: string): Proposal | null {
    const row = this.stmt(`SELECT ${PROPOSAL_COLS} FROM proposals WHERE capture_id = ? AND id = ?`).get(captureId, proposalId);
    return row ? rowToProposal(row) : null;
  }

  requireProposal(captureId: string, proposalId: string): Proposal {
    const p = this.getProposal(captureId, proposalId);
    if (!p) throw new NotFoundError(`Unknown proposal: ${proposalId}`);
    return p;
  }

  private insertProposal(captureId: string, pd: ProposalDraft, state: ProposalState, itemId: string | null, sortOrder: number): Proposal {
    const id = randomUUID();
    const confidence = Number.isFinite(pd.confidence) ? Math.min(1, Math.max(0, pd.confidence)) : 0.5;
    this.stmt(`INSERT INTO proposals (${PROPOSAL_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      captureId,
      state,
      itemId,
      JSON.stringify(normalizeStoredDraft(pd.draft)),
      confidence,
      pd.inferred ? 1 : 0,
      cleanNullable(pd.sourceExcerpt),
      JSON.stringify(Array.isArray(pd.warnings) ? pd.warnings : []),
      sortOrder,
    );
    return this.requireProposal(captureId, id);
  }

  /** Replace the still-`proposed` proposals of a capture (accepted / rejected rows are kept). */
  replaceProposals(captureId: string, drafts: ProposalDraft[]): Proposal[] {
    return this.transaction(() => {
      if (!this.captureExists(captureId)) throw new NotFoundError(`Unknown capture: ${captureId}`);
      this.stmt("DELETE FROM proposals WHERE capture_id = ? AND state = 'proposed'").run(captureId);
      const maxRow = this.stmt("SELECT COALESCE(MAX(sort_order), -1) + 1 AS base FROM proposals WHERE capture_id = ?").get(captureId);
      const base = asNumber(maxRow?.base);
      drafts.forEach((pd, index) => this.insertProposal(captureId, pd, "proposed", null, base + index));
      return this.listProposals(captureId);
    });
  }

  /** Provenance for imports / MCP: a proposal that was accepted the moment it was created. */
  recordAcceptedProposal(captureId: string, pd: ProposalDraft, itemId: string): Proposal {
    return this.transaction(() => {
      if (!this.captureExists(captureId)) throw new NotFoundError(`Unknown capture: ${captureId}`);
      const maxRow = this.stmt("SELECT COALESCE(MAX(sort_order), -1) + 1 AS base FROM proposals WHERE capture_id = ?").get(captureId);
      return this.insertProposal(captureId, pd, "accepted", itemId, asNumber(maxRow?.base));
    });
  }

  /** Edit a proposal's draft before accepting it. Enum / date shape is checked; the NB rule applies at accept. */
  updateProposalDraft(captureId: string, proposalId: string, patch: Partial<ItemDraft>): Proposal {
    return this.transaction(() => {
      this.requireReviewableCapture(captureId);
      const cur = this.requireProposal(captureId, proposalId);
      if (cur.state !== "proposed") throw new ConflictError(`Proposal already ${cur.state}`);
      const merged: ItemDraft = { ...cur.draft, ...definedOnly(patch) };
      if (!isIn(CATEGORIES, merged.category)) throw new ValidationError(`Invalid category: ${String(merged.category)}`);
      if (!isIn(PRIORITIES, merged.priority)) throw new ValidationError(`Invalid priority: ${String(merged.priority)}`);
      if (!isIn(STATUSES, merged.status)) throw new ValidationError(`Invalid status: ${String(merged.status)}`);
      if (typeof merged.title !== "string" || merged.title.length > 140) throw new ValidationError("Title must be 140 characters or fewer");
      merged.dueDate = normalizeDate(merged.dueDate);
      merged.note = typeof merged.note === "string" ? merged.note : "";
      merged.isPersonal = Boolean(merged.isPersonal);
      merged.divisionCode = cleanNullable(merged.divisionCode);
      merged.ownerInitials = cleanNullable(merged.ownerInitials);
      merged.initiativeName = cleanNullable(merged.initiativeName);
      merged.context = cleanNullable(merged.context);
      this.stmt("UPDATE proposals SET draft = ? WHERE id = ?").run(JSON.stringify(merged), proposalId);
      return this.requireProposal(captureId, proposalId);
    });
  }

  /** Create the item from the proposal's draft (+ overrides), mark it accepted, close the capture when nothing is left. */
  acceptProposal(captureId: string, proposalId: string, overrides: Partial<ItemDraft> = {}): { proposal: Proposal; item: Item } {
    return this.transaction(() => {
      const capture = this.getCaptureSummary(captureId);
      if (!capture) throw new NotFoundError(`Unknown capture: ${captureId}`);
      if (capture.status === "discarded") throw new ConflictError("Capture was discarded");
      const cur = this.requireProposal(captureId, proposalId);
      if (cur.state !== "proposed") throw new ConflictError(`Proposal already ${cur.state}`);
      const merged: ItemDraft = { ...cur.draft, ...definedOnly(overrides) };
      if (merged.context === null && capture.context !== null) merged.context = capture.context;
      const item = this.createItem(merged, { sourceCaptureId: captureId });
      this.stmt("UPDATE proposals SET state = 'accepted', item_id = ?, draft = ? WHERE id = ?").run(
        item.id,
        JSON.stringify(normalizeStoredDraft(merged)),
        proposalId,
      );
      this.settleCaptureStatus(captureId);
      return { proposal: this.requireProposal(captureId, proposalId), item };
    });
  }

  rejectProposal(captureId: string, proposalId: string): Proposal {
    return this.transaction(() => {
      this.requireReviewableCapture(captureId);
      const cur = this.requireProposal(captureId, proposalId);
      if (cur.state === "accepted") throw new ConflictError("Proposal already accepted");
      if (cur.state === "proposed") {
        this.stmt("UPDATE proposals SET state = 'rejected' WHERE id = ?").run(proposalId);
        this.settleCaptureStatus(captureId);
      }
      return this.requireProposal(captureId, proposalId);
    });
  }

  /** Accept every still-proposed proposal with its current draft. Atomic: one invalid draft fails the batch (422). */
  acceptAllProposals(captureId: string): Item[] {
    return this.transaction(() => {
      this.requireReviewableCapture(captureId);
      const items: Item[] = [];
      for (const p of this.listProposals(captureId)) {
        if (p.state !== "proposed") continue;
        try {
          items.push(this.acceptProposal(captureId, p.id).item);
        } catch (err) {
          if (err instanceof ValidationError) {
            throw new ValidationError(err.message, { proposalId: p.id, title: p.draft.title, cause: err.details });
          }
          throw err;
        }
      }
      return items;
    });
  }

  // ----- search ------------------------------------------------------------

  search(q: string): SearchResult {
    const term = q.trim();
    if (term.length === 0) return { items: [], captures: [] };
    const like = `%${escapeLike(term)}%`;
    const items = this.stmt(
      `SELECT ${ITEM_COLS} FROM items
       WHERE title LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\' OR context LIKE ? ESCAPE '\\'
       ORDER BY (status = 'Done') ASC, updated_at DESC LIMIT 100`,
    )
      .all(like, like, like)
      .map(rowToItem);
    const captures = this.stmt(
      `${CAPTURE_SELECT}
       WHERE c.status != 'discarded' AND (c.title LIKE ? ESCAPE '\\' OR c.raw_text LIKE ? ESCAPE '\\' OR c.context LIKE ? ESCAPE '\\')
       ORDER BY c.created_at DESC LIMIT 50`,
    )
      .all(like, like, like)
      .map(rowToCaptureSummary);
    return { items, captures };
  }

  // ----- briefs ------------------------------------------------------------

  listBriefs(limit = 20): Brief[] {
    const n = Number.isFinite(limit) ? Math.min(500, Math.max(1, Math.trunc(limit))) : 20;
    return this.stmt(`SELECT ${BRIEF_COLS} FROM briefs ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(n).map(rowToBrief);
  }

  getBrief(id: string): Brief | null {
    const row = this.stmt(`SELECT ${BRIEF_COLS} FROM briefs WHERE id = ?`).get(id);
    return row ? rowToBrief(row) : null;
  }

  createBrief(input: BriefInput): Brief {
    if (!isIn(BRIEF_KINDS, input.kind)) throw new ValidationError(`Invalid brief kind: ${String(input.kind)}`);
    const title = String(input.title ?? "").trim();
    if (title.length === 0 || title.length > 200) throw new ValidationError("Brief title must be 1–200 characters");
    const bodyMd = typeof input.bodyMd === "string" ? input.bodyMd : "";
    const id = randomUUID();
    this.stmt(`INSERT INTO briefs (${BRIEF_COLS}) VALUES (?, ?, ?, ?, ?)`).run(id, input.kind, title, bodyMd, nowISO());
    const brief = this.getBrief(id);
    if (!brief) throw new Error("briefs insert did not return a row");
    return brief;
  }

  deleteBrief(id: string): void {
    const result = this.stmt("DELETE FROM briefs WHERE id = ?").run(id);
    if (Number(result.changes) === 0) throw new NotFoundError(`Unknown brief: ${id}`);
  }

  // ----- sessions ----------------------------------------------------------

  createSession(ttlMs: number = SESSION_TTL_MS): Session {
    const now = new Date();
    const session: Session = {
      id: randomUUID(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    this.stmt("INSERT INTO sessions (id, created_at, expires_at) VALUES (?, ?, ?)").run(session.id, session.createdAt, session.expiresAt);
    return session;
  }

  /** Returns null for unknown or expired sessions. */
  getSession(id: string, now: string = nowISO()): Session | null {
    const row = this.stmt("SELECT id, created_at, expires_at FROM sessions WHERE id = ?").get(id);
    if (!row) return null;
    const session: Session = { id: asString(row.id), createdAt: asString(row.created_at), expiresAt: asString(row.expires_at) };
    return session.expiresAt > now ? session : null;
  }

  deleteSession(id: string): boolean {
    return Number(this.stmt("DELETE FROM sessions WHERE id = ?").run(id).changes) > 0;
  }

  purgeExpiredSessions(now: string = nowISO()): number {
    return Number(this.stmt("DELETE FROM sessions WHERE expires_at <= ?").run(now).changes);
  }
}

export function createRepo(db: Db): Repo {
  return new Repo(db);
}
