/**
 * Deterministic parser for Brandon's tag grammar (docs/SCOPE.md §1, docs/SPEC.md §5).
 *
 * A line is a proposal when it starts with a category tag: `A:` `Q:` `I:` `D:` `W:` `NB:` (also
 * `A -`, `(A)`, `A)`, `N.B.`, an optional bullet / list number in front, lower-case for the colon
 * and dash forms). On such a line:
 *   - initials right after the tag are the owner (A/Q/I/W) or target (NB); unknown initials become
 *     a warning `unknown person: XX` and are moved to the note;
 *   - a division code anywhere on the line (case-insensitive, `K&B` variants like `KB` / `K+B`)
 *     sets the division and is removed from the title; a full division name also identifies it;
 *   - `PTD` / `personal` → personal item without division;
 *   - `Initiative: Name` → initiativeName;
 *   - due phrases (`10/15`, `due 10/15/2026`, `by Friday`, `EOW`, `EOM`, `next week`, `tomorrow`,
 *     `Oct 15`, `in 2 weeks`, ...) resolve against `todayISO`;
 *   - `!!` / urgent / ASAP → High, `low priority` / `no rush` → Low;
 *   - someday / parking lot / back burner / on hold → Parked; decisions default to Done;
 *   - lines indented under a tagged line are appended to its note.
 *
 * Used offline when no API key is configured and, in the AI path, to cross-check the model:
 * any tagged line the model dropped is appended with the warning `added by rule parser`.
 */
import { emptyDraft, type Division, type Initiative, type ItemDraft, type Person, type Category } from "../../shared/types";
import type { ExtractContext, ProposalDraft } from "../contracts";

export const RULE_CONFIDENCE = 0.95;
export const TITLE_MAX = 140;
export const NB_TARGET_WARNING = "NB needs a target";
export const ADDED_BY_RULE_WARNING = "added by rule parser";

export function unknownPersonWarning(name: string): string {
  return `unknown person: ${name}`;
}
export function unknownDivisionWarning(code: string): string {
  return `unknown division: ${code}`;
}

// ---------------------------------------------------------------------------
// Dates (all arithmetic in UTC on calendar days; todayISO already is the Detroit date)
// ---------------------------------------------------------------------------

export interface DateParts {
  y: number;
  /** 0-based month. */
  m: number;
  d: number;
  /** 0 = Sunday. */
  dow: number;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
/** A year-less date this many days (or more) in the past is taken to mean next year. */
const PAST_DATE_GRACE_DAYS = 30;

export function toISODate(y: number, m0: number, d: number): string {
  return new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10);
}

export function parseISODate(iso: string): DateParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return { y, m: mo - 1, d, dow: date.getUTCDay() };
}

export function isValidISODate(s: string): boolean {
  return parseISODate(s) !== null;
}

export function weekdayName(iso: string): string {
  const p = parseISODate(iso);
  return p ? (WEEKDAY_NAMES[p.dow] ?? "") : "";
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = parseISODate(fromISO);
  const b = parseISODate(toISO);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d)) / 86_400_000);
}

/** Validates month/day (1-based month) and returns the ISO date, or null when the date does not exist. */
function calendarDate(y: number, month1: number, d: number): string | null {
  if (!Number.isInteger(y) || month1 < 1 || month1 > 12 || d < 1 || d > 31) return null;
  const iso = toISODate(y, month1 - 1, d);
  const back = parseISODate(iso);
  if (!back || back.m !== month1 - 1 || back.d !== d) return null;
  return iso;
}

export interface DueMatch {
  /** YYYY-MM-DD */
  dueDate: string;
  /** The text that expressed the date (including "due"/"by"), to strip from a title. */
  matched: string;
  /** Position of `matched` in the searched text. */
  index: number;
}

interface DueCandidate extends DueMatch {
  explicit: boolean;
}

const PREFIX = String.raw`(?:\b(?:due|by|on|before|until|deadline|needed)\s*:?\s+)?`;
const MONTH_SRC = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const WEEKDAY_SRC = String.raw`(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?)`;

const RE_ISO = new RegExp(String.raw`${PREFIX}\b(\d{4})-(\d{2})-(\d{2})\b`, "gi");
/** `10/15`, `10/15/2026`, `10/15/26`; not fractions like "3/4 of" or "1/2%". */
const RE_SLASH = new RegExp(String.raw`${PREFIX}(?<![\d/.\-])(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?(?![\d/])(?!\s*(?:%|of\b|ths?\b))`, "gi");
const RE_DASH_YEAR = new RegExp(String.raw`${PREFIX}(?<![\d/.\-])(\d{1,2})-(\d{1,2})-(\d{4}|\d{2})(?!\d)`, "gi");
const RE_MONTH_DAY = new RegExp(String.raw`${PREFIX}\b${MONTH_SRC}\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?`, "gi");
const RE_DAY_MONTH = new RegExp(String.raw`${PREFIX}\b(\d{1,2})(?:st|nd|rd|th)?\s+${MONTH_SRC}\b(?:,?\s+(\d{4})\b)?`, "gi");
const RE_WEEKDAY = new RegExp(String.raw`\b(due|by|on|before|until|for|this|next|coming)\s+${WEEKDAY_SRC}\b`, "gi");
const RE_RELATIVE = new RegExp(
  String.raw`\b(?:(?:due|by)\s+)?(day after tomorrow|tomorrow|today|tonight|eod|end of (?:the )?day|eow|end of (?:the )?week|this week|eom|end of (?:the )?month|eoy|end of (?:the )?year|next week|next month|in (\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten) (days?|weeks?|months?))\b`,
  "gi",
);

function monthIndex(word: string | undefined): number {
  return MONTH_KEYS.indexOf((word ?? "").slice(0, 3).toLowerCase());
}

function weekdayIndex(word: string | undefined): number {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf((word ?? "").slice(0, 3).toLowerCase());
}

function hasExplicitPrefix(matched: string): boolean {
  return /^(?:due|by|on|before|until|deadline|needed)\b/i.test(matched.trim());
}

/** Year-less dates that are well in the past roll into next year; recent ones stay (overdue). */
function settleYear(y: number, month1: number, d: number, hadYear: boolean, todayISO: string): string | null {
  const iso = calendarDate(y, month1, d);
  if (!iso) return null;
  if (hadYear) return iso;
  if (daysBetween(iso, todayISO) > PAST_DATE_GRACE_DAYS) return calendarDate(y + 1, month1, d);
  return iso;
}

function fullYear(raw: string | undefined, today: DateParts): { year: number; hadYear: boolean } {
  if (raw === undefined) return { year: today.y, hadYear: false };
  const n = Number(raw);
  return { year: raw.length === 2 ? 2000 + n : n, hadYear: true };
}

function collectAll(re: RegExp, text: string, fn: (m: RegExpExecArray) => DueCandidate | null, out: DueCandidate[]): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const c = fn(m);
    if (c) out.push(c);
    if (m[0].length === 0) re.lastIndex += 1;
  }
}

/**
 * Find the due date expressed in `text` relative to `todayISO`. Explicitly prefixed phrases
 * ("due 10/15", "by Friday") win over bare dates; otherwise the earliest phrase wins.
 */
export function resolveDuePhrase(text: string, todayISO: string): DueMatch | null {
  const today = parseISODate(todayISO);
  if (!today) return null;
  const plusDays = (n: number): string => toISODate(today.y, today.m, today.d + n);
  const candidates: DueCandidate[] = [];
  const push = (m: RegExpExecArray, iso: string | null, explicit: boolean): DueCandidate | null =>
    iso ? { dueDate: iso, matched: m[0], index: m.index, explicit } : null;

  collectAll(RE_ISO, text, (m) => push(m, calendarDate(Number(m[1]), Number(m[2]), Number(m[3])), hasExplicitPrefix(m[0])), candidates);
  collectAll(
    RE_SLASH,
    text,
    (m) => {
      const { year, hadYear } = fullYear(m[3], today);
      return push(m, settleYear(year, Number(m[1]), Number(m[2]), hadYear, todayISO), hasExplicitPrefix(m[0]));
    },
    candidates,
  );
  collectAll(
    RE_DASH_YEAR,
    text,
    (m) => {
      const { year } = fullYear(m[3], today);
      return push(m, settleYear(year, Number(m[1]), Number(m[2]), true, todayISO), hasExplicitPrefix(m[0]));
    },
    candidates,
  );
  collectAll(
    RE_MONTH_DAY,
    text,
    (m) => {
      const { year, hadYear } = fullYear(m[3], today);
      return push(m, settleYear(year, monthIndex(m[1]) + 1, Number(m[2]), hadYear, todayISO), hasExplicitPrefix(m[0]));
    },
    candidates,
  );
  collectAll(
    RE_DAY_MONTH,
    text,
    (m) => {
      const { year, hadYear } = fullYear(m[3], today);
      return push(m, settleYear(year, monthIndex(m[2]) + 1, Number(m[1]), hadYear, todayISO), hasExplicitPrefix(m[0]));
    },
    candidates,
  );
  collectAll(
    RE_WEEKDAY,
    text,
    (m) => {
      const target = weekdayIndex(m[2]);
      if (target < 0) return null;
      const modifier = (m[1] ?? "").toLowerCase();
      let ahead = (target - today.dow + 7) % 7;
      if (modifier === "next") {
        // The weekday of next week (weeks start Monday).
        const daysToNextMonday = ((1 - today.dow + 7) % 7) || 7;
        ahead = daysToNextMonday + ((target - 1 + 7) % 7);
      }
      return push(m, plusDays(ahead), true);
    },
    candidates,
  );
  collectAll(
    RE_RELATIVE,
    text,
    (m) => {
      const phrase = (m[1] ?? "").toLowerCase().replace(/\s+/g, " ");
      let iso: string | null = null;
      if (phrase === "day after tomorrow") iso = plusDays(2);
      else if (phrase === "tomorrow") iso = plusDays(1);
      else if (phrase === "today" || phrase === "tonight" || phrase === "eod" || phrase.startsWith("end of") && phrase.endsWith("day")) iso = todayISO;
      else if (phrase === "eow" || phrase === "this week" || (phrase.startsWith("end of") && phrase.endsWith("week"))) iso = plusDays((5 - today.dow + 7) % 7);
      else if (phrase === "eom" || (phrase.startsWith("end of") && phrase.endsWith("month"))) iso = toISODate(today.y, today.m + 1, 0);
      else if (phrase === "eoy" || (phrase.startsWith("end of") && phrase.endsWith("year"))) iso = toISODate(today.y, 11, 31);
      else if (phrase === "next week") iso = plusDays(((1 - today.dow + 7) % 7) || 7);
      else if (phrase === "next month") iso = toISODate(today.y, today.m + 1, 1);
      else if (phrase.startsWith("in ")) {
        const amountRaw = (m[2] ?? "").toLowerCase();
        const amount = NUMBER_WORDS[amountRaw] ?? Number(amountRaw);
        const unit = (m[3] ?? "").toLowerCase();
        if (Number.isFinite(amount) && amount > 0) {
          if (unit.startsWith("day")) iso = plusDays(amount);
          else if (unit.startsWith("week")) iso = plusDays(amount * 7);
          else iso = toISODate(today.y, today.m + amount, today.d);
        }
      }
      return push(m, iso, true);
    },
    candidates,
  );

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Number(b.explicit) - Number(a.explicit) || a.index - b.index);
  const best = candidates[0];
  return best ? { dueDate: best.dueDate, matched: best.matched, index: best.index } : null;
}

// ---------------------------------------------------------------------------
// Roster resolution (shared with the model post-processing in prompt.ts)
// ---------------------------------------------------------------------------

/** "K&B-I", "KB-I", "K+B-I", "kbi" all normalise to "KBI". */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "").replace(/\+/g, "&").replace(/[&.\-_/]/g, "");
}

function stripEdges(raw: string): string {
  return raw.trim().replace(/^[\[({«"'@#*_]+/, "").replace(/[\])}».,;:!?"'*_]+$/, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface RosterResolver {
  /** Initials (case-insensitive), full name, or a unique first / last name. */
  person(raw: string): Person | null;
  /** Initials only (case-insensitive). */
  personByInitials(raw: string): Person | null;
  /** Code (case-insensitive, `K&B` variants) or exact division name. */
  division(raw: string): Division | null;
  /** A division whose full name appears in the text (longest name first). */
  divisionInText(text: string): Division | null;
  /** Case-insensitive initiative name match. */
  initiative(raw: string): Initiative | null;
  isPersonalDivision(division: Division): boolean;
}

export function createRosterResolver(ctx: ExtractContext): RosterResolver {
  const people = [...ctx.people].sort((a, b) => Number(a.archived) - Number(b.archived));
  const divisions = [...ctx.divisions].sort((a, b) => Number(a.archived) - Number(b.archived) || a.sortOrder - b.sortOrder);
  const namedDivisions = divisions
    .filter((d) => d.name.trim().length >= 6 || d.name.trim().includes(" "))
    .map((d) => ({ division: d, re: new RegExp(`(?<![\\w&])${escapeRegExp(d.name.trim()).replace(/\s+/g, "\\s+")}(?![\\w&])`, "i") }))
    .sort((a, b) => b.division.name.length - a.division.name.length);
  const normalizedName = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

  const personByInitials = (raw: string): Person | null => {
    const s = stripEdges(raw).toUpperCase();
    if (s.length === 0) return null;
    return people.find((p) => p.initials.toUpperCase() === s) ?? null;
  };

  return {
    personByInitials,
    person(raw) {
      const byInitials = personByInitials(raw);
      if (byInitials) return byInitials;
      const s = normalizedName(stripEdges(raw));
      if (s.length === 0) return null;
      const full = people.find((p) => normalizedName(p.fullName) === s);
      if (full) return full;
      const firsts = people.filter((p) => normalizedName(p.fullName).split(" ")[0] === s);
      if (firsts.length === 1) return firsts[0] ?? null;
      const lasts = people.filter((p) => {
        const parts = normalizedName(p.fullName).split(" ");
        return parts.length > 1 && parts[parts.length - 1] === s;
      });
      if (lasts.length === 1) return lasts[0] ?? null;
      return null;
    },
    division(raw) {
      const s = stripEdges(raw);
      if (s.length === 0) return null;
      const upper = s.toUpperCase();
      const exact = divisions.find((d) => d.code.toUpperCase() === upper);
      if (exact) return exact;
      const norm = normalizeCode(s);
      if (norm.length >= 2) {
        const variant = divisions.find((d) => normalizeCode(d.code) === norm);
        if (variant) return variant;
      }
      const name = normalizedName(s);
      return divisions.find((d) => normalizedName(d.name) === name) ?? null;
    },
    divisionInText(text) {
      for (const entry of namedDivisions) {
        if (entry.re.test(text)) return entry.division;
      }
      return null;
    },
    initiative(raw) {
      const s = normalizedName(raw);
      if (s.length === 0) return null;
      return ctx.initiatives.find((i) => normalizedName(i.name) === s) ?? null;
    },
    isPersonalDivision(division) {
      return division.kind === "personal";
    },
  };
}

// ---------------------------------------------------------------------------
// Tag detection
// ---------------------------------------------------------------------------

const TAG_SRC = String.raw`(N\.?B\.?|A|Q|I|D|W)`;
const LEAD_RE = /^([ \t]*)(?:[-*•▪◦‣·]\s+|\d{1,2}[.)]\s+)?(.*)$/;
/** `(A)` / `(A):` / `(A) -` — upper-case only: `(a)` is a list enumerator. */
const FORM_PAREN = new RegExp(String.raw`^\(${TAG_SRC}\)\s*[:\-–—]?\s*(\S.*?)\s*$`);
/** `A:` (any case). */
const FORM_COLON = new RegExp(String.raw`^${TAG_SRC}\s*:\s*(\S.*?)\s*$`, "i");
/** `A - ` (any case; whitespace after the dash so "D-Day" is not a tag). */
const FORM_DASH = new RegExp(String.raw`^${TAG_SRC}\s*[-–—]\s+(\S.*?)\s*$`, "i");
/** `A)` — upper-case only: `a)` is a list enumerator. */
const FORM_CLOSE_PAREN = new RegExp(String.raw`^${TAG_SRC}\)\s*(\S.*?)\s*$`);
/** `N.B. something` */
const FORM_NB_DOTS = /^(N\.B\.)\s+(\S.*?)\s*$/i;

export interface TagMatch {
  category: Category;
  /** Text after the tag. */
  rest: string;
  /** Leading whitespace width (tab = 4). */
  indent: number;
}

function indentWidth(ws: string): number {
  let n = 0;
  for (const ch of ws) n += ch === "\t" ? 4 : 1;
  return n;
}

function toCategory(tag: string): Category {
  const t = tag.toUpperCase().replace(/\./g, "");
  return (t === "NB" ? "NB" : t) as Category;
}

/** Recognise a tagged line; null for everything else. */
export function matchTag(line: string): TagMatch | null {
  const lead = LEAD_RE.exec(line);
  if (!lead) return null;
  const indent = indentWidth(lead[1] ?? "");
  const body = lead[2] ?? "";
  if (body.length === 0) return null;
  for (const form of [FORM_PAREN, FORM_COLON, FORM_DASH, FORM_CLOSE_PAREN, FORM_NB_DOTS]) {
    const m = form.exec(body);
    if (m && m[1] !== undefined && m[2] !== undefined) return { category: toCategory(m[1]), rest: m[2], indent };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Line parsing
// ---------------------------------------------------------------------------

/** Lower-case words that coincide with codes / initials and must be spelled exactly to count. */
const COMMON_WORDS = new Set(
  (
    "app apps fob acc act add all and any are art ask bad bag bar bed big bit box but buy can cap car day did due end far fee few fit fix for fun get got had has her him his hit how its job key law let lot low man map may new not now off old one our out own pay per pro put ran red rep run saw say see set she sit six sum tab tag tax ten the tie top try two use van via was way web who why win yes yet you " +
    "an as at be by do go he if in is it me my no of ok on or so to up us we"
  )
    .trim()
    .split(/\s+/),
);

/** Upper-case 2–3 letter tokens that are acronyms, not people. */
const NOT_INITIALS = new Set(
  (
    "OK IT HR PR PO AP AR GL PL VP GM CEO CFO COO CTO CIO CPA ROI KPI IRS AC TV PC QA QC PM AM EOD EOW EOM EOY FYI ETA TBD TBA NDA LLC INC USA US UK NY MI OH ID URL API CRM ERP SOP RFP RFQ RFI NB PTD WIP ATM DIY FAQ MTG MTD YTD Q1 Q2 Q3 Q4 P1 P2 P3 OT PTO W2 W9 UI UX SEO PPC CPC ADP HOA DOT EPA CDL SKU ETC ALL AND THE FOR NOT BUT NEW OLD ONE TWO SIX TEN GET SET LET PUT CAN DUE BY TO IN ON AT OF OR IS AS IF DO GO NO SO UP WE HE ME MY AN BE AM"
  ).split(/\s+/),
);

const URGENT_RE = /!!+|\b(?:urgent(?:ly)?|asap|critical|(?:high|top)[- ]priority)\b/gi;
const LOW_RE = /\b(?:low[- ]priority|no rush|not urgent|nice[- ]to[- ]have)\b/gi;
const PARKED_RE = /\b(?:someday|parking[- ]lot|park (?:it|this|that)|parked|when we get to it|back[- ]?burner|on hold|not now)\b/gi;
const IN_PROGRESS_RE = /\b(?:in progress|wip|underway|working on (?:it|this))\b/gi;
/** A trailing status marker set off by punctuation: "… - done", "… (done)", "…: complete". */
const DONE_TRAILER_RE = /\s*(?:[-–—:;]\s*|[(\[]\s*)(?:done|complete|completed|finished|resolved)\s*[)\]]?\s*[.!]?\s*$/i;
const INITIATIVE_RE = /\binitiative\s*[:=]\s*([^,;|]+)/i;
const PERSONAL_RE = /^(?:PTD|personal)$/i;
const SENTENCE_ABBREVIATIONS = /\b(?:mr|mrs|ms|dr|st|vs|etc|inc|co|no|approx|e\.g|i\.e)\.$/i;

interface Token {
  lead: string;
  core: string;
  trail: string;
}

function tokenize(text: string): Token[] {
  return text
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((raw) => {
      const lead = /^[\[({«"'@#*_]+/.exec(raw)?.[0] ?? "";
      let body = raw.slice(lead.length);
      const trail = /[\])}».,;:!?"'*_]+$/.exec(body)?.[0] ?? "";
      body = body.slice(0, body.length - trail.length);
      return { lead, core: body, trail };
    });
}

function joinTokens(tokens: Token[]): string {
  return tokens.map((t) => `${t.lead}${t.core}${t.trail}`).join(" ");
}

/** When a token is consumed, keep its sentence punctuation on the previous kept word ("plan for K&B-I?" → "plan for?"). */
function carryPunctuation(kept: Token[], consumed: Token): void {
  const last = kept[kept.length - 1];
  if (last && /^[?!.,;:]+$/.test(consumed.trail)) last.trail += consumed.trail;
}

function looksLikeUnknownInitials(core: string, resolver: RosterResolver): boolean {
  return /^[A-Z]{2,3}$/.test(core) && !NOT_INITIALS.has(core) && resolver.division(core) === null;
}

function initialsCandidate(core: string): boolean {
  if (!/^[A-Za-z]{2,4}$/.test(core)) return false;
  const upper = core === core.toUpperCase();
  const lower = core === core.toLowerCase();
  if (!upper && !lower) return false; // "An", "Do" are words, not initials
  return !(lower && COMMON_WORDS.has(core));
}

function divisionToken(core: string, resolver: RosterResolver): Division | null {
  if (core.length < 2) return null;
  if (COMMON_WORDS.has(core.toLowerCase())) {
    // "app" / "App" are words; only the exact code spelling counts.
    return resolver.division(core)?.code === core ? resolver.division(core) : null;
  }
  return resolver.division(core);
}

export function cleanTitle(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s+([,.;:?!])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/\s+([)\]])/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:;,.|/]+/, "")
    .replace(/[\s\-–—:;,|/]+$/, "")
    .replace(/\.+$/, "")
    .trim();
}

function capitalizeFirstWord(title: string): string {
  const m = /^([a-z]+)\b/.exec(title);
  if (!m || !m[1]) return title;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** Split into a ≤ 140-char title and the remainder (first sentence, or a word-boundary cut). */
export function splitTitle(text: string): { title: string; rest: string | null } {
  const cleaned = cleanTitle(text);
  const sentence = /^(.{12,}?[.!?])\s+(?=["(\[]?[A-Z0-9])/.exec(cleaned);
  if (sentence && sentence[1] && sentence[1].length <= TITLE_MAX && !SENTENCE_ABBREVIATIONS.test(sentence[1])) {
    const rest = cleaned.slice(sentence[0].length).trim();
    return { title: cleanTitle(sentence[1]), rest: rest.length > 0 ? rest : null };
  }
  if (cleaned.length <= TITLE_MAX) return { title: cleaned, rest: null };
  const cut = cleaned.slice(0, TITLE_MAX - 1);
  const space = cut.lastIndexOf(" ");
  const head = (space > 60 ? cut.slice(0, space) : cut).replace(/[\s,;:\-–—(\[]+$/, "");
  return { title: `${head}…`, rest: cleaned };
}

function appendNote(note: string, extra: string | null): string {
  if (!extra || extra.trim().length === 0) return note;
  return note.length > 0 ? `${note}\n${extra.trim()}` : extra.trim();
}

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

export interface ParseLineOptions {
  /** Division to assume when the line names none. Unknown codes are ignored. */
  defaultDivisionCode?: string | null;
  /** Lines indented under the tagged line (joined into the note and the excerpt). */
  continuation?: string[];
  resolver?: RosterResolver;
}

/** Parse one tagged line (plus optional continuation lines) into a proposal; null when the line carries no tag. */
export function parseTaggedLine(line: string, ctx: ExtractContext, todayISO: string, options: ParseLineOptions | string | null = null): ProposalDraft | null {
  const opts: ParseLineOptions = typeof options === "string" || options === null ? { defaultDivisionCode: options } : options;
  const tag = matchTag(line);
  if (!tag) return null;
  const resolver = opts.resolver ?? createRosterResolver(ctx);
  const warnings: string[] = [];
  const noteParts: string[] = [];
  const draft: ItemDraft = emptyDraft({ category: tag.category });

  // Normalise "K & B" / "K and B" so the code is one token.
  let rest = tag.rest.replace(/\bK\s*(?:&|\+|and)\s*B\b/gi, "K&B");

  const initiative = INITIATIVE_RE.exec(rest);
  if (initiative) {
    const name = (initiative[1] ?? "").trim().replace(/[.\s]+$/, "");
    if (name.length > 0) {
      const known = resolver.initiative(name);
      draft.initiativeName = known ? known.name : name;
    }
    rest = rest.replace(initiative[0], " ");
  }

  const due = resolveDuePhrase(rest, todayISO);
  if (due) {
    draft.dueDate = due.dueDate;
    rest = rest.slice(0, due.index) + " " + rest.slice(due.index + due.matched.length);
  }

  if (URGENT_RE.test(rest)) {
    draft.priority = "High";
    rest = rest.replace(URGENT_RE, " ");
  } else if (LOW_RE.test(rest)) {
    draft.priority = "Low";
    rest = rest.replace(LOW_RE, " ");
  }
  URGENT_RE.lastIndex = 0;
  LOW_RE.lastIndex = 0;

  if (PARKED_RE.test(rest)) {
    draft.status = "Parked";
    rest = rest.replace(PARKED_RE, " ");
  } else if (IN_PROGRESS_RE.test(rest)) {
    draft.status = "In Progress";
    rest = rest.replace(IN_PROGRESS_RE, " ");
  } else if (tag.category !== "D" && DONE_TRAILER_RE.test(rest) && cleanTitle(rest.replace(DONE_TRAILER_RE, "")).length > 0) {
    draft.status = "Done";
    rest = rest.replace(DONE_TRAILER_RE, " ");
  }
  PARKED_RE.lastIndex = 0;
  IN_PROGRESS_RE.lastIndex = 0;

  const tokens = tokenize(rest);
  const kept: Token[] = [];
  let division: Division | null = null;
  let personal = false;
  const coOwners: Person[] = [];
  const unknownInitials: string[] = [];

  // Leading run right after the tag: initials, division codes and flags in any order.
  let i = 0;
  for (; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) break;
    const core = token.core;
    if (core.length === 0) continue; // a bare "-" or ":" separator
    if (PERSONAL_RE.test(core)) {
      personal = true;
      continue;
    }
    const div = divisionToken(core, resolver);
    if (div) {
      division ??= div;
      continue;
    }
    if (initialsCandidate(core)) {
      const person = resolver.personByInitials(core);
      if (person) {
        if (draft.ownerInitials === null) draft.ownerInitials = person.initials;
        else coOwners.push(person);
        continue;
      }
    }
    const parts = core.split(/[/&+]/);
    if (parts.length > 1 && parts.every((p) => initialsCandidate(p) && resolver.personByInitials(p) !== null)) {
      for (const p of parts) {
        const person = resolver.personByInitials(p);
        if (!person) continue;
        if (draft.ownerInitials === null) draft.ownerInitials = person.initials;
        else coOwners.push(person);
      }
      continue;
    }
    if (looksLikeUnknownInitials(core, resolver)) {
      unknownInitials.push(core);
      continue;
    }
    break;
  }

  for (; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    const core = token.core;
    if (core.length > 0 && PERSONAL_RE.test(core)) {
      personal = true;
      carryPunctuation(kept, token);
      continue;
    }
    if (division === null && core.length > 0) {
      const div = divisionToken(core, resolver);
      if (div) {
        division = div;
        carryPunctuation(kept, token);
        continue;
      }
    }
    kept.push(token);
  }

  if (division === null && !personal) {
    const named = resolver.divisionInText(joinTokens(kept));
    if (named) division = named;
  }
  if (division && resolver.isPersonalDivision(division)) {
    personal = true;
    division = null;
  }

  for (const person of coOwners) noteParts.push(`Also: ${person.fullName} (${person.initials})`);
  for (const initials of unknownInitials) {
    warnings.push(unknownPersonWarning(initials));
    noteParts.push(`Owner/target as written: ${initials} (not on the roster)`);
  }

  let body = cleanTitle(joinTokens(kept));
  if (body.length === 0) body = cleanTitle(tag.rest);
  const split = splitTitle(body);
  draft.title = capitalizeFirstWord(split.title);
  if (draft.title.length === 0) draft.title = line.trim().slice(0, TITLE_MAX);
  let note = split.rest ?? "";
  for (const part of noteParts) note = appendNote(note, part);
  const continuation = (opts.continuation ?? []).map((l) => l.trim()).filter((l) => l.length > 0);
  if (continuation.length > 0) note = appendNote(note, continuation.map((l) => l.replace(/^(?:[-*•▪◦‣·]|\d{1,2}[.)])\s+/, "")).join("\n"));
  draft.note = note;

  draft.isPersonal = personal;
  if (personal) {
    draft.divisionCode = null;
  } else if (division) {
    draft.divisionCode = division.code;
  } else if (opts.defaultDivisionCode) {
    const fallback = resolver.division(opts.defaultDivisionCode);
    if (fallback && !resolver.isPersonalDivision(fallback)) draft.divisionCode = fallback.code;
  }

  if (tag.category === "D" && draft.status === "Open") draft.status = "Done";
  if (tag.category === "NB" && draft.ownerInitials === null && draft.divisionCode === null) warnings.push(NB_TARGET_WARNING);

  const excerpt = [line.trim(), ...continuation].join("\n");
  return { draft, confidence: RULE_CONFIDENCE, inferred: false, sourceExcerpt: excerpt, warnings: uniq(warnings) };
}

/**
 * Every tagged line of `text`, in order. Untagged lines are ignored, except lines indented deeper
 * than the tagged line right above them, which become that proposal's note.
 */
export function parseTaggedLines(text: string, ctx: ExtractContext, todayISO: string, defaultDivisionCode: string | null = null): ProposalDraft[] {
  const resolver = createRosterResolver(ctx);
  const lines = text.split(/\r\n|\r|\n/);
  const out: ProposalDraft[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const tag = matchTag(line);
    if (!tag) {
      i += 1;
      continue;
    }
    const continuation: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j] ?? "";
      if (next.trim().length === 0 || matchTag(next)) break;
      const indent = indentWidth(/^[ \t]*/.exec(next)?.[0] ?? "");
      if (indent <= tag.indent) break;
      continuation.push(next);
      j += 1;
    }
    const proposal = parseTaggedLine(line, ctx, todayISO, { defaultDivisionCode, continuation, resolver });
    if (proposal) out.push(proposal);
    i = j;
  }
  return out;
}

/** True when `text` has at least one tagged line. */
export function hasTaggedLines(text: string): boolean {
  return text.split(/\r\n|\r|\n/).some((l) => matchTag(l) !== null);
}
