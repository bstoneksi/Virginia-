import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Config } from "./config";
import type { Db } from "./db/index";
import type { HealthResponse } from "../shared/types";

export interface AppDeps {
  config: Config;
  db: Db;
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

  if (!config.isProduction) app.use(logger());

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

  // TODO(integration): mount auth middleware + API routers here, e.g.
  //   app.use("/api/*", requireAuth(deps));
  //   app.route("/api", itemsRouter(deps)); ...
  //   app.all("/mcp/:token", mcpHandler(deps));

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
    const indexPath = path.join(config.clientDistDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      return c.text("Virginia API is running, but the client has not been built. Run `npm run build` (or use `npm run dev`).", 200);
    }
    return c.html(fs.readFileSync(indexPath, "utf8"));
  });

  app.onError((err, c) => {
    console.error(`[app] ${c.req.method} ${c.req.path}:`, err);
    return c.json({ error: err.message || "Internal error" }, 500);
  });

  return app;
}
