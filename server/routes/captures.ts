/**
 * Captures + proposals (docs/SPEC.md §4 "Captures"). Extraction is delegated to `deps.extractProposals`
 * (server/ai, wired in server/index.ts). When an app is built without it (tests), the same extractor runs
 * with no API key, i.e. only the deterministic rule parser in server/ai/grammar.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Capture, CaptureKind, CaptureStatus, Proposal } from "../../shared/types";
import { createExtractor } from "../ai/extract";
import { matchTag } from "../ai/grammar";
import { proposalSimilarity } from "../ai/prompt";
import type { ExtractContext, ExtractInput, ExtractResult, ProposalDraft } from "../contracts";
import { todayISO } from "../db/index";
import type { CaptureFileInput, Repo } from "../db/repo";
import { HttpError, NotFoundError, PayloadTooLargeError, ValidationError } from "../lib/errors";
import { captureJsonSchema, draftPatchSchema, parseJsonBody, parseOptionalJsonBody, proposalPatchSchema } from "../lib/validate";
import type { RouteDeps } from "./deps";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 8;
export const IMAGE_MIMES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "image/gif"]);
const EXTENSION_MIMES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
  gif: "image/gif",
};
const FILE_FIELDS = ["files[]", "files", "file", "images[]", "images", "image"];
/** ISO-BMFF brands (bytes 8..12 after `ftyp`) that mean a HEIC / HEIF still image. */
const HEIC_BRANDS: ReadonlySet<string> = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);
const HEIF_BRANDS: ReadonlySet<string> = new Set(["mif1", "msf1"]);

/** A re-extracted draft this similar to an accepted / rejected proposal of the capture is the same line and is not proposed again. */
export const RESOLVED_MATCH_THRESHOLD = 0.75;

export interface CaptureRequest {
  text: string | null;
  context: string | null;
  defaultDivisionCode: string | null;
  title: string | null;
  files: CaptureFileInput[];
}

// ---------------------------------------------------------------------------
// Kind inference
// ---------------------------------------------------------------------------

const TAG_WORDS = new Set(["A", "Q", "I", "D", "W", "NB"]);
const SPEAKER_LINE = /^\s*([A-Z][A-Za-z.'’-]*(?:\s+[A-Z][A-Za-z.'’-]*){0,2})\s*(?:\(?\d{1,2}:\d{2}(?::\d{2})?\)?)?\s*:\s+\S/;

/**
 * Long pastes or many `Name:` speaker lines read as a meeting transcript — unless at least half of the
 * non-empty lines carry a tag (or are indented notes under one), which is plain tagged notes however long.
 */
export function looksLikeTranscript(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length > 0) {
    let structured = 0;
    let underTag = false;
    for (const line of lines) {
      if (matchTag(line)) {
        structured += 1;
        underTag = true;
      } else if (underTag && /^[ \t]/.test(line)) {
        structured += 1;
      } else {
        underTag = false;
      }
    }
    if (structured * 2 >= lines.length) return false;
  }
  if (text.length > 1500) return true;
  if (lines.length < 4) return false;
  let speakers = 0;
  for (const line of lines) {
    const m = SPEAKER_LINE.exec(line);
    const label = m?.[1]?.trim() ?? "";
    if (label.length >= 3 && !TAG_WORDS.has(label.toUpperCase())) speakers += 1;
  }
  return speakers >= 3 && speakers / lines.length >= 0.4;
}

function looksLikeScreenshot(file: { filename: string; mime: string }): boolean {
  const name = file.filename.toLowerCase();
  if (/screen[\s_-]?shot/.test(name)) return true;
  // iOS names screenshots IMG_xxxx.PNG; camera photos are IMG_xxxx.HEIC/JPG.
  return /^img[_-]\d+/.test(name) && file.mime === "image/png";
}

export function inferCaptureKind(text: string | null, files: { filename: string; mime: string }[]): CaptureKind {
  const hasText = text !== null && text.trim().length > 0;
  if (hasText && files.length > 0) return "mixed";
  if (files.length > 0) return files.some(looksLikeScreenshot) ? "screenshot" : "image";
  return looksLikeTranscript(text ?? "") ? "transcript" : "text";
}

// ---------------------------------------------------------------------------
// Request parsing (multipart, urlencoded or JSON)
// ---------------------------------------------------------------------------

export function normalizeMime(mime: string, filename: string): string {
  const m = (mime.split(";")[0] ?? "").trim().toLowerCase();
  if (m === "image/jpg" || m === "image/pjpeg") return "image/jpeg";
  if (m.length > 0 && m !== "application/octet-stream") return m;
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_MIMES[ext] ?? m;
}

/**
 * The image type according to the file's first bytes (JPEG, PNG, GIF, WebP, HEIC/HEIF), or null when the
 * bytes are not a recognisable image. The stored `mime` comes from here, never from the client's label.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 12) return null;
  const ascii = (from: number, to: number): string => String.fromCharCode(...Array.from(bytes.subarray(from, to)));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (ascii(0, 4) === "GIF8" && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12).toLowerCase();
    if (HEIC_BRANDS.has(brand)) return "image/heic";
    if (HEIF_BRANDS.has(brand)) return "image/heif";
  }
  return null;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const s = value.find((v) => typeof v === "string");
    return typeof s === "string" ? s : null;
  }
  return null;
}

function blankToNull(value: string | null): string | null {
  if (value === null) return null;
  return value.trim().length === 0 ? null : value;
}

async function readCaptureRequest(c: Context): Promise<CaptureRequest> {
  const contentType = (c.req.header("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/json")) {
    const body = await parseJsonBody(c, captureJsonSchema);
    return { text: body.text, context: body.context, defaultDivisionCode: body.defaultDivisionCode, title: body.title, files: [] };
  }
  if (!contentType.includes("multipart/form-data") && !contentType.includes("application/x-www-form-urlencoded")) {
    throw new HttpError(415, "Send multipart/form-data (text, context, defaultDivisionCode, title, files[]) or JSON");
  }
  const body = await c.req.parseBody({ all: true });
  const candidates: unknown[] = [];
  for (const field of FILE_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    if (Array.isArray(value)) candidates.push(...value);
    else candidates.push(value);
  }
  const uploads = candidates.filter((v): v is File => v instanceof File && (v.size > 0 || v.name.length > 0));
  if (uploads.length > MAX_FILES) throw new ValidationError(`At most ${MAX_FILES} files per capture`, { count: uploads.length });
  const files: CaptureFileInput[] = [];
  for (const upload of uploads) {
    const filename = upload.name.trim() || `image-${files.length + 1}`;
    const declared = normalizeMime(upload.type, filename);
    if (!IMAGE_MIMES.has(declared)) {
      throw new ValidationError(`Unsupported file type: ${declared || "unknown"} (${filename}). Allowed: JPEG, PNG, HEIC, WebP, GIF`);
    }
    if (upload.size > MAX_FILE_BYTES) {
      throw new PayloadTooLargeError(`${filename} is ${(upload.size / 1024 / 1024).toFixed(1)} MB; the limit is 10 MB per file`);
    }
    const bytes = new Uint8Array(await upload.arrayBuffer());
    if (bytes.byteLength === 0) throw new ValidationError(`${filename} is empty`);
    // The bytes decide the stored type: a mislabelled upload is stored as what it really is, anything else is refused.
    const mime = sniffImageMime(bytes);
    if (mime === null) throw new ValidationError(`${filename} is not a recognisable JPEG, PNG, HEIC, WebP or GIF image`);
    files.push({ filename, mime, bytes, size: bytes.byteLength });
  }
  return {
    text: blankToNull(firstString(body.text)),
    context: blankToNull(firstString(body.context)),
    defaultDivisionCode: blankToNull(firstString(body.defaultDivisionCode)),
    title: blankToNull(firstString(body.title)),
    files,
  };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export function extractContext(repo: Repo): ExtractContext {
  return { people: repo.listPeople(), divisions: repo.listDivisions(), initiatives: repo.listInitiatives() };
}

/** Rule parser only — what the real extractor does without an API key. Used when no extractor was injected. */
const ruleParserOnly = createExtractor({ apiKey: null, model: "" });

async function runExtraction(deps: RouteDeps, capture: Capture, files: CaptureFileInput[]): Promise<ExtractResult> {
  const input: ExtractInput = {
    text: capture.rawText,
    images: files.map((f) => ({ filename: f.filename, mime: f.mime, bytes: f.bytes })),
    context: capture.context,
    defaultDivisionCode: capture.defaultDivisionCode,
    todayISO: todayISO(),
  };
  const extract = deps.extractProposals ?? ruleParserOnly;
  return extract(input, extractContext(deps.repo));
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message ? `${err.name}: ${err.message}` : err.name;
  return String(err);
}

function normalizeExcerpt(excerpt: string | null): string {
  return (excerpt ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Drop drafts that restate a line Brandon already accepted or rejected on this capture — the same source
 * excerpt, or a strong `proposalSimilarity` — so a re-extract never re-proposes reviewed lines
 * (SPEC §4: re-extract replaces *proposed* proposals and keeps accepted / rejected ones).
 */
export function dropResolvedDuplicates(resolved: readonly Proposal[], drafts: readonly ProposalDraft[]): { kept: ProposalDraft[]; skipped: number } {
  if (resolved.length === 0) return { kept: [...drafts], skipped: 0 };
  const kept: ProposalDraft[] = [];
  let skipped = 0;
  for (const draft of drafts) {
    const excerpt = normalizeExcerpt(draft.sourceExcerpt);
    const duplicate = resolved.some(
      (p) => (excerpt.length > 0 && normalizeExcerpt(p.sourceExcerpt) === excerpt) || proposalSimilarity(p, draft) >= RESOLVED_MATCH_THRESHOLD,
    );
    if (duplicate) skipped += 1;
    else kept.push(draft);
  }
  return { kept, skipped };
}

interface ExtractionOutcome {
  /** Newly inserted `proposed` rows. */
  inserted: number;
  /** Drafts skipped because an accepted / rejected proposal already covers the line. */
  skipped: number;
}

/** Store an extraction result: replace proposed proposals (minus already-reviewed lines), record notes, clear the error. */
function applyExtraction(repo: Repo, capture: Capture, result: ExtractResult): ExtractionOutcome {
  const resolved = capture.proposals.filter((p) => p.state !== "proposed");
  const { kept, skipped } = dropResolvedDuplicates(resolved, result.proposals);
  repo.transaction(() => {
    repo.replaceProposals(capture.id, kept);
    const notes = [...result.notes];
    if (skipped > 0) {
      notes.push(`${skipped} proposal${skipped === 1 ? "" : "s"} matched lines already accepted or rejected and ${skipped === 1 ? "was" : "were"} not proposed again`);
    }
    if (result.model) notes.push(`Model: ${result.model}`);
    repo.updateCapture(capture.id, { notes, error: null });
  });
  return { inserted: kept.length, skipped };
}

/** Run extraction for a capture; null when it failed (the error is recorded on the capture). */
async function extractInto(deps: RouteDeps, captureId: string, files: CaptureFileInput[]): Promise<ExtractionOutcome | null> {
  const capture = deps.repo.requireCapture(captureId);
  try {
    const result = await runExtraction(deps, capture, files);
    return applyExtraction(deps.repo, capture, result);
  } catch (err) {
    console.error(`[captures] extraction failed for ${captureId}:`, err);
    deps.repo.updateCapture(captureId, { error: describeError(err) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function capturesRouter(deps: RouteDeps): Hono {
  const { repo } = deps;
  const router = new Hono();

  router.post("/captures", async (c) => {
    const request = await readCaptureRequest(c);
    if (request.text === null && request.files.length === 0) {
      throw new ValidationError("Nothing to capture: add some text or at least one image");
    }
    const kind = inferCaptureKind(request.text, request.files);
    const capture = repo.transaction(() => {
      const created = repo.createCapture({
        kind,
        title: request.title,
        rawText: request.text,
        context: request.context,
        defaultDivisionCode: request.defaultDivisionCode,
      });
      for (const file of request.files) repo.addCaptureFile(created.id, file);
      return created;
    });
    const outcome = await extractInto(deps, capture.id, request.files);
    // Nothing to review (and no error) is not "waiting for review": the capture is filed as reviewed.
    if (outcome) repo.settleCaptureStatus(capture.id);
    return c.json(repo.requireCapture(capture.id), 201);
  });

  router.get("/captures", (c) => {
    const status = c.req.query("status");
    return c.json(repo.listCaptures(status ? (status as CaptureStatus) : undefined));
  });

  router.get("/captures/:id", (c) => c.json(repo.requireCapture(c.req.param("id"))));

  router.get("/captures/:id/files/:fileId", (c) => {
    const file = repo.getCaptureFile(c.req.param("id"), c.req.param("fileId"));
    if (!file) throw new NotFoundError(`Unknown file: ${c.req.param("fileId")}`);
    const safeName = file.filename.replace(/[^\w.\- ]+/g, "_");
    // Copy into an ArrayBuffer-backed view: node:sqlite hands back a Uint8Array<ArrayBufferLike>.
    const bytes = new Uint8Array(file.bytes);
    return c.body(bytes, 200, {
      "Content-Type": file.mime,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, max-age=3600",
      // The stored mime is what the bytes were sniffed as; never let a browser second-guess it.
      "X-Content-Type-Options": "nosniff",
    });
  });

  router.post("/captures/:id/reextract", async (c) => {
    const id = c.req.param("id");
    const capture = repo.requireCapture(id);
    const files = repo.listCaptureFilesWithBytes(id);
    const outcome = await extractInto(deps, id, files);
    if (outcome) {
      // New proposals re-open a reviewed (or discarded) capture; nothing new leaves its status alone,
      // and a pending capture with nothing left to review is filed as reviewed.
      if (outcome.inserted > 0 && capture.status !== "pending") repo.updateCapture(id, { status: "pending", reviewedAt: null });
      repo.settleCaptureStatus(id);
    }
    return c.json(repo.requireCapture(id));
  });

  router.post("/captures/:id/proposals/:pid/accept", async (c) => {
    const overrides = await parseOptionalJsonBody(c, draftPatchSchema);
    return c.json(repo.acceptProposal(c.req.param("id"), c.req.param("pid"), overrides));
  });

  router.post("/captures/:id/proposals/:pid/reject", (c) => c.json(repo.rejectProposal(c.req.param("id"), c.req.param("pid"))));

  router.patch("/captures/:id/proposals/:pid", async (c) => {
    const { draft } = await parseJsonBody(c, proposalPatchSchema);
    return c.json(repo.updateProposalDraft(c.req.param("id"), c.req.param("pid"), draft));
  });

  router.post("/captures/:id/accept-all", (c) => c.json({ items: repo.acceptAllProposals(c.req.param("id")) }));

  router.post("/captures/:id/discard", (c) => {
    repo.discardCapture(c.req.param("id"));
    return c.body(null, 204);
  });

  return router;
}
