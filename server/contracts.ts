/**
 * Cross-module contracts on the server side. These let the route layer (server/routes),
 * the AI extractor (server/ai), the importer (server/import) and the MCP endpoint (server/mcp)
 * be built independently and wired together in server/index.ts.
 *
 * Do not put SQL or SDK-specific types here — only the shapes modules exchange.
 */
import type { Context } from "hono";
import type { Division, ImportPreview, Initiative, ItemDraft, Person } from "../shared/types";

// ---------------------------------------------------------------------------
// AI extraction (server/ai/extract.ts implements ExtractProposalsFn)
// ---------------------------------------------------------------------------

export interface ExtractImage {
  filename: string;
  /** image/jpeg | image/png | image/webp | image/gif | image/heic */
  mime: string;
  bytes: Uint8Array;
}

export interface ExtractInput {
  /** Pasted notes / transcript text, or null when only images were provided. */
  text: string | null;
  images: ExtractImage[];
  /** Meeting or context label supplied by the user, e.g. "1:1 with VM". */
  context: string | null;
  /** Division code to assume when a line does not name one. */
  defaultDivisionCode: string | null;
  /** YYYY-MM-DD in America/Detroit — used to resolve relative due dates. */
  todayISO: string;
}

export interface ExtractContext {
  people: Person[];
  divisions: Division[];
  initiatives: Initiative[];
}

export interface ProposalDraft {
  draft: ItemDraft;
  /** 0..1 */
  confidence: number;
  /** True when the source line carried no explicit tag and the category was inferred. */
  inferred: boolean;
  sourceExcerpt: string | null;
  warnings: string[];
}

export interface ExtractResult {
  proposals: ProposalDraft[];
  /** Model id used, or "rule-parser" when the API was not available. */
  model: string;
  usage?: { input: number; output: number };
  /** Human-readable notes shown on the capture (fallbacks, refusals, dropped lines). */
  notes: string[];
}

export type ExtractProposalsFn = (input: ExtractInput, ctx: ExtractContext) => Promise<ExtractResult>;

// ---------------------------------------------------------------------------
// Excel / CSV import (server/import/excel.ts implements ParseImportFileFn)
// ---------------------------------------------------------------------------

export interface ImportFile {
  filename: string;
  bytes: Uint8Array;
}

export type ParseImportFileFn = (file: ImportFile, ctx: ExtractContext) => Promise<ImportPreview>;

// ---------------------------------------------------------------------------
// MCP endpoint (server/mcp/server.ts exports createMcpHandler(deps): McpRequestHandler)
// ---------------------------------------------------------------------------

/** Handles POST/GET/DELETE /mcp/:token after the token has been verified by the caller. */
export type McpRequestHandler = (c: Context) => Promise<Response>;
