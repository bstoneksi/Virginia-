import { serve } from "@hono/node-server";
import { createExtractor } from "./ai/extract";
import { createApp } from "./app";
import { createEmailSender } from "./brief/email";
import { startBriefScheduler } from "./brief/scheduler";
import type { BriefScheduler } from "./brief/scheduler";
import { toSeed } from "./assistantConfig";
import { loadConfig } from "./config";
import { openDatabase } from "./db/index";
import { createRepo } from "./db/repo";
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

// Daily brief (server/brief): a 60 s unref'd interval generates the brief at BRIEF_TIME on BRIEF_DAYS (Detroit),
// catching up after 07:00 if the server was asleep. Off under NODE_ENV=test and BRIEF_ENABLED=0; the
// Briefs page "run now" route and the MCP tool work regardless.
const emailSender = createEmailSender(config);
let briefScheduler: BriefScheduler | null = null;
if (process.env.NODE_ENV === "test") {
  console.log("[boot] Daily brief scheduler skipped (NODE_ENV=test).");
} else if (!config.briefEnabled) {
  console.log("[boot] Daily brief scheduler disabled (BRIEF_ENABLED=0).");
} else {
  briefScheduler = startBriefScheduler({
    repo: createRepo(db),
    sender: emailSender,
    to: config.briefEmailTo,
    time: config.briefTime,
    days: config.briefDays,
    sections: config.briefSections,
    scope: config.briefScope,
  });
  const days = config.briefDays.length === 7 ? "every day" : config.briefDays.join(", ");
  const email = emailSender.configured ? `emailed to ${config.briefEmailTo} (${emailSender.description})` : "email not configured — set RESEND_API_KEY";
  console.log(`[boot] Daily brief at ${config.briefTime} America/Detroit, ${days}; ${email}.`);
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
  briefScheduler?.stop();
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
