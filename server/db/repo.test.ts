import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDraft } from "../../shared/types";
import type { ItemDraft } from "../../shared/types";
import type { ProposalDraft } from "../contracts";
import { exampleSeed } from "../lib/testing";
import { openDatabase } from "./index";
import { ConflictError, NotFoundError, ValidationError, createRepo } from "./repo";
import type { Repo } from "./repo";

function fresh(): Repo {
  return createRepo(openDatabase(":memory:", { seed: exampleSeed }));
}

function draft(overrides: Partial<ItemDraft> = {}): ItemDraft {
  return emptyDraft({ title: "Do the thing", ...overrides });
}

function proposal(overrides: Partial<ItemDraft> = {}, warnings: string[] = []): ProposalDraft {
  return { draft: draft(overrides), confidence: 0.8, inferred: false, sourceExcerpt: "A: do the thing", warnings };
}

const is422 = (err: unknown): boolean => err instanceof ValidationError && err.status === 422;
const is404 = (err: unknown): boolean => err instanceof NotFoundError && err.status === 404;
const is409 = (err: unknown): boolean => err instanceof ConflictError && err.status === 409;

describe("repo: reference data", () => {
  it("reads the seed and resolves codes / initials case-insensitively", () => {
    const repo = fresh();
    assert.ok(repo.listDivisions().some((d) => d.code === "HG"));
    assert.equal(repo.getDivision("hg")?.code, "HG");
    assert.equal(repo.getPersonByInitials("vm")?.fullName, "Vincent Moynihan");
    assert.equal(repo.getMe()?.initials, "BS");
    const bau = repo.getInitiativeByName("bau");
    assert.ok(bau);
    assert.equal(repo.ensureInitiative("BAU").id, bau.id);
  });

  it("creates people with uppercase initials, one is_me at a time, and renames safely", () => {
    const repo = fresh();
    const brooke = repo.createPerson({ initials: "bd", fullName: "Brooke Dando", divisionCode: "hg" });
    assert.equal(brooke.initials, "BD");
    assert.equal(brooke.divisionCode, "HG");
    assert.throws(() => repo.createPerson({ initials: "BD", fullName: "Dup" }), is409);
    assert.throws(() => repo.createPerson({ initials: "XX", fullName: "Nope", divisionCode: "ZZZ" }), is422);

    const item = repo.createItem(draft({ ownerInitials: "BD" }));
    const renamed = repo.updatePerson(brooke.id, { initials: "BDO" });
    assert.equal(renamed.initials, "BDO");
    assert.equal(repo.getItem(item.id)?.ownerInitials, "BDO");

    repo.updatePerson(brooke.id, { isMe: true });
    assert.equal(repo.getMe()?.id, brooke.id);
    assert.equal(repo.getPersonByInitials("BS")?.isMe, false);
    assert.throws(() => repo.updatePerson(9999, { fullName: "x" }), is404);
  });

  it("creates / archives divisions and initiatives without deleting", () => {
    const repo = fresh();
    const ce = repo.createDivision({ code: "CE", name: "Cabinets Express" });
    assert.equal(ce.kind, "brand");
    assert.ok(ce.sortOrder > 100);
    assert.throws(() => repo.createDivision({ code: "ce", name: "dup" }), is409);
    assert.throws(() => repo.createDivision({ code: "X2", name: "x", parentCode: "NOPE" }), is404);
    const archived = repo.updateDivision("CE", { archived: true, color: "#123456" });
    assert.equal(archived.archived, true);
    assert.equal(archived.color, "#123456");
    assert.ok(!repo.listDivisions().some((d) => d.code === "CE"));
    assert.ok(repo.listDivisions({ includeArchived: true }).some((d) => d.code === "CE"));

    const init = repo.createInitiative({ name: "Showroom Refresh" });
    assert.throws(() => repo.createInitiative({ name: "showroom refresh" }), is409);
    assert.equal(repo.updateInitiative(init.id, { status: "On Hold" }).status, "On Hold");
    assert.throws(() => repo.updateInitiative(init.id, { status: "Bogus" as never }), is422);
  });
});

describe("repo: items", () => {
  it("creates items at the top of their column and writes a created event", () => {
    const repo = fresh();
    const first = repo.createItem(draft({ title: "  First  " }));
    const second = repo.createItem(draft({ title: "Second" }));
    assert.equal(first.title, "First");
    assert.equal(first.rank, 0);
    assert.equal(second.rank, -1);
    assert.equal(first.status, "Open");
    assert.equal(first.completedAt, null);
    const events = repo.listEvents(first.id);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "created");
    assert.deepEqual(repo.listItems().map((i) => i.id), [second.id, first.id]);
  });

  it("resolves initiativeName, creating the initiative when missing", () => {
    const repo = fresh();
    const a = repo.createItem(draft({ initiativeName: "Q4 Push" }));
    const b = repo.createItem(draft({ initiativeName: "q4 push" }));
    assert.ok(a.initiativeId);
    assert.equal(a.initiativeId, b.initiativeId);
    assert.equal(repo.listInitiatives().filter((i) => i.name === "Q4 Push").length, 1);
    const c = repo.createItem({ ...draft(), initiativeId: a.initiativeId });
    assert.equal(c.initiativeId, a.initiativeId);
    assert.throws(() => repo.createItem({ ...draft(), initiativeId: 4242 }), is422);
  });

  it("validates drafts: title, enums, dates, owner, division and the NB target rule", () => {
    const repo = fresh();
    assert.throws(() => repo.createItem(draft({ title: "   " })), is422);
    assert.throws(() => repo.createItem(draft({ title: "x".repeat(141) })), is422);
    assert.throws(() => repo.createItem(draft({ ownerInitials: "ZZ" })), is422);
    assert.throws(() => repo.createItem(draft({ divisionCode: "NOPE" })), is422);
    assert.throws(() => repo.createItem(draft({ dueDate: "2026-13-40" })), is422);
    assert.throws(() => repo.createItem(draft({ priority: "Urgent" as never })), is422);
    assert.throws(
      () => repo.createItem(draft({ category: "NB" })),
      (err: unknown) => is422(err) && (err as ValidationError).message === "NB needs a target",
    );
    assert.equal(repo.createItem(draft({ category: "NB", divisionCode: "HG" })).divisionCode, "HG");
    assert.equal(repo.createItem(draft({ category: "NB", ownerInitials: "vm" })).ownerInitials, "VM");
    const done = repo.createItem(draft({ status: "Done" }));
    assert.ok(done.completedAt);
  });

  it("records status changes with completed_at and a status event", () => {
    const repo = fresh();
    repo.createItem(draft({ status: "Done" }));
    const item = repo.createItem(draft());
    const done = repo.updateItem(item.id, { status: "Done" });
    assert.equal(done.status, "Done");
    assert.ok(done.completedAt);
    assert.equal(done.rank, -1, "moved to the top of the Done column");
    const events = repo.listEvents(item.id);
    assert.equal(events.at(-1)?.type, "status");
    assert.deepEqual(events.at(-1)?.data, { from: "Open", to: "Done" });

    const reopened = repo.updateItem(item.id, { status: "In Progress" });
    assert.equal(reopened.completedAt, null);
    assert.equal(repo.listEvents(item.id).length, 3);
  });

  it("records edits with the changed keys and skips no-op patches", () => {
    const repo = fresh();
    const item = repo.createItem(draft({ divisionCode: "HG" }));
    const updated = repo.updateItem(item.id, { title: "Renamed", priority: "High", divisionCode: null, note: item.note });
    assert.equal(updated.title, "Renamed");
    assert.equal(updated.divisionCode, null);
    const edit = repo.listEvents(item.id).at(-1);
    assert.equal(edit?.type, "edit");
    const changes = (edit?.data as { changes: Record<string, { from: unknown; to: unknown }> }).changes;
    assert.deepEqual(Object.keys(changes).sort(), ["divisionCode", "priority", "title"]);
    assert.deepEqual(changes.title, { from: "Do the thing", to: "Renamed" });

    const same = repo.updateItem(item.id, { title: "Renamed" });
    assert.equal(same.updatedAt, updated.updatedAt);
    assert.equal(repo.listEvents(item.id).length, 2);

    assert.throws(() => repo.updateItem(item.id, { category: "NB", ownerInitials: null }), is422);
    assert.throws(() => repo.updateItem("nope", { title: "x" }), is404);
    assert.equal(repo.updateItem(item.id, { initiativeName: "Fresh" }).initiativeId, repo.getInitiativeByName("Fresh")?.id);
    assert.equal(repo.updateItem(item.id, { initiativeName: null }).initiativeId, null);
  });

  it("reorders a column in one transaction, moving listed items into it", () => {
    const repo = fresh();
    const a = repo.createItem(draft({ title: "a" }));
    const b = repo.createItem(draft({ title: "b" }));
    const c = repo.createItem(draft({ title: "c" }));
    const parked = repo.createItem(draft({ title: "p", status: "Parked" }));

    repo.reorderItems("Open", [c.id, a.id, b.id]);
    assert.deepEqual(
      repo.listItems({ status: ["Open"] }).map((i) => [i.title, i.rank]),
      [
        ["c", 0],
        ["a", 1],
        ["b", 2],
      ],
    );
    assert.equal(repo.listEvents(a.id).length, 1, "pure reorders do not write events");

    repo.reorderItems("Done", [b.id, parked.id]);
    const bDone = repo.getItem(b.id);
    assert.equal(bDone?.status, "Done");
    assert.equal(bDone?.rank, 0);
    assert.ok(bDone?.completedAt);
    assert.equal(repo.getItem(parked.id)?.status, "Done");
    assert.deepEqual(repo.listEvents(b.id).at(-1)?.data, { from: "Open", to: "Done" });

    const before = repo.listItems({ includeDone: true }).map((i) => [i.id, i.status, i.rank]);
    assert.throws(() => repo.reorderItems("Open", [a.id, "missing", c.id]), is404);
    assert.deepEqual(repo.listItems({ includeDone: true }).map((i) => [i.id, i.status, i.rank]), before, "rolled back");
    assert.throws(() => repo.reorderItems("Open", [a.id, a.id]), is422);
    assert.throws(() => repo.reorderItems("Nope" as never, [a.id]), is422);
  });

  it("reorders a filtered subset without disturbing the unlisted items of the column", () => {
    const repo = fresh();
    const a = repo.createItem(draft({ title: "a" }));
    const b = repo.createItem(draft({ title: "b" }));
    const c = repo.createItem(draft({ title: "c" }));
    const d = repo.createItem(draft({ title: "d" }));
    repo.reorderItems("Open", [a.id, b.id, c.id, d.id]);
    const titles = (): string[] => repo.listItems({ status: ["Open"] }).map((i) => i.title);

    // A board filtered down to c and d swaps them: a and b keep their places, ranks stay distinct.
    repo.reorderItems("Open", [d.id, c.id]);
    assert.deepEqual(
      repo.listItems({ status: ["Open"] }).map((i) => [i.title, i.rank]),
      [
        ["a", 0],
        ["b", 1],
        ["d", 2],
        ["c", 3],
      ],
    );

    // An item dragged in from another column lands next to its visible neighbour.
    const p = repo.createItem(draft({ title: "p", status: "Parked" }));
    repo.reorderItems("Open", [b.id, p.id]);
    assert.deepEqual(titles(), ["a", "b", "p", "d", "c"]);
    assert.equal(repo.getItem(p.id)?.status, "Open");
    assert.deepEqual(repo.listEvents(p.id).at(-1)?.data, { from: "Parked", to: "Open" });

    // Dropped ahead of a visible neighbour, several arrivals keep their own order.
    const q = repo.createItem(draft({ title: "q", status: "Parked" }));
    const r = repo.createItem(draft({ title: "r", status: "In Progress" }));
    repo.reorderItems("Open", [q.id, r.id, d.id]);
    assert.deepEqual(titles(), ["a", "b", "p", "q", "r", "d", "c"]);

    // With no visible neighbour at all (empty-looking filtered column) the arrival goes on top.
    const s = repo.createItem(draft({ title: "s", status: "Parked" }));
    repo.reorderItems("Open", [s.id]);
    assert.deepEqual(titles(), ["s", "a", "b", "p", "q", "r", "d", "c"]);
    assert.deepEqual(
      repo.listItems({ status: ["Open"] }).map((i) => i.rank),
      [0, 1, 2, 3, 4, 5, 6, 7],
      "the whole column is renumbered",
    );
  });

  it("hard-deletes items, cascading events and unlinking proposals", () => {
    const repo = fresh();
    const capture = repo.createCapture({ kind: "text", rawText: "A: x" });
    const [p] = repo.replaceProposals(capture.id, [proposal()]);
    assert.ok(p);
    const { item } = repo.acceptProposal(capture.id, p.id);
    repo.addComment(item.id, "hello");
    repo.deleteItem(item.id);
    assert.equal(repo.getItem(item.id), null);
    assert.deepEqual(repo.listEvents(item.id), []);
    assert.equal(repo.getProposal(capture.id, p.id)?.itemId, null);
    assert.equal(repo.getProposal(capture.id, p.id)?.state, "accepted");
    assert.throws(() => repo.deleteItem(item.id), is404);
  });

  it("adds comments as events", () => {
    const repo = fresh();
    const item = repo.createItem(draft());
    const event = repo.addComment(item.id, "  Talked to Vince  ");
    assert.equal(event.type, "comment");
    assert.deepEqual(event.data, { text: "Talked to Vince" });
    assert.throws(() => repo.addComment(item.id, "   "), is422);
    assert.throws(() => repo.addComment("missing", "x"), is404);
    const detail = repo.getItemDetail(item.id);
    assert.equal(detail?.events.length, 2);
    assert.equal(detail?.capture, undefined);
  });

  it("filters lists and excludes Done by default", () => {
    const repo = fresh();
    repo.createItem(draft({ title: "open a", ownerInitials: "VM", divisionCode: "HG" }));
    repo.createItem(draft({ title: "open nb", category: "NB", divisionCode: "K&B" }));
    repo.createItem(draft({ title: "mine", isPersonal: true }));
    repo.createItem(draft({ title: "done", status: "Done" }));
    repo.createItem(draft({ title: "parked zebra", status: "Parked", note: "striped" }));

    assert.equal(repo.listItems().length, 4);
    assert.equal(repo.listItems({ includeDone: true }).length, 5);
    assert.deepEqual(repo.listItems({ status: ["Done"] }).map((i) => i.title), ["done"]);
    assert.deepEqual(repo.listItems({ category: ["NB"] }).map((i) => i.title), ["open nb"]);
    assert.deepEqual(repo.listItems({ divisionCode: "k&b" }).map((i) => i.title), ["open nb"]);
    assert.deepEqual(repo.listItems({ ownerInitials: "VM" }).map((i) => i.title), ["open a"]);
    assert.equal(repo.listItems({ ownerInitials: "VM", includeUnowned: true }).length, 4);
    assert.deepEqual(repo.listItems({ personal: true }).map((i) => i.title), ["mine"]);
    assert.deepEqual(repo.listItems({ q: "STRIPED" }).map((i) => i.title), ["parked zebra"]);
    assert.deepEqual(repo.listItems({ q: "100%_x" }), []);
    assert.throws(() => repo.listItems({ status: ["Bogus" as never] }), is422);
    const statuses = repo.listItems({ includeDone: true }).map((i) => i.status);
    assert.deepEqual(statuses, ["Open", "Open", "Open", "Parked", "Done"], "ordered by status then rank");
  });
});

describe("repo: captures and proposals", () => {
  it("accepts a proposal into an item and closes the capture when nothing is left", () => {
    const repo = fresh();
    const capture = repo.createCapture({ kind: "text", rawText: "A: VM call\nQ: DK plan", context: "1:1 with VM", defaultDivisionCode: "hg" });
    assert.equal(capture.status, "pending");
    assert.equal(capture.defaultDivisionCode, "HG");
    const [p1, p2] = repo.replaceProposals(capture.id, [proposal({ ownerInitials: "VM" }), proposal({ category: "Q", title: "Plan?" })]);
    assert.ok(p1 && p2);
    assert.deepEqual([p1.sortOrder, p2.sortOrder], [0, 1]);
    assert.equal(repo.getCapture(capture.id)?.proposedCount, 2);
    assert.equal(repo.countPendingCaptures(), 1);

    const { proposal: accepted, item } = repo.acceptProposal(capture.id, p1.id, { priority: "High" });
    assert.equal(accepted.state, "accepted");
    assert.equal(accepted.itemId, item.id);
    assert.equal(item.sourceCaptureId, capture.id);
    assert.equal(item.priority, "High");
    assert.equal(item.context, "1:1 with VM", "context inherited from the capture");
    assert.equal(repo.getCapture(capture.id)?.status, "pending");
    assert.throws(() => repo.acceptProposal(capture.id, p1.id), is409);
    assert.equal(repo.getItemDetail(item.id)?.capture?.id, capture.id);

    const rejected = repo.rejectProposal(capture.id, p2.id);
    assert.equal(rejected.state, "rejected");
    const closed = repo.getCapture(capture.id);
    assert.equal(closed?.status, "reviewed");
    assert.ok(closed?.reviewedAt);
    assert.equal(repo.countPendingCaptures(), 0);
    assert.throws(() => repo.acceptProposal("nope", p1.id), is404);
    assert.throws(() => repo.acceptProposal(capture.id, "nope"), is404);
  });

  it("replaceProposals keeps accepted / rejected rows and appends new proposed ones", () => {
    const repo = fresh();
    const capture = repo.createCapture({ kind: "transcript", rawText: "..." });
    const [p1] = repo.replaceProposals(capture.id, [proposal({ title: "keep" }), proposal({ title: "drop" })]);
    assert.ok(p1);
    repo.acceptProposal(capture.id, p1.id);
    const after = repo.replaceProposals(capture.id, [proposal({ title: "new" })]);
    assert.deepEqual(
      after.map((p) => [p.draft.title, p.state]),
      [
        ["keep", "accepted"],
        ["new", "proposed"],
      ],
    );
    assert.ok((after[1]?.sortOrder ?? 0) > (after[0]?.sortOrder ?? 0));
  });

  it("acceptAll is atomic: one invalid NB draft fails the whole batch", () => {
    const repo = fresh();
    const capture = repo.createCapture({ kind: "text", rawText: "x" });
    const [ok, bad] = repo.replaceProposals(capture.id, [proposal({ title: "fine" }), proposal({ category: "NB", title: "no target" }, ["NB needs a target"])]);
    assert.ok(ok && bad);
    assert.throws(
      () => repo.acceptAllProposals(capture.id),
      (err: unknown) => is422(err) && (err as ValidationError).message === "NB needs a target" && (err as ValidationError).details !== undefined,
    );
    assert.equal(repo.listItems().length, 0);
    assert.equal(repo.getCapture(capture.id)?.proposedCount, 2);

    repo.updateProposalDraft(capture.id, bad.id, { divisionCode: "PF" });
    const items = repo.acceptAllProposals(capture.id);
    assert.equal(items.length, 2);
    assert.equal(repo.getCapture(capture.id)?.status, "reviewed");
    assert.throws(() => repo.updateProposalDraft(capture.id, bad.id, { title: "late" }), is409);
  });

  it("edits proposal drafts and validates their shape", () => {
    const repo = fresh();
    const capture = repo.createCapture({ kind: "text", rawText: "x" });
    const [p] = repo.replaceProposals(capture.id, [proposal()]);
    assert.ok(p);
    const edited = repo.updateProposalDraft(capture.id, p.id, { title: "Edited", dueDate: "2026-10-10", ownerInitials: "VM" });
    assert.equal(edited.draft.title, "Edited");
    assert.equal(edited.draft.dueDate, "2026-10-10");
    assert.equal(edited.draft.ownerInitials, "VM");
    assert.throws(() => repo.updateProposalDraft(capture.id, p.id, { dueDate: "tomorrow" }), is422);
    assert.throws(() => repo.updateProposalDraft(capture.id, p.id, { title: "x".repeat(141) }), is422);
  });

  it("stores files as blobs and discards captures", () => {
    const repo = fresh();
    const capture = repo.createCapture({ kind: "image" });
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const meta = repo.addCaptureFile(capture.id, { filename: "IMG_0001.PNG", mime: "image/png", bytes });
    assert.equal(meta.size, bytes.byteLength);
    const stored = repo.getCaptureFile(capture.id, meta.id);
    assert.deepEqual(Array.from(stored?.bytes ?? []), Array.from(bytes));
    assert.equal(repo.getCapture(capture.id)?.fileCount, 1);
    assert.equal(repo.getCaptureFile(capture.id, "nope"), null);
    assert.throws(() => repo.addCaptureFile("nope", { filename: "x", mime: "image/png", bytes }), is404);

    repo.discardCapture(capture.id);
    assert.equal(repo.getCapture(capture.id)?.status, "discarded");
    assert.deepEqual(repo.listCaptures("discarded").map((c) => c.id), [capture.id]);
    assert.equal(repo.listCaptures("pending").length, 0);
    assert.throws(() => repo.listCaptures("bogus" as never), is422);
    const patched = repo.updateCapture(capture.id, { error: "boom", notes: ["n1"] });
    assert.equal(patched.error, "boom");
    assert.deepEqual(patched.notes, ["n1"]);
  });

  it("refuses to accept, reject or edit proposals of a discarded capture", () => {
    const repo = fresh();
    const capture = repo.createCapture({ kind: "text", rawText: "A: x" });
    const [p] = repo.replaceProposals(capture.id, [proposal()]);
    assert.ok(p);
    repo.discardCapture(capture.id);
    assert.throws(() => repo.acceptProposal(capture.id, p.id), is409);
    assert.throws(() => repo.acceptAllProposals(capture.id), is409);
    assert.throws(() => repo.rejectProposal(capture.id, p.id), is409);
    assert.throws(() => repo.updateProposalDraft(capture.id, p.id, { title: "late" }), is409);
    assert.equal(repo.listItems().length, 0);
    assert.equal(repo.getCapture(capture.id)?.status, "discarded");
    assert.equal(repo.getProposal(capture.id, p.id)?.state, "proposed");
  });

  it("settleCaptureStatus files a pending capture with nothing left to review", () => {
    const repo = fresh();
    const empty = repo.createCapture({ kind: "text", rawText: "nothing tagged" });
    repo.settleCaptureStatus(empty.id);
    assert.equal(repo.getCapture(empty.id)?.status, "reviewed");
    assert.ok(repo.getCapture(empty.id)?.reviewedAt);

    const busy = repo.createCapture({ kind: "text", rawText: "A: x" });
    repo.replaceProposals(busy.id, [proposal()]);
    repo.settleCaptureStatus(busy.id);
    assert.equal(repo.getCapture(busy.id)?.status, "pending", "something to review keeps it pending");

    const gone = repo.createCapture({ kind: "text" });
    repo.discardCapture(gone.id);
    repo.settleCaptureStatus(gone.id);
    assert.equal(repo.getCapture(gone.id)?.status, "discarded", "only pending captures settle");
    assert.throws(() => repo.settleCaptureStatus("nope"), is404);
  });

  it("records accepted proposals for import provenance", () => {
    const repo = fresh();
    const capture = repo.createCapture({ kind: "import", title: "Import" });
    const item = repo.createItem(draft(), { sourceCaptureId: capture.id });
    const p = repo.recordAcceptedProposal(capture.id, proposal(), item.id);
    assert.equal(p.state, "accepted");
    assert.equal(p.itemId, item.id);
    assert.throws(() => repo.createItem(draft(), { sourceCaptureId: "missing" }), is404);
  });
});

describe("repo: search, briefs, sessions", () => {
  it("searches items and captures with LIKE", () => {
    const repo = fresh();
    repo.createItem(draft({ title: "Zebra budget review", status: "Done" }));
    repo.createItem(draft({ title: "Other", note: "mentions zebra stripes" }));
    repo.createCapture({ kind: "text", rawText: "talked about the zebra account" });
    repo.createCapture({ kind: "text", title: "unrelated", rawText: "nothing" });
    const result = repo.search("ZEBRA");
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0]?.status, "Open", "open items before done ones");
    assert.equal(result.captures.length, 1);
    assert.deepEqual(repo.search("   "), { items: [], captures: [] });
  });

  it("creates, lists and deletes briefs", () => {
    const repo = fresh();
    const a = repo.createBrief({ kind: "email_digest", title: "Morning digest", bodyMd: "# hi" });
    repo.createBrief({ kind: "daily", title: "Daily", bodyMd: "" });
    assert.equal(repo.listBriefs().length, 2);
    assert.equal(repo.listBriefs(1).length, 1);
    assert.throws(() => repo.createBrief({ kind: "nope" as never, title: "x", bodyMd: "" }), is422);
    repo.deleteBrief(a.id);
    assert.equal(repo.getBrief(a.id), null);
    assert.throws(() => repo.deleteBrief(a.id), is404);
  });

  it("creates, expires and purges sessions", () => {
    const repo = fresh();
    const session = repo.createSession();
    assert.ok(repo.getSession(session.id));
    assert.equal(repo.getSession(session.id, "2999-01-01T00:00:00.000Z"), null);
    const expired = repo.createSession(-1000);
    assert.equal(repo.getSession(expired.id), null);
    assert.equal(repo.purgeExpiredSessions(), 1);
    assert.ok(repo.getSession(session.id));
    assert.equal(repo.deleteSession(session.id), true);
    assert.equal(repo.deleteSession(session.id), false);
  });
});
