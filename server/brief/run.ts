/**
 * server/brief/run.ts — one run of the daily brief: build → store (briefs, kind "daily") → email.
 *
 * Shared by the scheduler, `POST /api/briefs/daily/run` and the MCP tool `run_daily_brief`. The run
 * date is recorded in `settings` (`daily_brief_last_run_date`, Detroit YYYY-MM-DD) so the scheduler
 * never generates twice for one day; an email failure is caught, logged and recorded
 * (`daily_brief_last_email_error`) — it never fails the run, the brief is already on the Briefs page.
 */
import type { BriefScope, BriefSectionKey, DailyBriefRunResult, DailyBriefStatus } from "../../shared/types";
import type { Config } from "../config";
import { nowISO, todayISO } from "../db/index";
import type { Repo } from "../db/repo";
import { buildDailyBrief } from "./build";
import type { EmailSender } from "./email";

// The two payload types live in shared/types.ts (the client reads them); re-exported for the tests and callers here.
export type { DailyBriefRunResult, DailyBriefStatus };

export const BRIEF_SETTING_KEYS = {
  /** YYYY-MM-DD (America/Detroit) of the last generated brief. */
  lastRunDate: "daily_brief_last_run_date",
  /** ISO timestamp of the last generated brief. */
  lastRunAt: "daily_brief_last_run_at",
  /** Message of the last failed email attempt; removed when an email goes through. */
  lastEmailError: "daily_brief_last_email_error",
  /** ISO timestamp of the last email that went through. */
  lastEmailedAt: "daily_brief_last_emailed_at",
} as const;

export interface RunDailyBriefDeps {
  repo: Repo;
  sender: EmailSender;
  /** Recipient (BRIEF_EMAIL_TO). */
  to: string;
  sections?: readonly BriefSectionKey[] | null;
  scope?: BriefScope;
  /** Clock override for tests. */
  now?: Date;
  log?: (line: string) => void;
}

export async function runDailyBrief(deps: RunDailyBriefDeps): Promise<DailyBriefRunResult> {
  const { repo, sender, to } = deps;
  const log = deps.log ?? console.log;
  const now = deps.now ?? new Date();
  const today = todayISO(now);
  const content = buildDailyBrief(repo, { todayISO: today, now, sections: deps.sections ?? null, scope: deps.scope ?? "all" });

  const brief = repo.transaction(() => {
    const stored = repo.createBrief({ kind: "daily", title: content.title, bodyMd: content.bodyMd });
    repo.setSetting(BRIEF_SETTING_KEYS.lastRunDate, today);
    repo.setSetting(BRIEF_SETTING_KEYS.lastRunAt, now.toISOString());
    return stored;
  });

  let emailed = false;
  let emailError: string | null = null;
  let emailNote: string;
  try {
    const result = await sender.send({ to, subject: content.title, text: content.plainText, html: content.html });
    emailed = result.sent;
    if (emailed) {
      repo.setSetting(BRIEF_SETTING_KEYS.lastEmailedAt, nowISO());
      repo.setSetting(BRIEF_SETTING_KEYS.lastEmailError, null);
      emailNote = `emailed to ${to}${result.id ? ` (${result.id})` : ""}`;
    } else {
      emailNote = "email not configured";
    }
  } catch (err) {
    emailError = err instanceof Error ? err.message : String(err);
    repo.setSetting(BRIEF_SETTING_KEYS.lastEmailError, emailError);
    emailNote = `email to ${to} failed: ${emailError}`;
  }
  log(`[brief] ${content.title} stored (${brief.id}); ${emailNote}`);
  return { brief, emailed, emailError };
}

export function getDailyBriefStatus(
  repo: Repo,
  config: Pick<Config, "briefEnabled" | "briefTime" | "briefDays" | "briefSections" | "briefScope" | "briefEmailTo">,
  sender: EmailSender,
): DailyBriefStatus {
  return {
    enabled: config.briefEnabled,
    time: config.briefTime,
    days: [...config.briefDays],
    sections: config.briefSections ? [...config.briefSections] : null,
    scope: config.briefScope,
    lastRunDate: repo.getSetting(BRIEF_SETTING_KEYS.lastRunDate),
    lastRunAt: repo.getSetting(BRIEF_SETTING_KEYS.lastRunAt),
    lastEmailError: repo.getSetting(BRIEF_SETTING_KEYS.lastEmailError),
    lastEmailedAt: repo.getSetting(BRIEF_SETTING_KEYS.lastEmailedAt),
    emailConfigured: sender.configured,
    to: config.briefEmailTo,
  };
}
