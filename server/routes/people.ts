/**
 * Reference data: people. Archive instead of delete (PATCH { archived: true }).
 */
import { Hono } from "hono";
import { idParam, parseJsonBody, personCreateSchema, personPatchSchema } from "../lib/validate";
import type { RouteDeps } from "./deps";

export function peopleRouter(deps: RouteDeps): Hono {
  const { repo } = deps;
  const router = new Hono();

  router.get("/people", (c) => c.json(repo.listPeople({ includeArchived: true })));

  router.post("/people", async (c) => {
    const input = await parseJsonBody(c, personCreateSchema);
    return c.json(repo.createPerson(input), 201);
  });

  router.patch("/people/:id", async (c) => {
    const id = idParam(c.req.param("id"));
    const patch = await parseJsonBody(c, personPatchSchema);
    return c.json(repo.updatePerson(id, patch));
  });

  return router;
}
