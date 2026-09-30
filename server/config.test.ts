import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("refuses DISABLE_AUTH in production and demands real credentials otherwise", () => {
    assert.throws(() => loadConfig({ NODE_ENV: "production", DISABLE_AUTH: "1" }), /DISABLE_AUTH is not allowed with NODE_ENV=production/);
    assert.throws(() => loadConfig({ NODE_ENV: "production", DISABLE_AUTH: "true", APP_PASSWORD: "x".repeat(20), SESSION_SECRET: "y".repeat(32) }), /not allowed/);
    assert.throws(() => loadConfig({ NODE_ENV: "production" }), /APP_PASSWORD/);
    assert.throws(() => loadConfig({ APP_PASSWORD: "change-me", SESSION_SECRET: "y".repeat(32) }), /APP_PASSWORD/);
    assert.throws(() => loadConfig({ APP_PASSWORD: "long enough passphrase", SESSION_SECRET: "short" }), /SESSION_SECRET/);
  });

  it("reads the environment once with sane defaults", () => {
    const dev = loadConfig({ DISABLE_AUTH: "1", PORT: "3123" });
    assert.equal(dev.disableAuth, true);
    assert.equal(dev.isProduction, false);
    assert.equal(dev.port, 3123);
    assert.equal(dev.anthropicApiKey, null);
    assert.equal(dev.anthropicModel, "claude-opus-5-5");
    assert.equal(dev.mcpToken, null);

    const prod = loadConfig({ NODE_ENV: "production", APP_PASSWORD: "long enough passphrase", SESSION_SECRET: "0123456789abcdef", MCP_TOKEN: "tok", DATA_DIR: "/data" });
    assert.equal(prod.isProduction, true);
    assert.equal(prod.disableAuth, false);
    assert.equal(prod.mcpToken, "tok");
    assert.equal(prod.port, 3000);
    assert.match(prod.dataDir.replace(/\\/g, "/"), /\/data$/);
  });
});
