import assert from "node:assert/strict";
import { exampleSeed } from "../lib/testing";
import { describe, it } from "node:test";
import { openDatabase } from "../db/index";
import { createRepo } from "../db/repo";
import type { Repo } from "../db/repo";
import type { EmailSender } from "./email";
import { createNoopSender } from "./email";
import { BRIEF_SETTING_KEYS } from "./run";
import { WEEKDAYS, WEEKDAYS_MON_FRI, localClock, parseBriefDays, parseBriefTime, shouldRunNow, startBriefScheduler } from "./scheduler";

// America/Detroit is UTC-4 (EDT) from 2026-03-08 02:00 to 2026-11-01 02:00 local, UTC-5 (EST) otherwise.
// 2026-10-01 is a Thursday; 2026-03-08 and 2026-11-01 (the DST switch days) are Sundays.
const at = (iso: string): Date => new Date(iso);
const MON_FRI = WEEKDAYS_MON_FRI;
const DAILY = WEEKDAYS;

describe("localClock", () => {
  it("gives the Detroit wall-clock date, time and weekday across the midnight boundary", () => {
    assert.deepEqual(localClock(at("2026-10-01T11:00:00Z")), { date: "2026-10-01", time: "07:00", weekday: "Thu" });
    assert.deepEqual(localClock(at("2026-10-02T03:59:00Z")), { date: "2026-10-01", time: "23:59", weekday: "Thu" });
    assert.deepEqual(localClock(at("2026-10-02T04:00:00Z")), { date: "2026-10-02", time: "00:00", weekday: "Fri" });
    assert.deepEqual(localClock(at("2026-10-01T12:00:00Z"), "UTC"), { date: "2026-10-01", time: "12:00", weekday: "Thu" });
  });
});

describe("shouldRunNow", () => {
  it("runs at or after 07:00 on a scheduled day when today has not run yet", () => {
    assert.equal(shouldRunNow({ now: at("2026-10-01T10:59:00Z"), lastRunDate: null, time: "07:00", days: MON_FRI }), false, "06:59");
    assert.equal(shouldRunNow({ now: at("2026-10-01T11:00:00Z"), lastRunDate: null, time: "07:00", days: MON_FRI }), true, "07:00 sharp");
    assert.equal(shouldRunNow({ now: at("2026-10-01T11:01:00Z"), lastRunDate: "2026-09-30", time: "07:00", days: MON_FRI }), true, "07:01, ran yesterday");
    assert.equal(shouldRunNow({ now: at("2026-10-01T11:00:00Z"), lastRunDate: "2026-10-01", time: "07:00", days: MON_FRI }), false, "already ran today");
    assert.equal(shouldRunNow({ now: at("2026-10-01T23:00:00Z"), lastRunDate: "2026-10-01", time: "07:00", days: MON_FRI }), false, "never twice a day");
  });

  it("catches up on the first tick after 07:00 when the server slept, but never backfills a missed day", () => {
    assert.equal(shouldRunNow({ now: at("2026-10-01T19:30:00Z"), lastRunDate: "2026-09-30", time: "07:00", days: MON_FRI }), true, "15:30, slept through 07:00");
    assert.equal(shouldRunNow({ now: at("2026-10-01T19:30:00Z"), lastRunDate: "2026-09-28", time: "07:00", days: MON_FRI }), true, "missed two days: one brief, today's");
    assert.equal(shouldRunNow({ now: at("2026-10-01T19:30:00Z"), lastRunDate: null, time: "07:00", days: MON_FRI }), true, "never ran before");
    // Saturday 08:00 after a missed Friday: not a scheduled day, so nothing — Monday 07:00 picks up again.
    assert.equal(shouldRunNow({ now: at("2026-10-03T12:00:00Z"), lastRunDate: "2026-10-01", time: "07:00", days: MON_FRI }), false, "Saturday");
    assert.equal(shouldRunNow({ now: at("2026-10-04T12:00:00Z"), lastRunDate: "2026-10-01", time: "07:00", days: MON_FRI }), false, "Sunday");
    assert.equal(shouldRunNow({ now: at("2026-10-05T11:00:00Z"), lastRunDate: "2026-10-01", time: "07:00", days: MON_FRI }), true, "Monday 07:00");
    assert.equal(shouldRunNow({ now: at("2026-10-03T12:00:00Z"), lastRunDate: "2026-10-02", time: "07:00", days: DAILY }), true, "Saturday counts with BRIEF_DAYS=daily");
  });

  it("uses the Detroit calendar day, not UTC", () => {
    // 2026-10-02T03:59Z is still Oct 1 23:59 in Detroit: today already ran.
    assert.equal(shouldRunNow({ now: at("2026-10-02T03:59:00Z"), lastRunDate: "2026-10-01", time: "07:00", days: MON_FRI }), false);
    // 2026-10-02T04:30Z is Oct 2 00:30 in Detroit: a new day, but before 07:00.
    assert.equal(shouldRunNow({ now: at("2026-10-02T04:30:00Z"), lastRunDate: "2026-10-01", time: "07:00", days: MON_FRI }), false);
    // A clock that went backwards (last run "tomorrow") never double-runs.
    assert.equal(shouldRunNow({ now: at("2026-10-01T15:00:00Z"), lastRunDate: "2026-10-02", time: "07:00", days: MON_FRI }), false);
  });

  it("honours a custom time and day list", () => {
    assert.equal(shouldRunNow({ now: at("2026-10-01T10:29:00Z"), lastRunDate: null, time: "06:30", days: MON_FRI }), false);
    assert.equal(shouldRunNow({ now: at("2026-10-01T10:30:00Z"), lastRunDate: null, time: "06:30", days: MON_FRI }), true);
    assert.equal(shouldRunNow({ now: at("2026-10-01T22:00:00Z"), lastRunDate: null, time: "18:00", days: ["Thu"] }), true);
    assert.equal(shouldRunNow({ now: at("2026-10-01T22:00:00Z"), lastRunDate: null, time: "18:00", days: ["Mon", "Wed", "Fri"] }), false);
  });

  it("follows the wall clock through the DST switches", () => {
    // Spring forward, Sunday 2026-03-08: 07:00 EDT is 11:00Z (the day before, 07:00 EST was 12:00Z).
    assert.equal(shouldRunNow({ now: at("2026-03-07T11:00:00Z"), lastRunDate: null, time: "07:00", days: DAILY }), false, "Sat Mar 7, 06:00 EST");
    assert.equal(shouldRunNow({ now: at("2026-03-07T12:00:00Z"), lastRunDate: null, time: "07:00", days: DAILY }), true, "Sat Mar 7, 07:00 EST");
    assert.equal(shouldRunNow({ now: at("2026-03-08T10:59:00Z"), lastRunDate: "2026-03-07", time: "07:00", days: DAILY }), false, "Sun Mar 8, 06:59 EDT");
    assert.equal(shouldRunNow({ now: at("2026-03-08T11:00:00Z"), lastRunDate: "2026-03-07", time: "07:00", days: DAILY }), true, "Sun Mar 8, 07:00 EDT");
    assert.equal(localClock(at("2026-03-08T11:00:00Z")).time, "07:00");
    // Fall back, Sunday 2026-11-01: 11:00Z is 06:00 EST now, not 07:00 — the brief waits for 12:00Z.
    assert.equal(shouldRunNow({ now: at("2026-11-01T11:00:00Z"), lastRunDate: "2026-10-31", time: "07:00", days: DAILY }), false, "Sun Nov 1, 06:00 EST");
    assert.equal(shouldRunNow({ now: at("2026-11-01T12:00:00Z"), lastRunDate: "2026-10-31", time: "07:00", days: DAILY }), true, "Sun Nov 1, 07:00 EST");
    assert.equal(shouldRunNow({ now: at("2026-11-02T11:30:00Z"), lastRunDate: "2026-11-01", time: "07:00", days: MON_FRI }), false, "Mon Nov 2, 06:30 EST");
    assert.equal(shouldRunNow({ now: at("2026-11-02T12:00:00Z"), lastRunDate: "2026-11-01", time: "07:00", days: MON_FRI }), true, "Mon Nov 2, 07:00 EST");
    // The repeated 01:00–02:00 hour on fall-back day is before 07:00 either way.
    assert.equal(shouldRunNow({ now: at("2026-11-01T05:30:00Z"), lastRunDate: "2026-10-31", time: "07:00", days: DAILY }), false, "01:30 EDT (first pass)");
    assert.equal(shouldRunNow({ now: at("2026-11-01T06:30:00Z"), lastRunDate: "2026-10-31", time: "07:00", days: DAILY }), false, "01:30 EST (second pass)");
  });
});

describe("env parsers", () => {
  it("parseBriefTime accepts HH:MM (zero-padding a short hour) and rejects anything else", () => {
    assert.equal(parseBriefTime(undefined), "07:00");
    assert.equal(parseBriefTime(""), "07:00");
    assert.equal(parseBriefTime("7:00"), "07:00");
    assert.equal(parseBriefTime(" 18:30 "), "18:30");
    assert.equal(parseBriefTime("00:00"), "00:00");
    assert.throws(() => parseBriefTime("24:00"), /BRIEF_TIME/);
    assert.throws(() => parseBriefTime("07:60"), /BRIEF_TIME/);
    assert.throws(() => parseBriefTime("7"), /BRIEF_TIME/);
    assert.throws(() => parseBriefTime("7am"), /BRIEF_TIME/);
  });

  it("parseBriefDays handles the defaults, daily, lists, ranges and full names in week order", () => {
    assert.deepEqual(parseBriefDays(undefined), ["Mon", "Tue", "Wed", "Thu", "Fri"]);
    assert.deepEqual(parseBriefDays("weekdays"), ["Mon", "Tue", "Wed", "Thu", "Fri"]);
    assert.deepEqual(parseBriefDays("Mon-Fri"), ["Mon", "Tue", "Wed", "Thu", "Fri"]);
    assert.deepEqual(parseBriefDays("daily"), [...WEEKDAYS]);
    assert.deepEqual(parseBriefDays("Every day"), [...WEEKDAYS]);
    assert.deepEqual(parseBriefDays("Mon,Wed,Fri"), ["Mon", "Wed", "Fri"]);
    assert.deepEqual(parseBriefDays("fri, mon"), ["Mon", "Fri"]);
    assert.deepEqual(parseBriefDays("Monday, tuesday"), ["Mon", "Tue"]);
    assert.deepEqual(parseBriefDays("Tue-Thu"), ["Tue", "Wed", "Thu"]);
    assert.deepEqual(parseBriefDays("Fri-Mon"), ["Sun", "Mon", "Fri", "Sat"]);
    assert.deepEqual(parseBriefDays("Sat,Sun"), ["Sun", "Sat"]);
    assert.throws(() => parseBriefDays("Funday"), /BRIEF_DAYS: unknown day "Funday"/);
    assert.throws(() => parseBriefDays("Mon-Funday"), /BRIEF_DAYS/);
  });
});

describe("startBriefScheduler", () => {
  const T = (iso: string): Date => new Date(iso);

  it("generates once per scheduled day through tick(), records the run date, and survives an email failure", async () => {
    const db = openDatabase(":memory:", { seed: exampleSeed });
    const repo = createRepo(db);
    let now = T("2026-10-01T10:00:00Z"); // Thu 06:00 EDT
    const lines: string[] = [];
    const failing: EmailSender = {
      configured: true,
      description: "always fails",
      async send() {
        throw new Error("Resend responded 500: boom");
      },
    };
    const scheduler = startBriefScheduler({
      repo,
      sender: failing,
      to: "bstone@teamksi.com",
      time: "07:00",
      days: MON_FRI,
      intervalMs: 3_600_000,
      runOnStart: false,
      now: () => now,
      log: (l) => lines.push(l),
    });
    try {
      assert.equal(await scheduler.tick(), false, "06:00: not yet");
      assert.equal(repo.listBriefs().length, 0);

      now = T("2026-10-01T11:00:00Z"); // 07:00
      assert.equal(await scheduler.tick(), true);
      assert.equal(repo.getSetting(BRIEF_SETTING_KEYS.lastRunDate), "2026-10-01");
      assert.equal(repo.getSetting(BRIEF_SETTING_KEYS.lastRunAt), "2026-10-01T11:00:00.000Z");
      assert.match(repo.getSetting(BRIEF_SETTING_KEYS.lastEmailError) ?? "", /boom/);
      assert.equal(repo.getSetting(BRIEF_SETTING_KEYS.lastEmailedAt), null);
      const [first] = repo.listBriefs();
      assert.equal(first?.kind, "daily");
      assert.equal(first?.title, "Daily brief — Thu, Oct 1");

      now = T("2026-10-01T20:00:00Z"); // 16:00 same day
      assert.equal(await scheduler.tick(), false);
      assert.equal(repo.listBriefs().length, 1);

      now = T("2026-10-02T15:00:00Z"); // Fri 11:00 — the server was asleep at 07:00
      assert.equal(await scheduler.tick(), true, "catches up on the first tick after 07:00");
      assert.equal(repo.listBriefs().length, 2);
      assert.equal(repo.getSetting(BRIEF_SETTING_KEYS.lastRunDate), "2026-10-02");

      now = T("2026-10-03T15:00:00Z"); // Saturday
      assert.equal(await scheduler.tick(), false);
      assert.equal(repo.listBriefs().length, 2);

      const runLines = lines.filter((l) => l.startsWith("[brief] Daily brief"));
      assert.equal(runLines.length, 2, "one log line per run");
      assert.match(runLines[0] ?? "", /^\[brief\] Daily brief — Thu, Oct 1 stored \([0-9a-f-]{36}\); email to bstone@teamksi.com failed: Resend responded 500: boom$/);
    } finally {
      scheduler.stop();
      db.close();
    }
  });

  it("logs a failed run, backs off instead of retrying every minute, and never lets the interval throw", async () => {
    const db = openDatabase(":memory:", { seed: exampleSeed });
    const repo = createRepo(db);
    const broken = Object.assign(Object.create(repo) as Repo, {
      listItems: (): never => {
        throw new Error("db gone");
      },
    });
    let now = T("2026-10-01T11:00:00Z");
    const lines: string[] = [];
    const scheduler = startBriefScheduler({
      repo: broken,
      sender: createNoopSender(() => undefined),
      to: "bstone@teamksi.com",
      time: "07:00",
      days: MON_FRI,
      retryDelayMs: 600_000,
      runOnStart: false,
      now: () => now,
      log: (l) => lines.push(l),
    });
    try {
      assert.equal(await scheduler.tick(), false);
      assert.equal(lines.length, 1);
      assert.match(lines[0] ?? "", /^\[brief\] daily brief run failed \(retry in 10 min\): db gone$/);
      assert.equal(repo.getSetting(BRIEF_SETTING_KEYS.lastRunDate), null, "a failed run is not recorded");

      now = T("2026-10-01T11:05:00Z");
      assert.equal(await scheduler.tick(), false);
      assert.equal(lines.length, 1, "within the back-off window nothing is attempted");

      now = T("2026-10-01T11:11:00Z");
      assert.equal(await scheduler.tick(), false);
      assert.equal(lines.length, 2, "retried after the back-off");
    } finally {
      scheduler.stop();
      db.close();
    }
  });

  it("ticks once right after start by default so a late boot catches up without waiting a minute", async () => {
    const db = openDatabase(":memory:", { seed: exampleSeed });
    const repo = createRepo(db);
    const scheduler = startBriefScheduler({
      repo,
      sender: createNoopSender(() => undefined),
      to: "bstone@teamksi.com",
      time: "07:00",
      days: DAILY,
      intervalMs: 3_600_000,
      now: () => T("2026-10-01T15:00:00Z"),
      log: () => undefined,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(repo.listBriefs().length, 1);
      assert.equal(repo.getSetting(BRIEF_SETTING_KEYS.lastRunDate), "2026-10-01");
    } finally {
      scheduler.stop();
      db.close();
    }
  });
});
