import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import { HTTPException } from "hono/http-exception";
import type { Config } from "./config";
import type { Db } from "./db/index";
import type { HealthResponse } from "../shared/types";
import type { ExtractProposalsFn, McpRequestHandler, ParseImportFileFn } from "./contracts";
import { createRepo } from "./db/repo";
import { mcpTokenMatches, requireAuth } from "./auth";
import { isHttpError } from "./lib/errors";
import { createApiRouter } from "./routes/index";
import type { RouteDeps } from "./routes/deps";

export interface AppDeps {
  config: Config;
  db: Db;
  /** server/ai — Claude extraction. Without it, captures only parse explicitly tagged lines. */
  extractProposals?: ExtractProposalsFn;
  /** server/import — workbook / CSV parsing. Without it, /api/import/preview answers 501. */
  parseImportFile?: ParseImportFileFn;
  /** server/mcp — Streamable HTTP handler for /mcp/:token. Without it, /mcp answers 503. */
  mcpHandler?: McpRequestHandler;
}

/**
 * Largest request body accepted on /api/* and /mcp/*: a capture with 8 images of 10 MB each plus form
 * overhead (imports are 25 MB, JSON bodies far smaller). Checked before the body is buffered.
 */
export const MAX_REQUEST_BYTES = 96 * 1024 * 1024;

/** `/mcp/<MCP_TOKEN>` appears in request paths; the dev logger must never print the credential. */
export function redactMcpToken(line: string): string {
  return line.replace(/\/mcp\/[^\s/?#]+/g, "/mcp/<token>");
}

/** Paths that can only be static assets: a missing one is a 404, not the SPA shell. */
export function isAssetPath(pathname: string): boolean {
  if (pathname.startsWith("/assets/") || pathname.startsWith("/icons/")) return true;
  return /^\/[^/]+\.(?:ico|png|jpe?g|gif|svg|webp|avif|js|mjs|css|map|json|txt|xml|webmanifest|woff2?|ttf|otf)$/i.test(pathname);
}

/**
 * Build the Hono application. Kept separate from `index.ts` so tests can create an app
 * against an in-memory database without listening on a port.
 *
 * Route modules (server/routes/*) are mounted here under /api; the MCP endpoint under /mcp.
 * Everything else falls through to the built client (SPA).
 */
export function createApp(deps: AppDeps): Hono {
  const { config, db } = deps;
  const app = new Hono();

  if (!config.isProduction) app.use(logger((line) => console.log(redactMcpToken(line))));

  // --- health (no auth) -----------------------------------------------------
  app.get("/api/health", (c) => {
    let dbStatus: HealthResponse["db"] = "ok";
    try {
      db.prepare("SELECT 1").get();
    } catch {
      dbStatus = "error";
    }
    const body: HealthResponse = { ok: dbStatus === "ok", version: config.version, db: dbStatus };
    return c.json(body, dbStatus === "ok" ? 200 : 503);
  });

  // --- auth + body ceiling + API routers ------------------------------------
  const routeDeps: RouteDeps = { ...deps, repo: createRepo(db) };
  app.use("/api/*", requireAuth(routeDeps));
  app.use("/mcp/*", requireAuth(routeDeps));
  const limit = bodyLimit({
    maxSize: MAX_REQUEST_BYTES,
    onError: (c) => c.json({ error: `Request body is too large (limit ${Math.round(MAX_REQUEST_BYTES / 1024 / 1024)} MB)` }, 413),
  });
  app.use("/api/*", limit);
  app.use("/mcp/*", limit);
  app.route("/api", createApiRouter(routeDeps));

  // --- MCP connector: POST/GET/DELETE /mcp/:token -------------------------------
  app.all("/mcp/:token", async (c) => {
    if (config.mcpToken === null) return c.json({ error: "MCP not configured" }, 503);
    if (!mcpTokenMatches(c.req.param("token"), config)) return c.json({ error: "Unauthorized" }, 401);
    if (!deps.mcpHandler) return c.json({ error: "MCP not configured" }, 503);
    return deps.mcpHandler(c);
  });

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/mcp")) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.text("Not found", 404);
  });

  // --- static client + SPA fallback -----------------------------------------
  const distRel = path.relative(process.cwd(), config.clientDistDir).split(path.sep).join("/") || ".";
  app.use("/*", serveStatic({ root: distRel }));
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/mcp")) {
      return c.json({ error: "Not found" }, 404);
    }
    // A missing asset must surface as a 404 in devtools, not as a 200 copy of index.html.
    if (isAssetPath(c.req.path)) return c.text("Not found", 404);
    const indexPath = path.join(config.clientDistDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      return c.text("Virginia API is running, but the client has not been built. Run `npm run build` (or use `npm run dev`).", 200);
    }
    return c.html(fs.readFileSync(indexPath, "utf8"));
  });

  app.onError((err, c) => {
    // Repo / validation errors carry their own status (422, 404, 409, 413, 501, ...).
    if (isHttpError(err)) return c.json(err.toBody(), err.status);
    if (err instanceof HTTPException) return err.getResponse();
    console.error(`[app] ${c.req.method} ${c.req.path}:`, err);
    return c.json({ error: err.message || "Internal error" }, 500);
  });

  return app;
}
