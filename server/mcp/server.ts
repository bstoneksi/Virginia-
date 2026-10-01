/**
 * server/mcp/server.ts — the MCP connector (docs/SPEC.md §6).
 *
 * Streamable HTTP in stateless mode: every request gets a fresh McpServer + transport (no session ids,
 * JSON responses instead of SSE, so a curl round trip is readable and nothing lingers after the
 * response). Auth is finished before we are called — `createApp` verifies the `/mcp/:token` path token
 * and `requireAuth` accepts it — so the handler only speaks JSON-RPC.
 *
 * Tools run straight against the Repo (`add_items` is the one deliberate exception to "nothing lands
 * without review": Claude-in-chat is the owner acting on purpose). Results are pretty-printed JSON text
 * blocks; `get_agenda` adds the Markdown rendering as a second block.
 *
 * Wire into the app as `createApp({ ..., mcpHandler: createMcpHandler({ db, config }) })`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BRIEF_KINDS, CATEGORIES, PRIORITIES, STATUSES } from "../../shared/types";
import type { Agenda } from "../../shared/types";
import type { AssistantConfig } from "../assistantConfig";
import type { Config } from "../config";
import type { McpRequestHandler } from "../contracts";
import type { Db } from "../db/index";
import { todayISO } from "../db/index";
import { createRepo } from "../db/repo";
import type { Repo } from "../db/repo";
import { NotFoundError, ValidationError, isHttpError } from "../lib/errors";
import { divisionAgenda, personAgenda } from "../routes/agenda";
import { buildToday } from "../routes/today";

export interface McpHandlerDeps {
  db: Db;
  config: Config;
}

/** The server name Claude shows for the connector: the assistant's name as a slug ("Virginia" → "virginia"). */
export function mcpServerName(assistant: AssistantConfig): string {
  const slug = assistant.assistant.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "assistant";
}

export const MCP_TOOL_NAMES = [
  "list_items",
  "get_item",
  "add_items",
  "update_item",
  "get_agenda",
  "get_today",
  "search",
  "list_reference",
  "add_brief",
] as const;

/** Server instructions for Claude, built from assistant.config.json: who the owner is, which codes were seeded, the timezone. */
export function instructionsFor(assistant: AssistantConfig): string {
  const owner = assistant.owner;
  const who = `${owner.fullName} (${owner.initials}${owner.role ? `, ${owner.role}` : ""})`;
  const codes = assistant.divisions.filter((d) => d.kind !== "personal").map((d) => d.code);
  const personal = assistant.divisions.find((d) => d.kind === "personal")?.code ?? assistant.personalDivisionCode;
  return [
    `${assistant.assistant.name} is the private task tracker of ${who} at the ${assistant.organization.name}: ${owner.fullName} is the owner, "me".`,
    "Every item has a category tag — A action, Q question, I idea, D decision, W watch, NB new business (must target a person or a division) —",
    `an owner (roster initials; a blank owner on an action means the owner), an optional division code (seeded: ${codes.join(", ")}; ${personal} = personal),`,
    `a priority (Low/Medium/High), a status (Open, In Progress, Parked = someday, Done) and an optional due date (YYYY-MM-DD, ${owner.timezone}).`,
    "Call list_reference first for the live roster, division codes and today's date. add_items writes directly with no review step, so only use it when the owner has clearly asked.",
    "Items are never deleted — move them to Done instead. Agendas per person or division come from get_agenda; the owner's own priority list from get_today.",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function textBlock(text: string): { type: "text"; text: string } {
  return { type: "text", text };
}

function jsonResult(value: unknown, ...extraBlocks: string[]): CallToolResult {
  return { content: [textBlock(JSON.stringify(value, null, 2)), ...extraBlocks.map(textBlock)] };
}

function errorResult(err: unknown): CallToolResult {
  let text: string;
  if (isHttpError(err)) {
    text = err.details === undefined ? err.message : `${err.message}\n${JSON.stringify(err.details, null, 2)}`;
  } else {
    text = err instanceof Error ? err.message : String(err);
  }
  return { isError: true, content: [textBlock(text)] };
}

/** Run a tool body; repo errors (422/404/409) become `isError` results with their message, others are logged too. */
async function attempt(fn: () => CallToolResult | Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (!isHttpError(err)) console.error("[mcp] tool failed:", err);
    return errorResult(err);
  }
}

// ---------------------------------------------------------------------------
// Input schemas (zod 4)
// ---------------------------------------------------------------------------

const CATEGORY_HELP = "A action · Q question · I idea · D decision · W watch · NB new business (needs ownerInitials as the target, or a divisionCode)";
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const draftShape = {
  category: z.enum(CATEGORIES).default("A").describe(CATEGORY_HELP),
  title: z.string().trim().min(1).max(140).describe("Imperative headline, at most 140 characters, no trailing period"),
  note: z.string().max(20000).default("").describe("Full detail, speaker attribution, links"),
  divisionCode: z.string().trim().max(32).nullable().default(null).describe("Division code such as HG or K&B-I (see list_reference); null when none"),
  ownerInitials: z.string().trim().max(16).nullable().default(null).describe("Roster initials of the owner (A/Q/I/W) or target (NB); null on an action means the tracker's owner (\"me\")"),
  initiativeName: z.string().trim().max(120).nullable().default(null).describe("Optional roll-up initiative; created if it does not exist"),
  priority: z.enum(PRIORITIES).default("Medium"),
  status: z.enum(STATUSES).default("Open").describe("Open · In Progress · Parked (someday) · Done. Decisions (D) are usually Done."),
  dueDate: isoDate.nullable().default(null).describe("YYYY-MM-DD or null"),
  isPersonal: z.boolean().default(false).describe("Personal to-do (PTD) outside the company divisions"),
  context: z.string().trim().max(200).nullable().default(null).describe("Meeting or context label, e.g. '1:1 with VM 9/30'"),
};

const patchShape = {
  category: z.enum(CATEGORIES).optional().describe(CATEGORY_HELP),
  title: z.string().trim().min(1).max(140).optional(),
  note: z.string().max(20000).optional(),
  divisionCode: z.string().trim().max(32).nullable().optional().describe("Division code; null clears it"),
  ownerInitials: z.string().trim().max(16).nullable().optional().describe("Roster initials; null clears the owner"),
  initiativeName: z.string().trim().max(120).nullable().optional().describe("Initiative name; null unlinks"),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(STATUSES).optional().describe("Moving to Done records the completion time; leaving Done clears it"),
  dueDate: isoDate.nullable().optional().describe("YYYY-MM-DD; null clears it"),
  isPersonal: z.boolean().optional(),
  context: z.string().trim().max(200).nullable().optional(),
};

const listItemsShape = {
  status: z.array(z.enum(STATUSES)).optional().describe("Only these statuses (default: everything except Done)"),
  category: z.array(z.enum(CATEGORIES)).optional().describe(CATEGORY_HELP),
  divisionCode: z.string().trim().optional().describe("Division code, e.g. HG"),
  ownerInitials: z.string().trim().optional().describe("Owner / target initials, e.g. VM"),
  personal: z.boolean().optional().describe("true = personal to-dos only, false = company items only"),
  includeDone: z.boolean().optional().describe("Include Done items (default false)"),
  q: z.string().trim().optional().describe("Free-text match on title, note and context"),
};

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

/** A fully configured McpServer over `repo`. One instance per request in stateless mode. */
export function buildMcpServer(repo: Repo, config: Config): McpServer {
  const server = new McpServer({ name: mcpServerName(config.assistant), version: config.version }, { instructions: instructionsFor(config.assistant) });
  const tz = config.assistant.owner.timezone;
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
  const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

  server.registerTool(
    "list_items",
    {
      title: "List items",
      description:
        "List tracker items. Done items are hidden unless includeDone is true. Filter by status, category (A action, Q question, I idea, D decision, W watch, NB new business), divisionCode (e.g. HG), ownerInitials (e.g. VM), personal, or free text q. Returns Item[] ordered by status then board rank.",
      inputSchema: listItemsShape,
      annotations: readOnly,
    },
    async (args) =>
      attempt(() =>
        jsonResult(
          repo.listItems({
            status: args.status,
            category: args.category,
            divisionCode: args.divisionCode,
            ownerInitials: args.ownerInitials,
            personal: args.personal,
            includeDone: args.includeDone,
            q: args.q,
          }),
        ),
      ),
  );

  server.registerTool(
    "get_item",
    {
      title: "Get item",
      description: "Fetch one item by id with its event history (created / status / edit / comment) and the capture it came from, if any.",
      inputSchema: { id: z.string().trim().min(1).describe("Item id (from list_items, search or get_agenda)") },
      annotations: readOnly,
    },
    async ({ id }) =>
      attempt(() => {
        const detail = repo.getItemDetail(id);
        if (!detail) throw new NotFoundError(`Unknown item: ${id}`);
        return jsonResult(detail);
      }),
  );

  server.registerTool(
    "add_items",
    {
      title: "Add items",
      description:
        "Create items directly — there is no review step, so only call this when the owner has deliberately asked for items to be added. Each item needs a title; category defaults to A (action). NB items need ownerInitials (the target) or a divisionCode. Unknown initials or division codes are rejected — check list_reference. All-or-nothing: returns the created items.",
      inputSchema: { items: z.array(z.object(draftShape)).min(1).max(100).describe("Items to create") },
      annotations: writes,
    },
    async ({ items }) => attempt(() => jsonResult(repo.transaction(() => items.map((draft) => repo.createItem(draft))))),
  );

  server.registerTool(
    "update_item",
    {
      title: "Update item",
      description:
        "Change any field of an item: title, note, category, ownerInitials, divisionCode, initiativeName, priority, status, dueDate, isPersonal, context. Send only the fields to change; null clears a nullable field. Moving to Done records completion — items are never deleted. Returns the updated item.",
      inputSchema: { id: z.string().trim().min(1).describe("Item id"), patch: z.object(patchShape).describe("Fields to change") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, patch }) => attempt(() => jsonResult(repo.updateItem(id, patch))),
  );

  server.registerTool(
    "get_agenda",
    {
      title: "Get agenda",
      description:
        "Agenda for a person (initials, e.g. VM) or a division (code, e.g. HG); with neither, the owner's own agenda. Groups in order NB → A → Q → W → I → D, active items first (priority, due date), parked at the bottom, Done only with includeDone. Returns the JSON agenda and a ready-to-paste Markdown rendering.",
      inputSchema: {
        person: z.string().trim().optional().describe("Roster initials"),
        division: z.string().trim().optional().describe("Division code"),
        includeDone: z.boolean().default(false).describe("Also list Done items"),
      },
      annotations: readOnly,
    },
    async ({ person, division, includeDone }) =>
      attempt(() => {
        if (person && division) throw new ValidationError("Pass either person or division, not both");
        let agenda: Agenda;
        if (division) {
          agenda = divisionAgenda(repo, division, includeDone, tz);
        } else if (person) {
          agenda = personAgenda(repo, person, includeDone, tz);
        } else {
          const me = repo.getMe();
          if (!me) throw new ValidationError("Nobody is marked as 'me' in Settings — pass person or division");
          agenda = personAgenda(repo, me.initials, includeDone, tz);
        }
        return jsonResult(agenda, agenda.markdown);
      }),
  );

  server.registerTool(
    "get_today",
    {
      title: "Get today",
      description:
        "The owner's Today view: overdue, due in the next 7 days, high-priority and unowned items (each item appears in one bucket only) plus the number of captures waiting for review. Takes no arguments.",
      // No inputSchema: zero-argument tools must accept a call that omits `arguments` entirely.
      annotations: readOnly,
    },
    async () => attempt(() => jsonResult({ today: todayISO(new Date(), tz), ...buildToday(repo, new Date(), tz) })),
  );

  server.registerTool(
    "search",
    {
      title: "Search",
      description: "Text search over items (title, note, context) and captures (title, raw text, context). Returns { items, captures }.",
      inputSchema: { q: z.string().trim().min(1).describe("Search text") },
      annotations: readOnly,
    },
    async ({ q }) => attempt(() => jsonResult(repo.search(q))),
  );

  server.registerTool(
    "list_reference",
    {
      title: "List reference data",
      description:
        "The roster (people with initials), divisions (codes, names, colors), initiatives, who 'me' is and today's date in the owner's timezone. Call this before adding or updating items so initials and division codes are valid. Takes no arguments.",
      annotations: readOnly,
    },
    async () =>
      attempt(() =>
        jsonResult({
          today: todayISO(new Date(), tz),
          timezone: tz,
          me: repo.getMe(),
          people: repo.listPeople(),
          divisions: repo.listDivisions(),
          initiatives: repo.listInitiatives(),
        }),
      ),
  );

  server.registerTool(
    "add_brief",
    {
      title: "Add brief",
      description:
        "Store a Markdown brief so it appears on the app's Briefs page — this is how the email-digest routine drops its summaries into the app. Returns the stored brief.",
      inputSchema: {
        kind: z.enum(BRIEF_KINDS).describe("email_digest · daily · other"),
        title: z.string().trim().min(1).max(200),
        bodyMd: z.string().max(500000).describe("Markdown body"),
      },
      annotations: writes,
    },
    async (input) => attempt(() => jsonResult(repo.createBrief(input))),
  );

  return server;
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

function methodNotAllowed(): Response {
  const body = {
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. This MCP endpoint is stateless: send JSON-RPC requests with POST." },
    id: null,
  };
  return new Response(JSON.stringify(body), { status: 405, headers: { "content-type": "application/json", allow: "POST" } });
}

/**
 * The `McpRequestHandler` for `app.all("/mcp/:token")`. POST carries JSON-RPC (initialize, tools/list,
 * tools/call, notifications); GET (server-initiated SSE stream) and DELETE (session end) answer 405,
 * which the Streamable HTTP spec allows for servers without sessions.
 */
export function createMcpHandler(deps: McpHandlerDeps): McpRequestHandler {
  const repo = createRepo(deps.db);
  return async (c) => {
    if (c.req.method !== "POST") return methodNotAllowed();
    const server = buildMcpServer(repo, deps.config);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      // JSON response mode: the promise settles once every response for the request is ready.
      return await transport.handleRequest(c.req.raw);
    } finally {
      await server.close().catch(() => undefined);
    }
  };
}
