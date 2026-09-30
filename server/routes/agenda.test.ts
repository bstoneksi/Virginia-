import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDaysISO } from "../../shared/agenda";
import { emptyDraft } from "../../shared/types";
import type { Agenda, ItemDraft, TodayView } from "../../shared/types";
import { todayISO } from "../db/index";
import { call, json, makeTestApp } from "../lib/testing";

function d(overrides: Partial<ItemDraft>): ItemDraft {
  return emptyDraft({ title: "t", ...overrides });
}

describe("agenda routes", () => {
  it("builds a person agenda grouped by category with parked at the bottom and Done hidden", async () => {
    const t = makeTestApp();
    const { repo } = t;
    repo.createItem(d({ title: "Pitch the glass package", category: "NB", ownerInitials: "VM", divisionCode: "HG", priority: "High", dueDate: "2026-10-03" }));
    repo.createItem(d({ title: "Send the crew schedule", ownerInitials: "VM", priority: "Medium", dueDate: "2026-10-01" }));
    repo.createItem(d({ title: "Urgent follow-up", ownerInitials: "VM", priority: "High" }));
    repo.createItem(d({ title: "Someday signage", ownerInitials: "VM", status: "Parked" }));
    repo.createItem(d({ title: "Old question", category: "Q", ownerInitials: "VM", status: "Done" }));
    repo.createItem(d({ title: "Not Vince", ownerInitials: "DK" }));
    repo.createItem(d({ title: "Nobody's", ownerInitials: null }));

    const res = await call(t, "GET", "/api/agenda/person/vm");
    assert.equal(res.status, 200);
    const agenda = await json<Agenda>(res);
    assert.deepEqual(agenda.subject, { type: "person", key: "VM", label: "Vincent Moynihan" });
    assert.deepEqual(agenda.groups.map((g) => g.category), ["NB", "A"]);
    const actions = agenda.groups[1];
    assert.deepEqual(actions?.active.map((i) => i.title), ["Urgent follow-up", "Send the crew schedule"]);
    assert.deepEqual(actions?.parked.map((i) => i.title), ["Someday signage"]);
    assert.deepEqual(actions?.done, []);
    assert.match(agenda.markdown, /^# Agenda — Vincent Moynihan \(\d{4}-\d{2}-\d{2}\)\n\n## New Business\n- \[High\] Pitch the glass package — VM, due 2026-10-03\n/);
    assert.ok(agenda.markdown.includes("- Parked:\n  - [Medium] Someday signage — VM"));
    assert.ok(!agenda.markdown.includes("Not Vince"));
    assert.ok(!agenda.markdown.includes("Nobody's"));
    assert.match(agenda.generatedAt, /^\d{4}-\d{2}-\d{2}T/);

    const withDone = await json<Agenda>(await call(t, "GET", "/api/agenda/person/VM?includeDone=1"));
    assert.deepEqual(withDone.groups.map((g) => g.category), ["NB", "A", "Q"]);
    assert.equal(withDone.groups[2]?.done.length, 1);
    assert.ok(withDone.markdown.includes("## Question\n- Done:\n  - [Medium] Old question — VM"));

    assert.equal((await call(t, "GET", "/api/agenda/person/ZZ")).status, 404);
    assert.equal((await call(t, "GET", "/api/agenda/person/VM?includeDone=maybe")).status, 422);
  });

  it("counts unowned items as Brandon's on his own agenda", async () => {
    const t = makeTestApp();
    t.repo.createItem(d({ title: "Mine explicitly", ownerInitials: "BS" }));
    t.repo.createItem(d({ title: "Unowned", ownerInitials: null }));
    t.repo.createItem(d({ title: "Vince's", ownerInitials: "VM" }));
    const agenda = await json<Agenda>(await call(t, "GET", "/api/agenda/person/BS"));
    assert.deepEqual(agenda.groups[0]?.active.map((i) => i.title).sort(), ["Mine explicitly", "Unowned"]);
  });

  it("builds a division agenda (codes with & are URL-encoded)", async () => {
    const t = makeTestApp();
    t.repo.createItem(d({ title: "Glass lead", category: "NB", divisionCode: "HG" }));
    t.repo.createItem(d({ title: "Cabinet lead", category: "NB", divisionCode: "K&B-I" }));
    t.repo.createItem(d({ title: "Cabinet action", divisionCode: "K&B-I", ownerInitials: "DK" }));

    const hg = await json<Agenda>(await call(t, "GET", "/api/agenda/division/hg"));
    assert.deepEqual(hg.subject, { type: "division", key: "HG", label: "Henderson Glass" });
    assert.deepEqual(hg.groups.map((g) => g.active.map((i) => i.title)), [["Glass lead"]]);

    const kbi = await json<Agenda>(await call(t, "GET", `/api/agenda/division/${encodeURIComponent("K&B-I")}`));
    assert.equal(kbi.subject.label, "K&B Installation");
    assert.deepEqual(kbi.groups.map((g) => g.category), ["NB", "A"]);
    assert.ok(kbi.markdown.startsWith("# Agenda — K&B Installation ("));

    assert.equal((await call(t, "GET", "/api/agenda/division/NOPE")).status, 404);
  });
});

describe("today route", () => {
  it("returns the four buckets for Brandon plus the pending-capture count", async () => {
    const t = makeTestApp();
    const { repo } = t;
    const today = todayISO();
    const overdue = repo.createItem(d({ title: "Overdue mine", ownerInitials: "BS", dueDate: addDaysISO(today, -3) }));
    repo.createItem(d({ title: "Overdue Vince", ownerInitials: "VM", dueDate: addDaysISO(today, -3) }));
    const soon = repo.createItem(d({ title: "Due tomorrow", dueDate: addDaysISO(today, 1) }));
    repo.createItem(d({ title: "Due in two weeks", ownerInitials: "BS", dueDate: addDaysISO(today, 14) }));
    const high = repo.createItem(d({ title: "High", priority: "High", divisionCode: "HG" }));
    const unowned = repo.createItem(d({ title: "Needs triage" }));
    repo.createItem(d({ title: "Done overdue", status: "Done", dueDate: addDaysISO(today, -30) }));
    repo.createItem(d({ title: "Personal", isPersonal: true }));
    repo.createCapture({ kind: "text", rawText: "A: x" });
    repo.createCapture({ kind: "text", rawText: "A: y" });
    repo.discardCapture(repo.createCapture({ kind: "text", rawText: "gone" }).id);

    const res = await call(t, "GET", "/api/today");
    assert.equal(res.status, 200);
    const view = await json<TodayView>(res);
    assert.deepEqual(view.overdue.map((i) => i.title), [overdue.title]);
    assert.deepEqual(view.dueSoon.map((i) => i.title), [soon.title]);
    assert.deepEqual(view.highPriority.map((i) => i.title), [high.title]);
    assert.deepEqual(view.unowned.map((i) => i.title), [unowned.title]);
    assert.equal(view.pendingCaptures, 2);
    assert.match(view.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("shows everyone's items when nobody is marked as me", async () => {
    const t = makeTestApp();
    const me = t.repo.getMe();
    assert.ok(me);
    t.repo.updatePerson(me.id, { isMe: false });
    t.repo.createItem(d({ title: "Vince overdue", ownerInitials: "VM", dueDate: "2020-01-01" }));
    const view = await json<TodayView>(await call(t, "GET", "/api/today"));
    assert.equal(view.overdue.length, 1);
  });
});
