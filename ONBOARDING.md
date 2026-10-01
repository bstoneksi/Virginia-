# Starting your own assistant from this template

This repository is a working, tested executive-assistant tracker built for the KSI Family of Brands. One person already runs it ("Virginia", Brandon Stone's instance). You are about to make your own copy and personalize it. Almost everything expensive is already done: the scoping, the architecture, the build, the automated tests, the deployment files and the setup wizard. Your Claude Code session should spend its effort on **what is different about you**, not on rebuilding the tool.

Read this file top to bottom before changing anything. Then follow the steps in order.

## What you are getting

- A phone-installable web app plus API: capture anything (pasted meeting transcripts, photos of handwritten notes, screenshots, an Excel brain dump), Claude turns it into tagged action items, you approve them on a review screen, and they live on a kanban board with a Today list, an agenda per person you work with, a board per brand, a personal list, search and a briefs page.
- A note grammar the extractor understands: `A:` action, `Q:` question, `I:` idea, `D:` decision, `W:` watch, `NB:` new business; initials after the tag = owner/target; a brand code anywhere on the line. Example: `A:VM Send updated glass quote — HG due 10/15`.
- A connector so your own Claude.ai project can read and write the same tracker (Model Context Protocol over HTTPS).
- Single-user login, SQLite storage on a Railway volume, Dockerfile and Railway config, 297 automated tests, a setup wizard for the accounts only you can create.
- Docs: `README.md` (overview and grammar), `docs/SPEC.md` (how it is built, the contract every change must respect), `docs/DEPLOY.md` (run and deploy), `docs/SETUP-WIZARD.sh` (accounts), `docs/CLAUDE-PROJECT-TEMPLATE.md` (the system prompt for your Claude.ai project), and `docs/example-instance/` (how the first instance was scoped and decided, for reference only).

## Step 0 — Get the code into Claude Code

1. Unzip the template (or click **Use this template** on the GitHub repository once the KSI organization has one) into a folder named after your assistant, for example `C:\Users\<you>\code\atlas`.
2. Open that folder in Claude Code (desktop app → open folder). Everything below can be done by asking Claude Code; the commands are here so you can follow along.
3. Prerequisites on your PC: Node.js 24 or newer and Git. No Python, Docker or build tools are needed.

```bash
npm install
```

## Step 1 — Personalize from one file

Everything personal lives in `assistant.config.json` at the repository root. The template ships with `assistant.config.example.json`; copy it and fill it in:

```bash
cp assistant.config.example.json assistant.config.json
```

Fields:

| Field | What to put |
|---|---|
| `assistant.name`, `assistant.tagline` | The name you will call it (the app title, the phone icon label, the connector name) |
| `owner` | Your full name, your initials as you write them in notes, your work email, role, and timezone (`America/Detroit` for Michigan) |
| `organization` | `KSI Family of Brands` / `KSI` unless you run a different unit |
| `branding` | Theme colors; the KSI navy is already set |
| `divisions` | The brands and functions you file items under. The KSI brands are pre-filled (K&B and its sub-units, APP, HG, PF, RF, TS, FOB, ACC, S&M, Personal). Remove the ones you never touch, add your own units |
| `people` | The people you track items for: initials, full name, their brand, email. You are added automatically as "me" from `owner` |

Then:

```bash
npm run config:apply   # writes the name/colors into the app manifest and page title
npm run check          # typecheck + tests + build must stay green
DISABLE_AUTH=1 npm run dev   # look at it: http://localhost:5173
```

Nothing else needs editing for a standard instance. Roster and brands can also be changed later inside the app under Settings; the config file only seeds a brand-new database.

## Step 2 — Decide what is different about your workflow

Before changing code, answer these for yourself (ask Claude Code to walk you through them; Brandon used a one-page click-through decision sheet, `docs/example-instance/decisions-round-1.html`, which you can copy and edit):

1. Where do your notes come from? (voice memos, Teams/Otter transcripts, photos of a notebook, screenshots of texts, an existing spreadsheet to import)
2. Which systems do you live in that the assistant should know about or write to? (Outlook, Teams, HubSpot, Buildertrend, QuickBooks, a shared drive…) Each one is a possible connector or routine; none is required.
3. Who are the people and units you keep lists for? (that is your `people` and `divisions`)
4. Do the six tags and the four statuses (Open · In Progress · Parked · Done) fit, or do you need different words?
5. What should the first screen be: Today (your own list) or the Board?
6. Email rules: may the assistant read your inbox? draft replies? (the first instance's rule: never send anything, drafts only, and only after IT grants write access)
7. Do you want a daily brief, and where (in the app, email, Teams)?

Write the answers into `docs/DECISIONS.md` (start a fresh one) so later sessions do not re-ask.

## Step 3 — Customize with Claude Code (where things live)

Ask Claude Code to make the changes; tell it to read `docs/SPEC.md` first and to keep `npm run check` green. The usual customizations and where they land:

| You want to… | Where it lives |
|---|---|
| Rename statuses or add one | `shared/types.ts` (STATUSES + colors), `server/db/schema.sql` (CHECK constraint), the Board columns in `client/src/components/board/` |
| Change categories or the grammar | `shared/types.ts` (CATEGORIES, labels, colors), `server/ai/grammar.ts` (rule parser), `server/ai/prompt.ts` (what Claude is told) |
| Change what the importer expects | `server/import/mapping.ts` and `server/import/excel.ts` |
| Add a connector tool for your Claude project | `server/mcp/server.ts` |
| Add an integration (HubSpot, Buildertrend…) | a new router under `server/routes/` plus, if Claude should call it, a tool in `server/mcp/server.ts`; keep secrets in environment variables |
| Change pages or navigation | `client/src/pages/` and `client/src/components/AppShell.tsx` |
| Change the daily/email routine | it is not in this codebase: it is a scheduled task in Claude that talks to the app through the connector (see `docs/example-instance/EMAIL-ROUTINE.md`) |

Rules that keep the tool trustworthy — keep them unless you have a reason: nothing the AI proposes lands without your review (the connector's add-items tool is the only deliberate bypass); Done items are never deleted; the app never sends email; every API route requires login.

## Step 4 — Accounts and deployment (only you can do these)

Run the wizard from the project folder in Git Bash; it opens each site and tells you what to click:

```bash
bash docs/SETUP-WIZARD.sh
```

It walks through: a GitHub account and private repo (and pushes the code), the app secrets, an Anthropic API key with a spend limit, a Railway project with a `/data` volume and the environment variables, the public address, the Claude connector, and installing the app on your phone. Each person runs their own Railway service with their own database; nothing is shared between instances. Budget: roughly $5 a month for Railway plus Claude API usage (a few dollars at normal volume).

## Step 5 — Your Claude.ai project

Create a project in Claude.ai for your assistant and paste `docs/CLAUDE-PROJECT-TEMPLATE.md` as its instructions, filling in the placeholders. Add the connector (Settings → Connectors → Add custom connector) with the URL the app shows under Settings → Connector. From then on, "Virginia-style" dictation in chat and the app share one tracker.

## Suggested skills for the Claude Code session

If you have Matt Pocock's engineering skills installed, the repo is already configured for them (`CLAUDE.md`, `docs/agents/`). Useful ones here: `setup-matt-pocock-skills` (point the tracker at your own GitHub repo), `grilling` or `grill-with-docs` (to work through Step 2), `to-spec` (write up a bigger customization before building it), `tdd` and `code-review` (while changing code), `wizard` (if you add another account to set up).

## Do not redo

- Do not re-scope or re-architect the base: the decisions and their reasons are in `docs/SPEC.md` and `docs/example-instance/SCOPE.md`.
- Do not run large multi-agent builds for a personalization; the config file and small targeted edits cover almost everything.
- Do not commit `.env`, `assistant.config.local.json`, or anything under `data/`.
