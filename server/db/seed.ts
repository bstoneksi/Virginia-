import type { DatabaseSync } from "node:sqlite";
import type { Division, Person } from "../../shared/types";

/**
 * Reference data for an empty database. Built from assistant.config.json by `toSeed`
 * (server/assistantConfig.ts); tests use `exampleSeed` from server/lib/testing.ts.
 */
export interface SeedData {
  divisions: Division[];
  /** Exactly one entry carries `isMe: true` — the owner. */
  people: Omit<Person, "id">[];
  /** Initiative names created as Active, in order (the first is the default, e.g. "BAU"). */
  initiatives: string[];
}

/**
 * Parents before children at any depth, so the self-referencing divisions FK is satisfied on insert.
 * Divisions whose parent never appears stay at the end in their original order (SQLite then reports them).
 */
export function orderDivisionsParentsFirst(divisions: readonly Division[]): Division[] {
  const ordered: Division[] = [];
  const placed = new Set<string>();
  let remaining = [...divisions];
  while (remaining.length > 0) {
    const ready = remaining.filter((d) => d.parentCode === null || placed.has(d.parentCode));
    if (ready.length === 0) break;
    for (const d of ready) {
      ordered.push(d);
      placed.add(d.code);
    }
    remaining = remaining.filter((d) => !placed.has(d.code));
  }
  return [...ordered, ...remaining];
}

/** Insert `seed` into an empty database. Idempotent per row (INSERT OR IGNORE), all-or-nothing. */
export function seedDatabase(db: DatabaseSync, seed: SeedData): void {
  const insertDivision = db.prepare(
    `INSERT OR IGNORE INTO divisions (code, name, kind, parent_code, color, text_color, sort_order, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPerson = db.prepare(
    `INSERT OR IGNORE INTO people (initials, full_name, division_code, email, role, is_me, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertInitiative = db.prepare(
    `INSERT OR IGNORE INTO initiatives (name, status, created_at) VALUES (?, 'Active', ?)`,
  );
  const createdAt = new Date().toISOString();

  db.exec("BEGIN");
  try {
    for (const d of orderDivisionsParentsFirst(seed.divisions)) {
      insertDivision.run(d.code, d.name, d.kind, d.parentCode, d.color, d.textColor, d.sortOrder, d.archived ? 1 : 0);
    }
    for (const p of seed.people) {
      insertPerson.run(p.initials, p.fullName, p.divisionCode, p.email, p.role, p.isMe ? 1 : 0, p.archived ? 1 : 0);
    }
    for (const name of seed.initiatives) insertInitiative.run(name, createdAt);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
