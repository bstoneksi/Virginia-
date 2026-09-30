/**
 * Items: list / create / get / patch / delete / reorder / comments (docs/SPEC.md §4).
 */
import { Hono } from "hono";
import type { Category, Status } from "../../shared/types";
import { NotFoundError } from "../lib/errors";
import type { RepoItemFilters } from "../db/repo";
import { boolParam, commentSchema, csvParam, intParam, itemDraftSchema, itemPatchSchema, parseJsonBody, reorderSchema } from "../lib/validate";
import type { RouteDeps } from "./deps";

export function itemsRouter(deps: RouteDeps): Hono {
  const { repo } = deps;
  const router = new Hono();

  // GET /items?status=Open,Parked&category=A,NB&division=HG&owner=VM&personal=1&includeDone=0&q=text&initiative=3
  router.get("/items", (c) => {
    const q = c.req.query();
    const filters: RepoItemFilters = {
      status: csvParam(q.status) as Status[] | undefined,
      category: csvParam(q.category) as Category[] | undefined,
      divisionCode: q.division ?? q.divisionCode,
      ownerInitials: q.owner ?? q.ownerInitials,
      personal: boolParam(q.personal),
      includeDone: boolParam(q.includeDone),
      initiativeId: intParam(q.initiative ?? q.initiativeId, "initiative"),
      q: q.q,
    };
    return c.json(repo.listItems(filters));
  });

  router.post("/items", async (c) => {
    const draft = await parseJsonBody(c, itemDraftSchema);
    return c.json(repo.createItem(draft), 201);
  });

  // Registered before /items/:id so the literal segment wins for POST.
  router.post("/items/reorder", async (c) => {
    const body = await parseJsonBody(c, reorderSchema);
    repo.reorderItems(body.status, body.orderedIds);
    return c.body(null, 204);
  });

  router.get("/items/:id", (c) => {
    const detail = repo.getItemDetail(c.req.param("id"));
    if (!detail) throw new NotFoundError(`Unknown item: ${c.req.param("id")}`);
    return c.json(detail);
  });

  router.patch("/items/:id", async (c) => {
    const patch = await parseJsonBody(c, itemPatchSchema);
    return c.json(repo.updateItem(c.req.param("id"), patch));
  });

  router.delete("/items/:id", (c) => {
    repo.deleteItem(c.req.param("id"));
    return c.body(null, 204);
  });

  router.post("/items/:id/comments", async (c) => {
    const { text } = await parseJsonBody(c, commentSchema);
    return c.json(repo.addComment(c.req.param("id"), text), 201);
  });

  return router;
}
