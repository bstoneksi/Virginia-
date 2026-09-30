import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Hono } from "hono";
import type { Agenda, Brief, Item, Person, SearchResult, TodayView } from "../../shared/types";
import { createApp } from "../app";
import type { Config } from "../config";
import { openDatabase } from "../db/index";
import type { Db } from "../db/index";
import { createRepo } from "../db/repo";
import type { ItemDetail, Repo } from "../db/repo";
import { testConfig } from "../lib/testing";
import { MCP_SERVER_NAME, MCP_TOOL_NAMES, createMcpHandler } from "./server";

interface RpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}
interface ToolResult {
  content: { type: string; text?: string }[];
  isError?: boolean;
}
interface InitializeResult {
  protocolVersion: string;
  serverInfo: { name: string; version: string };
  capabilities: Record<string, unknown>;
  instructions?: string;
}
interface ToolsListResult {
  tools: { name: string; description?: string; inputSchema: { type: string; properties?: Record<string, unknown> }; annotations?: Record<string, unknown> }[];
}

const ACCEPT_BOTH = "application/json, text/event-stream";
const HEADERS = { "content-type": "application/json", accept: ACCEPT_BOTH };
const INIT_PARAMS = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "virginia-test", version: "0.0.0" } };

interface Fixture {
  app: Hono;
  db: Db;
  repo: Repo;
  config: Config;
  path: string;
}

/** The real app from createApp() with a hand-built Config (mcpToken "t") and the handler wired in. */
function setup(): Fixture {
  const config = testConfig({ mcpToken: "t" });
  const db = openDatabase(":memory:");
  const app = createApp({ config, db, mcpHandler: createMcpHandler({ db, config }) });
  return { app, db, repo: createRepo(db), config, path: "/mcp/t" };
}

let nextId = 1;

async function rpc(app: Hono, path: string, method: string, params?: unknown, headers: Record<string, string> = HEADERS): Promise<Response> {
  return app.request(path, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }) });
}

async function rpcResult<T>(app: Hono, path: string, method: string, params?: unknown): Promise<T> {
  const res = await rpc(app, path, method, params);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const body = JSON.parse(text) as RpcResponse | RpcResponse[];
  const message = Array.isArray(body) ? body[0] : body;
  assert.ok(message, "empty JSON-RPC response");
  assert.equal(message.error, undefined, JSON.stringify(message.error));
  return message.result as T;
}

async function callTool(app: Hono, path: string, name: string, args?: Record<string, unknown>): Promise<ToolResult> {
  return rpcResult<ToolResult>(app, path, "tools/call", args === undefined ? { name } : { name, arguments: args });
}

function textOf(result: ToolResult, index = 0): string {
  const block = result.content[index];
  assert.ok(block && block.type === "text" && typeof block.text === "string", `no text block at ${index}: ${JSON.stringify(result)}`);
  return block.text;
}

function parseText<T>(result: ToolResult, index = 0): T {
  assert.notEqual(result.isError, true, textOf(result, index));
  return JSON.parse(textOf(result, index)) as T;
}

describe("MCP handler over the real app (/mcp/:token)", () => {
  it("answers initialize with the virginia server info and advertises tools", async () => {
    const { app, path, config } = setup();
    const init = await rpcResult<InitializeResult>(app, path, "initialize", INIT_PARAMS);
    assert.equal(init.serverInfo.name, MCP_SERVER_NAME);
    assert.equal(init.serverInfo.version, config.version);
    assert.match(init.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok("tools" in init.capabilities);
    assert.match(init.instructions ?? "", /list_reference/);

    // notifications/initialized carries no id → 202 with an empty body (stateless: nothing to remember).
    const notified = await app.request(path, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    assert.equal(notified.status, 202);
  });

  it("lists every tool from SPEC §6 with object input schemas and annotations", async () => {
    const { app, path } = setup();
    const list = await rpcResult<ToolsListResult>(app, path, "tools/list", {});
    assert.deepEqual(list.tools.map((t) => t.name).sort(), [...MCP_TOOL_NAMES].sort());
    for (const tool of list.tools) {
      assert.equal(tool.inputSchema.type, "object", tool.name);
      assert.ok((tool.description ?? "").length > 20, `${tool.name} needs a description`);
      assert.ok(tool.annotations && typeof tool.annotations.readOnlyHint === "boolean", `${tool.name} annotations`);
    }
    const addItems = list.tools.find((t) => t.name === "add_items");
    assert.ok(addItems?.inputSchema.properties && "items" in addItems.inputSchema.properties);
    const readOnly = list.tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name).sort();
    assert.deepEqual(readOnly, ["get_agenda", "get_item", "get_today", "list_items", "list_reference", "search"]);
  });

  it("list_items returns JSON text of the items (Done hidden by default) and honours filters", async () => {
    const { app, path, repo } = setup();
    const open = repo.createItem({ category: "A", title: "Send the crew schedule", note: "", divisionCode: "HG", ownerInitials: "VM", initiativeName: null, priority: "Medium", status: "Open", dueDate: null, isPersonal: false, context: null });
    repo.createItem({ category: "Q", title: "Old question", note: "", divisionCode: null, ownerInitials: "DK", initiativeName: null, priority: "Low", status: "Done", dueDate: null, isPersonal: false, context: null });

    const all = parseText<Item[]>(await callTool(app, path, "list_items", {}));
    assert.deepEqual(all.map((i) => i.title), ["Send the crew schedule"]);
    assert.equal(all[0]?.id, open.id);

    const withDone = parseText<Item[]>(await callTool(app, path, "list_items", { includeDone: true }));
    assert.equal(withDone.length, 2);

    const filtered = parseText<Item[]>(await callTool(app, path, "list_items", { status: ["Done"], category: ["Q"], ownerInitials: "dk" }));
    assert.deepEqual(filtered.map((i) => i.title), ["Old question"]);

    const none = parseText<Item[]>(await callTool(app, path, "list_items", { divisionCode: "PF" }));
    assert.deepEqual(none, []);
  });

  it("add_items creates items directly (with defaults), atomically, and reports repo errors as isError", async () => {
    const { app, path, repo } = setup();
    const created = parseText<Item[]>(
      await callTool(app, path, "add_items", {
        items: [
          { title: "Call the builder group", ownerInitials: "vm", divisionCode: "hg", dueDate: "2026-10-03", priority: "High" },
          { category: "NB", title: "Cabinet line for the Novi builder", divisionCode: "K&B-S", initiativeName: "Builder program", context: "1:1 with VM 9/30" },
        ],
      }),
    );
    assert.equal(created.length, 2);
    assert.deepEqual(created.map((i) => [i.category, i.ownerInitials, i.divisionCode, i.status, i.priority]), [
      ["A", "VM", "HG", "Open", "High"],
      ["NB", null, "K&B-S", "Open", "Medium"],
    ]);
    assert.equal(created[1]?.initiativeId, repo.getInitiativeByName("Builder program")?.id);
    assert.equal(repo.listItems().length, 2);

    const failed = await callTool(app, path, "add_items", {
      items: [{ title: "This one is fine" }, { category: "NB", title: "No target" }],
    });
    assert.equal(failed.isError, true);
    assert.match(textOf(failed), /NB needs a target/);
    assert.equal(repo.listItems().length, 2, "the batch rolled back");

    const unknownOwner = await callTool(app, path, "add_items", { items: [{ title: "Who?", ownerInitials: "ZZ" }] });
    assert.equal(unknownOwner.isError, true);
    assert.match(textOf(unknownOwner), /Unknown owner initials: ZZ/);

    const badInput = await callTool(app, path, "add_items", { items: [{ title: "" }] });
    assert.equal(badInput.isError, true, "schema validation failure surfaces as a tool error");
  });

  it("update_item patches fields and status; get_item returns the history", async () => {
    const { app, path, repo } = setup();
    const item = repo.createItem({ category: "A", title: "Draft the memo", note: "", divisionCode: null, ownerInitials: null, initiativeName: null, priority: "Medium", status: "Open", dueDate: null, isPersonal: false, context: null });

    const updated = parseText<Item>(await callTool(app, path, "update_item", { id: item.id, patch: { status: "Done", priority: "High", ownerInitials: "AG", dueDate: null } }));
    assert.equal(updated.status, "Done");
    assert.equal(updated.priority, "High");
    assert.equal(updated.ownerInitials, "AG");
    assert.ok(updated.completedAt);

    const detail = parseText<ItemDetail>(await callTool(app, path, "get_item", { id: item.id }));
    assert.equal(detail.id, item.id);
    assert.deepEqual(detail.events.map((e) => e.type), ["created", "status", "edit"]);

    const missing = await callTool(app, path, "update_item", { id: "nope", patch: { title: "x" } });
    assert.equal(missing.isError, true);
    assert.match(textOf(missing), /Unknown item: nope/);

    const missingGet = await callTool(app, path, "get_item", { id: "nope" });
    assert.equal(missingGet.isError, true);
  });

  it("get_agenda returns JSON plus a Markdown block, for a person, a division and 'me' by default", async () => {
    const { app, path, repo } = setup();
    repo.createItem({ category: "NB", title: "Pitch the glass package", note: "", divisionCode: "HG", ownerInitials: "VM", initiativeName: null, priority: "High", status: "Open", dueDate: "2026-10-03", isPersonal: false, context: null });
    repo.createItem({ category: "A", title: "Someday signage", note: "", divisionCode: "HG", ownerInitials: "VM", initiativeName: null, priority: "Low", status: "Parked", dueDate: null, isPersonal: false, context: null });
    repo.createItem({ category: "A", title: "Brandon's own", note: "", divisionCode: null, ownerInitials: null, initiativeName: null, priority: "Medium", status: "Open", dueDate: null, isPersonal: false, context: null });

    const person = await callTool(app, path, "get_agenda", { person: "vm" });
    assert.equal(person.content.length, 2);
    const agenda = parseText<Agenda>(person);
    assert.deepEqual(agenda.subject, { type: "person", key: "VM", label: "Vincent Moynihan" });
    assert.deepEqual(agenda.groups.map((g) => g.category), ["NB", "A"]);
    const markdown = textOf(person, 1);
    assert.match(markdown, /^# Agenda — Vincent Moynihan/);
    assert.ok(markdown.includes("Pitch the glass package"));
    assert.ok(markdown.includes("- Parked:"));
    assert.equal(markdown, agenda.markdown);

    const division = parseText<Agenda>(await callTool(app, path, "get_agenda", { division: "HG", includeDone: true }));
    assert.deepEqual(division.subject, { type: "division", key: "HG", label: "Henderson Glass" });

    const me = parseText<Agenda>(await callTool(app, path, "get_agenda", {}));
    assert.deepEqual(me.subject, { type: "person", key: "BS", label: "Brandon Stone" });
    assert.ok(me.groups.some((g) => g.active.some((i) => i.title === "Brandon's own")));

    const both = await callTool(app, path, "get_agenda", { person: "VM", division: "HG" });
    assert.equal(both.isError, true);
    const unknown = await callTool(app, path, "get_agenda", { person: "ZZ" });
    assert.equal(unknown.isError, true);
    assert.match(textOf(unknown), /Unknown person: ZZ/);
  });

  it("get_today, search, list_reference and add_brief round-trip through the repo", async () => {
    const { app, path, repo } = setup();
    repo.createItem({ category: "A", title: "Overdue thing", note: "glass margins", divisionCode: null, ownerInitials: null, initiativeName: null, priority: "Medium", status: "Open", dueDate: "2020-01-01", isPersonal: false, context: null });

    const today = parseText<TodayView & { today: string }>(await callTool(app, path, "get_today", {}));
    assert.deepEqual(today.overdue.map((i) => i.title), ["Overdue thing"]);
    assert.equal(today.pendingCaptures, 0);
    assert.match(today.today, /^\d{4}-\d{2}-\d{2}$/);
    // Zero-argument tools also work when the client omits `arguments` entirely.
    const todayNoArgs = parseText<TodayView>(await callTool(app, path, "get_today"));
    assert.equal(todayNoArgs.overdue.length, 1);

    const search = parseText<SearchResult>(await callTool(app, path, "search", { q: "margins" }));
    assert.deepEqual(search.items.map((i) => i.title), ["Overdue thing"]);
    assert.deepEqual(search.captures, []);

    const reference = parseText<{ today: string; me: Person | null; people: Person[]; divisions: { code: string }[]; initiatives: { name: string }[] }>(
      await callTool(app, path, "list_reference", {}),
    );
    assert.equal(reference.me?.initials, "BS");
    assert.ok(reference.people.some((p) => p.initials === "VM"));
    assert.ok(reference.divisions.some((d) => d.code === "HG"));
    assert.deepEqual(reference.initiatives.map((i) => i.name), ["BAU"]);

    const brief = parseText<Brief>(await callTool(app, path, "add_brief", { kind: "email_digest", title: "Inbox 2–4 pm", bodyMd: "# Digest\n\n- one thing" }));
    assert.equal(brief.kind, "email_digest");
    assert.deepEqual(repo.listBriefs().map((b) => b.id), [brief.id]);

    const badBrief = await callTool(app, path, "add_brief", { kind: "memo", title: "x", bodyMd: "" });
    assert.equal(badBrief.isError, true);
  });

  it("enforces the token and the Streamable HTTP protocol rules", async () => {
    const { app, path } = setup();
    const wrongToken = await rpc(app, "/mcp/wrong", "tools/list", {});
    assert.equal(wrongToken.status, 401);

    const noAccept = await rpc(app, path, "tools/list", {}, { "content-type": "application/json" });
    assert.equal(noAccept.status, 406);

    const get = await app.request(path, { method: "GET", headers: { accept: "text/event-stream" } });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get("allow"), "POST");
    const getBody = (await get.json()) as RpcResponse;
    assert.equal(getBody.error?.code, -32000);

    const del = await app.request(path, { method: "DELETE" });
    assert.equal(del.status, 405);

    const unknownMethod = await rpc(app, path, "resources/list", {});
    assert.equal(unknownMethod.status, 200);
    const body = (await unknownMethod.json()) as RpcResponse;
    assert.equal(body.error?.code, -32601, "Method not found for unregistered capabilities");
  });
});

describe("MCP handler called directly with a constructed Request", () => {
  it("serves initialize → tools/list → tools/call list_items on a bare Hono route", async () => {
    const config = testConfig({ mcpToken: "t" });
    const db = openDatabase(":memory:");
    const handler = createMcpHandler({ db, config });
    const app = new Hono().all("/mcp", (c) => handler(c));

    const post = (body: unknown): Request =>
      new Request("http://localhost/mcp", { method: "POST", headers: { "content-type": "application/json", accept: ACCEPT_BOTH }, body: JSON.stringify(body) });

    const init = await app.request(post({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS }));
    assert.equal(init.status, 200);
    const initBody = (await init.json()) as RpcResponse;
    assert.equal((initBody.result as InitializeResult).serverInfo.name, "virginia");

    const list = await app.request(post({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    const listBody = (await list.json()) as RpcResponse;
    const names = (listBody.result as ToolsListResult).tools.map((t) => t.name);
    for (const name of MCP_TOOL_NAMES) assert.ok(names.includes(name), name);

    const call = await app.request(post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_items", arguments: {} } }));
    const callBody = (await call.json()) as RpcResponse;
    const result = callBody.result as ToolResult;
    assert.notEqual(result.isError, true);
    assert.deepEqual(JSON.parse(textOf(result)), []);
  });
});
