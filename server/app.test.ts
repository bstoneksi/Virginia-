import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_REQUEST_BYTES, isAssetPath, redactMcpToken } from "./app";
import { anon, call, json, makeTestApp } from "./lib/testing";

describe("app: request logging and body limits", () => {
  it("redacts the MCP token from logged request paths", () => {
    assert.equal(redactMcpToken("<-- POST /mcp/s3cret-token"), "<-- POST /mcp/<token>");
    assert.equal(redactMcpToken("--> GET /mcp/s3cret?x=1 405 2ms"), "--> GET /mcp/<token>?x=1 405 2ms");
    assert.equal(redactMcpToken("<-- GET /api/items"), "<-- GET /api/items");
    assert.equal(redactMcpToken("<-- GET /mcp"), "<-- GET /mcp");
  });

  it("answers 413 JSON for an oversized body before reading it, after auth", async () => {
    const t = makeTestApp({ mcpToken: "tok" });
    const oversized = { "content-type": "application/json", "content-length": String(MAX_REQUEST_BYTES + 1) };
    const res = await t.app.request("/api/items", { method: "POST", headers: { cookie: t.cookie, ...oversized }, body: "{}" });
    assert.equal(res.status, 413);
    assert.match((await json<{ error: string }>(res)).error, /too large/);
    const mcp = await t.app.request("/mcp/tok", { method: "POST", headers: { accept: "application/json, text/event-stream", ...oversized }, body: "{}" });
    assert.equal(mcp.status, 413);
    // No credentials: still a plain 401, whatever the declared size.
    assert.equal((await t.app.request("/api/items", { method: "POST", headers: oversized, body: "{}" })).status, 401);
    // Ordinary bodies are untouched.
    const ok = await call(t, "POST", "/api/items", { title: "fits" });
    assert.equal(ok.status, 201);
  });
});

describe("app: SPA fallback", () => {
  it("serves the shell for app routes but 404 for missing assets", async () => {
    assert.equal(isAssetPath("/icons/icon-192.png"), true);
    assert.equal(isAssetPath("/assets/index-abc123.js"), true);
    assert.equal(isAssetPath("/favicon.ico"), true);
    assert.equal(isAssetPath("/robots.txt"), true);
    assert.equal(isAssetPath("/board"), false);
    assert.equal(isAssetPath("/people/VM"), false);
    assert.equal(isAssetPath("/people/V.M"), false, "a dotted initials segment is a page, not a file");
    assert.equal(isAssetPath("/capture/0b2f-1"), false);

    const t = makeTestApp();
    assert.equal((await anon(t, "GET", "/icons/does-not-exist.png")).status, 404);
    assert.equal((await anon(t, "GET", "/favicon.ico")).status, 404);
    assert.equal((await anon(t, "GET", "/assets/nope.js")).status, 404);
    const shell = await anon(t, "GET", "/board");
    assert.equal(shell.status, 200, "app routes fall through to the client shell");
    assert.equal((await anon(t, "GET", "/api/nope")).status, 401, "unknown API paths still need auth");
    assert.equal((await call(t, "GET", "/api/nope")).status, 404);
  });
});
