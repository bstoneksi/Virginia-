import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Hono } from "hono";
import { createApp } from "../app";
import { openDatabase, todayISO } from "../db/index";
import { createRepo } from "../db/repo";
import { testConfig } from "../lib/testing";
import { MCP_TOOL_NAMES, createMcpHandler } from "../mcp/server";
import { BRIEF_SETTING_KEYS } from "./run";
import type { DailyBriefRunResult } from "./run";

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
interface ToolsListResult {
  tools: { name: string; description?: string; inputSchema: { type: string }; annotations?: Record<string, unknown> }[];
}

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
let nextId = 1;

async function rpcResult<T>(app: Hono, method: string, params?: unknown): Promise<T> {
  const res = await app.request("/mcp/t", { method: "POST", headers: HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }) });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as RpcResponse;
  assert.equal(body.error, undefined, JSON.stringify(body.error));
  return body.result as T;
}

describe("MCP tool run_daily_brief", () => {
  it("is advertised as a write tool and runs the daily brief exactly like POST /api/briefs/daily/run", async () => {
    const config = testConfig({ mcpToken: "t" });
    const db = openDatabase(":memory:");
    const repo = createRepo(db);
    const app = createApp({ config, db, mcpHandler: createMcpHandler({ db, config }) });

    assert.ok(MCP_TOOL_NAMES.includes("run_daily_brief"));
    const list = await rpcResult<ToolsListResult>(app, "tools/list", {});
    const tool = list.tools.find((t) => t.name === "run_daily_brief");
    assert.ok(tool, "run_daily_brief is listed");
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.annotations?.readOnlyHint, false);
    assert.match(tool.description ?? "", /Briefs page/);
    assert.equal(list.tools.length, MCP_TOOL_NAMES.length, "the existing tools are untouched");

    // Zero-argument call: `arguments` omitted entirely.
    const result = await rpcResult<ToolResult>(app, "tools/call", { name: "run_daily_brief" });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const block = result.content[0];
    assert.ok(block && block.type === "text" && typeof block.text === "string");
    const run = JSON.parse(block.text) as DailyBriefRunResult;
    assert.equal(run.brief.kind, "daily");
    assert.match(run.brief.title, /^Daily brief — /);
    assert.equal(run.emailed, false, "no RESEND_API_KEY in the test config");
    assert.equal(run.emailError, null);
    assert.ok(run.brief.bodyMd.includes("## Latest email digest\nNo digest yet."));

    assert.deepEqual(repo.listBriefs().map((b) => b.id), [run.brief.id]);
    assert.equal(repo.getSetting(BRIEF_SETTING_KEYS.lastRunDate), todayISO(), "counts as today's scheduled run");

    // Running by hand again generates another brief (the scheduler is what dedupes per day, not the tool).
    const again = await rpcResult<ToolResult>(app, "tools/call", { name: "run_daily_brief", arguments: {} });
    assert.notEqual(again.isError, true);
    assert.equal(repo.listBriefs().length, 2);
  });
});
