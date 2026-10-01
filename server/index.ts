import { serve } from "@hono/node-server";
import { createExtractor } from "./ai/extract";
import { createApp } from "./app";
import { toSeed } from "./assistantConfig";
import { loadConfig } from "./config";
import { openDatabase } from "./db/index";
import { parseImportFile } from "./import/excel";
import { createMcpHandler } from "./mcp/server";

const config = loadConfig();
const db = openDatabase(config.dataDir, { seed: toSeed(config.assistant) });

// Wire every module into the app (docs/SPEC.md §2). `createApp` keeps these optional so tests can build
// an app without them; here in the real boot all three are always present:
//  - extractProposals: Claude extraction; without ANTHROPIC_API_KEY it runs the rule parser alone.
//  - parseImportFile:  .xlsx/.xlsm/.csv → ImportPreview for Settings → Import.
//  - mcpHandler:       the Streamable HTTP connector behind /mcp/:token (503 until MCP_TOKEN is set).
const app = createApp({
  config,
  db,
  extractProposals: createExtractor({ apiKey: config.anthropicApiKey, model: config.anthropicModel }),
  parseImportFile,
  mcpHandler: createMcpHandler({ db, config }),
});

if (config.disableAuth) {
  console.warn("\n  ******************************************************************");
  console.warn("  *  DISABLE_AUTH=1 — the app is running WITHOUT a login. Dev only.  *");
  console.warn("  ******************************************************************\n");
}
if (config.anthropicApiKey) {
  console.log(`[boot] Claude extraction enabled (model ${config.anthropicModel}).`);
} else {
  console.warn("[boot] ANTHROPIC_API_KEY not set — captures will only parse explicitly tagged lines.");
}
if (config.mcpToken) {
  console.log("[boot] MCP connector enabled at /mcp/<MCP_TOKEN> — Settings → Connector shows the full URL.");
} else {
  console.warn("[boot] MCP_TOKEN not set — the /mcp connector endpoint is disabled.");
}

// A stray rejected promise (outside a request handler) should be visible in the log, not take the server down.
process.on("unhandledRejection", (reason) => {
  console.error("[boot] unhandled promise rejection:", reason);
});

const server = serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[boot] ${config.assistant.assistant.name} v${config.version} listening on http://localhost:${info.port}  (data: ${config.dataDir})`);
});

function shutdown(signal: string): void {
  console.log(`[boot] ${signal} received, shutting down`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
