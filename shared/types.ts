/**
 * Virginia — shared domain model, enums, seed data and API DTOs.
 * Server and client both import from here. This file is the contract described in docs/SPEC.md.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** Category tags from Brandon's note grammar. */
export const CATEGORIES = ["A", "Q", "I", "D", "W", "NB"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  A: "Action",
  Q: "Question",
  I: "Idea",
  D: "Decision",
  W: "Watch",
  NB: "New Business",
};

/** Order in which agendas list category groups. */
export const CATEGORY_ORDER: readonly Category[] = ["NB", "A", "Q", "W", "I", "D"];

export const STATUSES = ["Open", "In Progress", "Parked", "Done"] as const;
export type Status = (typeof STATUSES)[number];

export const PRIORITIES = ["Low", "Medium", "High"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const INITIATIVE_STATUSES = ["Active", "On Hold", "Complete"] as const;
export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];

export const DIVISION_KINDS = ["brand", "function", "personal"] as const;
export type DivisionKind = (typeof DIVISION_KINDS)[number];

export const CAPTURE_KINDS = ["text", "transcript", "image", "screenshot", "mixed", "import"] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export const CAPTURE_STATUSES = ["pending", "reviewed", "discarded"] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export const PROPOSAL_STATES = ["proposed", "accepted", "rejected"] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

export const BRIEF_KINDS = ["email_digest", "daily", "other"] as const;
export type BriefKind = (typeof BRIEF_KINDS)[number];

export const ITEM_EVENT_TYPES = ["created", "status", "edit", "comment"] as const;
export type ItemEventType = (typeof ITEM_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Domain entities (as returned by the API — camelCase, ISO strings)
// ---------------------------------------------------------------------------

export interface Division {
  /** Short code used in notes, e.g. "HG", "K&B-I", "FOB". Primary key. */
  code: string;
  name: string;
  kind: DivisionKind;
  /** e.g. "K&B" for "K&B-I". */
  parentCode: string | null;
  /** Hex background color for chips. */
  color: string;
  /** Hex text color that reads on `color`. */
  textColor: string;
  sortOrder: number;
  archived: boolean;
}

export interface Person {
  id: number;
  /** Two/three letter initials used in notes, unique. */
  initials: string;
  fullName: string;
  divisionCode: string | null;
  email: string | null;
  role: string | null;
  /** True for exactly one row: Brandon. */
  isMe: boolean;
  archived: boolean;
}

export interface Initiative {
  id: number;
  name: string;
  status: InitiativeStatus;
  createdAt: string;
}

export interface Item {
  id: string;
  category: Category;
  /** Short imperative headline, <= 140 chars. */
  title: string;
  /** Full detail; may be empty string. */
  note: string;
  divisionCode: string | null;
  /** Owner for A/Q/I/W, target for NB. Null on A means "me". */
  ownerInitials: string | null;
  initiativeId: number | null;
  priority: Priority;
  status: Status;
  /** YYYY-MM-DD or null. */
  dueDate: string | null;
  /** Manual ordering within a status column; lower = higher on the board. */
  rank: number;
  /** Personal to-do (PTD) — lives outside the company divisions. */
  isPersonal: boolean;
  /** Meeting / context label, e.g. "1:1 with VM 9/30". */
  context: string | null;
  sourceCaptureId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ItemEvent {
  id: number;
  itemId: string;
  type: ItemEventType;
  /** created: {}, status: {from,to}, edit: {changes}, comment: {text}. */
  data: Record<string, unknown>;
  createdAt: string;
}

/** Everything needed to create an item; also the payload shape of a proposal. */
export interface ItemDraft {
  category: Category;
  title: string;
  note: string;
  divisionCode: string | null;
  ownerInitials: string | null;
  /** Resolved to initiativeId on create; created on the fly if unknown. */
  initiativeName: string | null;
  priority: Priority;
  status: Status;
  dueDate: string | null;
  isPersonal: boolean;
  context: string | null;
}

export interface CaptureFileMeta {
  id: string;
  captureId: string;
  filename: string;
  mime: string;
  size: number;
}

export interface Proposal {
  id: string;
  captureId: string;
  state: ProposalState;
  itemId: string | null;
  draft: ItemDraft;
  /** 0..1 */
  confidence: number;
  /** True when the line carried no explicit tag and the category was inferred. */
  inferred: boolean;
  sourceExcerpt: string | null;
  warnings: string[];
  sortOrder: number;
}

export interface CaptureSummary {
  id: string;
  kind: CaptureKind;
  title: string | null;
  context: string | null;
  defaultDivisionCode: string | null;
  status: CaptureStatus;
  error: string | null;
  createdAt: string;
  reviewedAt: string | null;
  /** Counts for list views. */
  proposalCount: number;
  proposedCount: number;
  fileCount: number;
}

export interface Capture extends CaptureSummary {
  rawText: string | null;
  files: CaptureFileMeta[];
  proposals: Proposal[];
  /** Notes from the extractor (model used, fallbacks, etc). */
  notes: string[];
}

export interface Brief {
  id: string;
  kind: BriefKind;
  title: string;
  bodyMd: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// API DTOs
// ---------------------------------------------------------------------------

export interface ItemFilters {
  status?: Status[];
  category?: Category[];
  divisionCode?: string;
  ownerInitials?: string;
  personal?: boolean;
  includeDone?: boolean;
  initiativeId?: number;
  q?: string;
}

export interface ReorderRequest {
  status: Status;
  /** Final order of the column, top to bottom. Items not currently in `status` are moved into it. */
  orderedIds: string[];
}

export interface AgendaSubject {
  type: "person" | "division";
  key: string;
  label: string;
}

export interface AgendaGroup {
  category: Category;
  /** Open + In Progress, sorted priority desc, due date asc, rank asc. */
  active: Item[];
  /** Parked items, listed at the bottom of the group. */
  parked: Item[];
  /** Only populated when includeDone was requested. */
  done: Item[];
}

export interface Agenda {
  subject: AgendaSubject;
  groups: AgendaGroup[];
  generatedAt: string;
  /** Ready-to-paste Markdown rendering of the agenda. */
  markdown: string;
}

export interface TodayView {
  overdue: Item[];
  /** Due within the next 7 days (inclusive of today), not overdue. */
  dueSoon: Item[];
  /** High priority, open/in progress, not in the two buckets above. */
  highPriority: Item[];
  /** Open items with no owner and no division — need triage. */
  unowned: Item[];
  pendingCaptures: number;
  generatedAt: string;
}

export interface Bootstrap {
  divisions: Division[];
  people: Person[];
  initiatives: Initiative[];
  me: Person | null;
  aiConfigured: boolean;
  mcpConfigured: boolean;
  version: string;
}

export interface ImportRow {
  table: string;
  sheet: string;
  rowNumber: number;
  raw: Record<string, string>;
  draft: ItemDraft;
  warnings: string[];
  /** Client toggles this off to skip a row. Defaults true. */
  include: boolean;
}

export interface ImportPreview {
  filename: string;
  sheetNames: string[];
  detectedTables: string[];
  rows: ImportRow[];
}

export interface ImportCommitResult {
  created: number;
  captureId: string;
  items: Item[];
}

export interface SearchResult {
  items: Item[];
  captures: CaptureSummary[];
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  db: "ok" | "error";
}

export interface ApiError {
  error: string;
  details?: unknown;
}

// ---------------------------------------------------------------------------
// Colors (from the Virginia project conventions)
// ---------------------------------------------------------------------------

export interface BadgeColor {
  bg: string;
  fg: string;
}

export const CATEGORY_COLORS: Record<Category, BadgeColor> = {
  W: { bg: "#FDECEA", fg: "#B71C1C" }, // watch = red
  D: { bg: "#E6F4EA", fg: "#1E6B3A" }, // decision = green
  A: { bg: "#ECEFF1", fg: "#C0392B" }, // action = light grey fill, red lettering
  NB: { bg: "#E3F2FD", fg: "#1565C0" }, // new business = blue
  Q: { bg: "#FFF8E1", fg: "#9A6B00" }, // question = gold
  I: { bg: "#E0F2F1", fg: "#00796B" }, // idea = teal
};

export const STATUS_COLORS: Record<Status, BadgeColor> = {
  Open: { bg: "#FDECEA", fg: "#B71C1C" },
  "In Progress": { bg: "#EDE7F6", fg: "#5E35B1" },
  Parked: { bg: "#F6E7D8", fg: "#9C6B3C" }, // deliberately soft beige-orange
  Done: { bg: "#E6F4EA", fg: "#1E6B3A" },
};

export const PRIORITY_COLORS: Record<Priority, BadgeColor> = {
  Low: { bg: "#E6F4EA", fg: "#2E7D32" },
  Medium: { bg: "#FFF8E1", fg: "#F9A825" },
  High: { bg: "#FDECEA", fg: "#C62828" },
};

// ---------------------------------------------------------------------------
// Seed data (applied once on an empty database; editable in Settings)
// ---------------------------------------------------------------------------

export const ME_INITIALS = "BS";
export const PERSONAL_DIVISION_CODE = "PTD";
export const DEFAULT_INITIATIVE = "BAU";

export const SEED_DIVISIONS: Division[] = [
  { code: "K&B", name: "KSI Kitchen & Bath", kind: "brand", parentCode: null, color: "#1B2A49", textColor: "#FFFFFF", sortOrder: 10, archived: false },
  { code: "K&B-S", name: "K&B Sales", kind: "brand", parentCode: "K&B", color: "#24406E", textColor: "#FFFFFF", sortOrder: 11, archived: false },
  { code: "K&B-I", name: "K&B Installation", kind: "brand", parentCode: "K&B", color: "#2C4F87", textColor: "#FFFFFF", sortOrder: 12, archived: false },
  { code: "K&B-O", name: "K&B Operations", kind: "brand", parentCode: "K&B", color: "#355FA0", textColor: "#FFFFFF", sortOrder: 13, archived: false },
  { code: "APP", name: "KSI Appliances", kind: "brand", parentCode: null, color: "#6C3FA0", textColor: "#FFFFFF", sortOrder: 20, archived: false },
  { code: "HG", name: "Henderson Glass", kind: "brand", parentCode: null, color: "#C0392B", textColor: "#FFFFFF", sortOrder: 30, archived: false },
  { code: "PF", name: "Paramount Fence", kind: "brand", parentCode: null, color: "#1E6B3A", textColor: "#FFFFFF", sortOrder: 40, archived: false },
  { code: "RF", name: "Riemer Floors", kind: "brand", parentCode: null, color: "#1F1F1F", textColor: "#FFFFFF", sortOrder: 50, archived: false },
  { code: "TS", name: "TrueScale Studio", kind: "brand", parentCode: null, color: "#E67E22", textColor: "#1F1F1F", sortOrder: 60, archived: false },
  { code: "FOB", name: "Family of Brands (Corporate)", kind: "function", parentCode: null, color: "#3A3A3A", textColor: "#FFFFFF", sortOrder: 70, archived: false },
  { code: "ACC", name: "Accounting / Finance", kind: "function", parentCode: null, color: "#556270", textColor: "#FFFFFF", sortOrder: 80, archived: false },
  { code: "S&M", name: "Sales & Marketing", kind: "function", parentCode: null, color: "#4A7C8C", textColor: "#FFFFFF", sortOrder: 90, archived: false },
  { code: PERSONAL_DIVISION_CODE, name: "Personal", kind: "personal", parentCode: null, color: "#B08968", textColor: "#FFFFFF", sortOrder: 100, archived: false },
];

export const SEED_PEOPLE: Omit<Person, "id">[] = [
  { initials: "BS", fullName: "Brandon Stone", divisionCode: "FOB", email: "bstone@teamksi.com", role: "CEO", isMe: true, archived: false },
  { initials: "PH", fullName: "Patrick Hatch", divisionCode: null, email: null, role: null, isMe: false, archived: false },
  { initials: "DK", fullName: "David Karras", divisionCode: null, email: null, role: null, isMe: false, archived: false },
  { initials: "AG", fullName: "Amanda Gentner", divisionCode: "FOB", email: null, role: null, isMe: false, archived: false },
  { initials: "DJ", fullName: "Darren Johnston", divisionCode: null, email: null, role: null, isMe: false, archived: false },
  { initials: "MN", fullName: "Matthew Norton", divisionCode: null, email: "mnorton@teamksi.com", role: null, isMe: false, archived: false },
  { initials: "SB", fullName: "Steve Bevel", divisionCode: "RF", email: "steve.bevel@riemerfloors.com", role: null, isMe: false, archived: false },
  { initials: "VM", fullName: "Vincent Moynihan", divisionCode: "HG", email: "vince.moynihan@hendersonglass.com", role: null, isMe: false, archived: false },
  { initials: "JM", fullName: "Joshua Miller", divisionCode: null, email: "josh.miller@teamksi.com", role: null, isMe: false, archived: false },
  { initials: "MR", fullName: "Mark Renn", divisionCode: null, email: "mrenn@teamksi.com", role: null, isMe: false, archived: false },
  { initials: "AN", fullName: "Amanda Norton", divisionCode: null, email: null, role: null, isMe: false, archived: false },
  { initials: "JR", fullName: "Jennifer Rankin", divisionCode: null, email: null, role: null, isMe: false, archived: false },
];

// ---------------------------------------------------------------------------
// Small pure helpers used on both sides
// ---------------------------------------------------------------------------

export function emptyDraft(overrides: Partial<ItemDraft> = {}): ItemDraft {
  return {
    category: "A",
    title: "",
    note: "",
    divisionCode: null,
    ownerInitials: null,
    initiativeName: null,
    priority: "Medium",
    status: "Open",
    dueDate: null,
    isPersonal: false,
    context: null,
    ...overrides,
  };
}

/** True when the item has a due date strictly before `todayISO` (YYYY-MM-DD) and is not Done. */
export function isOverdue(item: Pick<Item, "dueDate" | "status">, todayISO: string): boolean {
  return item.status !== "Done" && item.dueDate !== null && item.dueDate < todayISO;
}

export function isActiveStatus(status: Status): boolean {
  return status === "Open" || status === "In Progress";
}

export function categoryLabel(category: Category): string {
  return CATEGORY_LABELS[category];
}
