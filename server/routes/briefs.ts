/**
 * Briefs: summaries dropped in by the email-digest routine (via MCP), the app-built daily brief and
 * Brandon's own notes, all shown on /briefs.
 *
 * Daily brief (server/brief):
 *   GET  /briefs/status         → DailyBriefStatus (schedule, last run, last email error, email configured)
 *   GET  /briefs/daily/preview  → today's brief as it would be generated now; nothing is stored or emailed
 *   POST /briefs/daily/run      → build, store (kind "daily"), email when configured → DailyBriefRunResult
 */
import { Hono } from "hono";
import type { DailyBriefPreview } from "../../shared/types";
import { buildDailyBrief } from "../brief/build";
import { createEmailSender } from "../brief/email";
import { getDailyBriefStatus, runDailyBrief } from "../brief/run";
import { todayISO } from "../db/index";
import { briefCreateSchema, intParam, parseJsonBody } from "../lib/validate";
import type { RouteDeps } from "./deps";

// The preview payload type lives in shared/types.ts (the Settings page renders it); re-exported for the route tests.
export type { DailyBriefPreview };

export function briefsRouter(deps: RouteDeps): Hono {
  const { repo, config } = deps;
  const sender = createEmailSender(config);
  const router = new Hono();

  router.get("/briefs", (c) => c.json(repo.listBriefs(intParam(c.req.query("limit"), "limit") ?? 20)));

  router.post("/briefs", async (c) => {
    const input = await parseJsonBody(c, briefCreateSchema);
    return c.json(repo.createBrief(input), 201);
  });

  router.get("/briefs/status", (c) => c.json(getDailyBriefStatus(repo, config, sender)));

  router.get("/briefs/daily/preview", (c) => {
    const now = new Date();
    const content = buildDailyBrief(repo, { todayISO: todayISO(now), now, sections: config.briefSections, scope: config.briefScope });
    const body: DailyBriefPreview = { title: content.title, bodyMd: content.bodyMd, html: content.html, plainText: content.plainText };
    return c.json(body);
  });

  router.post("/briefs/daily/run", async (c) =>
    c.json(await runDailyBrief({ repo, sender, to: config.briefEmailTo, sections: config.briefSections, scope: config.briefScope })),
  );

  router.delete("/briefs/:id", (c) => {
    repo.deleteBrief(c.req.param("id"));
    return c.body(null, 204);
  });

  return router;
}
