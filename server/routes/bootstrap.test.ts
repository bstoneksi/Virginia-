import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Bootstrap } from "../../shared/types";
import { TEST_MCP_TOKEN, call, exampleAssistantConfig, exampleDivisions, examplePeople, json, makeTestApp } from "../lib/testing";

describe("GET /api/bootstrap", () => {
  it("returns the reference data, the model id and no connector URL while MCP_TOKEN is unset", async () => {
    const t = makeTestApp();
    const res = await call(t, "GET", "/api/bootstrap");
    assert.equal(res.status, 200);
    const body = await json<Bootstrap>(res);
    assert.equal(body.divisions.length, exampleDivisions.length);
    assert.equal(body.people.length, examplePeople.length);
    assert.equal(body.me?.initials, exampleAssistantConfig.owner.initials);
    assert.deepEqual(body.initiatives.map((i) => i.name), [exampleAssistantConfig.defaultInitiative]);
    assert.deepEqual(body.assistant, {
      name: exampleAssistantConfig.assistant.name,
      tagline: exampleAssistantConfig.assistant.tagline,
      ownerName: exampleAssistantConfig.owner.fullName,
      ownerInitials: exampleAssistantConfig.owner.initials,
      organization: exampleAssistantConfig.organization.name,
      organizationShort: exampleAssistantConfig.organization.shortName,
      timezone: exampleAssistantConfig.owner.timezone,
      themeColor: exampleAssistantConfig.branding.themeColor,
      accentColor: exampleAssistantConfig.branding.accentColor,
    });
    assert.equal(body.aiConfigured, false);
    assert.equal(body.anthropicModel, "claude-opus-5-5");
    assert.equal(body.mcpConfigured, false);
    assert.equal(body.mcpUrl, null);
    assert.equal(body.version, "test");
  });

  it("builds the connector URL from the request origin, honouring reverse-proxy headers", async () => {
    const t = makeTestApp({ mcpToken: TEST_MCP_TOKEN, anthropicApiKey: "sk-test", anthropicModel: "claude-sonnet-5-5" });
    const direct = await json<Bootstrap>(await call(t, "GET", "/api/bootstrap"));
    assert.equal(direct.aiConfigured, true);
    assert.equal(direct.anthropicModel, "claude-sonnet-5-5");
    assert.equal(direct.mcpConfigured, true);
    assert.equal(direct.mcpUrl, `http://localhost/mcp/${TEST_MCP_TOKEN}`);

    const proxied = await json<Bootstrap>(
      await call(t, "GET", "/api/bootstrap", undefined, { "x-forwarded-proto": "https", "x-forwarded-host": "virginia.up.railway.app" }),
    );
    assert.equal(proxied.mcpUrl, `https://virginia.up.railway.app/mcp/${TEST_MCP_TOKEN}`);
  });

  it("is behind the login like every other /api route", async () => {
    const t = makeTestApp({ mcpToken: TEST_MCP_TOKEN });
    assert.equal((await t.app.request("/api/bootstrap")).status, 401, "the connector URL must never leak to an anonymous request");
  });
});
