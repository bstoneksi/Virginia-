import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { openDatabase } from "./db/index";
import { createApp } from "./app";

const config = loadConfig();
const db = openDatabase(config.dataDir);
const app = createApp({ config, db });

if (config.disableAuth) {
  console.warn("\n  ******************************************************************");
  console.warn("  *  DISABLE_AUTH=1 — the app is running WITHOUT a login. Dev only.  *");
  console.warn("  ******************************************************************\n");
}
if (!config.anthropicApiKey) {
  console.warn("[boot] ANTHROPIC_API_KEY not set — captures will only parse explicitly tagged lines.");
}
if (!config.mcpToken) {
  console.warn("[boot] MCP_TOKEN not set — the /mcp connector endpoint is disabled.");
}

const server = serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[boot] Virginia v${config.version} listening on http://localhost:${info.port}  (data: ${config.dataDir})`);
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
