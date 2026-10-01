/**
 * Date helpers. All display is in the owner's timezone — `displayTimezone()` (from /api/bootstrap,
 * America/Detroit until it loads); due dates are plain YYYY-MM-DD.
 */
import { DUE_SOON_DAYS } from "@shared/agenda";
import { dateISOInTZ } from "@shared/timezone";
import { displayTimezone } from "@/lib/timezone";

/** Today's date as YYYY-MM-DD in `tz` (the display timezone by default). */
export function todayISO(now: Date = new Date(), tz: string = displayTimezone()): string {
  return dateISOInTZ(now, tz);
}

/** Parse YYYY-MM-DD into a Date at UTC midnight (so formatting with timeZone UTC never shifts the day). */
export function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  if (!d) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (both YYYY-MM-DD); positive when b is later. */
export function daysBetween(a: string, b: string): number {
  const da = parseISODate(a);
  const db = parseISODate(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/** "Oct 15" or "Oct 15, 2027" when the year differs from today's. */
export function formatDue(iso: string | null, today: string = todayISO()): string {
  if (!iso) return "";
  const d = parseISODate(iso);
  if (!d) return iso;
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}

export type DueTone = "overdue" | "today" | "soon" | "normal";

/** Human label for a due date relative to today. */
export function dueLabel(iso: string | null, today: string = todayISO()): { text: string; tone: DueTone } | null {
  if (!iso) return null;
  const diff = daysBetween(today, iso);
  if (diff < 0) return { text: diff === -1 ? "Yesterday" : `${-diff}d overdue`, tone: "overdue" };
  if (diff === 0) return { text: "Today", tone: "today" };
  if (diff === 1) return { text: "Tomorrow", tone: "soon" };
  // Same window as Today's "Due this week" bucket (today .. today + DUE_SOON_DAYS - 1).
  if (diff < DUE_SOON_DAYS) return { text: formatDue(iso, today), tone: "soon" };
  return { text: formatDue(iso, today), tone: "normal" };
}

/** ISO datetime → "Sep 30, 2:15 PM" in `tz` (the display timezone by default). */
export function formatDateTime(iso: string, tz: string = displayTimezone()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** ISO datetime → "Sep 30, 2026" in `tz` (the display timezone by default). */
export function formatDate(iso: string, tz: string = displayTimezone()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }).format(d);
}

/** ISO datetime → "just now", "5m ago", "3h ago", "2d ago", else a date. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatDate(iso);
}

/** ISO datetime → YYYY-MM-DD in `tz` (the display timezone by default; for "completed in last 30 days" checks). */
export function isoDateInTZ(iso: string, tz: string = displayTimezone()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return todayISO(d, tz);
}
