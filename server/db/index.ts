import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_TIMEZONE, dateISOInTZ } from "../../shared/timezone";
import { seedDatabase } from "./seed";
import type { SeedData } from "./seed";

export type Db = DatabaseSync;

const SCHEMA_VERSION = 1;
const here = path.dirname(fileURLToPath(import.meta.url));

export interface OpenOptions {
  /** Reference data inserted when the database is empty (`toSeed(config.assistant)`), or false to leave it empty. */
  seed: SeedData | false;
}

/**
 * Open (creating if needed) the SQLite database at `${dataDir}/virginia.db`,
 * apply the schema idempotently and insert `options.seed` on first run.
 * Pass ":memory:" as dataDir for tests.
 */
export function openDatabase(dataDir: string, options: OpenOptions): Db {
  const seed = options.seed;
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

  if (seed !== false) {
    const count = db.prepare("SELECT COUNT(*) AS n FROM divisions").get() as { n: number };
    if (count.n === 0) seedDatabase(db, seed);
  }

  return db;
}

/** Current time as ISO-8601 UTC string, the format stored in every *_at column. */
export function nowISO(): string {
  return new Date().toISOString();
}

/** Today's date as YYYY-MM-DD in `tz` — the owner's timezone (`config.assistant.owner.timezone`), America/Detroit by default. */
export function todayISO(now: Date = new Date(), tz: string = DEFAULT_TIMEZONE): string {
  return dateISOInTZ(now, tz);
}
