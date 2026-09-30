/**
 * GET /today — Brandon's priority list (docs/SPEC.md §4/§8). Buckets come from shared/agenda.ts.
 */
import { Hono } from "hono";
import { todayBuckets } from "../../shared/agenda";
import type { TodayView } from "../../shared/types";
import { nowISO, todayISO } from "../db/index";
import type { Repo } from "../db/repo";
import type { RouteDeps } from "./deps";

/** Exported for the MCP `get_today` tool. */
export function buildToday(repo: Repo, now: Date = new Date()): TodayView {
  const me = repo.getMe();
  const items = repo.listItems({ includeDone: false });
  const buckets = todayBuckets(items, todayISO(now), me?.initials ?? null, nowISO());
  return { ...buckets, pendingCaptures: repo.countPendingCaptures() };
}

export function todayRouter(deps: RouteDeps): Hono {
  const router = new Hono();
  router.get("/today", (c) => c.json(buildToday(deps.repo)));
  return router;
}
