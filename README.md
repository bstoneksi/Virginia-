# Virginia

Brandon Stone's executive-assistant tracker for the KSI Family of Brands. One place for everything captured in a day — pasted meeting transcripts, photos of handwritten notes, screenshots, the Excel brain dump — turned into tagged action items with a kanban board, a Today list, an agenda per direct report and a board per brand. Installs on the phone as a web app; the Claude.ai "Virginia" project talks to the same tracker through a connector.

| Doc | What it is |
|---|---|
| [docs/SCOPE.md](docs/SCOPE.md) | What was reviewed, the shape of the system, and the 15 open design questions with the answers v1 assumed |
| [docs/SPEC.md](docs/SPEC.md) | Build contract: stack, data model, API, extraction rules, MCP tools, import, client pages |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Run locally, deploy to Railway, connect Claude, import the brain dump |
| [docs/SETUP-WIZARD.sh](docs/SETUP-WIZARD.sh) | Step-by-step wizard for the accounts only Brandon can create (GitHub, Railway, Anthropic) |
| [docs/EMAIL-ROUTINE.md](docs/EMAIL-ROUTINE.md) | The separate email-digest routine: what it may and may not do, ready to schedule |

## Quick start

```bash
npm install
cp .env.example .env      # set DISABLE_AUTH=1 for a local look, or APP_PASSWORD + SESSION_SECRET
npm run dev               # API :3000, UI :5173
```

`npm run check` runs typecheck, tests and the production build. `npm start` serves the built app on one port.

## Note grammar (what Virginia understands)

```
A:VM Send updated glass quote — HG due 10/15      action for Vince, Henderson Glass, due Oct 15
NB:SB Flooring bundle idea for K&B installs        new business to raise with Steve next time
Q: Who owns the Atlas vendor renewal? FOB          open question, corporate
W: Byron Center showroom traffic down 3 weeks      watch item
D: Approved the TrueScale pilot budget             decision (recorded as done)
I: Cross-sell scorecard on the sales huddle deck   idea
A: Renew passport PTD                              personal to-do
```

Tags: `A` action · `Q` question · `I` idea · `D` decision · `W` watch · `NB` new business. Initials after the tag = owner or target. A division code anywhere on the line (`K&B`, `K&B-S/I/O`, `APP`, `HG`, `PF`, `RF`, `TS`, `FOB`, `ACC`, `S&M`, `PTD`). Untagged transcripts are read by Claude and every proposal passes a review screen before it becomes an item.
