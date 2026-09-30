import { Hono } from "hono";
import { authRouter } from "../auth";
import { agendaRouter } from "./agenda";
import { bootstrapRouter } from "./bootstrap";
import { briefsRouter } from "./briefs";
import { capturesRouter } from "./captures";
import type { RouteDeps } from "./deps";
import { divisionsRouter } from "./divisions";
import { importerRouter } from "./importer";
import { initiativesRouter } from "./initiatives";
import { itemsRouter } from "./items";
import { peopleRouter } from "./people";
import { searchRouter } from "./search";
import { todayRouter } from "./today";

/** Every /api router composed into one sub-app; `createApp` mounts it at `/api` after `requireAuth`. */
export function createApiRouter(deps: RouteDeps): Hono {
  const api = new Hono();
  api.route("/", authRouter(deps));
  api.route("/", bootstrapRouter(deps));
  api.route("/", itemsRouter(deps));
  api.route("/", agendaRouter(deps));
  api.route("/", todayRouter(deps));
  api.route("/", searchRouter(deps));
  api.route("/", peopleRouter(deps));
  api.route("/", divisionsRouter(deps));
  api.route("/", initiativesRouter(deps));
  api.route("/", capturesRouter(deps));
  api.route("/", importerRouter(deps));
  api.route("/", briefsRouter(deps));
  return api;
}
