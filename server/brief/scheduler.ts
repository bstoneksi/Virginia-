/**
 * server/brief/scheduler.ts — runs the daily brief at BRIEF_TIME on BRIEF_DAYS (America/Detroit).
 *
 * A 60-second, unref'd interval asks the pure `shouldRunNow` whether the brief is due: it is when
 * today (Detroit) is a scheduled day, the local time has passed BRIEF_TIME and `settings` says the
 * last run was before today — so a server that was asleep at 07:00 catches up on its first tick
 * afterwards, and nothing ever runs twice for one day. Weekday / time parsing for server/config.ts
 * lives here too. One log line per run; a failed run is logged and retried after `retryDelayMs`.
 */
import type { Repo } from "../db/repo";
import type { BriefScope, BriefSectionKey } from "./build";
import type { EmailSender } from "./email";
import { BRIEF_SETTING_KEYS, runDailyBrief } from "./run";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAYS_MON_FRI: readonly Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export const DEFAULT_BRIEF_TIME = "07:00";
export const DETROIT_TZ = "America/Detroit";

// ---------------------------------------------------------------------------
// Env parsing (server/config.ts)
// ---------------------------------------------------------------------------

/** BRIEF_TIME: `HH:MM` 24-hour (a single-digit hour is accepted and zero-padded). Unset / empty → 07:00. */
export function parseBriefTime(raw: string | undefined): string {
  const s = (raw ?? "").trim();
  if (s.length === 0) return DEFAULT_BRIEF_TIME;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  const hour = m ? Number(m[1]) : NaN;
  const minute = m ? Number(m[2]) : NaN;
  if (!m || hour > 23 || minute > 59) throw new Error(`BRIEF_TIME must be HH:MM in 24-hour time (America/Detroit), got "${raw}"`);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const WEEKDAY_ALIASES = new Map<string, Weekday>(
  WEEKDAYS.flatMap((d) => {
    const full = { Sun: "sunday", Mon: "monday", Tue: "tuesday", Wed: "wednesday", Thu: "thursday", Fri: "friday", Sat: "saturday" }[d];
    return [
      [d.toLowerCase(), d],
      [full, d],
    ] as [string, Weekday][];
  }),
);

function weekdayOf(token: string): Weekday {
  const day = WEEKDAY_ALIASES.get(token.trim().toLowerCase());
  if (!day) throw new Error(`BRIEF_DAYS: unknown day "${token}" (use Mon,Tue,… / Mon-Fri / weekdays / daily)`);
  return day;
}

/**
 * BRIEF_DAYS: `daily` (every day), `weekdays` / unset (Mon–Fri), a comma list (`Mon,Wed,Fri`) or ranges
 * (`Mon-Thu`, `Fri-Mon` wraps). Case-insensitive, full names accepted. Result is in week order.
 */
export function parseBriefDays(raw: string | undefined): Weekday[] {
  const s = (raw ?? "").trim();
  const lower = s.toLowerCase();
  if (lower.length === 0 || lower === "weekdays" || lower === "mon-fri") return [...WEEKDAYS_MON_FRI];
  if (lower === "daily" || lower === "all" || lower === "everyday" || lower === "every day") return [...WEEKDAYS];
  const picked = new Set<Weekday>();
  for (const part of s.split(",")) {
    const token = part.trim();
    if (token.length === 0) continue;
    const range = /^([a-z]+)\s*-\s*([a-z]+)$/i.exec(token);
    if (range && range[1] && range[2]) {
      let index = WEEKDAYS.indexOf(weekdayOf(range[1]));
      const end = WEEKDAYS.indexOf(weekdayOf(range[2]));
      for (let guard = 0; guard < 7; guard++) {
        const day = WEEKDAYS[index];
        if (day) picked.add(day);
        if (index === end) break;
        index = (index + 1) % 7;
      }
    } else {
      picked.add(weekdayOf(token));
    }
  }
  if (picked.size === 0) return [...WEEKDAYS_MON_FRI];
  return WEEKDAYS.filter((d) => picked.has(d));
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export interface LocalClock {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, 24-hour */
  time: string;
  weekday: Weekday;
}

/** Wall-clock date, time and weekday of `now` in `timeZone` (default America/Detroit), DST included. */
export function localClock(now: Date, timeZone: string = DETROIT_TZ): LocalClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday") as Weekday;
  if (!WEEKDAYS.includes(weekday)) throw new Error(`Unexpected weekday from Intl: "${weekday}"`);
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}`, weekday };
}

export interface ShouldRunOptions {
  now: Date;
  /** `settings.daily_brief_last_run_date` (YYYY-MM-DD in the same zone) or null when it never ran. */
  lastRunDate: string | null;
  /** HH:MM local. */
  time: string;
  days: readonly Weekday[];
  /** Default America/Detroit. */
  timeZone?: string;
}

/**
 * True when the brief is due: today (local) is one of `days`, the local time is at or past `time`, and
 * the last run was before today. Pure — the scheduler and its tests call it with fixed dates.
 */
export function shouldRunNow(options: ShouldRunOptions): boolean {
  const local = localClock(options.now, options.timeZone ?? DETROIT_TZ);
  if (!options.days.includes(local.weekday)) return false;
  if (local.time < options.time) return false;
  if (options.lastRunDate !== null && options.lastRunDate >= local.date) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export interface BriefSchedulerDeps {
  repo: Repo;
  sender: EmailSender;
  /** Recipient (BRIEF_EMAIL_TO). */
  to: string;
  /** HH:MM local (BRIEF_TIME). */
  time: string;
  days: readonly Weekday[];
  sections?: readonly BriefSectionKey[] | null;
  scope?: BriefScope;
  /** Default 60 s. */
  intervalMs?: number;
  /** Wait this long before retrying after a failed run (default 10 min) so a broken run does not log every minute. */
  retryDelayMs?: number;
  /** Clock override for tests. */
  now?: () => Date;
  log?: (line: string) => void;
  /** Also tick right away (default true) — a server booting after 07:00 catches up without waiting a minute. */
  runOnStart?: boolean;
  timeZone?: string;
}

export interface BriefScheduler {
  /** One scheduler pass; resolves true when a brief was generated. Safe to call by hand (tests, boot). */
  tick(): Promise<boolean>;
  stop(): void;
}

export function startBriefScheduler(deps: BriefSchedulerDeps): BriefScheduler {
  const log = deps.log ?? console.log;
  const clock = deps.now ?? (() => new Date());
  const intervalMs = deps.intervalMs ?? 60_000;
  const retryDelayMs = deps.retryDelayMs ?? 10 * 60_000;
  let running = false;
  let lastFailureAt: number | null = null;

  const tick = async (): Promise<boolean> => {
    if (running) return false;
    running = true;
    try {
      const now = clock();
      if (lastFailureAt !== null && now.getTime() - lastFailureAt < retryDelayMs) return false;
      const lastRunDate = deps.repo.getSetting(BRIEF_SETTING_KEYS.lastRunDate);
      if (!shouldRunNow({ now, lastRunDate, time: deps.time, days: deps.days, timeZone: deps.timeZone })) return false;
      await runDailyBrief({ repo: deps.repo, sender: deps.sender, to: deps.to, sections: deps.sections, scope: deps.scope, now, log });
      lastFailureAt = null;
      return true;
    } catch (err) {
      lastFailureAt = clock().getTime();
      log(`[brief] daily brief run failed (retry in ${Math.round(retryDelayMs / 60_000)} min): ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  if (deps.runOnStart ?? true) setTimeout(() => void tick(), 0).unref();

  return {
    tick,
    stop: () => clearInterval(timer),
  };
}
