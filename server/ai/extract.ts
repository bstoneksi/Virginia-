/**
 * Claude-backed capture extraction (docs/SPEC.md §5) — implements `ExtractProposalsFn`.
 *
 *   const extractProposals = createExtractor({ apiKey: config.anthropicApiKey, model: config.anthropicModel });
 *
 * - No API key (and no injected client): only the deterministic rule parser runs (`grammar.ts`).
 * - Otherwise: `client.messages.parse` with structured outputs (`zodOutputFormat(ExtractionSchema)`),
 *   the byte-stable system prompt cached with `cache_control`, images as base64 blocks before the
 *   volatile user text. Refusals yield zero proposals plus a note; a null / unparsable answer is
 *   retried once; API errors are rethrown as plain-English `Error`s the capture UI can display.
 * - The rule parser always runs alongside the model and any tagged line the model dropped is
 *   appended with the warning `added by rule parser` (see `prompt.ts`).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { AutoParseableOutputFormat } from "@anthropic-ai/sdk/lib/parser";
import type { ExtractContext, ExtractInput, ExtractProposalsFn, ExtractResult, ProposalDraft } from "../contracts";
import { matchTag, parseTaggedLines } from "./grammar";
import { STABLE_SYSTEM_PROMPT, buildUserText, postProcessModelOutput } from "./prompt";
import { ExtractionSchema, type ExtractionOutput } from "./schema";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const MAX_TOKENS = 16000;
export const RULE_PARSER_MODEL = "rule-parser";
export const AI_NOT_CONFIGURED_NOTE = "AI not configured — only explicitly tagged lines were parsed";
export const REFUSAL_NOTE = "Claude declined to process this capture";
/** The API accepts images up to 5 MB; larger uploads are stored but not analysed. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Request timeout (ms) — the default 10 minutes is too long for a capture form to wait on. */
export const REQUEST_TIMEOUT_MS = 240_000;

type ImageMediaType = Anthropic.Base64ImageSource["media_type"];
const IMAGE_MEDIA_TYPES: Record<string, ImageMediaType> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
};

// ---------------------------------------------------------------------------
// Client shape (structural, so tests can inject a fake)
// ---------------------------------------------------------------------------

export type ExtractParseParams = Omit<Anthropic.MessageCreateParamsNonStreaming, "output_config"> & {
  output_config: { effort: "medium"; format: AutoParseableOutputFormat<ExtractionOutput> };
};

export interface ExtractParseResponse {
  stop_reason: string | null;
  stop_details?: { explanation?: string | null; category?: string | null } | null;
  parsed_output: ExtractionOutput | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  } | null;
  model?: string;
}

export interface ExtractorClient {
  messages: {
    parse(params: ExtractParseParams): Promise<ExtractParseResponse>;
  };
}

export interface CreateExtractorOptions {
  apiKey: string | null;
  /** Model id from config (default "claude-opus-5-5"); never append date suffixes. */
  model: string;
  /** Injectable Anthropic-like client (tests). Must expose `messages.parse()`. */
  client?: unknown;
}

function isExtractorClient(value: unknown): value is ExtractorClient {
  if (typeof value !== "object" || value === null) return false;
  const messages = (value as { messages?: unknown }).messages;
  return typeof messages === "object" && messages !== null && typeof (messages as { parse?: unknown }).parse === "function";
}

// ---------------------------------------------------------------------------
// Request assembly
// ---------------------------------------------------------------------------

const OUTPUT_FORMAT = zodOutputFormat(ExtractionSchema);

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

export interface BuiltRequest {
  params: ExtractParseParams;
  /** Images that were stored but could not be sent (unsupported type or too large), as reviewer notes. */
  skippedImages: string[];
  /** Filenames of the images that were attached. */
  attachedImages: string[];
}

export function buildRequest(model: string, input: ExtractInput, ctx: ExtractContext): BuiltRequest {
  const imageBlocks: Anthropic.ImageBlockParam[] = [];
  const skippedImages: string[] = [];
  const attachedImages: string[] = [];
  for (const image of input.images) {
    const mediaType = IMAGE_MEDIA_TYPES[image.mime.toLowerCase()];
    if (!mediaType) {
      skippedImages.push(`${image.filename} was stored but not analysed: ${image.mime || "unknown type"} is not supported by the model (use JPEG, PNG, WebP or GIF)`);
      continue;
    }
    if (image.bytes.byteLength > MAX_IMAGE_BYTES) {
      skippedImages.push(`${image.filename} was stored but not analysed: ${(image.bytes.byteLength / 1024 / 1024).toFixed(1)} MB exceeds the 5 MB the model accepts`);
      continue;
    }
    imageBlocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data: toBase64(image.bytes) } });
    attachedImages.push(image.filename);
  }
  const userText = buildUserText(input, ctx, { imageFilenames: attachedImages });
  const params: ExtractParseParams = {
    model,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: STABLE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: userText }] }],
    output_config: { effort: "medium", format: OUTPUT_FORMAT },
  };
  return { params, skippedImages, attachedImages };
}

// ---------------------------------------------------------------------------
// Error translation
// ---------------------------------------------------------------------------

/** Thrown internally when the model answered but the answer could not be read as proposals. */
class UnreadableAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreadableAnswerError";
  }
}

type ApiErrorInstance = InstanceType<typeof Anthropic.APIError>;

function serverMessage(err: ApiErrorInstance): string {
  const body = err.error as { error?: { message?: unknown }; message?: unknown } | undefined;
  const nested = body?.error?.message ?? body?.message;
  if (typeof nested === "string" && nested.trim().length > 0) return nested.trim();
  return err.message.replace(/^\d{3}\s+/, "").trim();
}

/**
 * Map SDK errors to plain-English `Error`s (auth, rate limit, other API errors — in that order).
 * Returns null for errors that are not from the Anthropic SDK.
 */
export function translateApiError(err: unknown, model: string): Error | null {
  if (err instanceof Anthropic.AuthenticationError) {
    return new Error("Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY in the server environment.");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new Error("Anthropic rate limit reached (429). Wait a minute and re-extract.");
  }
  if (err instanceof Anthropic.APIError) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      return new Error("The request to the Anthropic API timed out. Try again, or shorten the capture.");
    }
    if (err instanceof Anthropic.APIConnectionError || err.status === undefined) {
      return new Error("Could not reach the Anthropic API (network error). Check the server's internet connection and re-extract.");
    }
    const detail = serverMessage(err);
    switch (err.status) {
      case 400:
        return new Error(`The Anthropic API rejected the request (400): ${detail}`);
      case 403:
        return new Error(`The API key is not allowed to use model "${model}" (403): ${detail}`);
      case 404:
        return new Error(`Model "${model}" was not found (404). Check ANTHROPIC_MODEL.`);
      case 413:
        return new Error("The capture is too large for one request (413). Remove some images or split the text.");
      case 529:
        return new Error("Claude is overloaded right now (529). Re-extract in a minute.");
      default:
        if (err.status >= 500) return new Error(`Anthropic API error ${err.status}: ${detail}. Re-extract in a minute.`);
        return new Error(`Anthropic API error ${err.status}: ${detail}`);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

const SKIPPED_LINES_SHOWN = 3;
const SKIPPED_LINE_CHARS = 60;

/** Non-empty lines the rule parser ignores: no tag and not indented under a tagged line. */
export function untaggedLines(text: string): string[] {
  const out: string[] = [];
  let underTag = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (raw.trim().length === 0) {
      underTag = false;
      continue;
    }
    if (matchTag(raw)) {
      underTag = true;
      continue;
    }
    if (underTag && /^[ \t]/.test(raw)) continue;
    underTag = false;
    out.push(raw.trim());
  }
  return out;
}

function ruleOnlyResult(input: ExtractInput, proposals: ProposalDraft[], notes: string[]): ExtractResult {
  const out = [...notes];
  if (input.images.length > 0) out.push(`${input.images.length} image(s) stored but not analysed (AI not configured)`);
  if (input.text && input.text.trim().length > 0 && proposals.length === 0) out.push("No tagged lines (A:, Q:, I:, D:, W:, NB:) found");
  // Name what was dropped so an untagged line never disappears silently (the whole text is untagged
  // when there are no proposals, which the note above already says).
  const skipped = input.text && proposals.length > 0 ? untaggedLines(input.text) : [];
  if (skipped.length > 0) {
    const shown = skipped
      .slice(0, SKIPPED_LINES_SHOWN)
      .map((l) => `"${l.length > SKIPPED_LINE_CHARS ? `${l.slice(0, SKIPPED_LINE_CHARS - 1)}…` : l}"`);
    const more = skipped.length > SKIPPED_LINES_SHOWN ? ` (+${skipped.length - SKIPPED_LINES_SHOWN} more)` : "";
    out.push(`Skipped ${skipped.length} untagged line${skipped.length === 1 ? "" : "s"} (AI not configured): ${shown.join(", ")}${more}`);
  }
  return { proposals, model: RULE_PARSER_MODEL, notes: out };
}

async function callModel(client: ExtractorClient, params: ExtractParseParams, model: string): Promise<ExtractParseResponse> {
  try {
    return await client.messages.parse(params);
  } catch (err) {
    const translated = translateApiError(err, model);
    if (translated) throw translated;
    // Structured-output validation failures surface as a plain AnthropicError (not an APIError).
    if (err instanceof Anthropic.AnthropicError) throw new UnreadableAnswerError(err.message);
    throw err;
  }
}

function addUsage(total: { input: number; output: number }, response: ExtractParseResponse): void {
  const u = response.usage;
  if (!u) return;
  total.input += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  total.output += u.output_tokens ?? 0;
}

function describeUnreadable(response: ExtractParseResponse | null, err: UnreadableAnswerError | null): string {
  if (err) return err.message.split("\n")[0] ?? "invalid JSON";
  if (response?.stop_reason === "max_tokens") return "the answer was cut off at the token limit";
  if (response?.stop_reason) return `no structured answer (stop reason: ${response.stop_reason})`;
  return "no structured answer";
}

/**
 * Build the `extractProposals` dependency. With `apiKey: null` and no injected client, only the
 * rule parser runs and every capture gets the note "AI not configured — only explicitly tagged
 * lines were parsed".
 */
export function createExtractor(opts: CreateExtractorOptions): ExtractProposalsFn {
  const model = opts.model.trim().length > 0 ? opts.model.trim() : DEFAULT_MODEL;
  let client: ExtractorClient | null = null;
  if (opts.client !== undefined) {
    if (!isExtractorClient(opts.client)) throw new Error("createExtractor: the injected client must expose messages.parse()");
    client = opts.client;
  } else if (opts.apiKey) {
    const sdk: ExtractorClient = new Anthropic({ apiKey: opts.apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 });
    client = sdk;
  }

  return async (input: ExtractInput, ctx: ExtractContext): Promise<ExtractResult> => {
    const text = input.text && input.text.trim().length > 0 ? input.text : null;
    const ruleProposals = text ? parseTaggedLines(text, ctx, input.todayISO, input.defaultDivisionCode) : [];

    if (!client) return ruleOnlyResult(input, ruleProposals, [AI_NOT_CONFIGURED_NOTE]);

    const { params, skippedImages, attachedImages } = buildRequest(model, input, ctx);
    if (!text && attachedImages.length === 0) {
      return { proposals: ruleProposals, model, notes: [...skippedImages, "Nothing the model could analyse (no text and no supported images)"] };
    }

    const usage = { input: 0, output: 0 };
    let response: ExtractParseResponse | null = null;
    let unreadable: UnreadableAnswerError | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      unreadable = null;
      try {
        response = await callModel(client, params, model);
      } catch (err) {
        if (err instanceof UnreadableAnswerError) {
          unreadable = err;
          response = null;
          continue;
        }
        throw err;
      }
      addUsage(usage, response);
      if (response.stop_reason === "refusal" || response.parsed_output !== null) break;
    }

    const usedModel = response?.model && response.model.trim().length > 0 ? response.model : model;

    if (response?.stop_reason === "refusal") {
      const explanation = response.stop_details?.explanation?.trim();
      const note = explanation ? `${REFUSAL_NOTE}: ${explanation}` : `${REFUSAL_NOTE}. Nothing was extracted; edit the text and re-extract.`;
      return { proposals: [], model: usedModel, usage, notes: [note, ...skippedImages] };
    }

    if (!response || response.parsed_output === null) {
      throw new Error(`Claude's answer could not be read as proposals (${describeUnreadable(response, unreadable)}) after two attempts. Re-extract, or shorten the capture.`);
    }

    const processed = postProcessModelOutput(response.parsed_output, input, ctx, ruleProposals);
    const notes = [...processed.notes, ...skippedImages];
    if (processed.proposals.length === 0) notes.push("Nothing actionable found");
    return { proposals: processed.proposals, model: usedModel, usage, notes };
  };
}
