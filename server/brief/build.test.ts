import assert from "node:assert/strict";
import { exampleSeed } from "../lib/testing";
import { describe, it } from "node:test";
import { emptyDraft } from "../../shared/types";
import type { Item, ItemDraft } from "../../shared/types";
import { openDatabase } from "../db/index";
import type { Db } from "../db/index";
import { createRepo } from "../db/repo";
import type { Repo } from "../db/repo";
import {
  BRIEF_SECTION_KEYS,
  buildDailyBrief,
  dailyBriefTitle,
  daysBetween,
  formatDayShort,
  formatLongDate,
  formatWeekdayDay,
  itemLine,
  parseBriefScope,
  parseBriefSections,
} from "./build";

const TODAY = "2026-10-01"; // a Thursday
const NOW = new Date("2026-10-01T11:05:00Z"); // 07:05 EDT

function d(overrides: Partial<ItemDraft>): ItemDraft {
  return emptyDraft({ title: "t", ...overrides });
}

interface Fixture {
  db: Db;
  repo: Repo;
  backdate(item: Item, createdAtISO: string): void;
}

function fixture(): Fixture {
  const db = openDatabase(":memory:", { seed: exampleSeed });
  const repo = createRepo(db);
  return {
    db,
    repo,
    // Test setup only: created_at is written by the repo from the clock, so the "added yesterday" cases are backdated here.
    backdate: (item, iso) => {
      db.prepare("UPDATE items SET created_at = ? WHERE id = ?").run(iso, item.id);
    },
  };
}

/** The scenario every section needs. Returns the created items by role. */
function seedEverything(f: Fixture) {
  const { repo, backdate } = f;
  const crew = repo.createItem(d({ title: "Send the crew schedule", ownerInitials: "VM", divisionCode: "HG", dueDate: "2026-09-29" }));
  backdate(crew, "2026-09-30T03:00:00Z"); // Sep 29 23:00 EDT — two days ago, not "yesterday"
  const memo = repo.createItem(d({ title: "Draft the memo", priority: "High", dueDate: "2026-09-30" }));
  const pitch = repo.createItem(d({ title: "Pitch the glass package", category: "NB", ownerInitials: "VM", divisionCode: "HG", dueDate: TODAY }));
  backdate(pitch, "2026-09-30T18:00:00Z"); // yesterday afternoon
  const passport = repo.createItem(d({ title: "Renew passport", isPersonal: true, dueDate: "2026-10-02" }));
  const weekEnd = repo.createItem(d({ title: "Second week item", ownerInitials: "DK", dueDate: "2026-10-07" })); // today + 6: last day of the window
  const beyond = repo.createItem(d({ title: "Budget review", priority: "High", dueDate: "2026-10-15" })); // outside the window → high priority
  const builder = repo.createItem(d({ title: "Call the builder group", priority: "High", ownerInitials: "DK" }));
  const triage = repo.createItem(d({ title: "Needs triage" }));
  backdate(triage, "2026-10-01T04:00:00Z"); // Oct 1 00:00 EDT — today, not yesterday
  const closed = repo.createItem(d({ title: "Closed yesterday", status: "Done" }));
  backdate(closed, "2026-09-30T20:00:00Z");
  const parked = repo.createItem(d({ title: "Someday signage", status: "Parked", dueDate: "2026-09-01" }));
  const question = repo.createItem(d({ title: "Who owns the Atlas renewal?", category: "Q", ownerInitials: "AG" }));
  backdate(question, "2026-10-01T03:30:00Z"); // Sep 30 23:30 EDT — still yesterday

  repo.createCapture({ kind: "text", title: "1:1 with VM", rawText: "A: x" });
  repo.createCapture({ kind: "transcript", rawText: "long talk", context: "Monday huddle" });
  repo.discardCapture(repo.createCapture({ kind: "text", rawText: "gone" }).id);

  const oldDigest = repo.createBrief({ kind: "email_digest", title: "Inbox digest (old)", bodyMd: "stale" });
  f.db.prepare("UPDATE briefs SET created_at = ? WHERE id = ?").run("2026-09-29T12:00:00Z", oldDigest.id);
  const digest = repo.createBrief({ kind: "email_digest", title: "Inbox digest 6:00 PM", bodyMd: "## Needs Brandon\n- Reply to Doug about <the budget>\n\n## FYI\n- Nothing else" });
  f.db.prepare("UPDATE briefs SET created_at = ? WHERE id = ?").run("2026-09-30T22:02:00Z", digest.id); // Sep 30, 6:02 PM EDT
  repo.createBrief({ kind: "daily", title: "Daily brief — Wed, Sep 30", bodyMd: "yesterday's brief is not a digest" });

  return { crew, memo, pitch, passport, weekEnd, beyond, builder, triage, closed, parked, question, digest };
}

describe("buildDailyBrief", () => {
  it("fills every section from the tracker, in order, with counts and a summary line", () => {
    const f = fixture();
    seedEverything(f);
    const brief = buildDailyBrief(f.repo, { todayISO: TODAY, now: NOW });

    assert.equal(brief.title, "Daily brief — Thu, Oct 1");
    assert.deepEqual(brief.counts, { overdue: 3, dueToday: 1, dueWeek: 2, highPriority: 2, needsOwner: 1, review: 2, addedYesterday: 3, digest: 1 });

    const md = brief.bodyMd;
    assert.ok(md.startsWith("Good morning, Brandon. Thursday, October 1, 2026.\n\n**3 overdue · 1 due today · 2 due this week · 2 high priority · 1 needs an owner · 2 captures to review · 3 added yesterday**\n\n## Overdue (3)\n"), md);
    assert.ok(!md.includes("# Daily brief"), "the title is not repeated inside the body (the Briefs page shows it)");

    // Headings in BRIEF_SECTION_KEYS order; the quoted digest keeps its own headings after the last one (verbatim).
    const headings = md.split("\n").filter((l) => l.startsWith("## "));
    assert.deepEqual(headings, [
      "## Overdue (3)",
      "## Due today (1)",
      "## Due this week (2)",
      "## High priority (2)",
      "## Needs an owner (1)",
      "## Waiting for review (2)",
      "## Added yesterday (3)",
      "## Latest email digest",
      "## Needs Brandon",
      "## FYI",
    ]);

    // Overdue: due date ascending, owner initials, division, status when not Open, days late.
    assert.ok(md.includes("## Overdue (3)\n- Someday signage — Parked · due Sep 1 (30 days late)\n- Send the crew schedule — VM · HG · due Sep 29 (2 days late)\n- Draft the memo — High · due Sep 30 (1 day late)\n"), md);
    // Due today: the NB tag is shown, the due date is implied.
    assert.ok(md.includes("## Due today (1)\n- NB: Pitch the glass package — VM · HG\n"), md);
    // Due this week: next six days, each prefixed with its weekday; personal items say so.
    assert.ok(md.includes("## Due this week (2)\n- Fri, Oct 2: Renew passport — personal\n- Wed, Oct 7: Second week item — DK\n"), md);
    // High priority: only items not already listed above (the High overdue memo is not repeated).
    assert.ok(md.includes("## High priority (2)\n- Budget review — High · due Oct 15\n- Call the builder group — DK · High\n"), md);
    assert.equal(md.match(/Draft the memo/g)?.length, 1);
    // Needs an owner: unowned, un-branded, active — items already taken by a bucket above are not repeated.
    assert.ok(md.includes("## Needs an owner (1)\n- Needs triage\n"), md);
    // Waiting for review: pending captures only (the discarded one is gone), titled or "Untitled <kind>".
    assert.ok(md.includes("## Waiting for review (2)\n"), md);
    assert.ok(md.includes("- 1:1 with VM — 0 to review · added "), md);
    assert.ok(md.includes("- Untitled transcript — 0 to review · Monday huddle · added "), md);
    assert.ok(!md.includes("gone"));
    // Added yesterday: Detroit calendar day, oldest first, Done items marked.
    assert.ok(md.includes("## Added yesterday (3)\n- NB: Pitch the glass package — VM · HG · due Oct 1\n- Closed yesterday — Done\n- Q: Who owns the Atlas renewal? — AG\n"), md);
    assert.ok(!md.includes("## Added yesterday (3)\n- Send the crew"), "two days ago is not yesterday");
    // Digest: the newest email_digest of the last 24 h, verbatim, under its own heading; older digests and daily briefs are ignored.
    assert.ok(md.includes("## Latest email digest\n**Inbox digest 6:00 PM** · Sep 30, 6:02 PM\n\n## Needs Brandon\n- Reply to Doug about <the budget>\n\n## FYI\n- Nothing else\n"), md);
    assert.ok(!md.includes("stale"));
    assert.ok(!md.includes("yesterday's brief"));
    assert.ok(md.endsWith("_Built by Virginia at Oct 1, 7:05 AM._"), md.slice(-80));

    // Derived formats.
    assert.ok(brief.plainText.startsWith("Daily brief — Thu, Oct 1\n========================\n\nGood morning, Brandon."), brief.plainText.slice(0, 120));
    assert.ok(brief.plainText.includes("Overdue (3)\n-----------\n\n- Someday signage — Parked · due Sep 1 (30 days late)"));
    assert.ok(!brief.plainText.includes("**"));
    assert.ok(brief.html.startsWith("<!doctype html>"));
    assert.ok(brief.html.includes("<h1 style="));
    assert.ok(brief.html.includes("Daily brief — Thu, Oct 1</h1>"));
    assert.ok(brief.html.includes("Reply to Doug about &lt;the budget&gt;"), "digest text is escaped in the HTML part");
    assert.ok(!brief.html.includes("<the budget>"));
  });

  it("says Nothing in one line per empty section and No digest yet", () => {
    const f = fixture();
    const brief = buildDailyBrief(f.repo, { todayISO: TODAY, now: NOW });
    assert.deepEqual(Object.values(brief.counts), [0, 0, 0, 0, 0, 0, 0, 0]);
    assert.ok(brief.bodyMd.includes("Nothing overdue, nothing due, nothing waiting — a clear day."));
    for (const heading of ["Overdue", "Due today", "Due this week", "High priority", "Needs an owner", "Waiting for review", "Added yesterday"]) {
      assert.ok(brief.bodyMd.includes(`## ${heading}\nNothing.\n`), heading);
    }
    assert.ok(brief.bodyMd.includes("## Latest email digest\nNo digest yet.\n"));
    assert.equal(brief.bodyMd.match(/^## /gm)?.length, BRIEF_SECTION_KEYS.length);
  });

  it("toggles and orders sections, takes an explicit digest, and greets by the Detroit hour", () => {
    const f = fixture();
    const seeded = seedEverything(f);
    const trimmed = buildDailyBrief(f.repo, { todayISO: TODAY, now: NOW, sections: ["digest", "overdue"], emailDigest: null });
    assert.deepEqual(
      trimmed.bodyMd.split("\n").filter((l) => l.startsWith("## ")),
      ["## Latest email digest", "## Overdue (3)"],
    );
    assert.ok(trimmed.bodyMd.includes("No digest yet."));
    assert.ok(trimmed.bodyMd.includes("**3 overdue**"), "the summary only counts the sections that are on");
    assert.equal(trimmed.counts.dueToday, 0);

    const explicit = buildDailyBrief(f.repo, { todayISO: TODAY, now: NOW, sections: ["digest"], emailDigest: { ...seeded.digest, title: "Handed in", bodyMd: "verbatim body" } });
    assert.ok(explicit.bodyMd.includes("**Handed in** ·"));
    assert.ok(explicit.bodyMd.includes("\nverbatim body\n"));

    const afternoon = buildDailyBrief(f.repo, { todayISO: TODAY, now: new Date("2026-10-01T19:00:00Z"), sections: ["overdue"] }); // 15:00 EDT
    assert.ok(afternoon.bodyMd.startsWith("Good afternoon, Brandon."));
    const evening = buildDailyBrief(f.repo, { todayISO: TODAY, now: new Date("2026-10-02T01:00:00Z"), sections: ["overdue"] }); // 21:00 EDT
    assert.ok(evening.bodyMd.startsWith("Good evening, Brandon."));
  });

  it("scope mine keeps Brandon's own and unowned items only, like the Today page", () => {
    const f = fixture();
    seedEverything(f);
    const mine = buildDailyBrief(f.repo, { todayISO: TODAY, now: NOW, scope: "mine" });
    assert.equal(mine.counts.overdue, 2);
    assert.ok(mine.bodyMd.includes("- Draft the memo — High"));
    assert.ok(!mine.bodyMd.includes("Send the crew schedule"), "Vince's overdue item is not Brandon's");
    assert.equal(mine.counts.dueToday, 0, "the NB for Vince is not Brandon's");
    assert.deepEqual(mine.counts.highPriority, 1, "DK's High item drops out; the unowned Budget review stays");
    assert.equal(mine.counts.needsOwner, 1);
  });

  it("greets without a name when nobody is marked as me", () => {
    const f = fixture();
    const me = f.repo.getMe();
    assert.ok(me);
    f.repo.updatePerson(me.id, { isMe: false });
    const brief = buildDailyBrief(f.repo, { todayISO: TODAY, now: NOW });
    assert.ok(brief.bodyMd.startsWith("Good morning. Thursday, October 1, 2026."));
  });
});

describe("brief helpers", () => {
  it("formats calendar dates without zone drift", () => {
    assert.equal(dailyBriefTitle("2026-10-01"), "Daily brief — Thu, Oct 1");
    assert.equal(dailyBriefTitle("2026-12-31"), "Daily brief — Thu, Dec 31");
    assert.equal(formatDayShort("2026-09-29"), "Sep 29");
    assert.equal(formatWeekdayDay("2026-10-02"), "Fri, Oct 2");
    assert.equal(formatLongDate("2026-10-01"), "Thursday, October 1, 2026");
    assert.equal(daysBetween("2026-09-29", "2026-10-01"), 2);
    assert.equal(daysBetween("2026-10-01", "2026-09-29"), -2);
    assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2, "DST weekend is still two days");
  });

  it("builds item lines per mode", () => {
    const base: Item = {
      id: "1",
      category: "A",
      title: "  Send the quote ",
      note: "",
      divisionCode: "HG",
      ownerInitials: "VM",
      initiativeId: null,
      priority: "High",
      status: "In Progress",
      dueDate: "2026-09-28",
      rank: 0,
      isPersonal: false,
      context: null,
      sourceCaptureId: null,
      createdAt: "2026-09-30T12:00:00Z",
      updatedAt: "2026-09-30T12:00:00Z",
      completedAt: null,
    };
    assert.equal(itemLine(base, TODAY, "overdue"), "Send the quote — VM · HG · High · In Progress · due Sep 28 (3 days late)");
    assert.equal(itemLine(base, TODAY, "today"), "Send the quote — VM · HG · High · In Progress");
    assert.equal(itemLine(base, TODAY, "week"), "Send the quote — VM · HG · High · In Progress");
    assert.equal(itemLine(base, TODAY, "plain"), "Send the quote — VM · HG · High · In Progress · due Sep 28");
    assert.equal(itemLine({ ...base, category: "W", ownerInitials: null, divisionCode: null, isPersonal: true, priority: "Low", status: "Open", dueDate: null }, TODAY, "plain"), "W: Send the quote — personal");
    assert.equal(itemLine({ ...base, ownerInitials: null, divisionCode: null, priority: "Medium", status: "Open", dueDate: null }, TODAY, "plain"), "Send the quote");
  });

  it("parses BRIEF_SECTIONS and BRIEF_SCOPE", () => {
    assert.equal(parseBriefSections(undefined), null);
    assert.equal(parseBriefSections(""), null);
    assert.equal(parseBriefSections(" , "), null);
    assert.deepEqual(parseBriefSections("overdue, due-today,DIGEST,overdue"), ["overdue", "dueToday", "digest"]);
    assert.deepEqual(parseBriefSections("needs_owner,added yesterday"), ["needsOwner", "addedYesterday"]);
    assert.throws(() => parseBriefSections("overdue,nope"), /BRIEF_SECTIONS: unknown section "nope"/);
    assert.equal(parseBriefScope(undefined), "all");
    assert.equal(parseBriefScope(" ALL "), "all");
    assert.equal(parseBriefScope("mine"), "mine");
    assert.throws(() => parseBriefScope("everyone"), /BRIEF_SCOPE/);
  });
});
