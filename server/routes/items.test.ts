import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApiError, Item, ItemEvent } from "../../shared/types";
import type { ItemDetail } from "../db/repo";
import { call, json, makeTestApp } from "../lib/testing";

async function create(t: ReturnType<typeof makeTestApp>, body: Record<string, unknown>): Promise<Item> {
  const res = await call(t, "POST", "/api/items", body);
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
  return json<Item>(res);
}

describe("items routes", () => {
  it("create → list → detail → patch → comment → delete", async () => {
    const t = makeTestApp();
    const created = await create(t, { title: "Call Vince about the HG install", ownerInitials: "vm", divisionCode: "hg" });
    assert.equal(created.category, "A");
    assert.equal(created.priority, "Medium");
    assert.equal(created.status, "Open");
    assert.equal(created.ownerInitials, "VM");
    assert.equal(created.divisionCode, "HG");
    assert.equal(created.rank, 0);
    assert.equal(created.isPersonal, false);

    const list = await json<Item[]>(await call(t, "GET", "/api/items"));
    assert.deepEqual(list.map((i) => i.id), [created.id]);

    const detail = await json<ItemDetail>(await call(t, "GET", `/api/items/${created.id}`));
    assert.equal(detail.title, created.title);
    assert.equal(detail.events.length, 1);
    assert.equal(detail.events[0]?.type, "created");
    assert.equal(detail.capture, undefined);

    const patched = await json<Item>(await call(t, "PATCH", `/api/items/${created.id}`, { status: "Done", priority: "High", divisionCode: "" }));
    assert.equal(patched.status, "Done");
    assert.equal(patched.priority, "High");
    assert.equal(patched.divisionCode, null, "empty string clears a nullable field");
    assert.ok(patched.completedAt);

    const comment = await call(t, "POST", `/api/items/${created.id}/comments`, { text: "Left a voicemail" });
    assert.equal(comment.status, 201);
    const event = await json<ItemEvent>(comment);
    assert.equal(event.type, "comment");
    assert.deepEqual(event.data, { text: "Left a voicemail" });

    const after = await json<ItemDetail>(await call(t, "GET", `/api/items/${created.id}`));
    assert.deepEqual(
      after.events.map((e) => e.type),
      ["created", "status", "edit", "comment"],
    );
    assert.equal((await json<Item[]>(await call(t, "GET", "/api/items"))).length, 0, "Done hidden by default");
    assert.equal((await json<Item[]>(await call(t, "GET", "/api/items?includeDone=1"))).length, 1);

    assert.equal((await call(t, "DELETE", `/api/items/${created.id}`)).status, 204);
    const gone = await call(t, "GET", `/api/items/${created.id}`);
    assert.equal(gone.status, 404);
    assert.equal((await json<ApiError>(gone)).error, `Unknown item: ${created.id}`);
    assert.equal((await call(t, "DELETE", `/api/items/${created.id}`)).status, 404);
    assert.equal((await call(t, "PATCH", `/api/items/${created.id}`, { title: "x" })).status, 404);
    assert.equal((await call(t, "POST", `/api/items/${created.id}/comments`, { text: "x" })).status, 404);
  });

  it("returns 422 with details for invalid bodies", async () => {
    const t = makeTestApp();
    const missingTitle = await call(t, "POST", "/api/items", { note: "no title" });
    assert.equal(missingTitle.status, 422);
    const body = await json<ApiError & { details: { path: string; message: string }[] }>(missingTitle);
    assert.match(body.error, /title/i);
    assert.equal(body.details[0]?.path, "title");

    assert.equal((await call(t, "POST", "/api/items", { title: "x".repeat(141) })).status, 422);
    assert.equal((await call(t, "POST", "/api/items", { title: "ok", category: "Z" })).status, 422);
    assert.equal((await call(t, "POST", "/api/items", { title: "ok", ownerInitials: "ZZ" })).status, 422);
    assert.equal((await call(t, "POST", "/api/items", { title: "ok", dueDate: "2026-13-40" })).status, 422);
    assert.equal((await call(t, "POST", "/api/items", { title: "ok", dueDate: "10/15/2026" })).status, 422);
    assert.equal((await call(t, "POST", "/api/items", "{oops", { "content-type": "application/json" })).status, 422);
    assert.equal((await call(t, "POST", "/api/items")).status, 422);

    const nb = await call(t, "POST", "/api/items", { title: "Expand to Toledo", category: "NB" });
    assert.equal(nb.status, 422);
    assert.deepEqual(await nb.json(), { error: "NB needs a target" });
    assert.equal((await call(t, "POST", "/api/items", { title: "Expand to Toledo", category: "NB", divisionCode: "HG" })).status, 201);

    assert.equal((await call(t, "PATCH", "/api/items/whatever", { priority: "Urgent" })).status, 422, "validation before lookup");
    assert.equal((await call(t, "POST", "/api/items/whatever/comments", { text: "  " })).status, 422);
  });

  it("filters the list by status, category, division, owner, personal, initiative and text", async () => {
    const t = makeTestApp();
    const a = await create(t, { title: "HG install", ownerInitials: "VM", divisionCode: "HG", initiativeName: "Showroom" });
    const nb = await create(t, { title: "K&B lead", category: "NB", divisionCode: "K&B", priority: "High" });
    const mine = await create(t, { title: "Dry cleaning", isPersonal: true });
    const parked = await create(t, { title: "Someday dashboard", category: "I", status: "Parked", note: "grafana" });
    await create(t, { title: "Finished", status: "Done" });

    const ids = async (qs: string): Promise<string[]> => (await json<Item[]>(await call(t, "GET", `/api/items${qs}`))).map((i) => i.id);
    assert.deepEqual((await ids("")).sort(), [a.id, nb.id, mine.id, parked.id].sort());
    assert.deepEqual(await ids("?status=Parked"), [parked.id]);
    assert.deepEqual((await ids("?status=Open,Parked&category=I,NB")).sort(), [nb.id, parked.id].sort());
    assert.deepEqual(await ids(`?division=${encodeURIComponent("K&B")}`), [nb.id]);
    assert.deepEqual(await ids("?owner=vm"), [a.id]);
    assert.deepEqual(await ids("?personal=1"), [mine.id]);
    assert.deepEqual(await ids("?q=grafana"), [parked.id]);
    assert.deepEqual(await ids(`?initiative=${a.initiativeId}`), [a.id]);
    assert.equal((await ids("?includeDone=true")).length, 5);
    assert.equal((await call(t, "GET", "/api/items?status=Bogus")).status, 422);
    assert.equal((await call(t, "GET", "/api/items?personal=maybe")).status, 422);
    assert.equal((await call(t, "GET", "/api/items?initiative=abc")).status, 422);
  });

  it("reorders a column and moves items between columns in one call", async () => {
    const t = makeTestApp();
    const a = await create(t, { title: "a" });
    const b = await create(t, { title: "b" });
    const c = await create(t, { title: "c" });

    const res = await call(t, "POST", "/api/items/reorder", { status: "In Progress", orderedIds: [b.id, a.id] });
    assert.equal(res.status, 204);
    const progress = await json<Item[]>(await call(t, "GET", "/api/items?status=In%20Progress"));
    assert.deepEqual(
      progress.map((i) => [i.title, i.rank]),
      [
        ["b", 0],
        ["a", 1],
      ],
    );
    const open = await json<Item[]>(await call(t, "GET", "/api/items?status=Open"));
    assert.deepEqual(open.map((i) => i.id), [c.id]);
    const detail = await json<ItemDetail>(await call(t, "GET", `/api/items/${a.id}`));
    assert.deepEqual(detail.events.at(-1)?.data, { from: "Open", to: "In Progress" });

    assert.equal((await call(t, "POST", "/api/items/reorder", { status: "Sideways", orderedIds: [a.id] })).status, 422);
    assert.equal((await call(t, "POST", "/api/items/reorder", { status: "Open", orderedIds: [a.id, "missing"] })).status, 404);
    assert.equal((await call(t, "POST", "/api/items/reorder", { status: "Open" })).status, 422);
  });

  it("serves reference data and bootstrap", async () => {
    const t = makeTestApp({ mcpToken: "abc" });
    const boot = await json<{ divisions: unknown[]; people: unknown[]; me: { initials: string } | null; aiConfigured: boolean; mcpConfigured: boolean; version: string }>(
      await call(t, "GET", "/api/bootstrap"),
    );
    assert.ok(boot.divisions.length >= 13);
    assert.ok(boot.people.length >= 12);
    assert.equal(boot.me?.initials, "BS");
    assert.equal(boot.aiConfigured, false);
    assert.equal(boot.mcpConfigured, true);
    assert.equal(boot.version, "test");

    const person = await call(t, "POST", "/api/people", { initials: "bd", fullName: "Brooke Dando" });
    assert.equal(person.status, 201);
    const bd = await json<{ id: number; initials: string }>(person);
    assert.equal(bd.initials, "BD");
    assert.equal((await call(t, "POST", "/api/people", { initials: "BD", fullName: "dup" })).status, 409);
    assert.equal((await call(t, "PATCH", `/api/people/${bd.id}`, { archived: true })).status, 200);
    assert.equal((await call(t, "PATCH", "/api/people/abc", { archived: true })).status, 404);
    assert.equal((await call(t, "PATCH", "/api/people/99999", { archived: true })).status, 404);

    const division = await call(t, "POST", "/api/divisions", { code: "CE", name: "Cabinets Express", color: "#112233" });
    assert.equal(division.status, 201);
    assert.equal((await call(t, "POST", "/api/divisions", { code: "CE2", name: "x", color: "red" })).status, 422);
    assert.equal((await call(t, "PATCH", "/api/divisions/CE", { archived: true })).status, 200);
    assert.equal((await call(t, "PATCH", "/api/divisions/NOPE", { name: "x" })).status, 404);

    const initiative = await call(t, "POST", "/api/initiatives", { name: "Showroom Refresh" });
    assert.equal(initiative.status, 201);
    const init = await json<{ id: number }>(initiative);
    assert.equal((await call(t, "PATCH", `/api/initiatives/${init.id}`, { status: "Complete" })).status, 200);
    assert.equal((await json<unknown[]>(await call(t, "GET", "/api/initiatives"))).length, 2);

    const brief = await call(t, "POST", "/api/briefs", { kind: "email_digest", title: "Digest", bodyMd: "# hi" });
    assert.equal(brief.status, 201);
    const b = await json<{ id: string }>(brief);
    assert.equal((await json<unknown[]>(await call(t, "GET", "/api/briefs?limit=5"))).length, 1);
    assert.equal((await call(t, "DELETE", `/api/briefs/${b.id}`)).status, 204);
    assert.equal((await call(t, "DELETE", `/api/briefs/${b.id}`)).status, 404);
    assert.equal((await call(t, "POST", "/api/briefs", { kind: "nope", title: "x", bodyMd: "" })).status, 422);
  });

  it("searches items and captures", async () => {
    const t = makeTestApp();
    await create(t, { title: "Zebra budget" });
    t.repo.createCapture({ kind: "text", rawText: "zebra notes" });
    const result = await json<{ items: Item[]; captures: unknown[] }>(await call(t, "GET", "/api/search?q=zebra"));
    assert.equal(result.items.length, 1);
    assert.equal(result.captures.length, 1);
    assert.deepEqual(await json(await call(t, "GET", "/api/search")), { items: [], captures: [] });
  });

  it("answers JSON 404 for unknown API paths", async () => {
    const t = makeTestApp();
    const res = await call(t, "GET", "/api/nope");
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "Not found" });
  });
});
