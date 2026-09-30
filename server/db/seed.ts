import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_INITIATIVE, SEED_DIVISIONS, SEED_PEOPLE } from "../../shared/types";

/** Insert reference data into an empty database. Idempotent per row (INSERT OR IGNORE). */
export function seedDatabase(db: DatabaseSync): void {
  const insertDivision = db.prepare(
    `INSERT OR IGNORE INTO divisions (code, name, kind, parent_code, color, text_color, sort_order, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  );
  const insertPerson = db.prepare(
    `INSERT OR IGNORE INTO people (initials, full_name, division_code, email, role, is_me, archived)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
  );
  const insertInitiative = db.prepare(
    `INSERT OR IGNORE INTO initiatives (name, status, created_at) VALUES (?, 'Active', ?)`,
  );

  db.exec("BEGIN");
  try {
    // Parents first so the self-referencing FK is satisfied.
    const ordered = [...SEED_DIVISIONS].sort((a, b) => Number(a.parentCode !== null) - Number(b.parentCode !== null));
    for (const d of ordered) {
      insertDivision.run(d.code, d.name, d.kind, d.parentCode, d.color, d.textColor, d.sortOrder);
    }
    for (const p of SEED_PEOPLE) {
      insertPerson.run(p.initials, p.fullName, p.divisionCode, p.email, p.role, p.isMe ? 1 : 0);
    }
    insertInitiative.run(DEFAULT_INITIATIVE, new Date().toISOString());
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
