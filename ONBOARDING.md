# Virginia starter — handoff for the next assistant

*From Brandon Stone's build (KSI Family of Brands), 2026-10-01. Read this first in your own Claude Code session; it tells your Claude what is already done so it does not redo it.*

## 1. What you are getting

A working, reviewed, single-user "executive assistant" tracker you can rename and make your own:

- **Capture → Review → Track.** Paste a meeting or voice-memo transcript, drop in photos of handwritten notes or screenshots, or import an Excel list. Claude turns it into proposed items in a short tag grammar (Action, Question, Idea, Decision, Watch, New Business, with owner initials and a brand code). Nothing lands until you accept it on a review screen.
- **Views.** Today (your priority list), a kanban Board (Open · In Progress · Parked · Done, with a Group-by-person/brand switch in progress), an agenda per direct report you can copy or print, a board per brand, Personal to-dos, Search, Briefs.
- **Claude connector.** A Model Context Protocol endpoint so your claude.ai project can read and write the same tracker from chat.
- **Deploy-ready.** Dockerfile + Railway config, one service + one storage volume, SQLite built into Node (no native builds), phone-installable web app.
- **Quality.** 196 automated tests, a 42-step end-to-end check, four independent reviews with all 20 findings fixed.

Everything here was decided and built once already. Your job is to **personalize, not rebuild**.

## 2. Get the code running (10 minutes)

1. Unzip `virginia-starter.zip` (from Brandon) into a folder, or clone his GitHub repo once it exists.
2. Install Node 24 or newer if you don't have it. Then, in the folder:

```bash
npm install
cp .env.example .env        # set DISABLE_AUTH=1 for a first local look
npm run check               # typecheck + 196 tests + build; should be green
npm run dev                 # API on :3000, UI on :5173
```

3. Open http://localhost:5173. Use Capture with a line like `A:PH Call the Novi showroom about the delayed order — K&B due 10/15` and accept it in Review.

## 3. Read before changing anything (your Claude should too)

| File | Why |
|---|---|
| `README.md` | one-page overview and the tag grammar |
| `docs/SCOPE.md` | the 15 design questions, the reasoning, and Brandon's answers (§3 and §6) |
| `docs/SPEC.md` | the build contract; §10 lists where the code deliberately differs |
| `docs/PRODUCT-SPEC.md` | problem, solution, 59 user stories, testing approach |
| `docs/DEPLOY.md` | run, deploy to Railway, connect Claude, import a spreadsheet |
| `docs/EMAIL-ROUTINE.md` | what an email digest may and may not do, and the IT permission it needs |
| `CLAUDE.md`, `docs/agents/*` | project instructions for Claude Code and the issue-tracker / triage-label setup (Matt Pocock's engineering skills). Keep or delete. |

## 4. Make it yours — the personalization checklist

Paste this into your Claude Code session after step 2:

> Read ONBOARDING.md §4. Personalize this repo for me: assistant name **<Name>**, my name **<Your Name>**, role **<Role>**, company **<Company or "KSI Family of Brands">**, my initials **<XX>**, my email **<you@teamksi.com>**. My direct reports (initials → full name → brand) are: **<list>**. Keep the brands list as-is / replace it with: **<list>**. Apply every row of the checklist, run `npm run check`, fix any test that asserted the old examples, and show me a summary of what changed.

What changes and where:

| What | Where |
|---|---|
| Your initials, roster of direct reports, brands/divisions and their colors, default initiative | `shared/types.ts` (`ME_INITIALS`, `SEED_PEOPLE`, `SEED_DIVISIONS`, `DEFAULT_INITIATIVE`). Seeds apply to a **new** database; on an existing one edit them in Settings instead. |
| Assistant's name and who it serves, in the extraction prompt | `server/ai/prompt.ts` (`STABLE_SYSTEM_PROMPT` opening lines) |
| App name shown on the phone and in tabs | `client/public/manifest.webmanifest`, `client/index.html`, `client/src/lib/shell.tsx`, `client/src/components/AppShell.tsx`, `client/src/pages/LoginPage.tsx`, `MorePage.tsx`, `BriefsPage.tsx`, `pages/settings/AboutSettings.tsx`, `ConnectorSettings.tsx` |
| Connector name Claude sees | `server/mcp/server.ts` (server name and tool descriptions mention "Virginia") |
| Package name, Dockerfile comment, env comments | `package.json`, `Dockerfile`, `.env.example` |
| Example lines and names in docs | `README.md`, `CLAUDE.md`, `docs/SETUP-WIZARD.sh` (email address, repo name, spreadsheet file name, Claude project name), `docs/EMAIL-ROUTINE.md`, `docs/DEPLOY.md` |
| Tests that use Brandon's examples (initials like VM/SB, brand HG) | `server/**/*.test.ts` — update the examples if you change the roster or brands; `npm test` will tell you which |

Safe to keep: the cookie name `virginia_session`, the database file name `virginia.db`, and the `data/` layout.

## 5. Decide what you want differently

Brandon answered 15 design questions; your defaults are his answers. Ask your Claude to render them as a clickable decision page for you, the way `docs/decisions-round-1.html` does (KSI-branded, "Copy my answers" button), and change only what you disagree with:

1. Hosting — Railway, one service + volume, SQLite. (Postgres only if multi-user.)
2. Login — one passphrase, devices stay signed in ~90 days. Microsoft sign-in later.
3. Capture — both in the app and through the Claude connector.
4. Statuses — Open · In Progress · Parked · Done; "parking lot" is the Parked column.
5. Categories — A / Q / I / D / W / NB kept separate from status.
6. Board — columns by status, drag to move, filters; Brandon added a Group-by Person/Brand switch.
7. Landing page — Today on the phone, Board on desktop.
8. Sharing with direct reports — copy/print agendas now; live shared pages later.
9. Untagged transcript lines — Claude infers a category and marks it "inferred" for review.
10. Voice memos — iPhone Voice Memos transcript, pasted into Capture. (Claude's API does not take audio.)
11. Email — read-only digest first; flagging and drafting only after IT grants Mail.ReadWrite; never send.
12. Migration — import your spreadsheet through Settings → Import.
13. Roster — seed your direct reports and brands; edit in Settings any time.
14. Notifications — Brandon chose a daily 7 am brief in the app and by email (being designed).
15. Privacy — real names in your private tracker; trim before sharing an agenda.

## 6. Your own Claude.ai project

The app expects the same grammar your chat assistant uses. `docs/CLAUDE-PROJECT-TEMPLATE.md` is a fill-in-the-blanks version of Brandon's project instructions: paste it into a new project's custom instructions, replace the placeholders, and after deployment add the connector (Settings → Connector in the app shows the exact URL; claude.ai → Settings → Connectors → Add custom connector; no OAuth).

## 7. Deploy (30 minutes, accounts only you can create)

Run `bash docs/SETUP-WIZARD.sh` in Git Bash from the project folder after personalizing it. It walks through: GitHub account + private repo + push, app secrets, Anthropic API key with a spend limit, Railway project from the repo, `/data` volume, environment variables, public address, the Claude connector, phone install and first import. Budget: Railway Hobby (~$5/month) plus a few dollars of API use.

## 8. Email, and what IT must grant

Claude's Microsoft 365 connection in Claude Code is **read-only** for mail. That is enough for a digest. Flagging emails or leaving drafts needs an Entra admin to add **Mail.ReadWrite** to the Claude app (Enterprise applications → the Claude app → Permissions → Grant admin consent). Never request Mail.Send; the assistant must never send on your behalf. Details and a ready-to-schedule digest prompt: `docs/EMAIL-ROUTINE.md`.

## 9. Suggested skills for your Claude session

- `grilling` or `grill-with-docs` — only for the questions in §5 you want to re-think.
- `wizard` — to regenerate `docs/SETUP-WIZARD.sh` if your accounts differ.
- `claude-api` — load before touching `server/ai/*` (model ids and API shapes changed in 2025–26; the code uses `claude-opus-5-5` with structured outputs).
- `setup-matt-pocock-skills` — only if you want the issue-tracker / triage setup in `CLAUDE.md` for yourself; otherwise delete `docs/agents/` and the "Agent skills" section.
- `to-spec` / `to-tickets` — when you add features.

## 10. Don't redo

Scoping, architecture, the data model, API contract, extraction rules, MCP tools, import mapping, mobile layout, security review, the Railway setup files and the wizard. If something feels wrong, change the decision in `docs/SCOPE.md` first, then the code.

## 11. Secrets

None are in the repo. `.env` is git-ignored; create your own via the wizard. Never paste the connector URL (it contains your token) anywhere public.
