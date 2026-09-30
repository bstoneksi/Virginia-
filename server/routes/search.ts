/**
 * GET /search?q= — LIKE search over items (title/note/context) and captures (title/raw_text/context).
 */
import { Hono } from "hono";
import type { RouteDeps } from "./deps";

export function searchRouter(deps: RouteDeps): Hono {
  const router = new Hono();
  router.get("/search", (c) => c.json(deps.repo.search(c.req.query("q") ?? "")));
  return router;
}
