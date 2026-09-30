# Virginia — Build Specification (v1)

This is the contract every builder works from. `shared/types.ts` is the machine-readable half of it; when the two disagree, fix the code to match `shared/types.ts` and this file, not the other way round. Product rationale lives in `docs/SCOPE.md`.

## 0. Non-negotiables

1. **Nothing the AI proposes lands in the tracker without review.** Extraction produces `proposals`; only an explicit accept creates an `item`. (The MCP `add_items` tool is the one exception: Claude-in-chat is Brandon acting deliberately.)
2. **Done items are never deleted by the app.** Status `Done` keeps the row; hard delete exists only as an explicit, confirmed action.
3. **The app never sends email, never touches the mailbox.** Email lives in a separate routine outside this codebase.
4. **Single user.** Every `/api/*` route except `/api/health` and `/api/auth/login` requires a valid session cookie **or** `Authorization: Bearer <MCP_TOKEN>`. `/mcp/:token` requires `token === MCP_TOKEN` (constant-time compare). `DISABLE_AUTH=1` bypasses auth for local dev only and must log a loud warning at boot.
5. **Mobile first.** Every page must be usable at 375 px wide with 44 px tap targets; desktop gets a sidebar.
6. **No native modules.** SQLite is `node:sqlite` (`DatabaseSync`). Do not add better-sqlite3, sharp, etc.

## 1. Stack & conventions (decided — do not relitigate)

| Layer | Choice |
|---|---|
| Runtime | Node ≥ 24, ESM (`"type": "module"`), run with `tsx` in dev and prod |
| API | Hono 4 + `@hono/node-server`; JSON everywhere; errors as `{ error: string, details?: unknown }` with proper status codes |
| DB | SQLite file at `${DATA_DIR}/virginia.db` via `node:sqlite`; schema in `server/db/schema.sql`, applied idempotently at boot (`CREATE TABLE IF NOT EXISTS`, plus a `schema_version` table for future migrations); seed on empty DB |
| AI | `@anthropic-ai/sdk` ≥ 0.129, model from `ANTHROPIC_MODEL` (default `claude-opus-5-5`), structured outputs via `client.messages.parse` + `zodOutputFormat` (zod 4) |
| MCP | `@modelcontextprotocol/sdk` Streamable HTTP transport mounted at `/mcp/:token` |
| Import | `exceljs` reading `.xlsx`/`.xlsm` (same zip format) and `.csv` |
| Client | React 19 + Vite 7 + Tailwind 4 (`@tailwindcss/vite`), `react-router` 7 (`BrowserRouter`), `@dnd-kit/core` + `@dnd-kit/sortable`; PWA manifest + iOS meta tags (no service worker in v1) |
| Tests | `node:test` via `npm test` (`node --import tsx --test "server/**/*.test.ts" "shared/**/*.test.ts"`) |
| Imports | extensionless relative imports (`../db/repo`), `@shared/*` alias only inside `client/` |
| IDs | items/captures/proposals/briefs: `crypto.randomUUID()` strings; people/initiatives/events: integer autoincrement |
| Dates | `created_at`/`updated_at` ISO-8601 UTC strings; `due_date` is `YYYY-MM-DD` (no time); display in America/Detroit |
| Config | `server/config.ts` reads env once (`PORT`, `DATA_DIR`, `APP_PASSWORD`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `MCP_TOKEN`, `DISABLE_AUTH`); loads `.env` via `process.loadEnvFile` if present |

Scripts: `npm run dev` (server :3000 + Vite :5173 with `/api` and `/mcp` proxied), `npm run build`, `npm start`, `npm run typecheck`, `npm test`, `npm run check` (all three).

## 2. Repo layout & ownership

```
server/
  index.ts          boot: config → db → app (routes, static client/dist, SPA fallback) → listen   [foundation]
  config.ts                                                                                    [foundation]
  app.ts            createApp(deps) → Hono instance (so tests can build an app without listening) [server-core]
  auth.ts           login/logout/session cookie (HMAC-signed, 90-day), bearer check, middleware    [server-core]
  db/schema.sql, db/index.ts (open, migrate, seed), db/seed.ts                                  [foundation]
  db/repo.ts        all SQL lives here; typed functions; no SQL in routes                        [server-core]
  routes/*.ts       items, people, divisions, initiatives, agenda, captures, importer, search, briefs, auth, health [server-core; captures/import routes call modules below]
  ai/extract.ts     extractProposals(input) → ItemDraft proposals (Claude); ai/grammar.ts deterministic tag parser; ai/prompt.ts [ai-extract]
  mcp/server.ts     MCP tools over repo functions                                               [mcp-import]
  import/excel.ts   parse workbook/csv → ImportPreview; import/mapping.ts division/person fuzzy map [mcp-import]
shared/
  types.ts          domain types, enums, seed constants, colors, DTOs                            [foundation]
  agenda.ts         pure functions: groupForAgenda(items), agendaToMarkdown(agenda), todayBuckets(items, now) [server-core, shared with client]
client/
  index.html, vite.config.ts, public/manifest.webmanifest, public/icons/*                       [client-ui]
  src/main.tsx, App.tsx (routes + layout), api.ts (typed fetch wrapper), pages/*, components/*, lib/*  [client-ui]
docs/  SCOPE.md, SPEC.md, DEPLOY.md, SETUP-WIZARD.sh
```

Builders own only their bracketed areas. If you need something from another area that doesn't exist yet, code against the signature in this spec and leave a `// TODO(integration)` comment; the integration pass wires it.

## 3. Data model (`server/db/schema.sql`)

```sql
divisions(code TEXT PK, name TEXT NOT NULL, kind TEXT CHECK(kind IN ('brand','function','personal')), parent_code TEXT NULL REFERENCES divisions(code), color TEXT NOT NULL, text_color TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0)
people(id INTEGER PK AUTOINCREMENT, initials TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL, division_code TEXT NULL REFERENCES divisions(code), email TEXT NULL, role TEXT NULL, is_me INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0)
initiatives(id INTEGER PK AUTOINCREMENT, name TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','On Hold','Complete')), created_at TEXT NOT NULL)
items(id TEXT PK, category TEXT NOT NULL CHECK(category IN ('A','Q','I','D','W','NB')), title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', division_code TEXT NULL REFERENCES divisions(code), owner_initials TEXT NULL REFERENCES people(initials), initiative_id INTEGER NULL REFERENCES initiatives(id), priority TEXT NOT NULL DEFAULT 'Medium' CHECK(priority IN ('Low','Medium','High')), status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','In Progress','Parked','Done')), due_date TEXT NULL, rank REAL NOT NULL DEFAULT 0, is_personal INTEGER NOT NULL DEFAULT 0, context TEXT NULL, source_capture_id TEXT NULL REFERENCES captures(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT NULL)
item_events(id INTEGER PK AUTOINCREMENT, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, type TEXT NOT NULL CHECK(type IN ('created','status','edit','comment')), data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)
captures(id TEXT PK, kind TEXT NOT NULL CHECK(kind IN ('text','transcript','image','screenshot','mixed','import')), title TEXT NULL, raw_text TEXT NULL, context TEXT NULL, default_division_code TEXT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','discarded')), error TEXT NULL, created_at TEXT NOT NULL, reviewed_at TEXT NULL)
capture_files(id TEXT PK, capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE, filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, bytes BLOB NOT NULL)
proposals(id TEXT PK, capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE, state TEXT NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','accepted','rejected')), item_id TEXT NULL REFERENCES items(id), draft TEXT NOT NULL /* JSON ItemDraft */, confidence REAL NOT NULL DEFAULT 0.5, inferred INTEGER NOT NULL DEFAULT 0, source_excerpt TEXT NULL, warnings TEXT NOT NULL DEFAULT '[]', sort_order INTEGER NOT NULL DEFAULT 0)
briefs(id TEXT PK, kind TEXT NOT NULL CHECK(kind IN ('email_digest','daily','other')), title TEXT NOT NULL, body_md TEXT NOT NULL, created_at TEXT NOT NULL)
sessions(id TEXT PK, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)
schema_version(version INTEGER NOT NULL)
```
Indexes: `items(status, rank)`, `items(owner_initials)`, `items(division_code)`, `items(due_date)`, `proposals(capture_id)`, `item_events(item_id)`. `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;` at open.

Rank: new items get `rank = (min rank in that status) - 1` so they appear at the top; `reorder` rewrites ranks 0..n for the given column. Status change to `Done` sets `completed_at`; leaving `Done` clears it. Every create/status/edit/comment writes an `item_events` row.

Seed (empty DB only): divisions and people from `SEED_DIVISIONS` / `SEED_PEOPLE` in `shared/types.ts`; one initiative `BAU`.

## 4. API contract (`/api`, JSON)

Auth: `POST /api/auth/login {password}` → `204` + `Set-Cookie: virginia_session=…; HttpOnly; SameSite=Lax; Secure (when not localhost); Max-Age=90d` · `POST /api/auth/logout` → 204 · `GET /api/auth/me` → `{ authenticated: boolean }`. Wrong password → 401 after a 300 ms delay. `GET /api/health` → `{ ok: true, version, db: 'ok' }` (no auth).

Bootstrap: `GET /api/bootstrap` → `Bootstrap` (divisions, people, initiatives, me, `aiConfigured`, `mcpConfigured`).

Items:
- `GET /api/items?status=Open,Parked&category=A,NB&division=HG&owner=VM&personal=1&includeDone=0&q=text&initiative=3` → `Item[]` ordered by `status`, `rank`. Default excludes `Done`.
- `POST /api/items` body `ItemDraft` (title required, ≤ 140 chars; NB requires `ownerInitials` or `divisionCode` → else 422 `{error:'NB needs a target'}`) → 201 `Item`
- `GET /api/items/:id` → `Item & { events: ItemEvent[], capture?: CaptureSummary }`
- `PATCH /api/items/:id` partial `ItemDraft & { status?, rank? }` → `Item`
- `DELETE /api/items/:id` → 204 (hard delete; UI confirms)
- `POST /api/items/reorder { status: Status, orderedIds: string[] }` → 204 (also sets status of any listed item that isn't in that column — this is how drag-between-columns is persisted in one call)
- `POST /api/items/:id/comments { text }` → `ItemEvent`

Agenda & views:
- `GET /api/agenda/person/:initials` and `GET /api/agenda/division/:code` → `Agenda` (groups in `CATEGORY_ORDER`; within a group open+in-progress first sorted by priority desc, due date asc, rank; parked at the bottom; Done excluded unless `?includeDone=1`; `markdown` = `agendaToMarkdown`)
- `GET /api/today` → `TodayView` (buckets computed by `todayBuckets(items, now)` from `shared/agenda.ts`; "me" = `people.is_me`)
- `GET /api/search?q=` → `{ items: Item[], captures: CaptureSummary[] }` (LIKE on title/note/context; captures by raw_text/title)

Reference data: `GET/POST /api/people`, `PATCH /api/people/:id`; `GET/POST /api/divisions`, `PATCH /api/divisions/:code`; `GET/POST /api/initiatives`, `PATCH /api/initiatives/:id`. Archive instead of delete.

Captures:
- `POST /api/captures` multipart: `text?`, `context?`, `defaultDivisionCode?`, `title?`, `files[]?` (image/jpeg|png|heic|webp|gif, ≤ 10 MB each, ≤ 8 files) → creates capture (kind inferred: text/transcript/image/screenshot/mixed), runs `extractProposals`, stores proposals, returns 201 `Capture`. If extraction throws, capture is saved with `error` and `status:'pending'`, response is still 201 with `error` set (the user can retry).
- `GET /api/captures?status=pending` → `CaptureSummary[]`; `GET /api/captures/:id` → `Capture`; `GET /api/captures/:id/files/:fileId` → bytes with correct content-type (auth required)
- `POST /api/captures/:id/reextract` → re-runs extraction, replaces `proposed` proposals (keeps accepted/rejected)
- `POST /api/captures/:id/proposals/:pid/accept` body partial `ItemDraft` overrides → `{ proposal, item }`; `POST …/reject` → `proposal`
- `POST /api/captures/:id/accept-all` → `{ items: Item[] }` (all still-proposed, using their current drafts)
- `POST /api/captures/:id/discard` → 204 (status discarded)
- `PATCH /api/captures/:id/proposals/:pid { draft }` → edits a proposal's draft before accepting

Import: `POST /api/import/preview` multipart `file` → `ImportPreview` · `POST /api/import/commit { rows: ImportRow[] }` → `{ created: number, items: Item[] }` (creates one capture of kind `import` as provenance).

Briefs: `GET /api/briefs?limit=20` → `Brief[]` · `POST /api/briefs { kind, title, bodyMd }` → 201 · `DELETE /api/briefs/:id` → 204.

All list endpoints return arrays directly (no envelope). Validation errors → 422. Unknown ids → 404.

## 5. AI extraction contract (`server/ai/`)

`extractProposals(input: ExtractInput, ctx: ExtractContext): Promise<ExtractResult>`
- `ExtractInput = { text: string | null; images: { mime: string; bytes: Uint8Array }[]; context: string | null; defaultDivisionCode: string | null; todayISO: string }`
- `ExtractContext = { people: Person[]; divisions: Division[]; initiatives: Initiative[] }`
- `ExtractResult = { proposals: ProposalDraft[]; model: string; usage?: { input: number; output: number }; notes: string[] }` where `ProposalDraft = { draft: ItemDraft; confidence: number; inferred: boolean; sourceExcerpt: string | null; warnings: string[] }`

Rules the system prompt must encode (copy the grammar from `docs/SCOPE.md` §1 table and the live roster/divisions from ctx):
- Tagged lines are authoritative: `A:` `Q:` `I:` `D:` `W:` `NB:` at line start (also accept `A -`, `(A)`, `A)`, and in handwriting a circled letter). Initials right after the tag are owner (`A:`) or target (`NB:`). A division code anywhere on the line overrides the default division. `PTD` or `personal` → `isPersonal=true`, no division. `Initiative: Name` → `initiativeName`. `due 10/15`, `by Friday`, `EOW`, `next week` → `dueDate` resolved from `todayISO` (America/Detroit), else null. `!!`/`urgent`/`ASAP` → High; `someday`/`parking lot`/`when we get to it` → `status:'Parked'`.
- Untagged material (transcripts, screenshots of texts): extract only concrete commitments, requests, decisions, risks, and things to raise with someone; set `inferred=true`, `confidence ≤ 0.7`. Ignore pleasantries. Do not invent owners — leave `ownerInitials` null unless the person is named and matches the roster; people not on the roster go in the note text and a warning (`unknown person: Brooke`).
- `NB` without a target → keep it as a proposal with warning `NB needs a target`.
- Title ≤ 140 chars, imperative, no trailing period; `note` carries the detail and speaker attribution for transcripts; `sourceExcerpt` = the line(s) it came from.
- Decisions (`D`) default `status:'Done'`; everything else `Open` unless parked.
- Return an empty list when there is nothing actionable — never pad.

Implementation: `client.messages.parse({ model, max_tokens: 16000, system: [{type:'text', text: STABLE_PROMPT, cache_control:{type:'ephemeral'}}], messages:[{role:'user', content:[...images as base64 image blocks, {type:'text', text: userText}]}], output_config: { effort: 'medium', format: zodOutputFormat(ExtractionSchema) } })`. Omit `thinking` (Opus 5.5 default is adaptive). Do **not** use `tool_choice: any/tool` (400 on Opus 5.5). Handle `stop_reason === 'refusal'` → return `{ proposals: [], notes: ['Claude declined…'] }`. Retry once on `parsed_output === null`. Use typed `Anthropic.*Error` classes; surface rate-limit vs auth vs other as readable `error` text on the capture. Put the roster/divisions in the **user** message (they change; keep the system prompt byte-stable for caching).

`ai/grammar.ts` — `parseTaggedLines(text, ctx, todayISO): ProposalDraft[]` — deterministic parser for lines that carry an explicit tag; unit-tested; used (a) as the offline fallback when `ANTHROPIC_API_KEY` is unset (capture gets `notes: ['AI not configured — only tagged lines parsed']`), and (b) to cross-check: any tagged line the model dropped is appended as a proposal with warning `added by rule parser`.

Zod schema (`ai/schema.ts`): `z.object({ proposals: z.array(z.object({ category: z.enum(CATEGORIES), title, note, ownerInitials: z.string().nullable(), divisionCode: z.string().nullable(), initiativeName: z.string().nullable(), priority: z.enum(PRIORITIES), status: z.enum(STATUSES), dueDate: z.string().nullable(), isPersonal: z.boolean(), confidence: z.number().min(0).max(1), inferred: z.boolean(), sourceExcerpt: z.string().nullable(), warnings: z.array(z.string()) })), notes: z.array(z.string()) })`. Post-validate: unknown initials/division codes → null + warning.

## 6. MCP endpoint (`server/mcp/server.ts`)

Streamable HTTP at `POST/GET/DELETE /mcp/:token` (stateless mode is fine). Server name `virginia`, version from package.json. Tools (zod input schemas, concise descriptions, results as JSON text):
- `list_items { status?, category?, divisionCode?, ownerInitials?, personal?, includeDone?, q? }`
- `add_items { items: ItemDraft[] }` → creates items directly (no review), returns created items
- `update_item { id, patch }` (any `ItemDraft` field + `status`)
- `get_agenda { person?: initials, division?: code, includeDone? }` → markdown + JSON
- `get_today {}`
- `search { q }`
- `list_reference {}` → people, divisions, initiatives
- `add_brief { kind, title, bodyMd }` — how the email-digest routine drops summaries into the app
Settings page shows the full URL to paste into Claude → Settings → Connectors → Add custom connector.

## 7. Import (`server/import/`)

- Detect the four tables in the Brain Dump sheet by finding header cells `Date | Note | Division | Owner/Target | Priority | Due Date | Status` (case/space-insensitive; also accept the older `WHO` header for owner) anywhere on any sheet; the table name is the nearest non-empty cell above the `Date` header (`New Business`, `Action Items`, `Parking Lot`, `Watch List`). Also accept a plain single-table sheet or CSV with those headers (table = sheet name).
- Row → `ItemDraft`: `category` by table (NB / A / A / W; Parking Lot rows get `status:'Parked'`), `title` = first sentence or first 120 chars of Note (strip leading bullets `•-*`), `note` = full Note, `divisionCode` via `mapping.ts` fuzzy match on code or name (e.g. "Henderson Glass" → HG, "Kitchen & Bath - Install" → K&B-I), `ownerInitials` via initials or full-name match, `priority` (default Medium), `dueDate` from Excel date or `mm/dd/yyyy`, `status` Not Started→Open, In Progress→In Progress, Complete→Done. Unmatched division/person → null + warning; blank rows skipped.
- Excel serial dates → ISO; stray strikethrough/formatting ignored.
- Unit test with a fixture workbook generated in the test via exceljs (two tables, mixed rows, one unmatched division).

## 8. Client (`client/src`)

Layout: mobile bottom nav (Today · Board · People · Capture · More) and desktop left sidebar (all pages). Top bar shows page title + pending-captures badge. Unauthenticated → `/login`.

Pages:
- `/login` — passphrase field, remembers via cookie.
- `/` **Today** — sections Overdue / Due this week / High priority / Unowned, quick-add input (creates `A:` item for me), link to Inbox with count. Cards: tap opens Item drawer.
- `/board` **Board** — four columns (Open, In Progress, Parked, Done-collapsed to last 30 days with "show all"); dnd-kit drag between/within columns → optimistic update + `POST /api/items/reorder`; filter bar (division, person, category, personal toggle, text); "+ New" button. Card: category badge, title, owner initials chip, division chip (division color), due date (red when overdue), priority dot, "inferred" is not shown here (only in review).
- `/people` list with counts of open items; `/people/:initials` **Agenda**: grouped by `CATEGORY_ORDER`, open first, parked at bottom greyed, "Copy agenda" (Markdown to clipboard), "Print" (print stylesheet), inline status change, quick add for this person (defaults owner/target).
- `/brands` list; `/brands/:code` — board filtered to the division + agenda tab.
- `/personal` — items with `isPersonal`, simple list grouped by status.
- `/capture` **Inbox** — new capture form (textarea with placeholder showing grammar examples, context field, default division select, add photos/screenshots with `capture="environment"`), list of pending captures; `/capture/:id` **Review** — proposals as editable cards (category, title, note, owner, division, priority, due, personal, status), warnings and "inferred" tag, accept / reject / accept all / re-extract / discard; images shown; source excerpt shown under each card.
- `/search` — one box, results grouped items / captures.
- `/briefs` — list of briefs rendered from markdown (simple renderer, no external lib), newest first.
- `/settings` — People (add/edit/archive, set "this is me"), Divisions (name/color), Initiatives, Import (file drop → preview table with per-row fix-ups → commit), Connector (MCP URL + copy), AI status, Logout.
- Item drawer (shared): edit every field, status buttons, comments + history, source capture link, delete (confirm).

`api.ts`: typed wrapper over fetch with `credentials: 'include'`; 401 → redirect to `/login`; all DTOs from `@shared/types`. Keep state simple (React state + small hooks; no Redux). Colors from `CATEGORY_COLORS`/`STATUS_COLORS`/division `color`.

PWA: `manifest.webmanifest` (name Virginia, standalone, theme `#1B2A49`), `apple-mobile-web-app-capable`, `apple-touch-icon`, viewport `viewport-fit=cover`; safe-area padding for the bottom nav.

## 9. Verification checklist (definition of done)

- `npm run check` passes on Windows and Linux (typecheck, tests, build).
- `DISABLE_AUTH=1 npm start` boots with an empty `DATA_DIR`, seeds, and serves the client at `/`; `/api/health` → 200.
- Smoke via curl: login flow, create item, list, reorder, agenda for `VM`, today, capture with tagged text (offline rule parser) → proposals → accept → item, import preview with a fixture workbook, MCP `initialize` + `list_items` round trip with the token.
- Browser at 375 px: Today, Board drag, Capture form, Review accept, Agenda copy all work with no horizontal scroll.
- Auth: every `/api/*` and `/mcp/*` route returns 401 without credentials (except health/login); wrong MCP token → 401.
- No `any` leaks across `shared/types.ts` boundaries; no unhandled promise rejections in the server log during the smoke run.
