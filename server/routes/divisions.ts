/**
 * Reference data: divisions (brands / functions / personal). Archive instead of delete.
 */
import { Hono } from "hono";
import { divisionCreateSchema, divisionPatchSchema, parseJsonBody } from "../lib/validate";
import type { RouteDeps } from "./deps";

export function divisionsRouter(deps: RouteDeps): Hono {
  const { repo } = deps;
  const router = new Hono();

  router.get("/divisions", (c) => c.json(repo.listDivisions({ includeArchived: true })));

  router.post("/divisions", async (c) => {
    const input = await parseJsonBody(c, divisionCreateSchema);
    return c.json(repo.createDivision(input), 201);
  });

  router.patch("/divisions/:code", async (c) => {
    const patch = await parseJsonBody(c, divisionPatchSchema);
    return c.json(repo.updateDivision(c.req.param("code"), patch));
  });

  return router;
}
