# Deploying and running your instance

The app's name, your name, roster and brands come from `assistant.config.json` (see `ONBOARDING.md`). Everything below is the same for every instance.

## Run it locally (no accounts needed)

```bash
npm install
cp assistant.config.example.json assistant.config.json   # fill in your details, then:
npm run config:apply
cp .env.example .env        # then edit: set DISABLE_AUTH=1 for a quick local look, or set APP_PASSWORD + SESSION_SECRET
npm run dev                 # API on http://localhost:3000, UI on http://localhost:5173
```

Production-style run on one port:

```bash
npm run build
npm start                   # serves API + built client on http://localhost:3000
```

Data lives in `./data/virginia.db` (SQLite, the file name is the same in every instance). Back it up by copying that file while the server is stopped, or use the volume snapshot on Railway.

Without `ANTHROPIC_API_KEY` the Capture screen still works for explicitly tagged lines (`A:VM …`, `NB:SB …`); untagged transcripts and photos need the key.

## Deploy to Railway (one service + one volume per person)

Prerequisites: a GitHub repo containing this code, a Railway account, an Anthropic API key. `docs/SETUP-WIZARD.sh` walks through creating all three.

1. **Railway → New Project → Deploy from GitHub repo** → pick the repo. Railway detects the `Dockerfile` (via `railway.json`).
2. **Add a volume**: service → *Settings → Volumes → Add volume*, mount path `/data`. This is where the database and uploaded photos live. Without it, data is wiped on every deploy.
3. **Variables** (service → *Variables*):

   | Variable | Value |
   |---|---|
   | `APP_PASSWORD` | a long passphrase you will type on your phone once |
   | `SESSION_SECRET` | 32+ random characters (`openssl rand -hex 32` or any password generator) |
   | `ANTHROPIC_API_KEY` | from console.anthropic.com |
   | `ANTHROPIC_MODEL` | `claude-opus-5-5` (default; `claude-sonnet-5-5` is cheaper) |
   | `MCP_TOKEN` | 32+ random characters; this becomes part of the connector URL |
   | `RESEND_API_KEY` | from resend.com → API Keys (free tier); enables the emailed morning brief. Leave unset to keep the brief in the app only |
   | `BRIEF_EMAIL_TO` | the address the brief is sent to (your own; the wizard defaults it to the owner email in `assistant.config.json`) |
   | `BRIEF_EMAIL_FROM` | `<your assistant name> <onboarding@resend.dev>` (default; Resend's onboarding sender only delivers to the account's own sign-up address) or an address on a domain you verified in Resend |
   | `BRIEF_TIME` | `07:00` (default) — 24-hour local time, America/Detroit |
   | `BRIEF_DAYS` | `weekdays` (default), `daily`, or a list like `Mon,Wed,Fri` |
   | `BRIEF_ENABLED` | `1` (default); `0` turns the schedule off (the Briefs page and `run_daily_brief` can still run it by hand) |
   | `BRIEF_SECTIONS` | optional comma list to trim the brief, in order: `overdue,dueToday,dueWeek,highPriority,needsOwner,review,addedYesterday,digest` |
   | `BRIEF_SCOPE` | `all` (default: everyone's items with owner initials) or `mine` (your own and unowned items, like Today) |
   | `DATA_DIR` | `/data` (already set in the Dockerfile; set it here too for clarity) |
   | `NODE_ENV` | `production` |

   `PORT` is injected by Railway automatically. The brief variables are described in `docs/example-instance/EMAIL-ROUTINE.md` → *Daily 7 am brief* and `docs/SPEC.md` §11; once the app is up, *Settings → Daily brief* shows the schedule, the last run and the email state, with *Preview today's brief* and *Send now*. `assistant.config.json` is committed in your own repo, so the deploy picks it up; `ASSISTANT_CONFIG` can point at another path if you ever need to.
4. **Networking**: *Settings → Networking → Generate Domain*. Open `https://<your-domain>/api/health` — you should see `{"ok":true,...}`.
5. Open the domain on your phone, log in, then *Share → Add to Home Screen* to install it as an app.
6. **Health check** is configured at `/api/health` in `railway.json`; deploys wait for it.

Redeploys happen automatically on every push to the default branch.

## Connect your Claude.ai project

1. Claude.ai → *Settings → Connectors → Add custom connector*.
2. Name it after your assistant. URL: `https://<your-domain>/mcp/<MCP_TOKEN>` (the token is the secret; never paste this URL anywhere public). The app shows this exact URL under *Settings → Connector* with a Copy button, so you never have to assemble it by hand. No OAuth or extra header is needed.
3. In your Claude project (instructions template: `docs/CLAUDE-PROJECT-TEMPLATE.md`), enable the connector. Claude can then call `list_items`, `add_items`, `update_item`, `get_agenda`, `get_today`, `search`, `list_reference`, `add_brief`, `run_daily_brief`.
4. Rotate the token any time by changing `MCP_TOKEN` in Railway and updating the connector URL.

## Import an existing spreadsheet

Settings → Import → drop your to-do workbook (`.xlsx`, `.xlsm` or `.csv`; tables with `Date | Note | Division | Owner/Target | Priority | Due Date | Status` headers are detected automatically) → check the preview (fix any unmatched division/person) → Commit. Table names map to categories (New Business → NB, Action Items → A, Watch List → W, Parking Lot → status Parked).

## Updating the app

Any change pushed to GitHub redeploys. To work on it with Claude Code later: open the project folder, `npm install`, `npm run dev`, and point Claude at `docs/SPEC.md`.

## Backups

Railway → service → *Volumes* → snapshots (paid plans) — or, once a week, download the database: use the Railway CLI (`railway ssh` then `sqlite3 /data/virginia.db ".backup /data/backup.db"`), or keep your import spreadsheet as the baseline.
