/**
 * GET /bootstrap — everything the client needs on first load (docs/SPEC.md §4).
 *
 * Besides the reference data it carries two settings-page facts: the extraction model id and the full
 * MCP connector URL (SPEC §6: "Settings page shows the full URL to paste into Claude"). The URL embeds
 * MCP_TOKEN, so it is only ever returned here — behind `requireAuth` — and is null until a token is set.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Bootstrap } from "../../shared/types";
import type { RouteDeps } from "./deps";

function firstHeaderValue(value: string | undefined): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}

/** The origin the browser used, honouring a reverse proxy's X-Forwarded-Proto / X-Forwarded-Host (Railway). */
export function publicOrigin(c: Context): string {
  const url = new URL(c.req.url);
  const proto = firstHeaderValue(c.req.header("x-forwarded-proto")) ?? url.protocol.replace(/:$/, "");
  const host = firstHeaderValue(c.req.header("x-forwarded-host")) ?? firstHeaderValue(c.req.header("host")) ?? url.host;
  return `${proto}://${host}`;
}

export function bootstrapRouter(deps: RouteDeps): Hono {
  const { repo, config } = deps;
  const router = new Hono();

  router.get("/bootstrap", (c) => {
    const body: Bootstrap = {
      divisions: repo.listDivisions({ includeArchived: true }),
      people: repo.listPeople({ includeArchived: true }),
      initiatives: repo.listInitiatives(),
      me: repo.getMe(),
      aiConfigured: config.anthropicApiKey !== null,
      anthropicModel: config.anthropicModel,
      mcpConfigured: config.mcpToken !== null,
      mcpUrl: config.mcpToken === null ? null : `${publicOrigin(c)}/mcp/${encodeURIComponent(config.mcpToken)}`,
      version: config.version,
    };
    return c.json(body);
  });

  return router;
}
