# Deploying and running Virginia

## Run it locally (no accounts needed)

```bash
npm install
cp .env.example .env        # then edit: set DISABLE_AUTH=1 for a quick local look, or set APP_PASSWORD + SESSION_SECRET
npm run dev                 # API on http://localhost:3000, UI on http://localhost:5173
```

Production-style run on one port:

```bash
npm run build
npm start                   # serves API + built client on http://localhost:3000
```

Data lives in `./data/virginia.db` (SQLite). Back it up by copying that file while the server is stopped, or use the volume snapshot on Railway.

Without `ANTHROPIC_API_KEY` the Capture screen still works for explicitly tagged lines (`A:VM …`, `NB:SB …`); untagged transcripts and photos need the key.

## Deploy to Railway (one service + one volume)

Prerequisites: a GitHub repo containing this code, a Railway account, an Anthropic API key. `docs/SETUP-WIZARD.sh` walks through creating all three.

1. **Railway → New Project → Deploy from GitHub repo** → pick the repo. Railway detects the `Dockerfile` (via `railway.json`).
2. **Add a volume**: service → *Settings → Volumes → Add volume*, mount path `/data`. This is where `virginia.db` and uploaded photos live. Without it, data is wiped on every deploy.
3. **Variables** (service → *Variables*):

   | Variable | Value |
   |---|---|
   | `APP_PASSWORD` | a long passphrase you will type on your phone once |
   | `SESSION_SECRET` | 32+ random characters (`openssl rand -hex 32` or any password generator) |
   | `ANTHROPIC_API_KEY` | from console.anthropic.com |
   | `ANTHROPIC_MODEL` | `claude-opus-5-5` (default; `claude-sonnet-5-5` is cheaper) |
   | `MCP_TOKEN` | 32+ random characters; this becomes part of the connector URL |
   | `DATA_DIR` | `/data` (already set in the Dockerfile; set it here too for clarity) |
   | `NODE_ENV` | `production` |

   `PORT` is injected by Railway automatically.
4. **Networking**: *Settings → Networking → Generate Domain*. Open `https://<your-domain>/api/health` — you should see `{"ok":true,...}`.
5. Open the domain on your phone, log in, then *Share → Add to Home Screen* to install it as an app.
6. **Health check** is configured at `/api/health` in `railway.json`; deploys wait for it.

Redeploys happen automatically on every push to the default branch.

## Connect the Virginia project in Claude

1. Claude.ai → *Settings → Connectors → Add custom connector*.
2. Name: `Virginia tracker`. URL: `https://<your-domain>/mcp/<MCP_TOKEN>` (the token is the secret; never paste this URL anywhere public).
3. In the *Virginia - Executive Assistant* project, enable the connector. Claude can then call `list_items`, `add_items`, `update_item`, `get_agenda`, `get_today`, `search`, `list_reference`, `add_brief`.
4. Rotate the token any time by changing `MCP_TOKEN` in Railway and updating the connector URL.

## Import the Brain Dump

Settings → Import → drop `Brandon Runnign Brain Dump.xlsm` → check the preview (fix any unmatched division/person) → Commit. Rows land as items with the right category (New Business → NB, Action Items → A, Watch List → W, Parking Lot → status Parked).

## Updating the app

Any change pushed to GitHub redeploys. To work on it with Claude Code later: open the project folder, `npm install`, `npm run dev`, and point Claude at `docs/SPEC.md`.

## Backups

Railway → service → *Volumes* → snapshots (paid plans) — or, once a week, download the database: Settings → (planned) *Export*. Until an export button exists, use the Railway CLI: `railway ssh` then `sqlite3 /data/virginia.db ".backup /data/backup.db"` and `railway volume` tooling, or simply keep the Brain Dump import file as your baseline.
