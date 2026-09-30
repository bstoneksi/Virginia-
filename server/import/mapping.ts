/**
 * server/import/mapping.ts — turn a detected table row into an ImportRow / ItemDraft (docs/SPEC.md §7).
 *
 * Pure functions, no I/O: fuzzy division matching (code, name, alias vocabulary, token overlap against
 * the live divisions), person matching (initials, full name, "Last, First", nicknames, unique first or
 * last name), Excel and text date parsing to YYYY-MM-DD, the Brain Dump status / priority vocabularies
 * and title derivation. Unmatched values become null plus a warning; rows always stay `include: true`
 * so the user decides in the preview.
 */
import type { Category, Division, ImportRow, ItemDraft, Person, Priority, Status } from "../../shared/types";
import type { ExtractContext } from "../contracts";
import type { CellData, DetectedTable, TableRow } from "./tables";

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Lowercase, `&` → "and", punctuation → spaces, collapsed: "Kitchen & Bath - Install" → "kitchen and bath install". */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const STOP_WORDS: ReadonlySet<string> = new Set([
  "ksi", "and", "the", "of", "inc", "llc", "co", "division", "div", "brand", "brands", "team", "dept", "department", "group",
]);

function tokensOf(s: string): string[] {
  return normalizeText(s)
    .split(" ")
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------

interface AliasRule {
  /** Canonical seed code; only used when that code exists in the live divisions. */
  code: string;
  /** At least one must match the normalised text. */
  any: readonly RegExp[];
  /** All of these must match too (used to scope the K&B sub-divisions). */
  all?: readonly RegExp[];
}

const KB = /\b(kitchen|bath|k and b|kb|kandb)\b/;

/** Ordered: the first matching rule wins, so K&B sub-divisions come before the K&B umbrella. */
export const DIVISION_ALIASES: readonly AliasRule[] = [
  { code: "K&B-I", any: [/\binstall(ation|s|ers?)?\b/], all: [KB] },
  { code: "K&B-S", any: [/\bsales?\b/, /\bselling\b/], all: [KB] },
  { code: "K&B-O", any: [/\bops\b/, /\boperations?\b/], all: [KB] },
  { code: "K&B", any: [KB] },
  { code: "HG", any: [/\bhenderson\b/, /\bglass\b/] },
  { code: "RF", any: [/\br(ie|ei)mer\b/, /\bfloors?\b/, /\bflooring\b/] },
  { code: "APP", any: [/\bappliances?\b/] },
  { code: "PF", any: [/\bparamount\b/, /\bfenc(e|es|ing)\b/] },
  { code: "TS", any: [/\btrue ?scale\b/, /\bstudio\b/] },
  { code: "FOB", any: [/\bcorporate\b/, /\bcorp\b/, /\bfamily of brands\b/, /\bfob\b/, /\bexec(utive)?\b/, /\bhq\b/] },
  { code: "ACC", any: [/\baccounting\b/, /\bfinance\b/, /\bfinancial\b/, /\bacct\b/] },
  { code: "S&M", any: [/\bmarketing\b/, /\bs and m\b/] },
  { code: "PTD", any: [/\bpersonal\b/, /\bptd\b/, /\bhome\b/, /\bfamily\b/] },
];

function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  return shorter.length >= 4 && longer.startsWith(shorter);
}

/** Unique best token overlap between the input and a division's name + code, or null on a tie. */
function bestTokenMatch(norm: string, divisions: readonly Division[]): Division | null {
  const inputTokens = tokensOf(norm);
  if (inputTokens.length === 0) return null;
  let best: Division | null = null;
  let bestScore = 0;
  let tie = false;
  for (const d of divisions) {
    const nameTokens = [...tokensOf(d.name), ...tokensOf(d.code)];
    let score = 0;
    for (const t of inputTokens) if (nameTokens.some((n) => tokenMatches(t, n))) score++;
    if (score > bestScore) {
      best = d;
      bestScore = score;
      tie = false;
    } else if (score === bestScore && score > 0) {
      tie = true;
    }
  }
  return tie || bestScore === 0 ? null : best;
}

/**
 * Resolve free text to a live division: exact code, exact name, alias vocabulary ("Henderson" → HG,
 * "Kitchen & Bath - Install" → K&B-I, "Reimer" → RF, "Corporate" → FOB, "Personal" → PTD, …), then a
 * unique token overlap for divisions added later in Settings. Null when nothing matches.
 */
export function matchDivision(text: string, divisions: readonly Division[]): Division | null {
  const raw = text.trim();
  if (raw.length === 0) return null;
  const active = divisions.filter((d) => !d.archived);
  const upper = raw.toUpperCase();
  const byCode = active.find((d) => d.code.toUpperCase() === upper);
  if (byCode) return byCode;
  const norm = normalizeText(raw);
  if (norm.length === 0) return null;
  const byName = active.find((d) => normalizeText(d.name) === norm || normalizeText(d.code) === norm);
  if (byName) return byName;
  for (const rule of DIVISION_ALIASES) {
    if (!rule.any.some((re) => re.test(norm))) continue;
    if (rule.all && !rule.all.every((re) => re.test(norm))) continue;
    const hit = active.find((d) => d.code.toUpperCase() === rule.code);
    if (hit) return hit;
  }
  return bestTokenMatch(norm, active);
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const NICKNAMES: Readonly<Record<string, readonly string[]>> = {
  vince: ["vincent"], vinny: ["vincent"], vin: ["vincent"],
  matt: ["matthew"], matty: ["matthew"],
  josh: ["joshua"],
  dave: ["david"], davey: ["david"],
  steve: ["steven", "stephen"], stevie: ["steven", "stephen"],
  pat: ["patrick", "patricia"], paddy: ["patrick"], patty: ["patricia"],
  jen: ["jennifer"], jenny: ["jennifer"], jenn: ["jennifer"],
  mandy: ["amanda"],
  andy: ["andrew"], drew: ["andrew"],
  mike: ["michael"], mikey: ["michael"],
  chris: ["christopher", "christine", "christina"],
  jim: ["james"], jimmy: ["james"],
  bob: ["robert"], rob: ["robert"], bobby: ["robert"],
  bill: ["william"], will: ["william"], billy: ["william"],
  tom: ["thomas"], tommy: ["thomas"],
  dan: ["daniel"], danny: ["daniel"],
  joe: ["joseph"], joey: ["joseph"],
  jon: ["jonathan"], ben: ["benjamin"], nick: ["nicholas"], tony: ["anthony"],
  rick: ["richard"], rich: ["richard"], dick: ["richard"],
  ed: ["edward"], eddie: ["edward"], ted: ["theodore", "edward"],
  greg: ["gregory"], jeff: ["jeffrey"], ken: ["kenneth"], kenny: ["kenneth"],
  liz: ["elizabeth"], beth: ["elizabeth"], kate: ["katherine", "kathryn", "katelyn"], katie: ["katherine", "kathryn", "katelyn"],
  sue: ["susan"], meg: ["megan", "margaret"], peggy: ["margaret"],
  sam: ["samuel", "samantha"], alex: ["alexander", "alexandra"],
};

interface NameParts {
  first: string;
  last: string;
  full: string;
}

function nameParts(p: Person): NameParts {
  const tokens = normalizeText(p.fullName).split(" ").filter((t) => t.length > 0);
  return { first: tokens[0] ?? "", last: tokens[tokens.length - 1] ?? "", full: tokens.join(" ") };
}

function firstNameMatches(token: string, first: string): boolean {
  if (token.length === 0 || first.length === 0) return false;
  if (token === first) return true;
  if (token.length >= 3 && first.startsWith(token)) return true;
  const expansions = NICKNAMES[token];
  if (expansions && expansions.includes(first)) return true;
  // The roster may hold the short form (Steve) while the sheet says the formal one (Steven).
  const rosterExpansions = NICKNAMES[first];
  return rosterExpansions !== undefined && rosterExpansions.includes(token);
}

function uniquePeople(people: readonly Person[]): Person[] {
  const seen = new Set<number>();
  return people.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

/** "VM / SB", "VM, SB", "Vince & Steve", "DK and SB" → the individual names. */
export function splitPeople(text: string): string[] {
  return text
    .split(/\s*(?:[/,;&+]|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Resolve one name to a live person: initials (case-insensitive, dots ignored), "me", exact full name,
 * "Last First" / "Last, First", a unique first name (nicknames and prefixes count), a unique last name,
 * or "First L" / "First Lastprefix". Ambiguous names ("Amanda") return null.
 */
export function matchPerson(text: string, people: readonly Person[]): Person | null {
  const raw = text.trim();
  if (raw.length === 0) return null;
  const active = people.filter((p) => !p.archived);

  const compact = raw.replace(/[.\s]/g, "").toUpperCase();
  if (compact.length > 0 && compact.length <= 8) {
    const byInitials = active.find((p) => p.initials.toUpperCase() === compact);
    if (byInitials) return byInitials;
  }

  const norm = normalizeText(raw);
  if (norm.length === 0) return null;
  if (["me", "myself", "self", "mine"].includes(norm)) return active.find((p) => p.isMe) ?? null;

  const parts = active.map((p) => ({ p, n: nameParts(p) }));
  const byFull = parts.find(({ n }) => n.full === norm);
  if (byFull) return byFull.p;

  const tokens = norm.split(" ");
  let candidates: Person[] = [];
  if (tokens.length === 1) {
    const t = tokens[0] ?? "";
    candidates = uniquePeople(parts.filter(({ n }) => firstNameMatches(t, n.first)).map((x) => x.p));
    if (candidates.length === 0) candidates = parts.filter(({ n }) => n.last === t).map((x) => x.p);
  } else {
    const first = tokens[0] ?? "";
    const last = tokens[tokens.length - 1] ?? "";
    candidates = uniquePeople(
      parts
        .filter(
          ({ n }) =>
            (firstNameMatches(first, n.first) && (n.last === last || n.last.startsWith(last))) ||
            (firstNameMatches(last, n.first) && n.last === first),
        )
        .map((x) => x.p),
    );
  }
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function buildISO(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Calendar date of a JS Date in UTC — ExcelJS builds Date cells from serials in UTC. */
export function isoFromDate(d: Date): string | null {
  if (!Number.isFinite(d.getTime())) return null;
  return buildISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Excel 1900-system serial (days since 1899-12-30) → YYYY-MM-DD; fractional days (time) are dropped. */
export function excelSerialToISO(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial >= 2958466) return null;
  return isoFromDate(new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000));
}

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase());
}

function yearOf(part: string | undefined, todayISO: string | undefined): number {
  if (part !== undefined && part.length > 0) {
    const n = Number(part);
    return part.length <= 2 ? 2000 + n : n;
  }
  const fromToday = Number(todayISO?.slice(0, 4));
  return Number.isInteger(fromToday) && fromToday > 1900 ? fromToday : new Date().getUTCFullYear();
}

/**
 * Text → YYYY-MM-DD: ISO, m/d/yyyy, m/d/yy, m/d (current year), "Oct 15, 2026", "15 Oct 2026",
 * trailing times ignored, 5-digit Excel serials as text. Null when unrecognised.
 */
export function parseDateText(input: string, todayISO?: string): string | null {
  let s = input.trim();
  if (s.length === 0) return null;
  s = s
    .replace(/[T\s]+\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(am|pm)?\s*(z|[+-]\d{2}:?\d{2})?$/i, "")
    .replace(/,\s*$/, "")
    .trim();

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return buildISO(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/.exec(s);
  if (m) return buildISO(yearOf(m[3], todayISO), Number(m[1]), Number(m[2]));

  m = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?$/i.exec(s);
  if (m) {
    const month = monthIndex(m[1] ?? "");
    if (month >= 0) return buildISO(yearOf(m[3], todayISO), month + 1, Number(m[2]));
  }

  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?(?:\s+(\d{4}))?$/i.exec(s);
  if (m) {
    const month = monthIndex(m[2] ?? "");
    if (month >= 0) return buildISO(yearOf(m[3], todayISO), month + 1, Number(m[1]));
  }

  m = /^([a-z]+day),?\s+(.+)$/i.exec(s); // "Thursday, October 15, 2026"
  if (m) return parseDateText(m[2] ?? "", todayISO);

  if (/^\d{5}$/.test(s)) {
    const serial = Number(s);
    if (serial >= 20000 && serial < 80000) return excelSerialToISO(serial);
  }
  return null;
}

const NO_DATE_WORDS: ReadonlySet<string> = new Set(["tbd", "tba", "none", "n a", "na", "no date", "open", "ongoing"]);

/** Due date from a cell: Date values, Excel serials, then text. `invalid` carries unparseable text. */
export function parseDueDate(cell: CellData | undefined, todayISO?: string): { dueDate: string | null; invalid: string | null } {
  if (!cell) return { dueDate: null, invalid: null };
  const v = cell.value;
  if (v instanceof Date) {
    const iso = isoFromDate(v);
    return iso ? { dueDate: iso, invalid: null } : { dueDate: null, invalid: cell.text };
  }
  if (typeof v === "number") {
    // Same plausibility window as the text path (1954..2119): a stray "15" typed in the column is not 1900-01-14.
    const iso = v >= 20000 && v < 80000 ? excelSerialToISO(v) : null;
    return iso ? { dueDate: iso, invalid: null } : { dueDate: null, invalid: cell.text };
  }
  const text = cell.text.trim();
  if (text.length === 0 || /^[-–—?]+$/.test(text) || NO_DATE_WORDS.has(normalizeText(text))) return { dueDate: null, invalid: null };
  const iso = parseDateText(text, todayISO);
  return iso ? { dueDate: iso, invalid: null } : { dueDate: null, invalid: text };
}

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

const STATUS_WORDS: readonly [Status, readonly string[]][] = [
  ["Done", ["done", "complete", "completed", "closed", "addressed", "finished", "resolved", "cancelled", "canceled"]],
  ["In Progress", ["in progress", "inprogress", "started", "working", "wip", "ongoing", "active", "in process", "underway", "in work"]],
  ["Parked", ["parked", "on hold", "hold", "waiting", "someday", "deferred", "later", "parking lot", "blocked", "paused"]],
  ["Open", ["open", "not started", "notstarted", "new", "todo", "to do", "pending", "backlog", "planned"]],
];

/** Brain Dump status → Status. Blank / Not Started fall back to Open, or Parked for Parking Lot rows. */
export function mapStatus(text: string, parkedDefault: boolean): { status: Status; unknown: boolean } {
  const norm = normalizeText(text);
  const fallback: Status = parkedDefault ? "Parked" : "Open";
  if (norm.length === 0) return { status: fallback, unknown: false };
  for (const [status, words] of STATUS_WORDS) {
    if (words.includes(norm)) return { status: status === "Open" ? fallback : status, unknown: false };
  }
  return { status: fallback, unknown: true };
}

const PRIORITY_WORDS: readonly [Priority, readonly string[]][] = [
  ["Low", ["low", "l", "lo", "1", "minor", "nice to have"]],
  ["Medium", ["medium", "med", "m", "mid", "2", "normal", "moderate", "standard"]],
  ["High", ["high", "h", "hi", "3", "urgent", "critical", "asap", "top", "important"]],
];

export function mapPriority(text: string): { priority: Priority; unknown: boolean } {
  const norm = normalizeText(text);
  if (norm.length === 0) return { priority: "Medium", unknown: false };
  for (const [priority, words] of PRIORITY_WORDS) if (words.includes(norm)) return { priority, unknown: false };
  return { priority: "Medium", unknown: true };
}

const CATEGORY_WORDS: readonly [Category, readonly string[]][] = [
  ["NB", ["nb", "newbusiness", "newbiz", "business"]],
  ["A", ["a", "action", "actions", "actionitem", "actionitems", "task", "todo"]],
  ["Q", ["q", "question", "questions"]],
  ["I", ["i", "idea", "ideas"]],
  ["D", ["d", "decision", "decisions", "decided"]],
  ["W", ["w", "watch", "watchlist", "watching", "risk", "risks"]],
];

/** A Category / Type column value → Category. */
export function parseCategory(text: string): Category | null {
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (key.length === 0) return null;
  for (const [category, words] of CATEGORY_WORDS) if (words.includes(key)) return category;
  return null;
}

/** Table name → default category (New Business → NB, Action Items → A, Watch List → W, Parking Lot → A + Parked). */
export function categoryForTable(name: string): { category: Category; parked: boolean } | null {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (key.length === 0) return null;
  if (key.includes("newbusiness") || key === "nb") return { category: "NB", parked: false };
  if (key.includes("parking") || key.includes("parked")) return { category: "A", parked: true };
  if (key.includes("action") || key.includes("todo") || key.includes("task")) return { category: "A", parked: false };
  if (key.includes("watch") || key.includes("risk")) return { category: "W", parked: false };
  if (key.includes("question")) return { category: "Q", parked: false };
  if (key.includes("idea")) return { category: "I", parked: false };
  if (key.includes("decision")) return { category: "D", parked: false };
  return null;
}

const LEADING_TAG = /^\s*(?:[•\-*–—·▪◦>]+\s*)?(?:\((NB|A|Q|I|D|W)\)\s*:?|(NB|A|Q|I|D|W)(?:\s*[:)]|\s+[-–—]))\s*([\s\S]*)$/;

/** An explicit grammar tag at the start of a note (`A:`, `(Q)`, `NB -`, `W)`) and the text after it. */
export function extractLeadingTag(text: string): { category: Category; rest: string } | null {
  const m = LEADING_TAG.exec(text);
  if (!m) return null;
  const tag = m[1] ?? m[2];
  if (!tag) return null;
  return { category: tag as Category, rest: (m[3] ?? "").trim() };
}

const TITLE_MAX = 120;

/** First sentence of the first line (bullets stripped), else its first 120 characters; no trailing period. */
export function titleFromNote(note: string): string {
  const firstLine =
    note
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  const text = firstLine.replace(/^[\s•\-*–—·▪◦>]+/, "").replace(/\s+/g, " ").trim();
  if (text.length === 0) return "";
  let title = text;
  const boundary = /[.!?](?=\s+[A-Z("“]|\s*$)/.exec(text);
  if (boundary && boundary.index >= 12 && boundary.index + 1 <= TITLE_MAX) {
    title = text.slice(0, boundary.index + 1);
  } else if (text.length > TITLE_MAX) {
    const cut = text.lastIndexOf(" ", TITLE_MAX);
    title = `${text.slice(0, cut > 40 ? cut : TITLE_MAX).trimEnd()}…`;
  }
  return title.replace(/\.+$/, "").trim();
}

// ---------------------------------------------------------------------------
// Row → ImportRow
// ---------------------------------------------------------------------------

/**
 * Map one table row to an ImportRow. Category comes from the table (an explicit tag or a Category
 * column overrides it); Parking Lot rows default to Parked. Unmatched division / person, an invalid due
 * date, unknown status / priority words and an NB row without a target all produce warnings.
 */
export function buildImportRow(row: TableRow, table: DetectedTable, ctx: ExtractContext, todayISO: string): ImportRow {
  const warnings: string[] = [];
  const noteText = row.cells.note?.text ?? "";

  const tableInfo = categoryForTable(table.name);
  let category: Category = tableInfo?.category ?? "A";
  const parkedDefault = tableInfo?.parked ?? false;
  let titleSource = noteText;
  const tagged = extractLeadingTag(noteText);
  if (tagged) {
    category = tagged.category;
    titleSource = tagged.rest;
  }
  const categoryText = row.cells.category?.text ?? "";
  if (categoryText.length > 0) {
    const explicit = parseCategory(categoryText);
    if (explicit) category = explicit;
    else warnings.push(`unknown category: ${categoryText}`);
  }

  const title = titleFromNote(titleSource) || titleFromNote(noteText) || noteText.slice(0, 140).trim() || "(untitled)";

  let divisionCode: string | null = null;
  let isPersonal = false;
  const divisionText = row.cells.division?.text ?? "";
  if (divisionText.length > 0) {
    const division = matchDivision(divisionText, ctx.divisions);
    if (!division) warnings.push(`unknown division: ${divisionText}`);
    else if (division.kind === "personal") isPersonal = true;
    else divisionCode = division.code;
  }

  let ownerInitials: string | null = null;
  const ownerText = row.cells.owner?.text ?? "";
  if (ownerText.length > 0) {
    const names = splitPeople(ownerText);
    const resolved = names.map((name) => ({ name, person: matchPerson(name, ctx.people) }));
    const found = uniquePeople(resolved.flatMap((r) => (r.person ? [r.person] : [])));
    const missing = resolved.filter((r) => r.person === null).map((r) => r.name);
    const primary = found[0];
    if (!primary) {
      warnings.push(`unknown person: ${ownerText}`);
    } else {
      ownerInitials = primary.initials;
      if (found.length > 1) warnings.push(`multiple owners: used ${primary.initials}, also ${found.slice(1).map((p) => p.initials).join(", ")}`);
      if (missing.length > 0) warnings.push(`unknown person: ${missing.join(", ")}`);
    }
  }

  const priorityText = row.cells.priority?.text ?? "";
  const { priority, unknown: unknownPriority } = mapPriority(priorityText);
  if (unknownPriority) warnings.push(`unknown priority: ${priorityText}`);

  const statusText = row.cells.status?.text ?? "";
  const { status, unknown: unknownStatus } = mapStatus(statusText, parkedDefault);
  if (unknownStatus) warnings.push(`unknown status: ${statusText}`);

  const { dueDate, invalid } = parseDueDate(row.cells.due, todayISO);
  if (invalid !== null) warnings.push(`invalid due date: ${invalid}`);

  if (category === "NB" && ownerInitials === null && divisionCode === null) warnings.push("NB needs a target");

  const initiativeText = row.cells.initiative?.text ?? "";
  const contextText = row.cells.context?.text ?? "";

  const draft: ItemDraft = {
    category,
    title,
    note: noteText,
    divisionCode,
    ownerInitials,
    initiativeName: initiativeText.length > 0 ? initiativeText : null,
    priority,
    status,
    dueDate,
    isPersonal,
    context: contextText.length > 0 ? contextText.slice(0, 200) : null,
  };

  return {
    table: table.name,
    sheet: table.sheet,
    rowNumber: row.rowNumber,
    raw: row.raw,
    draft,
    warnings,
    include: true,
  };
}
