import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { seedDatabase } from "./seed";

export type Db = DatabaseSync;

const SCHEMA_VERSION = 1;
const here = path.dirname(fileURLToPath(import.meta.url));

export interface OpenOptions {
  /** Seed divisions/people/BAU when the database is empty. Default true. */
  seed?: boolean;
}

/**
 * Open (creating if needed) the SQLite database at `${dataDir}/virginia.db`,
 * apply the schema idempotently and seed reference data on first run.
 * Pass ":memory:" as dataDir for tests.
 */
export function openDatabase(dataDir: string, options: OpenOptions = {}): Db {
  const seed = options.seed ?? true;
  let file: string;
  if (dataDir === ":memory:") {
    file = ":memory:";
  } else {
    fs.mkdirSync(dataDir, { recursive: true });
    file = path.join(dataDir, "virginia.db");
  }

  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  const schemaSql = fs.readFileSync(path.join(here, "schema.sql"), "utf8");
  db.exec(schemaSql);

  const versionRow = db.prepare("SELECT version FROM schema_version LIMIT 1").get() as { version: number } | undefined;
  if (!versionRow) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
  } else if (versionRow.version < SCHEMA_VERSION) {
    // Future migrations go here, keyed on versionRow.version.
    db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
  }

  if (seed) {
    const count = db.prepare("SELECT COUNT(*) AS n FROM divisions").get() as { n: number };
    if (count.n === 0) seedDatabase(db);
  }

  return db;
}

/** Current time as ISO-8601 UTC string, the format stored in every *_at column. */
export function nowISO(): string {
  return new Date().toISOString();
}

/** Today's date as YYYY-MM-DD in America/Detroit (Brandon's timezone). */
export function todayISO(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Detroit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
