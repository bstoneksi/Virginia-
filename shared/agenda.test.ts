import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DUE_SOON_DAYS,
  addDaysISO,
  agendaToMarkdown,
  compareAgendaItems,
  formatDateDetroit,
  groupForAgenda,
  itemToBullet,
  todayBuckets,
} from "./agenda";
import type { AgendaSubject, Item } from "./types";

let seq = 0;
function mk(overrides: Partial<Item> = {}): Item {
  seq += 1;
  return {
    id: `item-${String(seq).padStart(3, "0")}`,
    category: "A",
    title: `Item ${seq}`,
    note: "",
    divisionCode: null,
    ownerInitials: null,
    initiativeId: null,
    priority: "Medium",
    status: "Open",
    dueDate: null,
    rank: seq,
    isPersonal: false,
    context: null,
    sourceCaptureId: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

const TODAY = "2026-09-30";
const VM: AgendaSubject = { type: "person", key: "VM", label: "Vincent Moynihan" };

describe("groupForAgenda", () => {
  it("orders groups by CATEGORY_ORDER and omits empty groups", () => {
    const groups = groupForAgenda([mk({ category: "D" }), mk({ category: "A" }), mk({ category: "NB", divisionCode: "HG" })]);
    assert.deepEqual(
      groups.map((g) => g.category),
      ["NB", "A", "D"],
    );
  });

  it("sorts active items by priority, then due date (nulls last), then rank", () => {
    const a = mk({ priority: "Low", rank: 1 });
    const b = mk({ priority: "High", rank: 5 });
    const c = mk({ priority: "High", dueDate: "2026-10-05", rank: 9 });
    const d = mk({ priority: "High", dueDate: "2026-10-01", rank: 3 });
    const e = mk({ priority: "Medium", rank: 0 });
    const [group] = groupForAgenda([a, b, c, d, e]);
    assert.ok(group);
    assert.deepEqual(
      group.active.map((i) => i.id),
      [d.id, c.id, b.id, e.id, a.id],
    );
  });

  it("uses rank to break ties and keeps the order stable", () => {
    const later = mk({ priority: "High", rank: 7 });
    const earlier = mk({ priority: "High", rank: 2 });
    const [group] = groupForAgenda([later, earlier]);
    assert.deepEqual(group?.active.map((i) => i.id), [earlier.id, later.id]);
    assert.ok(compareAgendaItems(earlier, later) < 0);
  });

  it("separates parked items, treats In Progress as active and hides Done unless includeDone", () => {
    const open = mk({ status: "Open" });
    const progress = mk({ status: "In Progress", priority: "High" });
    const parked = mk({ status: "Parked" });
    const doneOld = mk({ status: "Done", completedAt: "2026-09-10T00:00:00.000Z" });
    const doneNew = mk({ status: "Done", completedAt: "2026-09-20T00:00:00.000Z" });
    const items = [open, progress, parked, doneOld, doneNew];

    const [without] = groupForAgenda(items);
    assert.ok(without);
    assert.deepEqual(without.active.map((i) => i.id), [progress.id, open.id]);
    assert.deepEqual(without.parked.map((i) => i.id), [parked.id]);
    assert.deepEqual(without.done, []);

    const [withDone] = groupForAgenda(items, { includeDone: true });
    assert.deepEqual(withDone?.done.map((i) => i.id), [doneNew.id, doneOld.id]);
  });

  it("omits a group whose only items are Done when includeDone is false", () => {
    assert.deepEqual(groupForAgenda([mk({ category: "Q", status: "Done" })]), []);
    assert.equal(groupForAgenda([mk({ category: "Q", status: "Done" })], { includeDone: true }).length, 1);
  });

  it("returns no groups for no items", () => {
    assert.deepEqual(groupForAgenda([]), []);
  });
});

describe("agendaToMarkdown", () => {
  it("renders heading, sections, bullets, notes and the parked sub-list", () => {
    const items = [
      mk({ category: "NB", title: "Pitch the glass package", ownerInitials: "VM", dueDate: "2026-10-03", priority: "High", note: "Bring the Q3 numbers" }),
      mk({ category: "NB", title: "Old idea", ownerInitials: "VM", priority: "Low", status: "Parked" }),
      mk({ category: "A", title: "Call the installer" }),
    ];
    const md = agendaToMarkdown({ subject: VM, groups: groupForAgenda(items), generatedAt: "2026-09-30T20:00:00.000Z" });
    assert.equal(
      md,
      [
        "# Agenda — Vincent Moynihan (2026-09-30)",
        "",
        "## New Business",
        "- [High] Pitch the glass package — VM, due 2026-10-03",
        "  Bring the Q3 numbers",
        "- Parked:",
        "  - [Low] Old idea — VM",
        "",
        "## Action",
        "- [Medium] Call the installer",
      ].join("\n"),
    );
  });

  it("formats the heading date in America/Detroit", () => {
    // 03:30 UTC on Oct 1 is still 23:30 on Sep 30 in Detroit (EDT).
    const md = agendaToMarkdown({ subject: VM, groups: [], generatedAt: "2026-10-01T03:30:00.000Z" });
    assert.match(md, /^# Agenda — Vincent Moynihan \(2026-09-30\)/);
    assert.equal(formatDateDetroit("not a date"), "not a date".slice(0, 10));
  });

  it("says so when there is nothing to show", () => {
    const md = agendaToMarkdown({ subject: VM, groups: [], generatedAt: "2026-09-30T20:00:00.000Z" });
    assert.equal(md, "# Agenda — Vincent Moynihan (2026-09-30)\n\n_No open items._");
  });

  it("indents every line of a multi-line note and never leaves trailing whitespace", () => {
    const items = [mk({ title: "Fix the door  ", note: "line one   \n\n  line two\t" }), mk({ status: "Parked", note: "parked note" })];
    const md = agendaToMarkdown({ subject: VM, groups: groupForAgenda(items), generatedAt: "2026-09-30T20:00:00.000Z" });
    assert.ok(md.includes("- [Medium] Fix the door\n  line one\n  line two\n"));
    assert.ok(md.includes("- Parked:\n  - [Medium] Item"));
    assert.ok(md.includes("\n    parked note"));
    assert.equal(/[ \t]+$/m.test(md), false, "no trailing whitespace on any line");
    assert.equal(md, md.trimEnd());
  });

  it("adds a Done sub-list when done items are included", () => {
    const items = [mk({ title: "Live" }), mk({ title: "Finished", status: "Done", completedAt: "2026-09-20T00:00:00.000Z" })];
    const md = agendaToMarkdown({ subject: VM, groups: groupForAgenda(items, { includeDone: true }), generatedAt: "2026-09-30T20:00:00.000Z" });
    assert.ok(md.endsWith("- Done:\n  - [Medium] Finished"));
  });

  it("omits owner and due date from the bullet when absent", () => {
    assert.equal(itemToBullet(mk({ title: "Bare", priority: "Low" })), "[Low] Bare");
    assert.equal(itemToBullet(mk({ title: "Due only", dueDate: "2026-10-10" })), "[Medium] Due only — due 2026-10-10");
    assert.equal(itemToBullet(mk({ title: "Owner only", ownerInitials: "DK" })), "[Medium] Owner only — DK");
  });
});

describe("todayBuckets", () => {
  it("puts past-due, not-Done items in overdue (including Parked) and sorts by due date", () => {
    const older = mk({ dueDate: "2026-09-01" });
    const newer = mk({ dueDate: "2026-09-29", status: "Parked" });
    const done = mk({ dueDate: "2026-09-01", status: "Done" });
    const view = todayBuckets([newer, older, done], TODAY, "BS");
    assert.deepEqual(view.overdue.map((i) => i.id), [older.id, newer.id]);
    assert.equal(view.dueSoon.length + view.highPriority.length + view.unowned.length, 0);
  });

  it("dueSoon covers today through today + 6 and not beyond", () => {
    const today = mk({ dueDate: TODAY, ownerInitials: "BS" });
    const edge = mk({ dueDate: addDaysISO(TODAY, DUE_SOON_DAYS - 1), ownerInitials: "BS" });
    const beyond = mk({ dueDate: addDaysISO(TODAY, DUE_SOON_DAYS), ownerInitials: "BS" });
    const view = todayBuckets([beyond, edge, today], TODAY, "BS");
    assert.deepEqual(view.dueSoon.map((i) => i.id), [today.id, edge.id]);
    assert.equal(view.overdue.length, 0);
    assert.equal(view.highPriority.length, 0);
    assert.equal(view.unowned.length, 0);
  });

  it("highPriority holds High + active items that were not already bucketed", () => {
    const plain = mk({ priority: "High", ownerInitials: "BS" });
    const overdue = mk({ priority: "High", dueDate: "2026-09-01", ownerInitials: "BS" });
    const parked = mk({ priority: "High", status: "Parked", ownerInitials: "BS" });
    const done = mk({ priority: "High", status: "Done" });
    const view = todayBuckets([plain, overdue, parked, done], TODAY, "BS");
    assert.deepEqual(view.overdue.map((i) => i.id), [overdue.id]);
    assert.deepEqual(view.highPriority.map((i) => i.id), [plain.id]);
  });

  it("unowned = active, no owner, no division, not personal", () => {
    const unowned = mk();
    const withDivision = mk({ divisionCode: "HG" });
    const personal = mk({ isPersonal: true });
    const owned = mk({ ownerInitials: "VM" });
    const parked = mk({ status: "Parked" });
    const view = todayBuckets([unowned, withDivision, personal, owned, parked], TODAY, "BS");
    assert.deepEqual(view.unowned.map((i) => i.id), [unowned.id]);
  });

  it("places each item in exactly one bucket", () => {
    const highUnowned = mk({ priority: "High" });
    const dueSoonUnowned = mk({ dueDate: TODAY });
    const view = todayBuckets([highUnowned, dueSoonUnowned], TODAY, "BS");
    assert.deepEqual(view.highPriority.map((i) => i.id), [highUnowned.id]);
    assert.deepEqual(view.dueSoon.map((i) => i.id), [dueSoonUnowned.id]);
    assert.deepEqual(view.unowned, []);
    const all = [...view.overdue, ...view.dueSoon, ...view.highPriority, ...view.unowned].map((i) => i.id);
    assert.equal(new Set(all).size, all.length);
  });

  it("applies the 'me' filter to overdue / dueSoon / highPriority: mine or unowned", () => {
    const mine = mk({ dueDate: "2026-09-01", ownerInitials: "BS" });
    const nobody = mk({ dueDate: "2026-09-01" });
    const vince = mk({ dueDate: "2026-09-01", ownerInitials: "VM" });
    const vinceHigh = mk({ priority: "High", ownerInitials: "VM" });
    const vinceSoon = mk({ dueDate: TODAY, ownerInitials: "VM" });
    const items = [mine, nobody, vince, vinceHigh, vinceSoon];

    const view = todayBuckets(items, TODAY, "BS");
    assert.deepEqual(view.overdue.map((i) => i.id).sort(), [mine.id, nobody.id].sort());
    assert.equal(view.highPriority.length, 0);
    assert.equal(view.dueSoon.length, 0);

    const everyone = todayBuckets(items, TODAY, null);
    assert.equal(everyone.overdue.length, 3);
    assert.deepEqual(everyone.highPriority.map((i) => i.id), [vinceHigh.id]);
    assert.deepEqual(everyone.dueSoon.map((i) => i.id), [vinceSoon.id]);
  });

  it("passes generatedAt through and defaults it to now", () => {
    assert.equal(todayBuckets([], TODAY, null, "2026-09-30T12:00:00.000Z").generatedAt, "2026-09-30T12:00:00.000Z");
    assert.match(todayBuckets([], TODAY, null).generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("does not mutate or reorder the input array", () => {
    const items = [mk({ dueDate: "2026-09-02" }), mk({ dueDate: "2026-09-01" })];
    const ids = items.map((i) => i.id);
    todayBuckets(items, TODAY, null);
    assert.deepEqual(items.map((i) => i.id), ids);
  });
});

describe("addDaysISO", () => {
  it("does calendar arithmetic across month and year boundaries", () => {
    assert.equal(addDaysISO("2026-09-30", 1), "2026-10-01");
    assert.equal(addDaysISO("2026-09-30", 6), "2026-10-06");
    assert.equal(addDaysISO("2026-12-31", 1), "2027-01-01");
    assert.equal(addDaysISO("2026-03-01", -1), "2026-02-28");
  });
});
