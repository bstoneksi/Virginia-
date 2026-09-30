-- Virginia schema. Applied idempotently at boot (see server/db/index.ts).
-- Column semantics are documented in docs/SPEC.md §3 and shared/types.ts.

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS divisions (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('brand','function','personal')),
  parent_code TEXT NULL REFERENCES divisions(code),
  color       TEXT NOT NULL,
  text_color  TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS people (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  initials      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  division_code TEXT NULL REFERENCES divisions(code),
  email         TEXT NULL,
  role          TEXT NULL,
  is_me         INTEGER NOT NULL DEFAULT 0,
  archived      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS initiatives (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','On Hold','Complete')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS captures (
  id                    TEXT PRIMARY KEY,
  kind                  TEXT NOT NULL CHECK (kind IN ('text','transcript','image','screenshot','mixed','import')),
  title                 TEXT NULL,
  raw_text              TEXT NULL,
  context               TEXT NULL,
  default_division_code TEXT NULL,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','discarded')),
  error                 TEXT NULL,
  notes                 TEXT NOT NULL DEFAULT '[]',
  created_at            TEXT NOT NULL,
  reviewed_at           TEXT NULL
);

CREATE TABLE IF NOT EXISTS capture_files (
  id         TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  bytes      BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id                TEXT PRIMARY KEY,
  category          TEXT NOT NULL CHECK (category IN ('A','Q','I','D','W','NB')),
  title             TEXT NOT NULL,
  note              TEXT NOT NULL DEFAULT '',
  division_code     TEXT NULL REFERENCES divisions(code),
  owner_initials    TEXT NULL REFERENCES people(initials),
  initiative_id     INTEGER NULL REFERENCES initiatives(id),
  priority          TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High')),
  status            TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Parked','Done')),
  due_date          TEXT NULL,
  rank              REAL NOT NULL DEFAULT 0,
  is_personal       INTEGER NOT NULL DEFAULT 0,
  context           TEXT NULL,
  source_capture_id TEXT NULL REFERENCES captures(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  completed_at      TEXT NULL
);

CREATE TABLE IF NOT EXISTS item_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('created','status','edit','comment')),
  data       TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proposals (
  id             TEXT PRIMARY KEY,
  capture_id     TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
  state          TEXT NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','accepted','rejected')),
  item_id        TEXT NULL REFERENCES items(id),
  draft          TEXT NOT NULL,          -- JSON ItemDraft
  confidence     REAL NOT NULL DEFAULT 0.5,
  inferred       INTEGER NOT NULL DEFAULT 0,
  source_excerpt TEXT NULL,
  warnings       TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS briefs (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('email_digest','daily','other')),
  title      TEXT NOT NULL,
  body_md    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_status_rank ON items(status, rank);
CREATE INDEX IF NOT EXISTS idx_items_owner       ON items(owner_initials);
CREATE INDEX IF NOT EXISTS idx_items_division    ON items(division_code);
CREATE INDEX IF NOT EXISTS idx_items_due         ON items(due_date);
CREATE INDEX IF NOT EXISTS idx_proposals_capture ON proposals(capture_id);
CREATE INDEX IF NOT EXISTS idx_events_item       ON item_events(item_id);
CREATE INDEX IF NOT EXISTS idx_files_capture     ON capture_files(capture_id);
