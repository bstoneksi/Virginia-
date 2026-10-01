/**
 * server/brief/build.ts — the daily 7 am brief, built from the tracker.
 *
 * `buildDailyBrief(repo, { todayISO, now })` is deterministic given the repo contents and the clock:
 * it reads items, pending captures and the newest email digest, buckets the items with the shared
 * Today logic (shared/agenda.ts `todayBuckets` — nothing is re-bucketed here) and renders Markdown
 * first; the plain-text and HTML email parts are derived from that Markdown (server/brief/markdown.ts).
 *
 * Every section is a `SectionSpec` so the owner can trim the brief with BRIEF_SECTIONS (a comma list of
 * `BRIEF_SECTION_KEYS`; default all, in the order given). An empty section says "Nothing." in one line.
 * Storing and emailing the result is server/brief/run.ts's job; the scheduler is server/brief/scheduler.ts.
 */
import { addDaysISO, formatDateDetroit, todayBuckets } from "../../shared/agenda";
import { BRIEF_SCOPES, BRIEF_SECTION_KEYS, BRIEF_SECTION_LABELS } from "../../shared/types";
import type { Brief, BriefScope, BriefSectionKey, CaptureKind, CaptureSummary, Item, Person } from "../../shared/types";
import type { Repo } from "../db/repo";
import { markdownToPlainText, renderMarkdownHtml } from "./markdown";
import type { InlineStyles } from "./markdown";

// ---------------------------------------------------------------------------
// Sections, scope and their env parsers (used by server/config.ts)
// ---------------------------------------------------------------------------

// The section keys, labels and scopes are part of the shared contract (shared/types.ts, so the Settings
// page can name them); re-exported here so the brief modules and their tests keep one import site.
export { BRIEF_SCOPES, BRIEF_SECTION_KEYS, BRIEF_SECTION_LABELS };
export type { BriefScope, BriefSectionKey };

const normalizeKey = (s: string): string => s.toLowerCase().replace(/[-_\s]/g, "");
const SECTION_BY_NORMALIZED_KEY = new Map<string, BriefSectionKey>(BRIEF_SECTION_KEYS.map((k) => [normalizeKey(k), k]));

/** BRIEF_SECTIONS: comma list of section keys (case / dash / underscore insensitive); unset or empty → null (all). */
export function parseBriefSections(raw: string | undefined): BriefSectionKey[] | null {
  if (raw === undefined) return null;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  const out: BriefSectionKey[] = [];
  for (const part of parts) {
    const key = SECTION_BY_NORMALIZED_KEY.get(normalizeKey(part));
    if (!key) throw new Error(`BRIEF_SECTIONS: unknown section "${part}" (valid: ${BRIEF_SECTION_KEYS.join(", ")})`);
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** BRIEF_SCOPE: "all" (default) or "mine". */
export function parseBriefScope(raw: string | undefined): BriefScope {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "" || s === "all") return "all";
  if (s === "mine" || s === "me") return "mine";
  throw new Error(`BRIEF_SCOPE must be "all" or "mine", got "${raw}"`);
}

// ---------------------------------------------------------------------------
// Date helpers (YYYY-MM-DD strings are calendar dates; format them at UTC noon so no zone shifts them)
// ---------------------------------------------------------------------------

const DETROIT = "America/Detroit";

function formatDateISO(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(new Date(`${iso}T12:00:00Z`));
}

/** "Sep 29" — with the year ("Jan 1, 2020") when `referenceISO` is given and falls in a different year. */
export function formatDayShort(dateISO: string, referenceISO?: string): string {
  const sameYear = referenceISO === undefined || dateISO.slice(0, 4) === referenceISO.slice(0, 4);
  return formatDateISO(dateISO, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** "Thu, Oct 2" */
export function formatWeekdayDay(dateISO: string): string {
  return formatDateISO(dateISO, { weekday: "short", month: "short", day: "numeric" });
}

/** "Thursday, October 1, 2026" */
export function formatLongDate(dateISO: string): string {
  return formatDateISO(dateISO, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** "Sep 30, 6:02 PM" in America/Detroit for an ISO timestamp. */
export function formatDateTimeDetroit(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { timeZone: DETROIT, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

/** Whole days from `fromISO` to `toISO` (positive when `toISO` is later). */
export function daysBetween(fromISO: string, toISO: string): number {
  const toUtc = (iso: string): number => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((toUtc(toISO) - toUtc(fromISO)) / 86_400_000);
}

/** "Daily brief — Thu, Oct 1" */
export function dailyBriefTitle(todayISO: string): string {
  return `Daily brief — ${formatWeekdayDay(todayISO)}`;
}

function detroitHour(now: Date): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: DETROIT, hour: "2-digit", hourCycle: "h23" }).formatToParts(now).find((p) => p.type === "hour");
  const n = Number(part?.value);
  return Number.isFinite(n) ? n : 7;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

type LineMode = "overdue" | "today" | "week" | "plain" | "yesterday";

/** `Q: Title — VM · HG · High · due Sep 29 (2 days late)`; the A tag is implied, owner / division / priority only when telling. */
export function itemLine(item: Item, todayISO: string, mode: LineMode): string {
  const meta: string[] = [];
  if (item.ownerInitials) meta.push(item.ownerInitials);
  if (item.isPersonal) meta.push("personal");
  else if (item.divisionCode) meta.push(item.divisionCode);
  if (item.priority === "High") meta.push("High");
  if (item.status !== "Open") meta.push(item.status);
  if (item.dueDate) {
    if (mode === "overdue") {
      const late = daysBetween(item.dueDate, todayISO);
      meta.push(`due ${formatDayShort(item.dueDate, todayISO)} (${late} ${late === 1 ? "day" : "days"} late)`);
    } else if (mode === "plain" || mode === "yesterday") {
      meta.push(`due ${formatDayShort(item.dueDate, todayISO)}`);
    }
  }
  const title = `${item.category === "A" ? "" : `${item.category}: `}${item.title.trim()}`;
  return meta.length > 0 ? `${title} — ${meta.join(" · ")}` : title;
}

const CAPTURE_KIND_LABELS: Record<CaptureKind, string> = {
  text: "note",
  transcript: "transcript",
  image: "photo",
  screenshot: "screenshot",
  mixed: "capture",
  import: "import",
};

function captureLine(capture: CaptureSummary, todayISO: string): string {
  const title = capture.title?.trim() || `Untitled ${CAPTURE_KIND_LABELS[capture.kind]}`;
  const meta: string[] = [`${capture.proposedCount} to review`];
  if (capture.context) meta.push(capture.context);
  if (capture.error) meta.push("extraction failed");
  meta.push(`added ${formatDayShort(formatDateDetroit(capture.createdAt), todayISO)}`);
  return `${title} — ${meta.join(" · ")}`;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

interface SectionContext {
  todayISO: string;
  yesterdayISO: string;
  now: Date;
  me: Person | null;
  overdue: Item[];
  dueToday: Item[];
  dueWeek: Item[];
  highPriority: Item[];
  needsOwner: Item[];
  pending: CaptureSummary[];
  addedYesterday: Item[];
  digest: Brief | null;
}

interface SectionSpec {
  key: BriefSectionKey;
  count(ctx: SectionContext): number;
  /** Markdown lines under the heading; empty → "Nothing." */
  lines(ctx: SectionContext): string[];
  /** Fragment for the summary line, e.g. ["overdue", "overdue"] (singular, plural); omitted for the digest. */
  summary?: [singular: string, plural: string];
}

const bullets = (items: Item[], todayISO: string, mode: LineMode): string[] => items.map((i) => `- ${itemLine(i, todayISO, mode)}`);

const SECTIONS: Record<BriefSectionKey, SectionSpec> = {
  overdue: {
    key: "overdue",
    count: (c) => c.overdue.length,
    lines: (c) => bullets(c.overdue, c.todayISO, "overdue"),
    summary: ["overdue", "overdue"],
  },
  dueToday: {
    key: "dueToday",
    count: (c) => c.dueToday.length,
    lines: (c) => bullets(c.dueToday, c.todayISO, "today"),
    summary: ["due today", "due today"],
  },
  dueWeek: {
    key: "dueWeek",
    count: (c) => c.dueWeek.length,
    lines: (c) => c.dueWeek.map((i) => `- ${formatWeekdayDay(i.dueDate ?? c.todayISO)}: ${itemLine(i, c.todayISO, "week")}`),
    summary: ["due this week", "due this week"],
  },
  highPriority: {
    key: "highPriority",
    count: (c) => c.highPriority.length,
    lines: (c) => bullets(c.highPriority, c.todayISO, "plain"),
    summary: ["high priority", "high priority"],
  },
  needsOwner: {
    key: "needsOwner",
    count: (c) => c.needsOwner.length,
    lines: (c) => bullets(c.needsOwner, c.todayISO, "plain"),
    summary: ["needs an owner", "need an owner"],
  },
  review: {
    key: "review",
    count: (c) => c.pending.length,
    lines: (c) => c.pending.map((cap) => `- ${captureLine(cap, c.todayISO)}`),
    summary: ["capture to review", "captures to review"],
  },
  addedYesterday: {
    key: "addedYesterday",
    count: (c) => c.addedYesterday.length,
    lines: (c) => bullets(c.addedYesterday, c.todayISO, "yesterday"),
    summary: ["added yesterday", "added yesterday"],
  },
  digest: {
    key: "digest",
    count: (c) => (c.digest ? 1 : 0),
    lines: (c) => {
      if (!c.digest) return ["No digest yet."];
      return [`**${c.digest.title.trim()}** · ${formatDateTimeDetroit(c.digest.createdAt)}`, "", ...c.digest.bodyMd.replace(/\r\n?/g, "\n").split("\n")];
    },
  },
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface BuildDailyBriefOptions {
  /** YYYY-MM-DD in America/Detroit. */
  todayISO: string;
  now: Date;
  /** The digest to quote. `undefined` → the newest email_digest brief of the last 24 h is looked up; `null` → none. */
  emailDigest?: Brief | null;
  /** Sections to include, in this order. `undefined` / `null` → all (BRIEF_SECTION_KEYS order). */
  sections?: readonly BriefSectionKey[] | null;
  /** Default "all". */
  scope?: BriefScope;
}

export interface DailyBriefContent {
  /** "Daily brief — Thu, Oct 1" — also the email subject and the stored brief's title. */
  title: string;
  /** Markdown body for the Briefs page (the title is not repeated inside it). */
  bodyMd: string;
  /** Text part of the email: title + body. */
  plainText: string;
  /** HTML part of the email: a complete document with inline styles. */
  html: string;
  /** Per-section item counts (digest: 1 when one was quoted). */
  counts: Record<BriefSectionKey, number>;
}

/** How far back a digest still counts as "latest". */
export const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

export const EMAIL_STYLES: InlineStyles = {
  h1: "font-size:20px;line-height:1.3;margin:0 0 6px;color:#1B2A49;",
  h2: "font-size:15px;line-height:1.3;margin:20px 0 6px;padding-bottom:4px;border-bottom:1px solid #e2e8f0;color:#1B2A49;",
  h3: "font-size:14px;margin:14px 0 4px;color:#1B2A49;",
  h4: "font-size:14px;margin:12px 0 4px;",
  p: "margin:0 0 8px;",
  ul: "margin:0 0 8px;padding-left:20px;",
  ol: "margin:0 0 8px;padding-left:20px;",
  li: "margin:0 0 4px;",
  blockquote: "margin:0 0 8px;padding-left:12px;border-left:3px solid #cbd5e1;color:#475569;",
  pre: "margin:0 0 8px;padding:8px 10px;background:#f1f5f9;border-radius:6px;overflow:auto;",
  code: "font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;",
  a: "color:#1B2A49;",
  hr: "border:0;border-top:1px solid #e2e8f0;margin:12px 0;",
};

function greetingWord(now: Date): string {
  const hour = detroitHour(now);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function summaryLine(ctx: SectionContext, sections: readonly SectionSpec[]): string {
  const bits: string[] = [];
  for (const spec of sections) {
    if (!spec.summary) continue;
    const n = spec.count(ctx);
    if (n > 0) bits.push(`${n} ${n === 1 ? spec.summary[0] : spec.summary[1]}`);
  }
  if (bits.length === 0) return "Nothing overdue, nothing due, nothing waiting — a clear day.";
  return `**${bits.join(" · ")}**`;
}

function wrapEmailHtml(fragment: string): string {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    '<body style="margin:0;padding:16px;background:#f8fafc;">',
    '<div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;padding:20px 24px;font-family:-apple-system,\'Segoe UI\',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;">',
    fragment,
    "</div></body></html>",
  ].join("\n");
}

export function buildDailyBrief(repo: Repo, opts: BuildDailyBriefOptions): DailyBriefContent {
  const { todayISO, now } = opts;
  const scope = opts.scope ?? "all";
  const keys = opts.sections && opts.sections.length > 0 ? opts.sections : BRIEF_SECTION_KEYS;
  const sections = keys.map((k) => SECTIONS[k]);

  const me = repo.getMe();
  const all = repo.listItems({ includeDone: true });
  const buckets = todayBuckets(
    all.filter((i) => i.status !== "Done"),
    todayISO,
    scope === "mine" ? (me?.initials ?? null) : null,
    now.toISOString(),
  );
  const yesterdayISO = addDaysISO(todayISO, -1);
  const digest =
    opts.emailDigest === undefined ? repo.latestBrief("email_digest", new Date(now.getTime() - DIGEST_WINDOW_MS).toISOString()) : opts.emailDigest;

  const ctx: SectionContext = {
    todayISO,
    yesterdayISO,
    now,
    me,
    overdue: buckets.overdue,
    dueToday: buckets.dueSoon.filter((i) => i.dueDate === todayISO),
    dueWeek: buckets.dueSoon.filter((i) => i.dueDate !== todayISO),
    highPriority: buckets.highPriority,
    needsOwner: buckets.unowned,
    pending: repo.listCaptures("pending"),
    addedYesterday: all.filter((i) => formatDateDetroit(i.createdAt) === yesterdayISO).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)),
    digest,
  };

  const firstName = me?.fullName.trim().split(/\s+/)[0];
  const lines: string[] = [`${greetingWord(now)}${firstName ? `, ${firstName}` : ""}. ${formatLongDate(todayISO)}.`, "", summaryLine(ctx, sections), ""];
  const counts = Object.fromEntries(BRIEF_SECTION_KEYS.map((k) => [k, 0])) as Record<BriefSectionKey, number>;
  for (const spec of sections) {
    const n = spec.count(ctx);
    counts[spec.key] = n;
    const showCount = spec.key !== "digest" && n > 0;
    lines.push(`## ${BRIEF_SECTION_LABELS[spec.key]}${showCount ? ` (${n})` : ""}`);
    const body = spec.lines(ctx);
    lines.push(...(body.length > 0 ? body : ["Nothing."]));
    lines.push("");
  }
  lines.push(`_Built by Virginia at ${formatDateTimeDetroit(now.toISOString())}._`);

  const title = dailyBriefTitle(todayISO);
  const bodyMd = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const withTitle = `# ${title}\n\n${bodyMd}`;
  return {
    title,
    bodyMd,
    plainText: markdownToPlainText(withTitle),
    html: wrapEmailHtml(renderMarkdownHtml(withTitle, { styles: EMAIL_STYLES })),
    counts,
  };
}
