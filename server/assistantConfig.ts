/**
 * assistant.config.json — everything person-specific in one file: the assistant's name and tagline,
 * the owner (who "me" is), the organization, branding colors, the divisions (brands / functions /
 * personal) and the roster of people. `loadConfig` (server/config.ts) loads it once at boot as
 * `config.assistant`; `toSeed` turns it into the reference data inserted into an empty database
 * (server/db/seed.ts); `toAssistantInfo` is the public subset the client receives in /api/bootstrap.
 *
 * Resolution order (`loadAssistantConfig`, mirrored by scripts/apply-config.mjs):
 *   1. `assistant.config.local.json` in the repo root, when it exists (git-ignored personal override)
 *   2. the file named by `ASSISTANT_CONFIG` (absolute, or relative to the repo root)
 *   3. `assistant.config.json` in the repo root (the committed instance config)
 *
 * Validation problems are collected and thrown as one readable Error that lists every one of them.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_INITIATIVE, DIVISION_KINDS, PERSONAL_DIVISION_CODE } from "../shared/types";
import type { AssistantInfo, Division, Person } from "../shared/types";
import { isValidTimeZone } from "../shared/timezone";
import type { SeedData } from "./db/seed";

export const ASSISTANT_CONFIG_FILE = "assistant.config.json";
export const ASSISTANT_CONFIG_LOCAL_FILE = "assistant.config.local.json";
export const ASSISTANT_CONFIG_ENV = "ASSISTANT_CONFIG";

// ---------------------------------------------------------------------------
// Schema (zod 4). Objects are strict so a misspelled key is reported instead of silently ignored.
// ---------------------------------------------------------------------------

const text = (max = 200) => z.string().trim().min(1, "must not be empty").max(max, `must be at most ${max} characters`);
const optionalText = (max = 200) => z.string().trim().max(max, `must be at most ${max} characters`).nullable().default(null);
const code = () => text(16);
const hexColor = z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be a hex color such as "#1B2A49"');
const email = z.email("must be an email address").nullable().default(null);

const divisionSchema = z.strictObject({
  /** Short code used in notes and as the primary key, e.g. "HG", "K&B-I". */
  code: code(),
  name: text(),
  kind: z.enum(DIVISION_KINDS),
  /** Code of the parent division (e.g. "K&B" for "K&B-I"), or null. */
  parentCode: code().nullable().default(null),
  /** Chip background / text colors. */
  color: hexColor,
  textColor: hexColor,
  sortOrder: z.number().int("must be a whole number"),
});

const personSchema = z.strictObject({
  initials: code(),
  fullName: text(),
  divisionCode: code().nullable().default(null),
  email,
  role: optionalText(),
});

const ownerSchema = z.strictObject({
  fullName: text(),
  initials: code(),
  email,
  role: optionalText(),
  /** IANA timezone every "today" and every displayed date uses, e.g. "America/Detroit". */
  timezone: text(64),
  /** The owner's own division (e.g. corporate), or null. */
  divisionCode: code().nullable().default(null),
});

export const assistantConfigSchema = z.strictObject({
  assistant: z.strictObject({
    /** App title, phone icon label, connector name. */
    name: text(40),
    tagline: text(120),
  }),
  owner: ownerSchema,
  organization: z.strictObject({ name: text(), shortName: text(40) }),
  branding: z.strictObject({ themeColor: hexColor, accentColor: hexColor }),
  /** Code of the division of kind "personal" (default "PTD"). */
  personalDivisionCode: code().default(PERSONAL_DIVISION_CODE),
  /** Name of the initiative created on first run (default "BAU"). */
  defaultInitiative: text(80).default(DEFAULT_INITIATIVE),
  divisions: z.array(divisionSchema),
  /** The roster, without the owner (who is added as "me" automatically). */
  people: z.array(personSchema).default([]),
});

export type AssistantConfig = z.infer<typeof assistantConfigSchema>;
export type AssistantConfigDivision = AssistantConfig["divisions"][number];
export type AssistantConfigPerson = AssistantConfig["people"][number];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Thrown by `parseAssistantConfig` / `loadAssistantConfig`; `message` lists every problem, one per line. */
export class AssistantConfigError extends Error {
  readonly source: string;
  readonly problems: readonly string[];

  constructor(source: string, problems: readonly string[]) {
    super(`${source} has ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "AssistantConfigError";
    this.source = source;
    this.problems = problems;
  }
}

type Issue = z.ZodError["issues"][number];

/** ["divisions", 3, "parentCode"] → "divisions[3].parentCode" */
function formatPath(segments: readonly PropertyKey[]): string {
  let out = "";
  for (const segment of segments) {
    if (typeof segment === "number") out += `[${segment}]`;
    else out += out.length > 0 ? `.${String(segment)}` : String(segment);
  }
  return out;
}

function describeIssue(issue: Issue): string {
  const where = formatPath(issue.path);
  return where.length > 0 ? `${where}: ${issue.message}` : issue.message;
}

/**
 * Cross-field problems the schema cannot express — unique codes and initials, references to listed
 * divisions, no parent cycles, one personal division, a timezone Intl accepts. Empty when consistent.
 */
export function assistantConfigProblems(config: AssistantConfig): string[] {
  const problems: string[] = [];

  // Division codes: unique, and unique ignoring case because the app resolves codes case-insensitively.
  const codes = new Set<string>();
  const byUpper = new Map<string, string>();
  config.divisions.forEach((d, i) => {
    const seen = byUpper.get(d.code.toUpperCase());
    if (seen !== undefined) {
      const detail = seen === d.code ? "" : ` (clashes with "${seen}" — codes are matched case-insensitively)`;
      problems.push(`divisions[${i}].code: duplicate division code "${d.code}"${detail}`);
      return;
    }
    codes.add(d.code);
    byUpper.set(d.code.toUpperCase(), d.code);
  });

  // References must match a listed code exactly (the database foreign keys compare exact text).
  const checkReference = (where: string, ref: string | null, what: string): void => {
    if (ref === null || codes.has(ref)) return;
    const near = byUpper.get(ref.toUpperCase());
    problems.push(`${where}: ${what} "${ref}" is not a listed division${near ? ` (did you mean "${near}"?)` : ""}`);
  };

  const parentOf = new Map(config.divisions.map((d) => [d.code, d.parentCode] as const));
  config.divisions.forEach((d, i) => {
    if (d.parentCode === null) return;
    if (d.parentCode === d.code) {
      problems.push(`divisions[${i}].parentCode: "${d.code}" cannot be its own parent`);
      return;
    }
    checkReference(`divisions[${i}].parentCode`, d.parentCode, "parentCode");
    // Walk up the chain; coming back to this division means a cycle.
    const visited = new Set<string>([d.code]);
    let current: string | null = d.parentCode;
    while (current !== null && codes.has(current)) {
      if (visited.has(current)) {
        if (current === d.code) problems.push(`divisions[${i}].parentCode: "${d.code}" is part of a parent cycle`);
        break;
      }
      visited.add(current);
      current = parentOf.get(current) ?? null;
    }
  });

  const personal = config.divisions.filter((d) => d.kind === "personal");
  const firstPersonal = personal[0];
  if (personal.length > 1) {
    problems.push(`divisions: only one division may have kind "personal" (found ${personal.map((d) => `"${d.code}"`).join(", ")})`);
  } else if (firstPersonal && firstPersonal.code !== config.personalDivisionCode) {
    problems.push(`personalDivisionCode: "${config.personalDivisionCode}" does not match the personal division "${firstPersonal.code}"`);
  }

  checkReference("owner.divisionCode", config.owner.divisionCode, "divisionCode");
  if (!isValidTimeZone(config.owner.timezone)) {
    problems.push(`owner.timezone: "${config.owner.timezone}" is not a valid IANA timezone (for example "America/Detroit")`);
  }

  // Initials: unique ignoring case, and the owner is never listed twice.
  const ownerKey = config.owner.initials.toUpperCase();
  const initials = new Set<string>();
  config.people.forEach((p, i) => {
    const key = p.initials.toUpperCase();
    if (key === ownerKey) {
      problems.push(`people[${i}].initials: "${p.initials}" are the owner's initials — the owner is added from "owner" automatically, leave them out of "people"`);
    } else if (initials.has(key)) {
      problems.push(`people[${i}].initials: duplicate initials "${p.initials}"`);
    } else {
      initials.add(key);
    }
    checkReference(`people[${i}].divisionCode`, p.divisionCode, "divisionCode");
  });

  return problems;
}

/** Validate an already-parsed JSON value. `source` names the file in the error message. */
export function parseAssistantConfig(raw: unknown, source = ASSISTANT_CONFIG_FILE): AssistantConfig {
  const parsed = assistantConfigSchema.safeParse(raw);
  if (!parsed.success) throw new AssistantConfigError(source, parsed.error.issues.map(describeIssue));
  const problems = assistantConfigProblems(parsed.data);
  if (problems.length > 0) throw new AssistantConfigError(source, problems);
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Which file `loadAssistantConfig` would read: local override → $ASSISTANT_CONFIG → assistant.config.json. */
export function resolveAssistantConfigPath(rootDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const local = path.join(rootDir, ASSISTANT_CONFIG_LOCAL_FILE);
  if (fs.existsSync(local)) return local;
  const fromEnv = env[ASSISTANT_CONFIG_ENV]?.trim();
  if (fromEnv) return path.resolve(rootDir, fromEnv);
  return path.join(rootDir, ASSISTANT_CONFIG_FILE);
}

/** Read, parse and validate one specific config file (no resolution — tests use this for determinism). */
export function readAssistantConfigFile(file: string): AssistantConfig {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    const hint =
      missing && path.basename(file) === ASSISTANT_CONFIG_FILE
        ? ` — copy assistant.config.example.json to ${ASSISTANT_CONFIG_FILE} and fill it in`
        : "";
    throw new Error(`Cannot read assistant config ${file}: ${(err as Error).message}${hint}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content.replace(/^﻿/, ""));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${(err as Error).message}`);
  }
  return parseAssistantConfig(raw, file);
}

/** The config this instance runs with (see the resolution order at the top of this file). */
export function loadAssistantConfig(rootDir: string, env: NodeJS.ProcessEnv = process.env): AssistantConfig {
  return readAssistantConfigFile(resolveAssistantConfigPath(rootDir, env));
}

// ---------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------

/** Reference data for an empty database: divisions as listed, the owner first as "me", then the roster. */
export function toSeed(config: AssistantConfig): SeedData {
  const divisions: Division[] = config.divisions.map((d) => ({
    code: d.code,
    name: d.name,
    kind: d.kind,
    parentCode: d.parentCode,
    color: d.color,
    textColor: d.textColor,
    sortOrder: d.sortOrder,
    archived: false,
  }));
  const me: Omit<Person, "id"> = {
    initials: config.owner.initials,
    fullName: config.owner.fullName,
    divisionCode: config.owner.divisionCode ?? null,
    email: config.owner.email,
    role: config.owner.role,
    isMe: true,
    archived: false,
  };
  const people: Omit<Person, "id">[] = [
    me,
    ...config.people.map((p) => ({
      initials: p.initials,
      fullName: p.fullName,
      divisionCode: p.divisionCode,
      email: p.email,
      role: p.role,
      isMe: false,
      archived: false,
    })),
  ];
  return { divisions, people, initiatives: [config.defaultInitiative] };
}

/** The public, non-secret subset the client needs (shared/types.ts `AssistantInfo`, sent in /api/bootstrap). */
export function toAssistantInfo(config: AssistantConfig): AssistantInfo {
  return {
    name: config.assistant.name,
    tagline: config.assistant.tagline,
    ownerName: config.owner.fullName,
    ownerInitials: config.owner.initials,
    organization: config.organization.name,
    organizationShort: config.organization.shortName,
    timezone: config.owner.timezone,
    themeColor: config.branding.themeColor,
    accentColor: config.branding.accentColor,
  };
}
