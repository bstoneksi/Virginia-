/**
 * Reference data: initiatives (Active / On Hold / Complete). No delete — set status Complete.
 */
import { Hono } from "hono";
import { idParam, initiativeCreateSchema, initiativePatchSchema, parseJsonBody } from "../lib/validate";
import type { RouteDeps } from "./deps";

export function initiativesRouter(deps: RouteDeps): Hono {
  const { repo } = deps;
  const router = new Hono();

  router.get("/initiatives", (c) => c.json(repo.listInitiatives()));

  router.post("/initiatives", async (c) => {
    const input = await parseJsonBody(c, initiativeCreateSchema);
    return c.json(repo.createInitiative(input), 201);
  });

  router.patch("/initiatives/:id", async (c) => {
    const id = idParam(c.req.param("id"));
    const patch = await parseJsonBody(c, initiativePatchSchema);
    return c.json(repo.updateInitiative(id, patch));
  });

  return router;
}
