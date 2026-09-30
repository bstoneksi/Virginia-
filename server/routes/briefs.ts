/**
 * Briefs: summaries dropped in by the email-digest routine (via MCP) and shown on /briefs.
 */
import { Hono } from "hono";
import { briefCreateSchema, intParam, parseJsonBody } from "../lib/validate";
import type { RouteDeps } from "./deps";

export function briefsRouter(deps: RouteDeps): Hono {
  const { repo } = deps;
  const router = new Hono();

  router.get("/briefs", (c) => c.json(repo.listBriefs(intParam(c.req.query("limit"), "limit") ?? 20)));

  router.post("/briefs", async (c) => {
    const input = await parseJsonBody(c, briefCreateSchema);
    return c.json(repo.createBrief(input), 201);
  });

  router.delete("/briefs/:id", (c) => {
    repo.deleteBrief(c.req.param("id"));
    return c.body(null, 204);
  });

  return router;
}
