# KSI assistant tracker (template)

A personal executive-assistant tracker for people at the KSI Family of Brands. One place for everything captured in a day — pasted meeting transcripts, photos of handwritten notes, screenshots, an Excel brain dump — turned into tagged action items with a kanban board, a Today list, an agenda per person you work with and a board per brand. Installs on the phone as a web app; your Claude.ai project talks to the same tracker through a connector.

Each person runs their **own instance**, personalized from one file (`assistant.config.json`): the assistant's name, you, your roster, the brands you file under, your timezone and colors. The first instance is "Virginia" (Brandon Stone); its scoping and decisions are kept in `docs/example-instance/` as a worked example.

**New here? Read [ONBOARDING.md](ONBOARDING.md).** It is written for your Claude Code session as much as for you.

| Doc | What it is |
|---|---|
| [ONBOARDING.md](ONBOARDING.md) | Start your own instance: personalize, decide your workflow, customize, deploy |
| [docs/SPEC.md](docs/SPEC.md) | Build contract: stack, data model, API, extraction rules, connector tools, import, client pages |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Run locally, deploy to Railway, connect Claude, import a spreadsheet |
| [docs/SETUP-WIZARD.sh](docs/SETUP-WIZARD.sh) | Step-by-step wizard for the accounts only you can create (GitHub, Railway, Anthropic) |
| [docs/CLAUDE-PROJECT-TEMPLATE.md](docs/CLAUDE-PROJECT-TEMPLATE.md) | Instructions template for your Claude.ai project |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log for this instance |
| [docs/example-instance/](docs/example-instance/) | How the first instance was scoped, specified and decided (reference) |

## Quick start

```bash
npm install
cp assistant.config.example.json assistant.config.json   # then fill in your name, roster, brands
npm run config:apply
cp .env.example .env      # set DISABLE_AUTH=1 for a local look, or APP_PASSWORD + SESSION_SECRET
npm run dev               # API :3000, UI :5173
```

`npm run check` runs typecheck, tests and the production build. `npm start` serves the built app on one port. `bash scripts/make-template.sh` packages a fresh template zip for the next teammate.

## Note grammar (what the assistant understands)

```
A:VM Send updated glass quote — HG due 10/15      action for Vince, Henderson Glass, due Oct 15
NB:SB Flooring bundle idea for K&B installs        new business to raise with Steve next time
Q: Who owns the Atlas vendor renewal? FOB          open question, corporate
W: Byron Center showroom traffic down 3 weeks      watch item
D: Approved the TrueScale pilot budget             decision (recorded as done)
I: Cross-sell scorecard on the sales huddle deck   idea
A: PTD Renew passport                              personal to-do
```

Tags: `A` action · `Q` question · `I` idea · `D` decision · `W` watch · `NB` new business. Initials after the tag = owner or target. A division code anywhere on the line (`K&B`, `K&B-S/I/O`, `APP`, `HG`, `PF`, `RF`, `TS`, `FOB`, `ACC`, `S&M`, `PTD`). Untagged transcripts are read by Claude and every proposal passes a review screen before it becomes an item.
