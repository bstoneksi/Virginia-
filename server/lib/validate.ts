/**
 * Request validation (zod 4) and query-string helpers for the route layer.
 * Failures throw ValidationError (422) with `details: [{ path, message }]`.
 */
import type { Context } from "hono";
import { z } from "zod";
import { BRIEF_KINDS, CATEGORIES, DIVISION_KINDS, INITIATIVE_STATUSES, PRIORITIES, STATUSES } from "../../shared/types";
import { NotFoundError, ValidationError } from "./errors";

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const emptyToNull = (v: unknown): unknown => (typeof v === "string" && v.trim() === "" ? null : v);

/** Trimmed string or null; empty strings become null. */
export function nullableText(max: number) {
  return z.preprocess(emptyToNull, z.string().trim().max(max).nullable());
}

export function isValidCalendarDate(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine(isValidCalendarDate, "Invalid calendar date");
export const nullableIsoDate = z.preprocess(emptyToNull, isoDate.nullable());

const hexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #RRGGBB color");
const titleField = z.string().trim().min(1, "Title is required").max(140, "Title must be 140 characters or fewer");

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const loginSchema = z.object({ password: z.string().max(1024) });

/** Full ItemDraft with defaults applied (POST /api/items, import rows). */
export const itemDraftSchema = z.object({
  category: z.enum(CATEGORIES).default("A"),
  title: titleField,
  note: z.string().max(20000).default(""),
  divisionCode: nullableText(32).default(null),
  ownerInitials: nullableText(16).default(null),
  initiativeName: nullableText(120).default(null),
  initiativeId: z.number().int().nullable().optional(),
  priority: z.enum(PRIORITIES).default("Medium"),
  status: z.enum(STATUSES).default("Open"),
  dueDate: nullableIsoDate.default(null),
  isPersonal: z.boolean().default(false),
  context: nullableText(200).default(null),
});

/** Partial ItemDraft (proposal edits, accept overrides). */
export const draftPatchSchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  title: titleField.optional(),
  note: z.string().max(20000).optional(),
  divisionCode: nullableText(32).optional(),
  ownerInitials: nullableText(16).optional(),
  initiativeName: nullableText(120).optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(STATUSES).optional(),
  dueDate: nullableIsoDate.optional(),
  isPersonal: z.boolean().optional(),
  context: nullableText(200).optional(),
});

/** PATCH /api/items/:id */
export const itemPatchSchema = draftPatchSchema.extend({
  initiativeId: z.number().int().nullable().optional(),
  rank: z.number().optional(),
});

export const reorderSchema = z.object({
  status: z.enum(STATUSES),
  orderedIds: z.array(z.string().min(1)).max(10000),
});

export const commentSchema = z.object({ text: z.string().trim().min(1, "Comment text is required").max(4000) });

export const personCreateSchema = z.object({
  initials: z.string().trim().min(1).max(8),
  fullName: z.string().trim().min(1).max(120),
  divisionCode: nullableText(32).default(null),
  email: nullableText(200).default(null),
  role: nullableText(120).default(null),
  isMe: z.boolean().default(false),
});

export const personPatchSchema = z.object({
  initials: z.string().trim().min(1).max(8).optional(),
  fullName: z.string().trim().min(1).max(120).optional(),
  divisionCode: nullableText(32).optional(),
  email: nullableText(200).optional(),
  role: nullableText(120).optional(),
  isMe: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const divisionCreateSchema = z.object({
  code: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(DIVISION_KINDS).default("brand"),
  parentCode: nullableText(16).default(null),
  color: hexColor.optional(),
  textColor: hexColor.optional(),
  sortOrder: z.number().int().optional(),
});

export const divisionPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(DIVISION_KINDS).optional(),
  parentCode: nullableText(16).optional(),
  color: hexColor.optional(),
  textColor: hexColor.optional(),
  sortOrder: z.number().int().optional(),
  archived: z.boolean().optional(),
});

export const initiativeCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(INITIATIVE_STATUSES).default("Active"),
});

export const initiativePatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(INITIATIVE_STATUSES).optional(),
});

export const briefCreateSchema = z.object({
  kind: z.enum(BRIEF_KINDS),
  title: z.string().trim().min(1).max(200),
  bodyMd: z.string().max(500000),
});

export const proposalPatchSchema = z.object({ draft: draftPatchSchema });

/** JSON alternative to the multipart capture body (no files). */
export const captureJsonSchema = z.object({
  text: nullableText(500000).default(null),
  context: nullableText(200).default(null),
  defaultDivisionCode: nullableText(32).default(null),
  title: nullableText(200).default(null),
});

export const importRowSchema = z.object({
  table: z.string().max(200).default(""),
  sheet: z.string().max(200).default(""),
  rowNumber: z.number().int().default(0),
  raw: z.record(z.string(), z.coerce.string()).default({}),
  draft: itemDraftSchema,
  warnings: z.array(z.string()).default([]),
  include: z.boolean().default(true),
});

export const importCommitSchema = z.object({
  filename: z.string().trim().max(200).optional(),
  rows: z.array(importRowSchema).max(5000),
});

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

export interface IssueDetail {
  path: string;
  message: string;
}

export function parseWith<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const details: IssueDetail[] = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
  const first = details[0];
  const message = first ? (first.path.length > 0 ? `${first.path}: ${first.message}` : first.message) : "Invalid request";
  throw new ValidationError(message, details);
}

async function readJson(c: Context, allowEmpty: boolean): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim().length === 0) {
    if (allowEmpty) return {};
    throw new ValidationError("Request body is required");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError("Invalid JSON body");
  }
}

/** Parse and validate a required JSON body. */
export async function parseJsonBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  return parseWith(schema, await readJson(c, false));
}

/** Parse a JSON body that may be empty (treated as `{}`). */
export async function parseOptionalJsonBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  return parseWith(schema, await readJson(c, true));
}

// ---------------------------------------------------------------------------
// Query-string helpers
// ---------------------------------------------------------------------------

/** `a,b, c` → ["a","b","c"]; undefined / empty → undefined. */
export function csvParam(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : undefined;
}

export function boolParam(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "") return undefined;
  const s = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  throw new ValidationError(`Expected a boolean query value, got "${value}"`);
}

export function intParam(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ValidationError(`${name} must be an integer`);
  return n;
}

/** Integer path parameter; anything else is an unknown id (404). */
export function idParam(value: string): number {
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n)) throw new NotFoundError(`Unknown id: ${value}`);
  return n;
}
