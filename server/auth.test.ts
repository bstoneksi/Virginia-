import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { SESSION_COOKIE, makeSessionCookieValue, parseSessionCookie, safeEqualStrings } from "./auth";
import { TEST_MCP_TOKEN, TEST_PASSWORD, TEST_SECRET, anon, call, json, makeTestApp } from "./lib/testing";

async function login(t: ReturnType<typeof makeTestApp>, password: string, headers: Record<string, string> = {}): Promise<Response> {
  return anon(t, "POST", "/api/auth/login", { password }, headers);
}

function cookieFrom(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
}

describe("auth primitives", () => {
  it("signs and verifies session cookies", () => {
    const id = randomUUID();
    const value = makeSessionCookieValue(id, TEST_SECRET);
    assert.equal(parseSessionCookie(value, TEST_SECRET), id);
    assert.equal(parseSessionCookie(value, "other-secret"), null);
    assert.equal(parseSessionCookie(`${value.slice(0, -1)}${value.endsWith("a") ? "b" : "a"}`, TEST_SECRET), null);
    assert.equal(parseSessionCookie("garbage", TEST_SECRET), null);
    assert.equal(parseSessionCookie(undefined, TEST_SECRET), null);
    assert.equal(safeEqualStrings("abc", "abc"), true);
    assert.equal(safeEqualStrings("abc", "abcd"), false);
  });
});

describe("requireAuth", () => {
  it("lets health through and rejects everything else without credentials", async () => {
    const t = makeTestApp();
    const health = await anon(t, "GET", "/api/health");
    assert.equal(health.status, 200);
    assert.equal((await json<{ ok: boolean }>(health)).ok, true);

    for (const [method, url] of [
      ["GET", "/api/items"],
      ["GET", "/api/auth/me"],
      ["GET", "/api/bootstrap"],
      ["POST", "/api/items"],
      ["GET", "/api/today"],
    ] as const) {
      const res = await anon(t, method, url);
      assert.equal(res.status, 401, `${method} ${url}`);
      assert.deepEqual(await res.json(), { error: "Unauthorized" });
    }
  });

  it("rejects a tampered or unknown session cookie", async () => {
    const t = makeTestApp();
    const tampered = t.cookie.slice(0, -1) + (t.cookie.endsWith("0") ? "1" : "0");
    assert.equal((await anon(t, "GET", "/api/items", undefined, { cookie: tampered })).status, 401);
    const unknown = `${SESSION_COOKIE}=${makeSessionCookieValue(randomUUID(), TEST_SECRET)}`;
    assert.equal((await anon(t, "GET", "/api/items", undefined, { cookie: unknown })).status, 401);
    assert.equal((await call(t, "GET", "/api/items")).status, 200);
  });

  it("accepts Authorization: Bearer <MCP_TOKEN> only when a token is configured", async () => {
    const withToken = makeTestApp({ mcpToken: TEST_MCP_TOKEN });
    assert.equal((await anon(withToken, "GET", "/api/items", undefined, { authorization: `Bearer ${TEST_MCP_TOKEN}` })).status, 200);
    assert.equal((await anon(withToken, "GET", "/api/items", undefined, { authorization: "Bearer wrong" })).status, 401);
    assert.equal((await anon(withToken, "GET", "/api/items", undefined, { authorization: TEST_MCP_TOKEN })).status, 401);
    const withoutToken = makeTestApp();
    assert.equal((await anon(withoutToken, "GET", "/api/items", undefined, { authorization: `Bearer ${TEST_MCP_TOKEN}` })).status, 401);
  });

  it("is a no-op when DISABLE_AUTH is set", async () => {
    const t = makeTestApp({ disableAuth: true });
    assert.equal((await anon(t, "GET", "/api/items")).status, 200);
    assert.deepEqual(await json(await anon(t, "GET", "/api/auth/me")), { authenticated: true });
    assert.equal((await login(t, "anything")).status, 204);
  });
});

describe("login / logout", () => {
  it("rejects a wrong password with 401 after a delay", async () => {
    const t = makeTestApp();
    const started = performance.now();
    const res = await login(t, "wrong");
    const elapsed = performance.now() - started;
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Invalid password" });
    assert.equal(res.headers.get("set-cookie"), null);
    assert.ok(elapsed >= 280, `expected ~300ms delay, got ${elapsed.toFixed(0)}ms`);
  });

  it("validates the body", async () => {
    const t = makeTestApp();
    assert.equal((await login(t, 42 as never)).status, 422);
    assert.equal((await anon(t, "POST", "/api/auth/login", undefined, { "content-type": "application/json" })).status, 422);
    const res = await t.app.request("/api/auth/login", { method: "POST", body: "{not json", headers: { "content-type": "application/json" } });
    assert.equal(res.status, 422);
  });

  it("sets a signed, HttpOnly, 90-day cookie that authenticates later requests", async () => {
    const t = makeTestApp();
    const res = await login(t, TEST_PASSWORD);
    assert.equal(res.status, 204);
    const setCookie = res.headers.get("set-cookie") ?? "";
    assert.match(setCookie, new RegExp(`^${SESSION_COOKIE}=[0-9a-f-]{36}\\.[0-9a-f]{64};`));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\//);
    assert.match(setCookie, /Max-Age=7776000/);
    assert.doesNotMatch(setCookie, /Secure/i, "localhost never gets Secure");

    const cookie = cookieFrom(res);
    const id = parseSessionCookie(cookie.slice(cookie.indexOf("=") + 1), TEST_SECRET);
    assert.ok(id && t.repo.getSession(id), "session row exists");

    const me = await anon(t, "GET", "/api/auth/me", undefined, { cookie });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { authenticated: true });
    assert.equal((await anon(t, "GET", "/api/items", undefined, { cookie })).status, 200);
  });

  it("marks the cookie Secure on https (behind a proxy) but not on localhost", async () => {
    const dev = makeTestApp({ isProduction: false });
    const plain = await login(dev, TEST_PASSWORD);
    assert.doesNotMatch(plain.headers.get("set-cookie") ?? "", /Secure/i);
    // Plain http from a phone on the LAN in dev: a Secure cookie would never come back, so none is set (SPEC §10).
    const lan = await login(dev, TEST_PASSWORD, { "x-forwarded-host": "192.168.1.20:3000" });
    assert.equal(lan.status, 204);
    assert.doesNotMatch(lan.headers.get("set-cookie") ?? "", /Secure/i, "http on a non-localhost host in dev stays usable");
    const proxied = await login(dev, TEST_PASSWORD, { "x-forwarded-proto": "https", "x-forwarded-host": "virginia.up.railway.app" });
    assert.match(proxied.headers.get("set-cookie") ?? "", /;\s*Secure/i);

    const prod = makeTestApp({ isProduction: true });
    const prodRemote = await login(prod, TEST_PASSWORD, { "x-forwarded-host": "virginia.example.com" });
    assert.match(prodRemote.headers.get("set-cookie") ?? "", /;\s*Secure/i);
    const prodLocal = await login(prod, TEST_PASSWORD, { "x-forwarded-host": "localhost:3000" });
    assert.doesNotMatch(prodLocal.headers.get("set-cookie") ?? "", /Secure/i);
  });

  it("logout deletes the session and clears the cookie", async () => {
    const t = makeTestApp();
    const cookie = cookieFrom(await login(t, TEST_PASSWORD));
    const out = await anon(t, "POST", "/api/auth/logout", undefined, { cookie });
    assert.equal(out.status, 204);
    const cleared = out.headers.get("set-cookie") ?? "";
    assert.match(cleared, new RegExp(`^${SESSION_COOKIE}=;`));
    assert.match(cleared, /Max-Age=0/);
    assert.equal((await anon(t, "GET", "/api/auth/me", undefined, { cookie })).status, 401);
    assert.equal((await anon(t, "POST", "/api/auth/logout")).status, 401, "logout itself requires auth");
  });
});

describe("/mcp/:token", () => {
  it("answers 503 when no MCP token is configured", async () => {
    const t = makeTestApp();
    const res = await anon(t, "POST", "/mcp/whatever", { jsonrpc: "2.0" });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "MCP not configured" });
    assert.equal((await call(t, "GET", "/mcp/whatever")).status, 503);
  });

  it("requires the exact token, then needs a handler", async () => {
    const noHandler = makeTestApp({ mcpToken: TEST_MCP_TOKEN });
    assert.equal((await anon(noHandler, "POST", "/mcp/wrong-token", {})).status, 401);
    assert.equal((await anon(noHandler, "POST", `/mcp/${TEST_MCP_TOKEN}`, {})).status, 503);
    // A valid cookie does not substitute for the path token.
    assert.equal((await call(noHandler, "POST", "/mcp/wrong-token", {})).status, 401);

    const seen: string[] = [];
    const withHandler = makeTestApp(
      { mcpToken: TEST_MCP_TOKEN },
      {
        mcpHandler: async (c) => {
          seen.push(c.req.method);
          return c.json({ ok: true });
        },
      },
    );
    const res = await anon(withHandler, "POST", `/mcp/${TEST_MCP_TOKEN}`, { jsonrpc: "2.0", method: "initialize" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal((await anon(withHandler, "DELETE", `/mcp/${TEST_MCP_TOKEN}`)).status, 200);
    assert.deepEqual(seen, ["POST", "DELETE"]);
    // /mcp/* also covers the bare /mcp path: anonymous callers get 401, authenticated ones 404.
    assert.equal((await anon(withHandler, "GET", "/mcp")).status, 401);
    assert.equal((await call(withHandler, "GET", "/mcp")).status, 404);
  });
});
