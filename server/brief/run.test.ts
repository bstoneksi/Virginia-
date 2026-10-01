import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDraft } from "../../shared/types";
import { openDatabase, todayISO } from "../db/index";
import { ValidationError, createRepo } from "../db/repo";
import { testConfig, exampleSeed } from "../lib/testing";
import type { EmailMessage, EmailSender } from "./email";
import { createNoopSender } from "./email";
import { BRIEF_SETTING_KEYS, getDailyBriefStatus, runDailyBrief } from "./run";

function capturingSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    configured: true,
    description: "capturing",
    sent,
    async send(message) {
      sent.push(message);
      return { sent: true, id: `id-${sent.length}` };
    },
  };
}

describe("repo additions: settings and latestBrief", () => {
  it("get / set / delete settings", () => {
    const repo = createRepo(openDatabase(":memory:", { seed: exampleSeed }));
    assert.equal(repo.getSetting("x"), null);
    repo.setSetting("x", "1");
    assert.equal(repo.getSetting("x"), "1");
    repo.setSetting("x", "2");
    assert.equal(repo.getSetting("x"), "2");
    repo.setSetting("y", "");
    assert.equal(repo.getSetting("y"), "");
    repo.setSetting("x", null);
    assert.equal(repo.getSetting("x"), null);
    repo.setSetting("x", null);
    assert.throws(() => repo.setSetting("  ", "v"), ValidationError);
  });

  it("latestBrief picks the newest of a kind, optionally since an instant", () => {
    const repo = createRepo(openDatabase(":memory:", { seed: exampleSeed }));
    assert.equal(repo.latestBrief("email_digest"), null);
    const a = repo.createBrief({ kind: "email_digest", title: "A", bodyMd: "" });
    const b = repo.createBrief({ kind: "daily", title: "B", bodyMd: "" });
    const c = repo.createBrief({ kind: "email_digest", title: "C", bodyMd: "" });
    assert.equal(repo.latestBrief("email_digest")?.id, c.id);
    assert.equal(repo.latestBrief("daily")?.id, b.id);
    assert.equal(repo.latestBrief("other"), null);
    assert.equal(repo.latestBrief("email_digest", "2000-01-01T00:00:00.000Z")?.id, c.id);
    assert.equal(repo.latestBrief("email_digest", "2999-01-01T00:00:00.000Z"), null);
    assert.equal(repo.latestBrief("email_digest", a.createdAt)?.id, c.id);
    assert.throws(() => repo.latestBrief("memo" as "daily"), ValidationError);
  });
});

describe("runDailyBrief", () => {
  it("stores a daily brief, records the run in settings and emails it with the title as subject", async () => {
    const repo = createRepo(openDatabase(":memory:", { seed: exampleSeed }));
    repo.createItem(emptyDraft({ title: "Late thing", dueDate: "2020-01-01" }));
    const sender = capturingSender();
    const lines: string[] = [];
    const now = new Date("2026-10-01T11:00:00Z");

    const result = await runDailyBrief({ repo, sender, to: "bstone@teamksi.com", now, log: (l) => lines.push(l) });

    assert.equal(result.emailed, true);
    assert.equal(result.emailError, null);
    assert.equal(result.brief.kind, "daily");
    assert.equal(result.brief.title, "Daily brief — Thu, Oct 1");
    assert.ok(result.brief.bodyMd.includes("## Overdue (1)\n- Late thing — due Jan 1, 2020"), result.brief.bodyMd);
    assert.deepEqual(repo.listBriefs().map((b) => b.id), [result.brief.id]);

    assert.equal(repo.getSetting(BRIEF_SETTING_KEYS.lastRunDate), "2026-10-01");
    assert.equal(repo.getSetting(BRIEF_SETTING_KEYS.lastRunAt), now.toISOString());
    assert.equal(repo.getSetting(BRIEF_SETTING_KEYS.lastEmailError), null);
    assert.match(repo.getSetting(BRIEF_SETTING_KEYS.lastEmailedAt) ?? "", /^\d{4}-\d{2}-\d{2}T/);

    assert.equal(sender.sent.length, 1);
    const message = sender.sent[0];
    assert.ok(message);
    assert.equal(message.to, "bstone@teamksi.com");
    assert.equal(message.subject, "Daily brief — Thu, Oct 1");
    assert.ok(message.text.startsWith("Daily brief — Thu, Oct 1\n"));
    assert.ok(message.html.startsWith("<!doctype html>"));
    assert.ok(message.html.includes("Late thing"));

    assert.deepEqual(lines, [`[brief] Daily brief — Thu, Oct 1 stored (${result.brief.id}); emailed to bstone@teamksi.com (id-1)`]);
  });

  it("with the noop sender the brief is stored, emailed is false and there is no error", async () => {
    const repo = createRepo(openDatabase(":memory:", { seed: exampleSeed }));
    const lines: string[] = [];
    const result = await runDailyBrief({ repo, sender: createNoopSender(() => undefined), to: "bstone@teamksi.com", log: (l) => lines.push(l) });
    assert.equal(result.emailed, false);
    assert.equal(result.emailError, null);
    assert.equal(repo.listBriefs().length, 1);
    assert.equal(repo.getSetting(BRIEF_SETTING_KEYS.lastRunDate), todayISO());
    assert.equal(repo.getSetting(BRIEF_SETTING_KEYS.lastEmailError), null);
    assert.match(lines[0] ?? "", /; email not configured$/);
  });

  it("catches an email failure, records it, keeps the brief, and clears it after the next success", async () => {
    const repo = createRepo(openDatabase(":memory:", { seed: exampleSeed }));
    const failing: EmailSender = {
      configured: true,
      description: "failing",
      async send() {
        throw new Error("Resend responded 403: You can only send testing emails to your own email address");
      },
    };
    const failed = await runDailyBrief({ repo, sender: failing, to: "someone@else.com", log: () => undefined });
    assert.equal(failed.emailed, false);
    assert.match(failed.emailError ?? "", /^Resend responded 403/);
    assert.equal(repo.listBriefs().length, 1, "the brief is on the Briefs page even when the email failed");
    assert.equal(repo.getSetting(BRIEF_SETTING_KEYS.lastEmailError), failed.emailError);
    assert.equal(repo.getSetting(BRIEF_SETTING_KEYS.lastRunDate), todayISO(), "a failed email still counts as today's run");

    const ok = await runDailyBrief({ repo, sender: capturingSender(), to: "bstone@teamksi.com", log: () => undefined });
    assert.equal(ok.emailed, true);
    assert.equal(repo.getSetting(BRIEF_SETTING_KEYS.lastEmailError), null);
  });

  it("getDailyBriefStatus reflects the config and the recorded settings", async () => {
    const repo = createRepo(openDatabase(":memory:", { seed: exampleSeed }));
    const config = testConfig({ briefEnabled: true, briefTime: "06:30", briefDays: ["Mon", "Wed"], briefSections: ["overdue"], briefScope: "mine", briefEmailTo: "b@teamksi.com" });
    const noop = createNoopSender(() => undefined);
    assert.deepEqual(getDailyBriefStatus(repo, config, noop), {
      enabled: true,
      time: "06:30",
      days: ["Mon", "Wed"],
      sections: ["overdue"],
      scope: "mine",
      lastRunDate: null,
      lastRunAt: null,
      lastEmailError: null,
      lastEmailedAt: null,
      emailConfigured: false,
      to: "b@teamksi.com",
    });

    await runDailyBrief({ repo, sender: capturingSender(), to: config.briefEmailTo, sections: config.briefSections, scope: config.briefScope, now: new Date("2026-10-01T11:00:00Z"), log: () => undefined });
    const status = getDailyBriefStatus(repo, testConfig(), capturingSender());
    assert.equal(status.enabled, false);
    assert.equal(status.sections, null);
    assert.equal(status.lastRunDate, "2026-10-01");
    assert.equal(status.lastRunAt, "2026-10-01T11:00:00.000Z");
    assert.equal(status.emailConfigured, true);
    assert.ok(status.lastEmailedAt);
  });
});
